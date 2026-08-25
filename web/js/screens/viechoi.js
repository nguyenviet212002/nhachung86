/* ============================================================================
 * web/js/screens/viechoi.js — Việc trong Hội: danh sách thật từ GET /jobs.
 *
 * Thay V.viechoi (Task 1 giữ nguyên từ thiet-ke-mau.html, đọc mảng giả JOBS)
 * bằng bản gọi API thật. Cùng khuôn với web/js/screens/nguoi.js (Task 4–5):
 * trạng thái module-level (VC), AbortController hủy lời gọi cũ khi bộ lọc
 * đổi hoặc rời màn, ba trạng thái tải (loading/error/rỗng), chốt lastKey để
 * không tự gọi lại vô hạn mỗi lượt paint().
 *
 * MD.taoviec (đăng việc) nằm ở web/js/forms/taoviec.js — nạp SAU tệp này,
 * đọc chung ngEsc()/ngAvatar() (đã định nghĩa ở screens/nguoi.js, nạp trước
 * tệp này) để khỏi chép lại logic thoát HTML / tải ảnh đại diện qua GET
 * /files/:id (route đó đòi requireAuth, không dùng <img src> trần được).
 * ========================================================================== */

// ----------------------------------------------------------------------------
// FSET.loai/FSET.tt (index.html) vốn là hai bộ facet CHO MOCK, ba/bốn nhãn
// tiếng Việt không khớp bất kỳ tham số nào của GET /jobs thật (không có
// "loại việc theo trả công", "trạng thái" mock cũng không khớp bốn giá trị
// enum thật). index.html đã đổi nhãn hai bộ đó sang đúng hai enum thật của
// GET /jobs — job_type (loai) và status (tt) — xem chú thích tại chỗ khai
// báo FSET. Hai bảng dưới đây chỉ dịch NHÃN TIẾNG VIỆT ĐÃ ĐỔI đó sang giá
// trị enum snake_case mà máy chủ nhận, cùng chiều ngược lại để tô nút đã
// chọn.
// ----------------------------------------------------------------------------
var VC_JOB_TYPE_BY_LABEL = { 'Dài hạn': 'dai_han', 'Thời vụ': 'thoi_vu', 'Hợp tác': 'hop_tac', 'Học nghề': 'hoc_nghe' };
// VC_STATUS_BY_LABEL dịch NHÃN CỦA BỘ LỌC (FSET.tt trong index.html, vốn có
// nhãn riêng 'Đã nhận đủ người' cho filled — không đổi ở đây, ngoài phạm vi
// nhiệm vụ này) sang enum; KHÔNG dùng để vẽ huy hiệu trạng thái trên từng
// việc — hai việc độc lập, xem VC_STATUS_LABEL ngay dưới.
var VC_STATUS_BY_LABEL = { 'Đang mở': 'open', 'Đã đóng': 'closed', 'Đã nhận đủ người': 'filled', 'Đã hủy': 'cancelled' };
// Nhãn vẽ huy hiệu trạng thái (hàng danh sách + khung chi tiết) — bốn nhãn
// đúng theo đặc tả Nhiệm vụ 7 Bước 4: filled -> "Có người nhận" (KHÔNG phải
// "Đã nhận đủ người" bản Task 6 từng dùng), closed -> "Đã đóng". Cặp đôi này
// dễ đọc lộn vì bốn nhãn không xếp cùng thứ tự với bốn giá trị enum
// open/closed/filled/cancelled liệt kê trong đặc tả — ghi rõ ra đây để khỏi
// tráo lại lần sau.
var VC_STATUS_LABEL = { open: 'Đang mở', closed: 'Đã đóng', filled: 'Có người nhận', cancelled: 'Đã hủy' };
var VC_STATUS_TONE = { open: '', filled: 'g', closed: '', cancelled: 'r' };
var VC_JOB_TYPE_LABEL = { dai_han: 'Dài hạn', thoi_vu: 'Thời vụ', hop_tac: 'Hợp tác', hoc_nghe: 'Học nghề' };

