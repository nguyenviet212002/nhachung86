/* ============================================================================
 * web/js/screens/viec.js — "Việc của tôi": bảng tổng hợp bốn nhóm, màn mặc
 * định sau đăng nhập (state.js: S.r mặc định 'viec'; auth.js's post-login
 * cũng về đây).
 *
 * KHÁC HÌNH DẠNG với nguoi.js/viechoi.js: không phải MỘT danh sách từ MỘT
 * endpoint, mà GHÉP bốn nguồn (GET /jobs?mine=true, GET /jobs/connections,
 * GET /members/me/contact-requests, GET /guarantee-invites) rồi phân vào bốn
 * nhóm hoàn toàn ở phía trình duyệt. Bốn nguồn tải SONG SONG và ĐỘC LẬP (mỗi
 * nguồn giữ trạng thái idle/loading/loaded/error riêng, xem VD bên dưới) thay
 * vì gộp vào một Promise.all() chờ tất cả-hoặc-không-gì: một nguồn hỏng (vd.
 * /guarantee-invites rớt mạng) không có lý do kéo sập cả ba nhóm còn lại phụ
 * thuộc ba nguồn kia vẫn tải tốt — mỗi NHÓM chỉ báo lỗi/tải khi đúng những
 * nguồn NÓ cần chưa xong (vdGroupStatus), không phải khi bất kỳ nguồn nào
 * trong bốn nguồn chưa xong.
 *
 * NGỮ NGHĨA TRẠNG THÁI KẾT NỐI (bẫy dễ hiểu ngược, ghi rõ ở đây một lần):
 * `connections.status='contacted'` được ghi NGAY LÚC người thợ (worker) NỘP
 * ĐƠN nhận việc (jobs/service.js's apply(), không phải lúc chủ việc chủ động
 * liên hệ). Suy ra: `poster_id===mình && status==='contacted'` nghĩa là "có
 * người vừa xin nhận việc CỦA MÌNH, tới lượt MÌNH trả lời" (việc của mình,
 * mình là người CẦN LÀM) — còn `worker_id===mình && status==='contacted'`
 * nghĩa là "MÌNH vừa xin nhận việc của người khác, đang CHỜ họ trả lời" (mình
 * đã làm xong phần của mình, giờ chờ người kia). Hai chiều đối chiếu người
 * NGHE, KHÔNG PHẢI ai đăng bài trước.
 *
 * "Lời mời vào Hội mình đã gửi" đọc từ GET /guarantee-invites KHÔNG kèm tham
 * số — mặc định trả lời mời của CHÍNH người gọi (invites/service.js's list():
 * `target = referrerId ?? actor.id`) — KHÔNG dùng /join-requests (chỉ
 * approver/content_ops gọi được, thành viên thường sẽ nhận 403).
 *
 * Mục "BÀI CỦA BẠN ĐANG CHỜ DUYỆT" ở bản mock (ui.js's V.viec cũ, đọc
 * join_requests đang chờ Ban điều hành duyệt sau khi ai đó DÙNG lời mời của
 * mình) CỐ TÌNH BỎ — GET /guarantee-invites chỉ cho biết một lời mời đã dùng
 * hay chưa (status 'used'), không cho biết đơn gia nhập phát sinh từ đó đã
 * được duyệt/từ chối hay còn chờ; câu trả lời đó nằm ở GET /join-requests,
 * đúng route bị chặn ở trên. Không có dữ liệu thì không dựng mục giả.
 *
 * KHÔNG HÀNH ĐỘNG Ở MÀN NÀY — chỉ đọc rồi trỏ sang màn thật (go('viechoi',
 * id)) để làm (nhận việc/đóng việc đã có ở viechoi.js). Riêng "yêu cầu xem
 * liên hệ đang chờ" (contact-requests) chưa có màn nào để trả lời (PATCH
 * /members/me/contact-requests/:id không được giao cho nhiệm vụ nào trong kế
 * hoạch này) — mục đó hiện dạng chữ, không có nút, không trỏ đi đâu cả, thay
 * vì giả vờ có một nơi để bấm.
 * ========================================================================== */

// ----------------------------------------------------------------------------
// Trạng thái màn — BỐN nguồn dữ liệu, mỗi nguồn một vòng đời idle/loading/
// loaded/error riêng (khác VC/NG chỉ có một nguồn). `me` tách khỏi bốn nguồn
// vì hình dạng khác ({id}, không phải {data:[]}) — cùng khuôn vcLoadMe()
// (viechoi.js) nhưng viết lại riêng ở đây (không gọi thẳng vcLoadMe()): hàm
// đó chỉ paint() lại khi `S.r==='viechoi'`, sai màn nếu gọi từ đây.
// ----------------------------------------------------------------------------
var VD = {
  jobs: { status: 'idle', data: [], controller: null },    // GET /jobs?mine=true&status=open — việc mình đăng còn mở
  conns: { status: 'idle', data: [], controller: null },   // GET /jobs/connections — cả hai chiều poster/worker
  creq: { status: 'idle', data: [], controller: null },    // GET /members/me/contact-requests?status=pending
  invites: { status: 'idle', data: [], controller: null }, // GET /guarantee-invites — lời mời mình đã gửi
  me: { status: 'idle', id: null }
};

