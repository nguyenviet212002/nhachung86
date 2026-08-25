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
  lastKey: null,
  // Chi tiết một người (GET /members/:id) của MỘT id đang mở — đúng một khung
  // chi tiết tồn tại cùng lúc (split()), nên module-level là đủ, không cần
  // theo từng id như ngFileUrlCache.
  detail: { id: null, status: 'idle', data: null }, // status: idle|loading|loaded|error
  // "Xem" một trường liên hệ đã mở (state self/visible) — key "id|field".
  reveal: {},     // key -> { status: 'loading'|'ok'|'error', value?, message? }
  // "Xin xem" đang gửi (state can_request) — key "id|field" -> true trong lúc bay.
  requesting: {},
  requestError: {} // key -> câu lỗi của lần "Xin xem" gần nhất, nếu có
};

// ----------------------------------------------------------------------------
// fpick() (ui.js) là bộ chọn ĐA GIÁ TRỊ dùng chung cho mọi khoá facet: bấm một
// tuỳ chọn thì thêm/bớt nó khỏi mảng S.f[k], filterBar() tô ✓ và vẽ một chip
// cho MỌI giá trị trong mảng đó. Đúng cho loai/tt/khan (applyF() cục bộ ở
// index.html hiểu "khớp MỘT TRONG các giá trị đã chọn") — nhưng GET /members
// chỉ nhận một `job`, một `area_id` (ngFiltersFromS() bên dưới chỉ lấy phần
// tử ĐẦU của S.f.nghe/S.f.kv). Để nguyên fpick() gốc thì người dùng chọn được
// hai nghề, ô tích hiện CẢ HAI đã chọn, nhưng chỉ nghề đầu tiên thật sự lọc —
// giao diện nói dối về việc gì đang có hiệu lực, và bỏ chọn nghề đầu khiến kết
// quả nhảy sang nghề thứ hai không ai giải thích.
//
// Sửa bằng cách bọc fpick() TOÀN CỤC (không sửa ui.js — filterBar()/FSET vẫn
// y nguyên) nhưng CHỈ đổi hành vi khi đang ở màn "Con người" VÀ đúng hai khoá
// nghe/kv: ép về đơn chọn (chọn giá trị mới thay hẳn giá trị cũ, bấm lại giá
// trị đang chọn thì bỏ chọn). Màn khác (vd. "Việc trong Hội"/"Giúp nhau" cũng
// dùng khoá nghe/kv nhưng lọc client-side qua applyF(), thật sự đa chọn) đi
// qua nhánh gốc y hệt trước, không bị ảnh hưởng.
var ngOrigFpick = window.fpick;
window.fpick = function (k, v) {
  if (S.r === 'nguoi' && (k === 'nghe' || k === 'kv')) {
    var cur = S.f[k];
    S.f[k] = (cur.length === 1 && cur[0] === v) ? [] : [v];
    paint();
    return;
  }
  return ngOrigFpick(k, v);
};

// S.f là bộ lọc dùng chung của mọi màn danh sách (state.js) — FSET đa chọn
// (mảng), còn GET /members chỉ nhận một `job`/một `area_id`. Lấy lựa chọn đầu
// tiên của mỗi ô làm giá trị lọc gửi lên máy chủ; UI đa chọn vẫn giữ nguyên,
// chỉ phần dịch sang tham số API là đơn-giá-trị theo đúng những gì API nhận.
// Ở đúng hai khoá nghe/kv, wrapper fpick() ở trên đã ép mảng còn tối đa một
// phần tử khi đang ở màn này, nên "phần tử đầu" và "phần tử duy nhất" là một —
// UI (✓/chip) và giá trị thật sự gửi lên máy chủ khớp nhau.
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

// ----------------------------------------------------------------------------
// Chi tiết đầy đủ: GET /members/:id + khung sáu trạng thái riêng tư cho bốn
// trường liên hệ (phone/zalo/messenger/address).
//
// LỆCH MỘT CHỖ SO VỚI KẾ HOẠCH — GHI RÕ VÌ SAO:
// Kế hoạch giả định `contacts.<field>.value` của hồ sơ CHI TIẾT đã có sẵn giá
// trị thật khi state là self/visible (dựa trên đọc envelope() không kỹ). Đọc
// lại api/src/core/privacy.js và api/src/modules/members/service.js thì thấy
// KHÔNG PHẢI VẬY: FIELD_SPEC đặt `inline:false` cho cả bốn trường liên hệ, nên
// `allowed = spec.inline && VISIBLE_STATES.has(state)` LUÔN false với chúng —
// value luôn null bất kể state, ở CẢ danh sách lẫn chi tiết. service.js nói
// thẳng bằng chú thích tại get(): "hồ sơ chi tiết KHÔNG phải cửa đọc số điện
// thoại. Cửa đó là readContactField()". Trường liên hệ CHỈ populate qua GET
// /members/:id/contacts/:field (readContactField, rate-limit 10/phút, có ghi
// nhật ký riêng mỗi lượt xem) — đúng nguyên tắc 4 mà chính privacy.js nêu: một
// lượt xem một số điện thoại phải là MỘT hành động riêng, không được tự động
// kèm theo lúc mở hồ sơ.
//
// Vì vậy self/visible ở đây không hiện thẳng giá trị: hiện nút "Xem", bấm mới
// gọi readContactField() — im lặng cho tới lúc người dùng chủ động, không gọi
// hộ khi vừa mở hồ sơ (mở một hồ sơ có đủ bốn trường sẽ không tự tiêu 4/10 lượt
// mỗi phút). Đây đúng là "reveal on demand" mà đặc tả Task 5 có chừa cửa cho
// phép ("Only wire GET /members/:id/contacts/:field if a later task needs a
// distinct 'reveal on demand' UX") — chỉ là cửa đó cần dùng NGAY ở Task 5 chứ
// không phải một task sau, vì không dùng thì self/visible không có gì để hiện.
// ----------------------------------------------------------------------------