// GET /jobs chỉ nhận MỘT job_type, MỘT status (không phải mảng như FSET đa
// chọn mặc định) — cùng lý do và cùng cách chữa nguoi.js đã dùng cho
// nghe/kv: bọc fpick() TOÀN CỤC, chỉ đổi hành vi khi đang ở màn "Việc trong
// Hội" VÀ đúng hai khoá loai/tt, ép về đơn chọn. Bọc chồng lên bản nguoi.js
// đã bọc (biến vcOrigFpick chụp lại đúng cái đó, không phải bản gốc của
// ui.js) — hai màn không khoá trùng nhau (nguoi.js chỉ xử nghe/kv, ở đây chỉ
// xử loai/tt) nên không giẫm chân, cứ chuyền tiếp xuống dưới khi không khớp.
var vcOrigFpick = window.fpick;
window.fpick = function (k, v) {
  if (S.r === 'viechoi' && (k === 'loai' || k === 'tt')) {
    var cur = S.f[k];
    S.f[k] = (cur.length === 1 && cur[0] === v) ? [] : [v];
    paint();
    return;
  }
  return vcOrigFpick(k, v);
};

function vcFiltersFromS() {
  var jobTypeLabel = (S.f.loai && S.f.loai.length) ? S.f.loai[0] : undefined;
  var statusLabel = (S.f.tt && S.f.tt.length) ? S.f.tt[0] : undefined;
  return {
    q: S.f.q || undefined,
    job_type: jobTypeLabel ? VC_JOB_TYPE_BY_LABEL[jobTypeLabel] : undefined,
    // GET /jobs mặc định status=open khi không gửi — gửi tường minh 'open'
    // khi chưa chọn gì để danh sách và bộ đếm hiển thị đúng cùng một điều
    // đang thật sự lọc (đặc tả Bước 2 của nhiệm vụ).
    status: statusLabel ? VC_STATUS_BY_LABEL[statusLabel] : 'open'
  };
}

// ----------------------------------------------------------------------------
// Trạng thái màn (module-level — chỉ một màn "Việc trong Hội" tồn tại cùng
// lúc, giống NG ở nguoi.js).
// ----------------------------------------------------------------------------
var VC = {
  items: [],
  meta: { page: 1, limit: 20, total: 0 },
  status: 'idle', // idle | loading | loaded | error
  controller: null,
  lastKey: null,
  // Thành viên đang đăng nhập — CHỈ để so sánh với poster_id (gate nút "Đóng
  // việc"). Tải một lần, giữ ở module-level (không theo id việc) — một
  // người dùng, một phiên, id không đổi trong lúc màn còn mở. Cùng khuôn
  // ngLoadAreas() ở nguoi.js: tải trong lúc vẽ (side effect), tự paint() lại
  // khi xong, không chặn khung chi tiết trong lúc chờ.
  me: { status: 'idle', id: null }, // idle | loading | loaded | error
  // Trạng thái "Nhận việc" lạc quan, theo từng id việc — ghi bởi nvSubmit()
  // (web/js/forms/nhanviec.js), đọc bởi vcDetail() ngay dưới. 'pending' (vừa
  // bấm, đang bay) và 'sent' (máy chủ đã xác nhận) HIỂN THỊ GIỐNG HỆT NHAU
  // ("Đã gửi yêu cầu — chờ chủ việc phản hồi") — phân biệt hai trạng thái chỉ
  // để nvSubmit() biết có nên ghi đè 'sent' hay không nếu người dùng đã điều
  // hướng đi nơi khác rồi quay lại trước khi máy chủ trả lời.
  applyState: {}, // id việc -> 'pending' | 'sent'
  applyError: {}, // id việc -> câu lỗi của lần gửi gần nhất (đã revert)
  closing: {},    // id việc -> true trong lúc PATCH đóng việc đang bay
  closeError: {}  // id việc -> câu lỗi của lần đóng gần nhất
};

