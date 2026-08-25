/* ============================================================================
 * web/js/forms/taoviec.js — MD.taoviec: đăng một việc, POST /jobs thật.
 *
 * Thay MD.taoviec (Task 1 giữ nguyên từ thiet-ke-mau.html, mọi nút chỉ gọi
 * alert()) bằng bản gửi thật lên POST /jobs. Giữ NGUYÊN khung ba bước (wz()/
 * .wz từ ui.js) — đặc tả nói rõ không thiết kế lại các bước — chỉ đổi:
 *   (a) các trường thật sự có trong api/src/modules/jobs/schema.js's
 *       jobFields — bỏ những ô mock không có trường thật tương ứng (ảnh kèm
 *       theo: không có endpoint gắn ảnh khi tạo; "Nhắc lại": không có trường
 *       nhắc; "Loại việc" bước 1 mock vốn là ba nhãn trả-công không khớp
 *       enum job_type thật, đổi nhãn ngay tại chỗ khai báo sang bốn nhãn thật
 *       "Dài hạn/Thời vụ/Hợp tác/Học nghề" — cùng bốn nhãn viechoi.js đã đổi
 *       cho bộ lọc danh sách, để hai nơi nói cùng một khái niệm),
 *   (b) chỉ "Tên việc" (title) có dấu * — MỌI trường khác trong jobFields
 *       nullable/optional, không ép người dùng điền,
 *   (c) một khoá idempotency SINH MỘT LẦN khi mở modal (không sinh lại mỗi
 *       lần bấm Đăng việc — cùng ý định giữ cùng khoá qua mọi lần bấm lại),
 *   (d) lỗi VALIDATION_FAILED (err.fields) hiện DƯỚI TỪNG Ô qua lớp .fd.bad/
 *       .err đã có sẵn (css/app.css) — không phải một băng lỗi chung.
 *
 * Modal render lại TOÀN BỘ innerHTML mỗi lần đổi bước (wz() trong ui.js:
 * `ov.innerHTML = MD[S.md]()`) — input do đó KHÔNG "controlled" theo từng
 * phím gõ (sẽ nhảy con trỏ nếu render lại mỗi ký tự). Thay vào đó: đọc giá
 * trị DOM của bước đang rời (vcCaptureStep) NGAY TRƯỚC KHI đổi bước/đóng
 * modal, lưu vào TV.data; các control rời rạc (radio loại việc, ai thấy, ai
 * liên hệ, hiện số điện thoại) cập nhật TV.data NGAY khi bấm rồi render lại
 * toàn bộ — an toàn vì đó không phải ô gõ chữ.
 *
 * mo()/wz()/dong() (ui.js) dùng chung cho MỌI modal của app — bọc toàn cục
 * ba hàm đó, chỉ đổi hành vi khi S.md==='taoviec', cùng kỹ thuật nguoi.js/
 * viechoi.js đã dùng để bọc fpick().
 * ========================================================================== */

var VC_AREA_MAP = null;  // tên khu vực -> id, null nghĩa là /areas chưa tải xong
var VC_AREA_LIST = null; // tên khu vực, theo đúng thứ tự cây (walk trước-sau)

function vcLoadAreas() {
  if (VC_AREA_MAP) return;
  VC_AREA_MAP = {};
  VC_AREA_LIST = [];
  api.get('/areas').then(function (res) {
    (function walk(nodes) {
      (nodes || []).forEach(function (n) {
        VC_AREA_MAP[n.name] = n.id;
        VC_AREA_LIST.push(n.name);
        walk(n.children);
      });
    })(res.data);
    if (S.md === 'taoviec') document.getElementById('ov').innerHTML = MD.taoviec();
  }).catch(function () {
    // /areas hỏng: ô chọn khu vực coi như trống, không chặn cả form — area_id
    // là trường nullable/optional.
  });
}

var VC_FIELD_STEP = {
  title: 1, description: 1, profession: 1, people_needed: 1, job_type: 1,
  area_id: 2, terms: 2, start_at: 2, start_note: 2, close_at: 2, requirements: 2, warnings: 2, contact_owner: 2,
  visibility: 3, contact_policy: 3, show_phone: 3
};