var NG_CONTACT_LABEL = { phone: 'Số điện thoại', zalo: 'Zalo', messenger: 'Messenger', address: 'Địa chỉ' };
// Dạng thường, để ghép vào câu "Xin xem …" cho đúng ngữ pháp tiếng Việt (hai
// tên riêng Zalo/Messenger giữ nguyên hoa).
var NG_CONTACT_NOUN = { phone: 'số điện thoại', zalo: 'Zalo', messenger: 'Messenger', address: 'địa chỉ' };

function ngCKey(id, field) { return id + '|' + field; }

// Tải hồ sơ chi tiết một người. Gọi từ TRONG lượt vẽ (ngDetail, giống cách
// ngResolveAvatarUrl/ngLoadAreas tự tải rồi tự paint() lại) nên KHÔNG paint()
// đồng bộ ở đây — làm vậy giữa một lượt paint() đang chạy dở sẽ đệ quy.
function ngLoadDetail(id) {
  if (NG.detail.id === id && (NG.detail.status === 'loading' || NG.detail.status === 'loaded')) return;
  NG.detail = { id: id, status: 'loading', data: null };
  api.get('/members/' + id).then(function (res) {
    if (NG.detail.id !== id) return; // đã chuyển sang người khác trong lúc chờ
    NG.detail = { id: id, status: 'loaded', data: res };
    if (S.r === 'nguoi') paint();
  }).catch(function () {
    if (NG.detail.id !== id) return;
    NG.detail = { id: id, status: 'error', data: null };
    if (S.r === 'nguoi') paint();
  });
}

// Nút "Thử lại" của khung chi tiết lỗi — cùng khuôn với ngRetry(): xoá trạng
// thái rồi paint() (đây LÀ một tay cầm onclick thật, chạy ngoài lượt vẽ, nên
// paint() đồng bộ ở đây an toàn, khác ngLoadDetail ở trên).
function ngRetryDetail() {
  NG.detail = { id: null, status: 'idle', data: null };
  paint();
}

// "Xem" một trường liên hệ đang ở state self/visible — cửa DUY NHẤT lấy được
// giá trị thật, xem chú thích lớn phía trên.
function ngRevealContact(id, field) {
  var key = ngCKey(id, field);
  if (NG.reveal[key] && NG.reveal[key].status === 'loading') return; // đang bay, khỏi bắn thêm
  NG.reveal[key] = { status: 'loading' };
  paint(); // tay cầm onclick thật (không phải trong lượt vẽ) — paint() đồng bộ ở đây an toàn
  api.get('/members/' + id + '/contacts/' + field).then(function (res) {
    NG.reveal[key] = { status: 'ok', value: res.value };
    if (S.r === 'nguoi') paint();
  }).catch(function (err) {
    NG.reveal[key] = { status: 'error', message: err.message };
    if (S.r === 'nguoi') paint();
  });
}

// "Xin xem [trường]" — state can_request. Thành công thì cập nhật lạc quan
// state cục bộ sang 'requested' ngay, không tải lại cả hồ sơ (đặc tả mục
// "Cập nhật lạc quan" — không bắt buộc cho việc này nhưng làm được thì làm).
function ngRequestContact(id, field) {
  var key = ngCKey(id, field);
  if (NG.requesting[key]) return; // chặn bấm đúp trong lúc đang gửi
  NG.requesting[key] = true;
  delete NG.requestError[key];
  paint();
  api.post('/members/' + id + '/contact-requests', { field_key: field }, api.newIdemKey()).then(function () {
    delete NG.requesting[key];
    if (NG.detail.id === id && NG.detail.data && NG.detail.data.contacts && NG.detail.data.contacts[field]) {
      NG.detail.data.contacts[field].state = 'requested';
    }
    if (S.r === 'nguoi') paint();
  }).catch(function (err) {
    delete NG.requesting[key];
    NG.requestError[key] = err.message;
    if (S.r === 'nguoi') paint();
  });
}