// Tải GET /members/me một lần — cùng khuôn ngLoadAreas()/ngResolveAvatarUrl:
// gọi TRONG lượt vẽ (vcDetail), không paint() đồng bộ (đang vẽ dở), tự
// paint() lại khi có kết quả nếu còn ở đúng màn này.
function vcLoadMe() {
  if (VC.me.status === 'loading' || VC.me.status === 'loaded') return;
  VC.me.status = 'loading';
  api.get('/members/me').then(function (res) {
    VC.me = { status: 'loaded', id: res.id };
    if (S.r === 'viechoi') paint();
  }).catch(function () {
    // Hỏng thì thôi, coi như chưa biết mình là ai — nút "Đóng việc" cứ ẩn,
    // không chặn cả khung chi tiết vì một lời gọi phụ hỏng.
    VC.me = { status: 'error', id: null };
  });
}

// "Đóng việc" — chỉ người đăng (đã gate ở vcDetail) bấm được. Cập nhật
// PATCH /jobs/:id {status:'closed'}; thành công thì sửa THẲNG bản ghi trong
// VC.items (không nạp lại cả danh sách) — cùng chiều "không refetch, sửa cục
// bộ" mà ngRequestContact() (nguoi.js) đã dùng.
function vcCloseJob(jobId) {
  if (VC.closing[jobId]) return; // chặn bấm đúp trong lúc đang gửi
  if (!confirm('Đóng việc này lại? Sau khi đóng sẽ không ai ứng tuyển thêm được nữa.')) return;
  VC.closing[jobId] = true;
  delete VC.closeError[jobId];
  paint(); // tay cầm onclick thật (ngoài lượt vẽ) — paint() đồng bộ ở đây an toàn
  api.patch('/jobs/' + jobId, { status: 'closed' }).then(function (job) {
    delete VC.closing[jobId];
    for (var i = 0; i < VC.items.length; i++) {
      if (VC.items[i].id === jobId) { VC.items[i].status = job.status; break; }
    }
    if (S.r === 'viechoi') paint();
  }).catch(function (err) {
    delete VC.closing[jobId];
    VC.closeError[jobId] = api.messageFor(err.code);
    if (S.r === 'viechoi') paint();
  });
}

function loadJobs(filters, page) {
  if (VC.controller) VC.controller.abort();
  var controller = new AbortController();
  VC.controller = controller;
  VC.status = 'loading';

  var query = api.qs({
    q: filters.q, job_type: filters.job_type, status: filters.status || 'open',
    page: page || 1, limit: 20
  });

  api.get('/jobs' + query, { signal: controller.signal }).then(function (res) {
    VC.items = res.data;
    VC.meta = res.meta;
    VC.status = 'loaded';
    if (S.r === 'viechoi') paint();
  }).catch(function (err) {
    if (err && err.name === 'AbortError') return; // hủy có chủ đích, không phải lỗi
    VC.status = 'error';
    if (S.r === 'viechoi') paint();
  });
}

function vcRetry() { VC.lastKey = null; paint(); }

// Rời màn (điều hướng sang màn khác) mà lời gọi /jobs trước còn đang bay:
// hủy nó, cùng khuôn nguoi.js.
window.addEventListener('hashchange', function () {
  var route = location.hash.slice(1).split('/')[0];
  if (route !== 'viechoi' && VC.controller) { VC.controller.abort(); VC.controller = null; }
});

function vcDaysLeft(closeAt) {
  if (!closeAt) return null;
  var ms = new Date(closeAt).getTime() - Date.now();
  if (isNaN(ms)) return null;
  return Math.ceil(ms / 86400000);
}