var TV = { idemKey: null, data: {}, errors: {}, submitting: false, generalError: null };

function vcDefaultData() {
  return {
    job_type: '', title: '', description: '', profession: '', people_needed: '',
    area_name: '', terms: '', start_at: '', start_note: '', close_at: '',
    requirements: '', warnings: '', contact_owner: '',
    visibility: 'profession', contact_policy: 'approval', show_phone: false
  };
}

function vcResetForm() {
  TV.idemKey = api.newIdemKey(); // MỘT lần lúc mở modal — spec idempotency: cùng ý định giữ cùng khoá
  TV.data = vcDefaultData();
  TV.errors = {};
  TV.submitting = false;
  TV.generalError = null;
  vcLoadAreas();
}

function vcCaptureStep(step) {
  function val(id) { var el = document.getElementById(id); return el ? el.value : undefined; }
  if (step === 1) {
    if (val('tv_title') !== undefined) TV.data.title = val('tv_title');
    if (val('tv_desc') !== undefined) TV.data.description = val('tv_desc');
    if (val('tv_profession') !== undefined) TV.data.profession = val('tv_profession');
    if (val('tv_people') !== undefined) TV.data.people_needed = val('tv_people');
  } else if (step === 2) {
    if (val('tv_area') !== undefined) TV.data.area_name = val('tv_area');
    if (val('tv_terms') !== undefined) TV.data.terms = val('tv_terms');
    if (val('tv_start_at') !== undefined) TV.data.start_at = val('tv_start_at');
    if (val('tv_start_note') !== undefined) TV.data.start_note = val('tv_start_note');
    if (val('tv_close_at') !== undefined) TV.data.close_at = val('tv_close_at');
    if (val('tv_requirements') !== undefined) TV.data.requirements = val('tv_requirements');
    if (val('tv_warnings') !== undefined) TV.data.warnings = val('tv_warnings');
    if (val('tv_contact_owner') !== undefined) TV.data.contact_owner = val('tv_contact_owner');
  }
  // Bước 3 chỉ có control rời rạc (radio/nút chọn) — đã ghi thẳng vào
  // TV.data lúc bấm (vcSet), không có gì để đọc từ DOM ở đây.
}

// Control rời rạc (không phải ô gõ chữ) — cập nhật rồi render lại toàn bộ
// ngay, an toàn vì không có con trỏ để mất.
function vcSet(key, value) {
  TV.data[key] = value;
  document.getElementById('ov').innerHTML = MD.taoviec();
}
function vcToggleJobType(value) {
  TV.data.job_type = (TV.data.job_type === value) ? '' : value; // job_type nullable/optional: cho bỏ chọn
  document.getElementById('ov').innerHTML = MD.taoviec();
}

function vcCount(id, cntId, max) {
  var el = document.getElementById(id), c = document.getElementById(cntId);
  if (el && c) c.textContent = el.value.length + ' / ' + max;
}

function vcHasAnyData() {
  var d = TV.data;
  return !!((d.title && d.title.trim()) || (d.description && d.description.trim()) ||
    (d.profession && d.profession.trim()) ||
    (d.people_needed && String(d.people_needed).trim()) || (d.terms && d.terms.trim()) ||
    d.start_at || d.close_at || (d.start_note && d.start_note.trim()) ||
    (d.requirements && d.requirements.trim()) || (d.warnings && d.warnings.trim()) ||
    (d.contact_owner && d.contact_owner.trim()) || d.job_type || d.area_name);
  // visibility/contact_policy/show_phone cố ý KHÔNG tính: đó là những lựa
  // chọn có nghĩa dù người dùng chưa chạm form (ai thấy/ai liên hệ/hiện số
  // điện thoại luôn CÓ một giá trị hợp lệ, không phải "chưa chọn gì"). Ngược
  // lại, KHÔNG có "nghề mặc định hợp lý" — trước đây profession mặc định
  // NGHE[0] ('Xây dựng — hoàn thiện') và bị gộp vào nhóm này, khiến việc dán
  // nhãn sai nghề không tính là "có dữ liệu". Sửa: profession giờ mặc định
  // rỗng (giống area_id) nên tự nhiên rơi vào nhánh có tính ở trên.
}