function vdLoadMe() {
  // Chỉ 'idle' mới được bắn — KHÔNG chỉ chặn 'loading'/'loaded'. V.viec() gọi
  // vdEnsureLoaded() ở MỌI lượt vẽ (không có "khoá bộ lọc" như VC/NG để so
  // sánh đổi/không đổi), nên nếu chặn thiếu 'error' thì lượt vẽ NGAY SAU một
  // lần lỗi sẽ tự bắn lại request — xoá mất trạng thái lỗi trước khi người
  // dùng kịp thấy nút "Thử lại", và vdRetryGroup() (chủ đích reset về 'idle')
  // trở thành thừa. 'error' phải nằm yên cho tới khi vdRetryGroup() đặt lại.
  if (VD.me.status !== 'idle') return;
  VD.me.status = 'loading';
  api.get('/members/me').then(function (res) {
    VD.me = { status: 'loaded', id: res.id };
    if (S.r === 'viec') paint();
  }).catch(function () {
    VD.me = { status: 'error', id: null };
    if (S.r === 'viec') paint();
  });
}

function vdLoadSource(key, path) {
  var s = VD[key];
  if (s.status !== 'idle') return; // xem chú thích cùng lý do ở vdLoadMe()
  s.status = 'loading';
  var controller = new AbortController();
  s.controller = controller;
  api.get(path, { signal: controller.signal }).then(function (res) {
    VD[key] = { status: 'loaded', data: res.data, controller: null };
    if (S.r === 'viec') paint();
  }).catch(function (err) {
    if (err && err.name === 'AbortError') return; // hủy có chủ đích (rời màn), không phải lỗi
    VD[key] = { status: 'error', data: [], controller: null };
    if (S.r === 'viec') paint();
  });
}

// Gọi trong lượt vẽ (cùng khuôn ngLoadAreas/vcLoadMe) — mỗi vdLoadSource()/
// vdLoadMe() tự chặn gọi lại khi nguồn đó KHÔNG còn 'idle' (đang bay, đã
// xong, hoặc đã lỗi), nên gọi lại mỗi paint() không tạo vòng lặp, không bắn
// trùng request, và KHÔNG tự ý xoá một trạng thái lỗi trước khi người dùng
// bấm "Thử lại" (vdRetryGroup()).
function vdEnsureLoaded() {
  vdLoadMe();
  vdLoadSource('jobs', '/jobs' + api.qs({ mine: 'true', status: 'open', limit: 100 }));
  vdLoadSource('conns', '/jobs/connections' + api.qs({ limit: 100 }));
  vdLoadSource('creq', '/members/me/contact-requests' + api.qs({ status: 'pending', limit: 100 }));
  vdLoadSource('invites', '/guarantee-invites' + api.qs({ limit: 100 }));
}

// Rời màn mà còn lời gọi đang bay: hủy hết, cùng khuôn NG/VC.
window.addEventListener('hashchange', function () {
  var route = location.hash.slice(1).split('/')[0];
  if (route !== 'viec') {
    ['jobs', 'conns', 'creq', 'invites'].forEach(function (k) {
      if (VD[k].controller) { VD[k].controller.abort(); VD[k].controller = null; }
    });
  }
});

// Trạng thái GỘP của các nguồn một nhóm cần — 'error' nếu có nguồn nào lỗi,
// 'loading' nếu còn nguồn nào chưa xong (kể cả 'idle', trước khi vdEnsureLoaded
// kịp bắn request), 'ready' chỉ khi mọi nguồn liên quan đã 'loaded'.
function vdGroupStatus(keys) {
  var hasError = false, hasPending = false;
  keys.forEach(function (k) {
    var st = VD[k].status;
    if (st === 'error') hasError = true;
    else if (st !== 'loaded') hasPending = true;
  });
  if (hasError) return 'error';
  if (hasPending) return 'loading';
  return 'ready';
}

// "Thử lại" một nhóm — chỉ reset đúng những nguồn ĐANG lỗi trong nhóm đó
// (nguồn khác trong cùng nhóm, nếu đã tải xong, giữ nguyên — không tải lại
// những gì đã có).
function vdRetryGroup(keys) {
  keys.forEach(function (k) {
    if (VD[k].status === 'error') {
      VD[k] = (k === 'me') ? { status: 'idle', id: null } : { status: 'idle', data: [], controller: null };
    }
  });
  vdEnsureLoaded();
  paint();
}

