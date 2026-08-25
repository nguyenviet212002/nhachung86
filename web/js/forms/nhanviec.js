/* ============================================================================
 * web/js/forms/nhanviec.js — MD.nhanviec: nhận việc, POST /jobs/:id/applications
 * thật.
 *
 * Thay MD.nhanviec (Task 1 giữ nguyên từ thiet-ke-mau.html, mọi nút chỉ gọi
 * xong()/alert() với một tấm form nhiều ô — "khả năng", "đồ nghề", "giá công
 * dự kiến", ảnh việc đã làm...) bằng bản gửi thật lên POST /jobs/:id/applications.
 * applySchema (api/src/modules/jobs/schema.js) chỉ nhận MỘT trường: `note`
 * (10–1000 ký tự) — form vì vậy chỉ còn một ô, không dựng lại các ô khác của
 * bản mock (không có trường thật tương ứng: "khả năng"/"đồ nghề"/"giá công dự
 * kiến" đều không nằm trong applySchema; ảnh kèm đơn ứng tuyển không có
 * endpoint — cùng lý do taoviec.js đã bỏ ảnh kèm khi đăng việc).
 *
 * CẬP NHẬT LẠC QUAN (đặc tả Nhiệm vụ 7 Bước 2): bấm "Gửi yêu cầu nhận việc"
 * xong là ĐÓNG MODAL VÀ HIỆN NGAY trạng thái "Đã gửi yêu cầu — chờ chủ việc
 * phản hồi" ở khung chi tiết bên dưới (VC.applyState[jobId]='pending', paint()
 * ngay, KHÔNG đợi POST trả lời) — không phải chờ máy chủ xác nhận rồi mới đổi
 * giao diện. Hỏng thì REVERT: xoá applyState (nút "Nhận việc" hiện lại) và
 * hiện lỗi qua api.messageFor(err.code) ngay cạnh nút đó (VC.applyError,
 * vcDetail() ở viechoi.js đọc lại) — cùng khuôn "sửa cục bộ, không tải lại cả
 * khung chi tiết" mà ngRequestContact() (nguoi.js) đã dùng.
 *
 * VC (module-level, khai báo ở viechoi.js) là nơi giữ applyState/applyError vì
 * chính vcDetail() (viechoi.js) đọc chúng để vẽ — tệp này (form) chỉ GHI vào
 * đó, không đọc lại để vẽ khung chi tiết. viechoi.js phải nạp TRƯỚC tệp này
 * (đã đúng thứ tự trong index.html: screens/viechoi.js rồi mới tới forms/).
 * ========================================================================== */

// Trạng thái riêng của MODAL "Nhận việc" — id việc đang mở, nội dung ô đang
// gõ (giữ lại khi vẽ lại do lỗi, cùng lý do TV.data giữ lại d.title ở
// taoviec.js), câu lỗi kiểm tra phía trình duyệt (10–1000 ký tự) nếu có.
var NV = { jobId: null, note: '', error: null };

// Mở modal — gọi từ nút "Nhận việc" trong vcDetail() (viechoi.js). Không cần
// nạp lại gì: id việc + tựa đề/tên người đăng đã có sẵn trong VC.items (mục
// danh sách đang mở, cùng đối tượng vcDetail() nhận được).
function vcOpenApply(jobId) {
  NV.jobId = jobId;
  NV.note = '';
  NV.error = null;
  mo('nhanviec');
}

function nvFindJob(jobId) {
  for (var i = 0; i < VC.items.length; i++) {
    if (VC.items[i].id === jobId) return VC.items[i];
  }
  return null;
}

function nvSubmit() {
  var el = document.getElementById('nv_note');
  var raw = el ? el.value : NV.note;
  NV.note = raw; // giữ lại nội dung đã gõ phòng khi phải vẽ lại vì lỗi kiểm tra dưới đây

  var note = raw.trim();
  if (note.length < 10 || note.length > 1000) {
    NV.error = note.length === 0 ? 'Chưa nhập lời nhắn.' : 'Lời nhắn cần 10–1000 ký tự.';
    document.getElementById('ov').innerHTML = MD.nhanviec();
    return;
  }
  NV.error = null;

  var jobId = NV.jobId;
  var idemKey = api.newIdemKey(); // sinh MỘT lần cho đúng một ý định gửi này

  // Lạc quan: coi như đã gửi xong NGAY, đóng modal, vẽ lại khung chi tiết —
  // xem chú thích lớn ở đầu tệp.
  VC.applyState[jobId] = 'pending';
  delete VC.applyError[jobId];
  dong();
  if (S.r === 'viechoi') paint();

  api.post('/jobs/' + jobId + '/applications', { note: note }, idemKey).then(function () {
    // Người dùng có thể đã điều hướng đi nơi khác trong lúc chờ — chỉ ghi
    // 'sent' nếu applyState vẫn còn là chính lượt gửi này (chưa bị một lượt
    // sau ghi đè/xoá).
    if (VC.applyState[jobId] === 'pending') VC.applyState[jobId] = 'sent';
    if (S.r === 'viechoi') paint();
  }).catch(function (err) {
    delete VC.applyState[jobId];
    VC.applyError[jobId] = api.messageFor(err.code);
    if (S.r === 'viechoi') paint();
  });
}

MD.nhanviec = function () {
  var job = nvFindJob(NV.jobId);
  var sub = job ? (ngEsc(job.title) + ' — ' + ngEsc(job.poster_name)) : '';

  return '<div class="md"><div class="mh"><div class="sp"><h3>Nhận việc này</h3><div class="s">' + sub + '</div></div>' +
    '<button class="mx" onclick="dong()">✕</button></div>' +
    '<div class="mb">' +
    '<div class="fd' + (NV.error ? ' bad' : '') + '"><label>Lời nhắn gửi chủ việc <span class="req">*</span></label>' +
    '<textarea class="in" id="nv_note" maxlength="1000" placeholder="Giới thiệu ngắn về bản thân, kinh nghiệm, và khi nào có thể bắt đầu…" ' +
    'oninput="vcCount(\'nv_note\',\'nv_note_cnt\',1000)">' + ngEsc(NV.note) + '</textarea>' +
    '<div class="cnt" id="nv_note_cnt">' + (NV.note || '').length + ' / 1000</div>' +
    '<div class="err">' + (NV.error ? ngEsc(NV.error) : '') + '</div>' +
    '<div class="hint">Cần ít nhất 10 ký tự. Viết rõ để chủ việc dễ quyết định.</div></div>' +
    '<div class="nt" style="margin-top:0">Nhận được thì nói nhận. Không chắc thì nói không chắc — một lần lỡ hẹn với anh em đắt hơn nhiều so với một lần từ chối thẳng.</div>' +
    '</div>' +
    '<div class="mf"><button class="bt" onclick="dong()">Để nghĩ thêm</button>' +
    '<button class="bt p" onclick="nvSubmit()">Gửi yêu cầu nhận việc</button></div></div>';
};
