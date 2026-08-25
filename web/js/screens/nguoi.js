/* ============================================================================
 * web/js/screens/nguoi.js — Con người: danh sách thật từ GET /members.
 *
 * Thay V.nguoi (Task 1 giữ nguyên từ thiet-ke-mau.html, đọc mảng giả PEOPLE)
 * bằng bản gọi API thật. Bộ lọc/vốn từ (nghe/kv qua filterBar()+FSET) GIỮ
 * NGUYÊN — đặc tả nói rõ không thiết kế lại — chỉ đổi nơi chúng nạp dữ liệu:
 * từ lọc mảng PEOPLE trong bộ nhớ (applyF()) sang gọi loadMembers().
 *
 * Cùng phong cách với router.js/ui.js/auth.js: hàm và biến toàn cục thẳng,
 * không bọc IIFE.
 * ========================================================================== */

// Thoát HTML cho dữ liệu người dùng tự nhập (full_name/job) — mảng PEOPLE cũ
// là dữ liệu tĩnh nên mock không cần thoát, dữ liệu thật từ /members thì cần.
function ngEsc(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

var WORK_STATUS_LABEL = {
  available: 'Đang nhận việc',
  by_appointment: 'Nhận việc theo hẹn',
  paused: 'Tạm nghỉ nhận việc'
};
var WORK_STATUS_TONE = { available: 'g', by_appointment: 'o', paused: '' };

// avatar_url thật (khi có) trỏ tới GET /files/:id — route đó đòi
// requireAuth (api/src/modules/files/routes.js), nên một thẻ <img src="...">
// trần sẽ nhận 401 (không có header Authorization). Cùng cách chữa đã dùng ở
// chỗ khác của dự án (secureImageUrl trong web/index-cu.html): tải qua
// api.blob() rồi dựng URL.createObjectURL, giữ cache theo đường dẫn để không
// tải lại mỗi lần paint().
var ngFileUrlCache = {};   // "/files/:id" -> object URL
var ngFileUrlLoading = {}; // "/files/:id" -> true trong lúc đang tải

function ngResolveAvatarUrl(path) {
  if (!path) return null;
  if (String(path).indexOf('/files/') !== 0) return path; // đã là URL công khai (vd. ảnh ngoài), dùng thẳng
  if (ngFileUrlCache[path]) return ngFileUrlCache[path];
  if (!ngFileUrlLoading[path]) {
    ngFileUrlLoading[path] = true;
    api.blob(path).then(function (blob) {
      ngFileUrlCache[path] = URL.createObjectURL(blob);
      if (S.r === 'nguoi') paint();
    }).catch(function () {
      // Không tải được ảnh: coi như không có ảnh, vẫn dùng chữ cái đầu tên.
    }).finally(function () { delete ngFileUrlLoading[path]; });
  }
  return null; // chưa có sẵn: ngAvatar() dùng chữ cái đầu tên thay tạm
}

// Không ảnh (hoặc ảnh chưa tải xong) thì vẽ vòng tròn chữ cái đầu tên, cùng
// kiểu với .mk (logo góc trên bên trái) chứ không gọi dịch vụ ngoài nào.
function ngAvatar(p, size) {
  size = size || 34;
  var url = ngResolveAvatarUrl(p.avatar_url);
  if (url) {
    return '<img src="' + ngEsc(url) + '" style="width:' + size + 'px;height:' + size +
      'px;border-radius:50%;object-fit:cover;flex:none" alt="">';
  }
  var ch = (p.full_name || '?').trim().charAt(0).toUpperCase() || '?';
  return '<div style="width:' + size + 'px;height:' + size + 'px;border-radius:50%;background:var(--or);' +
    'color:#fff;display:grid;place-items:center;font-weight:700;font-size:' + Math.round(size * 0.42) +
    'px;flex:none">' + ngEsc(ch) + '</div>';
}

// ----------------------------------------------------------------------------
// Khu vực: FSET.kv (giữ nguyên từ mockup) hiện nhãn ("Xã Bắc Thái Ninh", ...),
// nhưng GET /members chỉ nhận `area_id` (uuid, listQuerySchema). Tra ngược
// tên → id bằng chính GET /areas mà Task 2 đã thêm cache 60 giây cho — không
// tự bịa danh mục khu vực ở đây, và api.get('/areas') sau lần đầu là miễn phí
// nhờ cache đó.
// ----------------------------------------------------------------------------
var ngAreaMap = null; // tên khu vực -> id; null nghĩa là /areas chưa tải xong

function ngLoadAreas() {
  if (ngAreaMap) return;
  ngAreaMap = {};
  api.get('/areas').then(function (res) {
    (function walk(nodes) {
      (nodes || []).forEach(function (n) {
        ngAreaMap[n.name] = n.id;
        walk(n.children);
      });
    })(res.data);
    if (S.r === 'nguoi') paint();
  }).catch(function () {
    // /areas hỏng: lọc theo khu vực coi như không khớp gì, không chặn cả màn.
  });
}

// ----------------------------------------------------------------------------
// Trạng thái màn (module-level — chỉ một màn "Con người" tồn tại cùng lúc).
// ----------------------------------------------------------------------------
var NG = {
  items: [],
  meta: { page: 1, limit: 20, total: 0 },
  status: 'idle', // idle | loading | loaded | error
  controller: null,
  lastKey: null
};

// S.f là bộ lọc dùng chung của mọi màn danh sách (state.js) — FSET đa chọn
// (mảng), còn GET /members chỉ nhận một `job`/một `area_id`. Lấy lựa chọn đầu
// tiên của mỗi ô làm giá trị lọc gửi lên máy chủ; UI đa chọn vẫn giữ nguyên,
// chỉ phần dịch sang tham số API là đơn-giá-trị theo đúng những gì API nhận.
function ngFiltersFromS() {
  var jobTerm = (S.f.nghe && S.f.nghe.length) ? S.f.nghe[0] : undefined;
  var areaName = (S.f.kv && S.f.kv.length) ? S.f.kv[0] : undefined;
  var areaId = (areaName && ngAreaMap) ? ngAreaMap[areaName] : undefined;
  return { q: S.f.q || undefined, job: jobTerm, area_id: areaId };
}

function loadMembers(filters, page) {
  if (NG.controller) NG.controller.abort();
  var controller = new AbortController();
  NG.controller = controller;
  NG.status = 'loading';

  var query = api.qs({
    q: filters.q, job: filters.job, area_id: filters.area_id,
    work_status: filters.work_status, page: page || 1, limit: 20
  });

  api.get('/members' + query, { signal: controller.signal }).then(function (res) {
    NG.items = res.data;
    NG.meta = res.meta;
    NG.status = 'loaded';
    if (S.r === 'nguoi') paint();
  }).catch(function (err) {
    if (err && err.name === 'AbortError') return; // hủy có chủ đích, không phải lỗi
    NG.status = 'error';
    if (S.r === 'nguoi') paint();
  });
}

// Nút "Thử lại" ở trạng thái lỗi: ép gọi lại loadMembers dù bộ lọc không đổi
// (bình thường V.nguoi() chỉ gọi lại khi khoá bộ lọc đổi — xem bên dưới).
function ngRetry() { NG.lastKey = null; paint(); }

// Rời màn "Con người" (điều hướng sang màn khác) mà lời gọi /members trước
// còn đang bay: hủy nó để khỏi phí một request không ai còn cần kết quả. Đặt
// trong chính tệp này (không sửa router.js) — chỉ nghe hashchange bên ngoài.
window.addEventListener('hashchange', function () {
  var route = location.hash.slice(1).split('/')[0];
  if (route !== 'nguoi' && NG.controller) { NG.controller.abort(); NG.controller = null; }
});

function ngJobAreaLine(p) {
  var parts = [];
  if (p.job) parts.push(ngEsc(p.job));
  if (p.area && p.area.name) parts.push(ngEsc(p.area.name));
  return parts.length ? parts.join(' · ') : 'Chưa cập nhật nghề, khu vực';
}

function ngRow(p, on) {
  var tone = WORK_STATUS_TONE[p.work_status] || '';
  var label = WORK_STATUS_LABEL[p.work_status] || p.work_status || '';
  return '<button class="it ' + (on ? 'on' : '') + '" onclick="go(\'nguoi\',\'' + p.id + '\')">' +
    '<div class="r1">' + ngAvatar(p, 34) + '<span class="t">' + ngEsc(p.full_name) + '</span>' +
    (label ? '<span class="tg ' + tone + '">' + ngEsc(label) + '</span>' : '') + '</div>' +
    '<div class="r2" style="margin-left:43px">' + ngJobAreaLine(p) + '</div>' +
    '</button>';
}

// Chi tiết đầy đủ (GET /members/:id, xin xem số điện thoại, ...) là việc của
// bước tiếp theo (chi tiết + xin xem số điện thoại). Ở đây chỉ hiện những gì
// hàng danh sách đã có sẵn, đủ để hai khung không trống khi chọn một người.
function ngDetail(p) {
  var tone = WORK_STATUS_TONE[p.work_status] || '';
  var label = WORK_STATUS_LABEL[p.work_status] || p.work_status || '';
  return '<div style="display:flex;gap:17px;align-items:flex-end;padding:18px 6px 0">' +
    ngAvatar(p, 88) +
    '<div class="sp"><h1>' + ngEsc(p.full_name) + '</h1>' +
    '<div class="sub">' + ngJobAreaLine(p) + '</div>' +
    (label ? '<div style="margin-top:9px"><span class="tg ' + tone + '">' + ngEsc(label) + '</span></div>' : '') +
    '</div></div>' +
    '<div class="nt" style="margin-top:16px">Xem đầy đủ hồ sơ và xin xem số điện thoại — có ở bước tiếp theo.</div>';
}

// Khung hai cột dùng khi CHƯA có danh sách để đưa cho split() (đang tải / lỗi
// / rỗng) — cùng các lớp CSS split() dùng (pane/list/lh/s/lb/det/ph), lặp lại
// vỏ ngoài của nó thay vì sửa ui.js để thêm một tham số "thông báo".
function ngShell(subText, bodyHtml) {
  var fbar = filterBar(['nghe', 'kv'], NG.meta.total, NG.items.length);
  return '<div class="pane list">' +
    '<div class="lh"><h2>Con người</h2><div class="s">' + subText + '</div></div>' +
    fbar +
    '<div class="lb">' + bodyHtml + '</div>' +
    '</div>' +
    '<div class="pane det"><div class="ph">Chọn một mục bên trái để xem chi tiết</div></div>';
}

V.nguoi = function () {
  ngLoadAreas();

  var f = ngFiltersFromS();
  // Gọi lại loadMembers chỉ khi bộ lọc THẬT SỰ đổi kể từ lần gọi trước — paint()
  // gọi V.nguoi() lại ở MỌI thay đổi (kể cả khi kết quả /members vừa về xong
  // rồi tự paint()); không có chốt này thì mỗi lần tải xong lại tự bắn tiếp
  // một lời gọi giống hệt, vòng lặp không dừng.
  var key = JSON.stringify([f.q, f.job, f.area_id]);
  if (key !== NG.lastKey) {
    NG.lastKey = key;
    loadMembers(f, 1);
  }

  if (NG.status === 'loading' || NG.status === 'idle') {
    return ngShell('Danh bạ thành viên · hiện theo mức mỗi người cho phép', '<div class="em">Đang tải…</div>');
  }
  if (NG.status === 'error') {
    return ngShell('Danh bạ thành viên · hiện theo mức mỗi người cho phép',
      '<div class="em">Không tải được. Kiểm tra mạng rồi thử lại.<br>' +
      '<button class="bt s" style="margin-top:9px" onclick="ngRetry()">Thử lại</button></div>');
  }
  if (NG.items.length === 0) {
    return ngShell(NG.meta.total + ' thành viên · hiện theo mức mỗi người cho phép',
      '<div class="em">Chưa có ai khớp bộ lọc. <a onclick="fclear()">Xoá bộ lọc</a></div>');
  }

  return split({
    title: 'Con người',
    sub: NG.meta.total + ' thành viên · hiện theo mức mỗi người cho phép',
    items: NG.items,
    fbar: filterBar(['nghe', 'kv'], NG.meta.total, NG.items.length),
    row: ngRow,
    detail: ngDetail
  });
};