function vcMetaLine(j) {
  var parts = [];
  if (j.profession) parts.push(ngEsc(j.profession));
  if (j.area_name) parts.push(ngEsc(j.area_name));
  var d = vcDaysLeft(j.close_at);
  if (d !== null) parts.push(d >= 0 ? 'còn ' + d + ' ngày' : 'đã hết hạn nhận');
  return parts.length ? parts.join(' · ') : 'Chưa rõ nghề, khu vực';
}

function vcRow(j, on) {
  var tone = VC_STATUS_TONE[j.status] || '';
  var label = VC_STATUS_LABEL[j.status] || j.status || '';
  return '<button class="it ' + (on ? 'on' : '') + '" onclick="go(\'viechoi\',\'' + j.id + '\')">' +
    '<div class="r1">' + ngAvatar({ avatar_url: j.poster_avatar_url, full_name: j.poster_name }, 34) +
    '<span class="t">' + ngEsc(j.title) + '</span>' +
    '<span class="tg ' + tone + '">' + ngEsc(label) + '</span></div>' +
    '<div class="r2" style="margin-left:43px">' + vcMetaLine(j) + '</div>' +
    '<div class="r3" style="margin-left:43px">' + ngEsc(j.poster_name) + ' · ' +
    (j.received_count ? j.received_count + ' người đã nhận' : 'chưa ai nhận') + '</div>' +
    '</button>';
}

// ----------------------------------------------------------------------------
// Khung chi tiết: CHỈ dùng dữ liệu đã có sẵn trong chính mục danh sách, KHÔNG
// gọi thêm GET /jobs/:id.
//
// Task 6 (chú thích cũ ở đây) hoãn việc này lại vì lúc đó khung chi tiết chỉ
// là đọc — Task 7 (nhiệm vụ này) thêm nút "Nhận việc"/"Đóng việc" nên đã đọc
// lại api/src/modules/jobs/service.js's get() để kiểm tra CHẮC CHẮN: get()
// dùng CHUNG hằng JOB_SELECT với list() (dòng khai báo JOB_SELECT ở đầu tệp
// đó, list() và get() đều nội suy `${JOB_SELECT} WHERE ...`), nên MỌI trường
// khung này cần — kể cả poster_id (để so khớp VC.me.id gate nút "Đóng việc")
// và images (json_agg từ job_need_images) — đã có sẵn trong CHÍNH mục danh
// sách, không riêng gì get(). Cái get() có thêm mà list() không có chỉ là ba
// mảng applications/introductions/events (ai đã ứng tuyển/giới thiệu, lịch sử
// sự kiện) — đúng phần "xem đầy đủ ai đã ứng tuyển" mà đặc tả Nhiệm vụ 7 cố
// tình để lại cho một bản cập nhật sau (xem ghi chú cuối hàm). Vì vậy vẫn
// không cần thêm lời gọi GET /jobs/:id ở đây.
// ----------------------------------------------------------------------------
function vcJobImagesHtml(images) {
  if (!images || !images.length) return '';
  var thumbs = images.map(function (img) {
    // Dùng lại ngResolveAvatarUrl() (nguoi.js) — hàm đó không đặc thù cho
    // avatar, chỉ tải một đường dẫn /files/:id có xác thực rồi cache theo
    // đường dẫn; ảnh việc cũng đi qua đúng route đó (files/routes.js đòi
    // requireAuth) nên dùng lại được nguyên vẹn, không chép lại logic tải.
    var url = ngResolveAvatarUrl('/files/' + img.id);
    if (!url) return '<div style="width:84px;height:84px;border-radius:9px;background:var(--soft);flex:none"></div>';
    return '<img src="' + ngEsc(url) + '" style="width:84px;height:84px;border-radius:9px;object-fit:cover;flex:none" alt="' + ngEsc(img.caption || '') + '">';
  }).join('');
  return '<div class="sc">HÌNH ẢNH</div><div class="row" style="gap:8px">' + thumbs + '</div>';
}

