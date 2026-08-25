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
var VC_STATUS_BY_LABEL = { 'Đang mở': 'open', 'Đã đóng': 'closed', 'Đã nhận đủ người': 'filled', 'Đã hủy': 'cancelled' };
var VC_STATUS_LABEL = { open: 'Đang mở', closed: 'Đã đóng', filled: 'Đã nhận đủ người', cancelled: 'Đã hủy' };
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
  lastKey: null
};

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
// Khung chi tiết: CHỈ dùng dữ liệu đã có sẵn trong chính mục danh sách
// (GET /jobs trả kèm profession/area_name/poster_*/application_count/... —
// xem JOB_SELECT trong api/src/modules/jobs/service.js), KHÔNG gọi thêm
// GET /jobs/:id. Nhiệm vụ này chỉ làm danh sách + đăng việc; khung chi tiết
// đầy đủ (ai đã ứng tuyển, nhận việc, đóng việc) là việc của một nhiệm vụ
// sau — cố tình không dựng nút ứng tuyển/đóng việc giả ở đây.
// ----------------------------------------------------------------------------
function vcDetail(j) {
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

  return head +
    (j.description ? '<p style="font-size:15px;line-height:1.65;color:var(--body)">' + ngEsc(j.description) + '</p>' : '') +
    (kv ? '<div class="sc">NỘI DUNG</div>' + kv : '') +
    (j.requirements ? '<div class="sc">YÊU CẦU</div><p style="font-size:14.5px;line-height:1.6;color:var(--body)">' + ngEsc(j.requirements) + '</p>' : '') +
    (j.warnings ? '<div class="sc">CẦN NÓI TRƯỚC</div><p style="font-size:14.5px;line-height:1.6;color:var(--body)">' + ngEsc(j.warnings) + '</p>' : '') +
    '<div class="sc">AI ĐANG THAM GIA</div>' +
    '<div class="kv"><span class="k">Đã ứng tuyển / nhận</span><span class="v">' + (j.application_count || 0) + '</span></div>' +
    '<div class="kv"><span class="k">Đã xác nhận cùng làm</span><span class="v">' + (j.received_count || 0) + '</span></div>' +
    '<div class="kv"><span class="k">Đã xong</span><span class="v">' + (j.completed_count || 0) + '</span></div>' +
    '<div class="nt">Xem đầy đủ (ứng tuyển, nhận việc, đóng việc) sẽ có ở bản cập nhật tiếp theo.</div>';
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