// ----------------------------------------------------------------------------
// Bốn hàm dựng mục — CHỈ gọi khi vdGroupStatus() của nhóm tương ứng đã
// 'ready' (mọi nguồn cần đã tải xong), nên đọc thẳng VD[...].data không kiểm
// lại trạng thái. Đọc lại chú thích ngữ nghĩa 'contacted' ở đầu tệp trước khi
// sửa hai nhánh poster_id/worker_id dưới đây — dễ tráo ngược.
// ----------------------------------------------------------------------------
function vdBucketCanLam() {
  var items = [];
  VD.creq.data.forEach(function (r) {
    items.push({
      title: ngEsc(r.other_member_name) + ' xin xem ' + (NG_CONTACT_NOUN[r.field_key] || r.field_key) + ' của bạn',
      sub: 'Đang chờ bạn trả lời — mục trả lời ở bản cập nhật tiếp theo',
      onclick: null,
      t: r.created_at
    });
  });
  VD.conns.data.forEach(function (c) {
    if (c.poster_id === VD.me.id && c.status === 'contacted') {
      items.push({
        title: ngEsc(c.worker_name) + ' xin nhận việc "' + ngEsc(c.title || '') + '"',
        sub: 'Việc bạn đăng · cần bạn trả lời',
        onclick: "go('viechoi','" + c.job_need_id + "')",
        t: c.updated_at
      });
    }
  });
  return vdSortDesc(items);
}

function vdBucketDangCho() {
  var items = [];
  VD.invites.data.forEach(function (inv) {
    if (inv.status === 'open') {
      items.push({
        title: 'Lời mời vào Hội bạn đã gửi',
        sub: 'Hạn dùng ' + new Date(inv.expires_at).toLocaleDateString('vi-VN') + ' · chưa ai dùng',
        onclick: null,
        t: inv.created_at
      });
    }
  });
  VD.conns.data.forEach(function (c) {
    if (c.worker_id === VD.me.id && c.status === 'contacted') {
      items.push({
        title: 'Bạn đã xin nhận việc "' + ngEsc(c.title || '') + '"',
        sub: ngEsc(c.poster_name) + ' đăng · đang chờ trả lời',
        onclick: "go('viechoi','" + c.job_need_id + "')",
        t: c.updated_at
      });
    }
  });
  VD.jobs.data.forEach(function (j) {
    if (j.status === 'open' && !j.application_count) {
      items.push({
        title: ngEsc(j.title),
        sub: 'Việc bạn đăng · chưa ai nhận',
        onclick: "go('viechoi','" + j.id + "')",
        t: j.created_at
      });
    }
  });
  return vdSortDesc(items);
}

function vdBucketThamGia() {
  var items = [];
  VD.conns.data.forEach(function (c) {
    if (c.status === 'agreed' || c.status === 'working') {
      var iAmPoster = c.poster_id === VD.me.id;
      items.push({
        title: ngEsc(c.title || ''),
        sub: (iAmPoster ? ngEsc(c.worker_name) + ' đang làm cho bạn' : ngEsc(c.poster_name) + ' đăng · bạn đang làm') +
          ' · ' + (c.status === 'agreed' ? 'Đã đồng ý' : 'Đang làm'),
        onclick: "go('viechoi','" + c.job_need_id + "')",
        t: c.updated_at
      });
    }
  });
  return vdSortDesc(items);
}

function vdBucketDaXong() {
  var items = [];
  VD.conns.data.forEach(function (c) {
    if (c.status === 'done' || c.status === 'failed') {
      var iAmPoster = c.poster_id === VD.me.id;
      items.push({
        text: ngEsc(c.title || '') + ' — ' + (iAmPoster ? ngEsc(c.worker_name) : ngEsc(c.poster_name)) +
          (c.status === 'done' ? ' (đã xong)' : ' (không thành)'),
        t: c.updated_at
      });
    }
  });
  return vdSortDesc(items);
}

function vdSortDesc(items) {
  items.sort(function (a, b) { return new Date(b.t) - new Date(a.t); });
  return items;
}