function vcDetail(j) {
  vcLoadMe(); // side effect trong lượt vẽ — cùng khuôn ngLoadDetail/ngLoadAreas

  var tone = VC_STATUS_TONE[j.status] || '';
  var label = VC_STATUS_LABEL[j.status] || j.status || '';
  var head = '<div class="hd"><div class="sp"><h1>' + ngEsc(j.title) + '</h1>' +
    '<div class="sub">' + ngEsc(j.poster_name) + ' đăng' +
    (j.job_type ? ' · ' + ngEsc(VC_JOB_TYPE_LABEL[j.job_type] || j.job_type) : '') + '</div></div>' +
    '<span class="tg ' + tone + '">' + ngEsc(label) + '</span></div>';

  var rows = [];
  if (j.area_name) rows.push(['Khu vực', ngEsc(j.area_name)]);
  if (j.profession) rows.push(['Thuộc nghề', ngEsc(j.profession)]);
  if (j.people_needed) rows.push(['Cần mấy người', ngEsc(String(j.people_needed))]);
  if (j.terms) rows.push(['Trả công / điều kiện', ngEsc(j.terms)]);
  if (j.start_note || j.start_at) {
    var startTxt = [j.start_note ? ngEsc(j.start_note) : '', j.start_at ? new Date(j.start_at).toLocaleDateString('vi-VN') : '']
      .filter(Boolean).join(' · ');
    rows.push(['Bắt đầu', startTxt]);
  }
  if (j.close_at) rows.push(['Hạn nhận trả lời', new Date(j.close_at).toLocaleDateString('vi-VN')]);
  if (j.contact_owner) rows.push(['Người chịu trách nhiệm', ngEsc(j.contact_owner)]);

  var kv = rows.map(function (r) {
    return '<div class="kv"><span class="k">' + r[0] + '</span><span class="v">' + r[1] + '</span></div>';
  }).join('');

  // ----------------------------------------------------------------------
  // Nút hành động — Nhận việc (không phải người đăng, việc còn 'open') /
  // Đóng việc (chính người đăng, việc còn 'open' hoặc 'filled').
  //
  // isPoster CHỈ chắc chắn là false-negative trong lúc VC.me.status còn
  // 'idle'/'loading'/'error' (vcLoadMe() gọi ở đầu hàm, side effect, tự
  // paint() lại khi xong) — nghĩa là "Đóng việc" có thể trễ một nhịp xuất
  // hiện sau khi vào màn lần đầu, nhưng không bao giờ hiện SAI cho người
  // không phải chủ việc (an toàn hơn là hiện nhầm rồi 403 khi bấm).
  // ----------------------------------------------------------------------
  var isPoster = VC.me.status === 'loaded' && VC.me.id === j.poster_id;
  var actionHtml = '';

  if (!isPoster) {
    var applyState = VC.applyState[j.id];
    if (applyState === 'pending' || applyState === 'sent') {
      actionHtml += '<div class="nt" style="margin-top:14px">Đã gửi yêu cầu — chờ chủ việc phản hồi.</div>';
    } else if (j.status === 'open') {
      var applyErr = VC.applyError[j.id];
      actionHtml += (applyErr ? '<div class="err" style="display:block;margin-top:14px">' + ngEsc(applyErr) + '</div>' : '') +
        '<button class="bt p" style="margin-top:10px" onclick="vcOpenApply(\'' + j.id + '\')">Nhận việc</button>';
    }
  }

  if (isPoster && (j.status === 'open' || j.status === 'filled')) {
    var closing = !!VC.closing[j.id];
    var closeErr = VC.closeError[j.id];
    actionHtml += (closeErr ? '<div class="err" style="display:block;margin-top:14px">' + ngEsc(closeErr) + '</div>' : '') +
      '<button class="bt s" style="margin-top:10px" ' + (closing ? 'disabled' : '') +
      ' onclick="vcCloseJob(\'' + j.id + '\')">' + (closing ? 'Đang đóng…' : 'Đóng việc') + '</button>';
  }

  return head +
    (j.description ? '<p style="font-size:15px;line-height:1.65;color:var(--body)">' + ngEsc(j.description) + '</p>' : '') +
    (kv ? '<div class="sc">NỘI DUNG</div>' + kv : '') +
    (j.requirements ? '<div class="sc">YÊU CẦU</div><p style="font-size:14.5px;line-height:1.6;color:var(--body)">' + ngEsc(j.requirements) + '</p>' : '') +
    (j.warnings ? '<div class="sc">CẦN NÓI TRƯỚC</div><p style="font-size:14.5px;line-height:1.6;color:var(--body)">' + ngEsc(j.warnings) + '</p>' : '') +
    vcJobImagesHtml(j.images) +
    '<div class="sc">AI ĐANG THAM GIA</div>' +
    '<div class="kv"><span class="k">Đã ứng tuyển / nhận</span><span class="v">' + (j.application_count || 0) + '</span></div>' +
    '<div class="kv"><span class="k">Đã xác nhận cùng làm</span><span class="v">' + (j.received_count || 0) + '</span></div>' +
    '<div class="kv"><span class="k">Đã xong</span><span class="v">' + (j.completed_count || 0) + '</span></div>' +
    actionHtml +
    '<div class="nt" style="margin-top:14px">Xem đầy đủ danh sách người đã ứng tuyển (tên, hồ sơ) sẽ có ở bản cập nhật tiếp theo.</div>';
}