function vcNonEmpty(v) { v = (v == null ? '' : String(v)).trim(); return v ? v : undefined; }

function vcBuildPayload() {
  var d = TV.data, p = { title: (d.title || '').trim() };
  var desc = vcNonEmpty(d.description); if (desc) p.description = desc;
  var prof = vcNonEmpty(d.profession); if (prof) p.profession = prof;
  if (d.people_needed !== '' && d.people_needed != null) {
    var n = parseInt(d.people_needed, 10);
    if (!isNaN(n)) p.people_needed = n;
  }
  if (d.job_type) p.job_type = d.job_type;
  if (d.area_name && VC_AREA_MAP && VC_AREA_MAP[d.area_name]) p.area_id = VC_AREA_MAP[d.area_name];
  var terms = vcNonEmpty(d.terms); if (terms) p.terms = terms;
  if (d.start_at) { var da = new Date(d.start_at); if (!isNaN(da.getTime())) p.start_at = da.toISOString(); }
  var sn = vcNonEmpty(d.start_note); if (sn) p.start_note = sn;
  if (d.close_at) { var dc = new Date(d.close_at); if (!isNaN(dc.getTime())) p.close_at = dc.toISOString(); }
  var req = vcNonEmpty(d.requirements); if (req) p.requirements = req;
  var warn = vcNonEmpty(d.warnings); if (warn) p.warnings = warn;
  var owner = vcNonEmpty(d.contact_owner); if (owner) p.contact_owner = owner;
  p.visibility = d.visibility;
  p.contact_policy = d.contact_policy;
  p.show_phone = !!d.show_phone;
  return p;
}

function vcSubmit() {
  if (TV.submitting) return; // chặn bấm đúp trong lúc đang gửi
  vcCaptureStep(S.wz);

  var title = (TV.data.title || '').trim();
  if (title.length < 6 || title.length > 200) {
    TV.errors = { title: title.length === 0 ? 'Chưa nhập tên việc.' : 'Tên việc cần 6–200 ký tự.' };
    S.wz = 1;
    document.getElementById('ov').innerHTML = MD.taoviec();
    return;
  }

  TV.errors = {};
  TV.generalError = null;
  TV.submitting = true;
  document.getElementById('ov').innerHTML = MD.taoviec(); // vẽ lại: nút Đăng việc hiện "Đang đăng…", disabled

  api.post('/jobs', vcBuildPayload(), TV.idemKey).then(function (job) {
    TV.submitting = false;
    VC.lastKey = null; // ép loadJobs() nạp lại danh sách ở lượt V.viechoi() kế tiếp
    vcOrigDong(); // đóng thẳng — đã gửi xong, khỏi hỏi "mất dữ liệu chưa lưu"
    alert('Đã đăng việc "' + job.title + '".');
    if (S.r === 'viechoi') paint();
  }).catch(function (err) {
    TV.submitting = false;
    if (err.code === 'VALIDATION_FAILED' && err.fields) {
      TV.errors = err.fields;
      var steps = Object.keys(err.fields).map(function (f) { return VC_FIELD_STEP[f] || 1; });
      S.wz = steps.length ? Math.min.apply(null, steps) : 1;
    } else {
      TV.generalError = err.message;
    }
    document.getElementById('ov').innerHTML = MD.taoviec();
  });
}

// ----------------------------------------------------------------------------
// Bọc ba hàm dùng chung của MỌI modal (ui.js) — chỉ đổi hành vi khi đang mở
// đúng modal 'taoviec', chuyển tiếp nguyên vẹn cho mọi modal khác.
// ----------------------------------------------------------------------------
var vcOrigMo = window.mo;
window.mo = function (n) {
  if (n === 'taoviec') vcResetForm();
  return vcOrigMo(n);
};