// Một hàng "khoá: giá trị" (lớp .kv có sẵn từ mockup) cho một trường liên hệ,
// theo đúng bảng sáu trạng thái của Task 5. `closed` KHÔNG vẽ gì — kể cả nhãn
// tên trường — để không tự rò việc trường đó tồn tại theo cách thiết kế không
// định làm.
function ngContactRow(memberId, field, fs) {
  if (!fs || fs.state === 'closed') return '';
  var label = NG_CONTACT_LABEL[field];
  var key = ngCKey(memberId, field);

  if (fs.state === 'self' || fs.state === 'visible') {
    var rv = NG.reveal[key];
    var right;
    if (rv && rv.status === 'ok') {
      right = '<span class="v">' + ngEsc(rv.value ? rv.value : 'Chưa cập nhật') + '</span>';
    } else if (rv && rv.status === 'loading') {
      right = '<span class="v" style="color:var(--fnt)">Đang tải…</span>';
    } else if (rv && rv.status === 'error') {
      right = '<span class="v" style="color:var(--rd);font-size:13px">' + ngEsc(rv.message) +
        ' <a onclick="ngRevealContact(\'' + memberId + '\',\'' + field + '\')">Thử lại</a></span>';
    } else {
      right = '<button class="bt s" style="margin-left:auto" onclick="ngRevealContact(\'' + memberId + '\',\'' + field + '\')">Xem</button>';
    }
    // self: một chỗ "Sửa" hiện diện nhưng bất động — màn "Hồ sơ của tôi" thật
    // (sửa trực tiếp) chưa nối, và Task 5 không dựng luồng sửa giả cho có.
    var edit = fs.state === 'self'
      ? '<button class="bt s" disabled style="margin-left:8px;opacity:.5;cursor:default" title="Sửa ở Hồ sơ của tôi — chưa nối ở bước này">Sửa</button>'
      : '';
    return '<div class="kv"><span class="k">' + ngEsc(label) + '</span>' + right + edit + '</div>';
  }

  if (fs.state === 'can_request') {
    var busy = !!NG.requesting[key];
    var err = NG.requestError[key];
    return '<div class="kv"><span class="k">' + ngEsc(label) + '</span>' +
      (err ? '<span class="v" style="color:var(--rd);font-size:13px">' + ngEsc(err) + '</span>' : '') +
      '<button class="bt s p" style="margin-left:auto" ' + (busy ? 'disabled' : '') +
      ' onclick="ngRequestContact(\'' + memberId + '\',\'' + field + '\')">' +
      (busy ? 'Đang gửi…' : 'Xin xem ' + ngEsc(NG_CONTACT_NOUN[field])) + '</button></div>';
  }

  if (fs.state === 'requested') {
    return '<div class="kv"><span class="k">' + ngEsc(label) + '</span>' +
      '<button class="bt s" disabled style="margin-left:auto;opacity:.6;cursor:default">Đang chờ trả lời</button></div>';
  }

  // denied
  return '<div class="kv"><span class="k">' + ngEsc(label) + '</span>' +
    '<span class="v" style="margin-left:auto;color:var(--fnt)">Đã từ chối</span></div>';
}

function ngDetail(p) {
  ngLoadDetail(p.id); // side effect trong lượt vẽ — cùng khuôn ngResolveAvatarUrl/ngLoadAreas

  var tone = WORK_STATUS_TONE[p.work_status] || '';
  var label = WORK_STATUS_LABEL[p.work_status] || p.work_status || '';
  var head = '<div style="display:flex;gap:17px;align-items:flex-end;padding:18px 6px 0">' +
    ngAvatar(p, 88) +
    '<div class="sp"><h1>' + ngEsc(p.full_name) + '</h1>' +
    '<div class="sub">' + ngJobAreaLine(p) + '</div>' +
    (label ? '<div style="margin-top:9px"><span class="tg ' + tone + '">' + ngEsc(label) + '</span></div>' : '') +
    '</div></div>';

  if (NG.detail.id !== p.id || NG.detail.status === 'loading' || NG.detail.status === 'idle') {
    return head + '<div class="nt" style="margin-top:16px">Đang tải chi tiết…</div>';
  }
  if (NG.detail.status === 'error') {
    return head + '<div class="em" style="margin-top:16px">Không tải được chi tiết hồ sơ.<br>' +
      '<button class="bt s" style="margin-top:9px" onclick="ngRetryDetail()">Thử lại</button></div>';
  }

  var d = NG.detail.data;
  var rows = ['phone', 'zalo', 'messenger', 'address'].map(function (f) {
    return ngContactRow(d.id, f, d.contacts && d.contacts[f]);
  }).join('');

  return head +
    (d.bio ? '<div class="nt" style="margin-top:16px">' + ngEsc(d.bio) + '</div>' : '') +
    (rows ? '<div class="sc">LIÊN HỆ</div>' + rows : '');
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