// Khung hai cột dùng khi CHƯA có danh sách (đang tải/lỗi/rỗng) — cùng khuôn
// ngShell() ở nguoi.js.
function vcShell(subText, bodyHtml) {
  var fbar = filterBar(['loai', 'tt'], VC.meta.total, VC.items.length);
  return '<div class="pane list">' +
    '<div class="lh"><h2>Việc trong Hội</h2><div class="s">' + subText + '</div></div>' +
    fbar +
    '<div class="lb">' + bodyHtml + '</div>' +
    '</div>' +
    '<div class="pane det"><div class="ph">Chọn một mục bên trái để xem chi tiết</div></div>';
}

V.viechoi = function () {
  var f = vcFiltersFromS();
  // Gọi lại loadJobs chỉ khi bộ lọc THẬT SỰ đổi — cùng chốt lastKey nguoi.js
  // dùng, tránh vòng lặp gọi lại vô hạn (paint() gọi V.viechoi() lại ở mọi
  // thay đổi, kể cả sau khi /jobs vừa về xong rồi tự paint()).
  var key = JSON.stringify([f.q, f.job_type, f.status]);
  if (key !== VC.lastKey) {
    VC.lastKey = key;
    loadJobs(f, 1);
  }

  if (VC.status === 'loading' || VC.status === 'idle') {
    return vcShell('Việc ai cần người, ai nhận việc', '<div class="em">Đang tải…</div>');
  }
  if (VC.status === 'error') {
    return vcShell('Việc ai cần người, ai nhận việc',
      '<div class="em">Không tải được. Kiểm tra mạng rồi thử lại.<br>' +
      '<button class="bt s" style="margin-top:9px" onclick="vcRetry()">Thử lại</button></div>');
  }
  if (VC.items.length === 0) {
    return vcShell(VC.meta.total + ' việc · ai cần người, ai nhận việc',
      '<div class="em">Chưa có việc nào khớp bộ lọc. <a onclick="fclear()">Xoá bộ lọc</a></div>');
  }

  return split({
    title: 'Việc trong Hội',
    sub: VC.meta.total + ' việc · ai cần người, ai nhận việc',
    items: VC.items,
    fbar: filterBar(['loai', 'tt'], VC.meta.total, VC.items.length),
    row: vcRow,
    detail: vcDetail
  });
};