var vcOrigWz = window.wz;
window.wz = function (d) {
  if (S.md === 'taoviec') vcCaptureStep(S.wz); // đọc DOM của bước ĐANG RỜI trước khi ui.js vẽ lại
  return vcOrigWz(d);
};

var vcOrigDong = window.dong;
window.dong = function () {
  if (S.md === 'taoviec' && !TV.submitting) {
    vcCaptureStep(S.wz);
    if (vcHasAnyData() && !confirm('Đóng lại sẽ mất nội dung đã nhập cho việc này. Bạn có chắc muốn đóng?')) return;
  }
  return vcOrigDong();
};

// ----------------------------------------------------------------------------
// Render
// ----------------------------------------------------------------------------
var VC_JOB_TYPE_OPTS = [['dai_han', 'Dài hạn'], ['thoi_vu', 'Thời vụ'], ['hop_tac', 'Hợp tác'], ['hoc_nghe', 'Học nghề']];
var VC_VISIBILITY_OPTS = [['profession', 'Người đúng nghề và ở gần', 'Chỉ người cùng nghề, gần khu vực thấy và nhận thông báo'],
  ['community', 'Cả cộng đồng', 'Mọi thành viên trong Hội đều thấy'],
  ['selected', 'Vài người tôi tự chọn', 'Chỉ người anh chọn mới thấy (chọn sau khi đăng)']];
var VC_CONTACT_POLICY_OPTS = [['anyone', 'Ai cũng được'], ['approval', 'Người tôi duyệt'], ['admin', 'Qua Ban điều hành']];

function vcOptSelect(list, selected) {
  return list.map(function (name) { return '<option ' + (name === selected ? 'selected' : '') + '>' + ngEsc(name) + '</option>'; }).join('');
}

// Dòng lỗi máy chủ cho ba control chọn rời rạc ở bước 3 (visibility/
// contact_policy/show_phone) — không đi qua vcFd() vì chúng không phải một ô
// nhập đơn, nhưng vẫn cần hiện lỗi VALIDATION_FAILED nếu máy chủ trả về.
function vcErrLine(field) {
  var err = TV.errors[field];
  return err ? '<div class="err" style="display:block">' + ngEsc(err) + '</div>' : '';
}

function vcFd(field, labelHtml, innerHtml, hint) {
  var err = TV.errors[field];
  return '<div class="fd' + (err ? ' bad' : '') + '" id="fd_' + field + '">' +
    '<label>' + labelHtml + '</label>' + innerHtml +
    '<div class="err">' + (err ? ngEsc(err) : '') + '</div>' +
    (hint ? '<div class="hint">' + hint + '</div>' : '') +
    '</div>';
}