// ----------------------------------------------------------------------------
// Vẽ: thẻ (.bx trong lưới .g2, cùng lớp mockup cũ dùng) cho ba nhóm đầu, dòng
// thời gian (.tl, cùng lớp "VIỆC ĐÃ LÀM XONG" của bản mock cũ) cho nhóm cuối.
// Mục không có onclick (contact-request đang chờ, lời mời chưa dùng) vẽ
// thành <div> tĩnh thay vì <button> — không giả vờ có chỗ để bấm.
// ----------------------------------------------------------------------------
function vdCards(items) {
  return '<div class="g2">' + items.map(function (it) {
    var body = '<div class="sp"><b style="font-size:15.5px">' + it.title + '</b>' +
      (it.sub ? '<div style="font-size:13.5px;color:var(--mut);margin-top:4px">' + it.sub + '</div>' : '') + '</div>';
    return it.onclick
      ? '<button class="bx" onclick="' + it.onclick + '"><div style="display:flex;gap:9px;align-items:flex-start">' + body + '</div></button>'
      : '<div class="bx" style="cursor:default"><div style="display:flex;gap:9px;align-items:flex-start">' + body + '</div></div>';
  }).join('') + '</div>';
}

function vdTimeline(items) {
  return items.map(function (it) {
    var d = new Date(it.t);
    var label = isNaN(d.getTime()) ? '' : (d.getMonth() + 1) + '-' + d.getFullYear();
    return '<div class="tl"><span class="d">' + label + '</span><span>' + it.text + '</span></div>';
  }).join('');
}

// Một nhóm: {status, count, sortWeight, html}. sortWeight quyết định thứ tự
// hiện (Bước 3 của đặc tả: nhóm rỗng — đã xác nhận, không phải đang tải/lỗi —
// gộp về một dòng và trôi xuống cuối; nhóm đang tải/lỗi giữ nguyên vị trí gốc
// vì "chưa biết là rỗng hay không" khác "đã biết là rỗng").
function vdSection(title, groupKeys, itemsBuilder, render, emptyText) {
  var st = vdGroupStatus(groupKeys);
  var head = '<div class="sc">' + title + '</div>';
  if (st === 'loading') {
    return { status: st, count: 0, sortWeight: 0, html: head + '<div class="em">Đang tải…</div>' };
  }
  if (st === 'error') {
    var retryArg = "['" + groupKeys.join("','") + "']";
    return {
      status: st, count: 0, sortWeight: 0,
      html: head + '<div class="em">Không tải được phần này. <a onclick="vdRetryGroup(' + retryArg + ')">Thử lại</a></div>'
    };
  }
  var items = itemsBuilder();
  if (!items.length) {
    return { status: st, count: 0, sortWeight: 2, html: '<div class="sc">' + title + '</div><div class="em">' + emptyText + '</div>' };
  }
  return {
    status: st, count: items.length, sortWeight: -1,
    html: '<div class="sc">' + title + ' <i>' + items.length + '</i></div>' + render(items)
  };
}

V.viec = function () {
  vdEnsureLoaded();

  var sections = [
    vdSection('CẦN BẠN LÀM', ['creq', 'conns', 'me'], vdBucketCanLam, vdCards,
      'Không có gì cần bạn quyết định lúc này.'),
    vdSection('BẠN ĐANG CHỜ NGƯỜI KHÁC', ['invites', 'conns', 'me', 'jobs'], vdBucketDangCho, vdCards,
      'Không có gì đang chờ.'),
    vdSection('BẠN ĐANG THAM GIA', ['conns', 'me'], vdBucketThamGia, vdCards,
      'Chưa nhận việc nào. <a onclick="go(\'viechoi\')">Xem việc đang cần người →</a>'),
    vdSection('VIỆC BẠN ĐÃ LÀM XONG', ['conns', 'me'], vdBucketDaXong, vdTimeline,
      'Chưa có việc nào đã xong.')
  ];

  var head = '<div class="one wide"><div class="hd"><div class="sp"><h1>Việc của tôi</h1>' +
    '<div class="sub">Việc gấp xếp lên trước.</div></div></div>' + vhint();

  // Rỗng-toàn-bộ: cả bốn nhóm đều đã xác nhận 'ready' và không mục nào — gộp
  // thành MỘT dòng gợi ý duy nhất thay vì bốn tiêu đề + bốn dòng "không có gì"
  // (đúng ý "không phải một bức tường khung rỗng" của đặc tả), CHỈ khi chắc
  // chắn rỗng (không phải vì còn đang tải hay lỗi — hai trạng thái đó vẫn vẽ
  // như bình thường, xem vòng lặp bên dưới).
  var allReadyEmpty = sections.every(function (s) { return s.status === 'ready' && s.count === 0; });
  if (allReadyEmpty) {
    return head +
      '<div class="em" style="margin-top:18px;font-size:15px">' +
      'Bạn chưa có việc gì đang chờ. <a onclick="go(\'viechoi\')">Xem việc đang cần người trong Hội →</a>' +
      '</div></div>';
  }

  var ordered = sections.map(function (s, i) { return { s: s, i: i }; })
    .sort(function (a, b) { return (a.s.sortWeight - b.s.sortWeight) || (a.i - b.i); });

  return head + ordered.map(function (x) { return x.s.html; }).join('') + '</div>';
};