MD.taoviec = function () {
  var W = ['Việc gì', 'Điều kiện', 'Ai thấy'];
  var d = TV.data;

  var body;
  if (S.wz === 1) {
    body =
      '<div class="fd' + (TV.errors.job_type ? ' bad' : '') + '"><label>Loại việc <span style="color:var(--fnt);font-weight:400">— không bắt buộc</span></label>' +
      '<div class="g3">' + VC_JOB_TYPE_OPTS.map(function (o) {
        var on = d.job_type === o[0];
        return '<label class="pick ' + (on ? 'on' : '') + '" onclick="vcToggleJobType(\'' + o[0] + '\')">' +
          '<div><b>' + o[1] + '</b></div></label>';
      }).join('') + vcErrLine('job_type') + '</div></div>' +
      vcFd('title', 'Tên việc <span class="req">*</span>',
        '<input class="in" id="tv_title" maxlength="200" placeholder="Cần 2 thợ ốp lát làm dài hạn" ' +
        'value="' + ngEsc(d.title) + '" oninput="vcCount(\'tv_title\',\'tv_title_cnt\',200)">' +
        '<div class="cnt" id="tv_title_cnt">' + (d.title || '').length + ' / 200</div>',
        'Viết như đang nói với anh em. Người đọc phải hiểu ngay trong một dòng.') +
      vcFd('description', 'Nói rõ hơn <span style="color:var(--fnt);font-weight:400">— không bắt buộc</span>',
        '<textarea class="in" id="tv_desc" maxlength="5000" placeholder="Công trình nhà dân hai tầng, phần ốp lát khoảng 3 tuần. Cần một tổ 2–3 người làm được liên tục. Vật tư chủ nhà lo, chỉ tính công.">' + ngEsc(d.description) + '</textarea>') +
      '<div class="r2c">' +
      vcFd('profession', 'Thuộc nghề <span style="color:var(--fnt);font-weight:400">— không bắt buộc</span>',
        '<select class="in" id="tv_profession"><option value="">— Chưa chọn —</option>' + vcOptSelect(NGHE, d.profession) + '</select>') +
      vcFd('people_needed', 'Cần mấy người',
        '<input class="in" id="tv_people" type="number" min="1" max="1000" value="' + ngEsc(d.people_needed) + '">') +
      '</div>';
  } else if (S.wz === 2) {
    var areaOpts = VC_AREA_LIST === null
      ? '<option value="">Đang tải khu vực…</option>'
      : '<option value="">— Chưa chọn —</option>' + vcOptSelect(VC_AREA_LIST, d.area_name);
    body =
      '<div class="r2c">' +
      vcFd('area_id', 'Khu vực làm việc <span style="color:var(--fnt);font-weight:400">— không bắt buộc</span>',
        '<select class="in" id="tv_area">' + areaOpts + '</select>') +
      '<div class="fd"></div>' + // giữ đúng lưới 2 cột như mock, không có ô "nơi làm cụ thể" — không có trường thật tương ứng
      '</div>' +
      vcFd('terms', 'Trả công / điều kiện <span style="color:var(--fnt);font-weight:400">— không bắt buộc</span>',
        '<input class="in" id="tv_terms" maxlength="2000" placeholder="Tính theo mét vuông · trả theo tuần" value="' + ngEsc(d.terms) + '">',
        'Ghi "thoả thuận" cũng được, nhưng ghi rõ thì đỡ mất công hỏi lại.') +
      '<div class="r3c">' +
      vcFd('start_at', 'Bắt đầu', '<input class="in" id="tv_start_at" type="date" value="' + ngEsc(d.start_at) + '">') +
      vcFd('start_note', 'Dự kiến kéo dài',
        '<input class="in" id="tv_start_note" maxlength="300" placeholder="Khoảng 3 tuần" value="' + ngEsc(d.start_note) + '">') +
      vcFd('close_at', 'Hạn nhận trả lời', '<input class="in" id="tv_close_at" type="date" value="' + ngEsc(d.close_at) + '">') +
      '</div>' +
      vcFd('requirements', 'Yêu cầu với người nhận việc <span style="color:var(--fnt);font-weight:400">— không bắt buộc</span>',
        '<textarea class="in" id="tv_requirements" maxlength="3000" placeholder="Có kinh nghiệm ốp lát, tự lo đồ nghề cơ bản, làm được liên tục ít nhất ba tuần.">' + ngEsc(d.requirements) + '</textarea>') +
      vcFd('warnings', 'Điều cần nói trước <span style="color:var(--fnt);font-weight:400">— kể cả điều bất lợi</span>',
        '<textarea class="in" id="tv_warnings" maxlength="3000" placeholder="Ngõ nhỏ, xe tải không vào tận nơi, phải chuyển vật tư khoảng 40 m. Chưa có điện ba pha.">' + ngEsc(d.warnings) + '</textarea>',
        'Giấu bây giờ thì hai tuần nữa người ta bỏ việc. Nói trước là tôn trọng nhau.') +
      vcFd('contact_owner', 'Người chịu trách nhiệm <span style="color:var(--fnt);font-weight:400">— không bắt buộc</span>',
        '<input class="in" id="tv_contact_owner" maxlength="200" placeholder="Tên người anh em nên hỏi khi có việc" value="' + ngEsc(d.contact_owner) + '">');
  } else {
    body =
      '<div class="fd' + (TV.errors.visibility ? ' bad' : '') + '"><label>Ai thấy việc này</label>' +
      VC_VISIBILITY_OPTS.map(function (o) {
        var on = d.visibility === o[0];
        return '<label class="pick ' + (on ? 'on' : '') + '" onclick="vcSet(\'visibility\',\'' + o[0] + '\')">' +
          '<div><b>' + o[1] + '</b><span>' + o[2] + '</span></div></label>';
      }).join('') + vcErrLine('visibility') + '</div>' +
      '<div class="fd' + (TV.errors.contact_policy ? ' bad' : '') + '"><label>Ai được liên hệ trực tiếp với tôi</label><div class="row">' +
      VC_CONTACT_POLICY_OPTS.map(function (o) {
        var on = d.contact_policy === o[0];
        return '<button type="button" class="bt s" style="' + (on ? 'background:var(--ink);color:#fff;border-color:var(--ink)' : '') +
          '" onclick="vcSet(\'contact_policy\',\'' + o[0] + '\')">' + o[1] + '</button>';
      }).join('') + '</div>' + vcErrLine('contact_policy') + '</div>' +
      '<div class="fd' + (TV.errors.show_phone ? ' bad' : '') + '"><label>Hiện số điện thoại của tôi trong việc này</label><div class="row">' +
      [['Có', true], ['Không', false]].map(function (o) {
        var on = d.show_phone === o[1];
        return '<button type="button" class="bt s" style="' + (on ? 'background:var(--ink);color:#fff;border-color:var(--ink)' : '') +
          '" onclick="vcSet(\'show_phone\',' + o[1] + ')">' + o[0] + '</button>';
      }).join('') + '</div>' + vcErrLine('show_phone') + '</div>' +
      '<div class="bx" style="background:var(--soft);border:0"><div style="font-size:11px;letter-spacing:.1em;color:var(--fnt);font-weight:700;margin-bottom:9px">NGƯỜI KHÁC SẼ THẤY THẾ NÀY</div>' +
      '<b style="font-size:15px">' + (ngEsc(d.title) || 'Tên việc') + '</b>' +
      '<div style="font-size:13px;color:var(--mut);margin-top:4px">' +
      [d.job_type ? VC_JOB_TYPE_LABEL[d.job_type] : '', d.area_name ? ngEsc(d.area_name) : '', d.terms ? ngEsc(d.terms) : ''].filter(Boolean).join(' · ') +
      '</div></div>' +
      '<div class="gh"><b>Sau khi đăng</b><div>Việc hiện trong "Việc trong Hội" theo đúng phạm vi hiển thị anh chọn ở trên. Anh sửa hoặc đóng lại được sau, ở một bản cập nhật tiếp theo.</div></div>';
  }

  return '<div class="md"><div class="mh"><div class="sp"><h3>Đăng một việc</h3><div class="s">Bước ' + S.wz + ' trên 3 — ' + W[S.wz - 1] + '</div></div><button class="mx" onclick="dong()">✕</button></div>' +
    '<div class="wz">' + W.map(function (w, i) { return '<div class="' + (S.wz > i + 1 ? 'o' : S.wz === i + 1 ? 'n' : '') + '"><span>' + (S.wz > i + 1 ? '✓' : i + 1) + '</span>' + w + '</div>'; }).join('') + '</div>' +
    '<div class="mb">' +
    (TV.generalError ? '<div style="font-size:13px;color:var(--rd);background:var(--rd-s);border-radius:9px;padding:10px 12px;margin-bottom:14px">' + ngEsc(TV.generalError) + '</div>' : '') +
    body + '</div>' +
    '<div class="mf">' + (S.wz > 1 ? '<button class="bt" onclick="wz(-1)">Quay lại</button>' : '<button class="bt" onclick="dong()">Hủy</button>') +
    '<button class="bt p" ' + (TV.submitting ? 'disabled' : '') + ' onclick="' + (S.wz < 3 ? 'wz(1)' : 'vcSubmit()') + '">' +
    (TV.submitting ? 'Đang đăng…' : (S.wz < 3 ? 'Tiếp tục' : 'Đăng việc')) + '</button></div></div>';
};
