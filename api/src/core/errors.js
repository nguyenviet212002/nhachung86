export class AppError extends Error {
  constructor(code, message, { status = 400, fields = undefined } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.fields = fields;
  }
}

// Ánh xạ lỗi do trigger/ràng buộc CSDL ném ra. Bảng này là bản sao mục 5.1 của spec.
const BY_MESSAGE = {
  GUARANTEE_QUOTA_EXCEEDED:    [422, 'GUARANTEE_QUOTA_EXCEEDED', 'Người bảo lãnh đã dùng hết số lượt trong 12 tháng gần nhất.'],
  MANUAL_PAIR_QUOTA_EXCEEDED:  [422, 'MANUAL_PAIR_QUOTA_EXCEEDED', 'Hai người đã ghi quá số việc thủ công cho phép trong 12 tháng.'],
  SELF_ONLY:                   [403, 'SELF_ONLY', 'Việc này chỉ chính người đó làm được, không ai điền hộ.'],
  NO_ACTOR:                    [500, 'INTERNAL', 'Lỗi hệ thống.'],
  MEMBER_NEEDS_MET_CONFIRMATION: [422, 'MET_CONFIRMATION_REQUIRED', 'Chưa có xác nhận đã gặp mặt nên chưa thể thành thành viên.'],
  SUMMARY_REQUIRED:            [422, 'SUMMARY_REQUIRED', 'Còn hoạt động dùng quỹ chưa có tổng kết.'],
  FUND_ENTRY_LOCKED:           [409, 'FUND_ENTRY_LOCKED', 'Bút toán đã khóa. Hãy ghi bút toán điều chỉnh mới.'],
  FUND_TWO_APPROVERS_REQUIRED: [422, 'TWO_APPROVERS_REQUIRED', 'Bút toán từ một triệu đồng trở lên cần hai người duyệt.'],
  ENDORSEMENT_NEEDS_TWO_DISTINCT: [422, 'TWO_SIGNERS_REQUIRED', 'Bảo chứng cần đúng hai người khác nhau ký.'],
  PHOTO_CONSENT_INCOMPLETE:    [422, 'PHOTO_CONSENT_INCOMPLETE', 'Còn người có mặt trong ảnh chưa đồng ý.'],
  GUARANTEE_CYCLE:             [422, 'GUARANTEE_CYCLE', 'Sợi bảo lãnh tạo thành vòng tròn.'],
  WORK_RECORD_FROZEN:          [409, 'WORK_RECORD_FROZEN', 'Việc đã có xác nhận nên không sửa được nữa.'],
  REFERRER_FROZEN:             [409, 'REFERRER_FROZEN', 'Sợi bảo lãnh đã thành sự thật lịch sử, không sửa được.'],
  CONTACT_WRITE_DENIED:        [403, 'CONTACT_WRITE_DENIED', 'Bạn không có quyền sửa thông tin liên hệ này.'],
  REFERRER_REQUIRED:           [422, 'REFERRER_REQUIRED', 'Phải có người bảo lãnh.'],
  // join_secret_consume (migration 009a). Không có trong bảng mục 5.1 của spec
  // vì hàm này ra đời sau bảng đó — cùng khuôn CONTACT_WRITE_DENIED: một quyết
  // định về QUYỀN nằm trong CSDL chứ không phải trong route.
  JOIN_SECRET_DENIED:          [403, 'JOIN_SECRET_DENIED', 'Chỉ ban duyệt của chính cộng đồng này mới duyệt được đơn, và chỉ khi đơn đã có xác nhận gặp mặt.'],
  JOIN_SECRET_MISSING:         [422, 'JOIN_SECRET_MISSING', 'Đơn này không có dữ liệu đăng ký kèm theo nên không duyệt được.'],
  // Sáu mã của migration 025 (Task 12). Thêm NGAY khi trigger ra đời, không đợi
  // tới lúc dựng endpoint: một mã không map được sẽ rơi qua `return null` và
  // người dùng thấy "Lỗi hệ thống" thay vì biết mình vướng luật nào. Bốn trong
  // sáu mã dưới đây canh đúng chỗ nguyên tắc 1 và 2 bị lách, nên hiện đúng lý do
  // từ chối chính là phần việc của chúng.
  WORK_PARTICIPANTS_FROZEN:     [409, 'WORK_PARTICIPANTS_FROZEN', 'Việc đã có người xác nhận nên không thêm bớt người tham gia được nữa.'],
  MANUAL_CREATOR_NOT_PARTICIPANT: [422, 'MANUAL_CREATOR_NOT_PARTICIPANT', 'Người ghi việc thủ công phải là một trong những người đã làm việc đó.'],
  MANUAL_REVIEW_BEFORE_WORK:    [422, 'MANUAL_REVIEW_BEFORE_WORK', 'Việc thủ công không thể sinh ra đã được duyệt sẵn.'],
  REVIEWER_NOT_APPROVER:        [403, 'REVIEWER_NOT_APPROVER', 'Chỉ ban duyệt của chính cộng đồng này mới duyệt được việc thủ công.'],
  REVIEWER_IS_PARTICIPANT:      [403, 'REVIEWER_IS_PARTICIPANT', 'Người tham gia không tự duyệt việc của mình được.'],
  REVIEWER_REQUIRED:            [422, 'REVIEWER_REQUIRED', 'Phải ghi rõ ai là người duyệt.'],

  // ---------------------------------------------------------------------
  // Mười chín mã của Task 13 (migration 013–026) và ba mã cũ chưa ai khai.
  //
  // Chúng thiếu ở đây suốt vì `t23` bản đầu so bảng JS với bảng JS: cả hai
  // cùng thiếu thì nó vẫn xanh. Nay `t23` đọc thẳng `RAISE EXCEPTION` trong
  // migration, nên danh sách này không tụt lại được nữa.
  //
  // "Không tìm thấy X" đều gộp về NOT_FOUND: người dùng không cần biết
  // trigger nào bắt, họ cần biết thứ họ trỏ tới không còn ở đó. Gộp cũng
  // tránh làm bảng phía trình duyệt phình ra vì bảy câu nói cùng một điều.
  // ---------------------------------------------------------------------
  NO_CAPABILITY:               [404, 'NOT_FOUND', 'Không tìm thấy dữ liệu này.'],
  NO_ENDORSEMENT:              [404, 'NOT_FOUND', 'Không tìm thấy dữ liệu này.'],
  NO_LOAN:                     [404, 'NOT_FOUND', 'Không tìm thấy dữ liệu này.'],
  NO_PENDING_ACTION:           [404, 'NOT_FOUND', 'Không tìm thấy dữ liệu này.'],
  NO_AID_SLOT:                 [404, 'NOT_FOUND', 'Không tìm thấy dữ liệu này.'],
  NO_WORK_RECORD:              [404, 'NOT_FOUND', 'Không tìm thấy dữ liệu này.'],
  NO_TARGET:                   [404, 'NOT_FOUND', 'Không tìm thấy dữ liệu này.'],
  // Lối vào sai tên trường: zod đã chặn trước, nhưng nếu lọt tới CSDL thì đó
  // là lỗi dữ liệu gửi lên, không phải hệ thống hỏng.
  BAD_FIELD:                   [422, 'VALIDATION_FAILED', 'Dữ liệu gửi lên chưa hợp lệ.'],

  AID_SLOT_FULL:               [409, 'AID_SLOT_FULL', 'Suất giúp này đã có đủ người nhận.'],
  EVIDENCE_NOT_PARTICIPANT:    [422, 'EVIDENCE_NOT_PARTICIPANT', 'Chỉ người đã làm việc đó mới lấy nó làm bằng chứng năng lực được.'],
  EVIDENCE_NOT_CONFIRMED:      [422, 'EVIDENCE_NOT_CONFIRMED', 'Việc chưa đủ xác nhận của mọi người tham gia nên chưa làm bằng chứng được.'],
  ENDORSEMENT_SELF_SIGN:       [403, 'ENDORSEMENT_SELF_SIGN', 'Không ai tự bảo chứng cho chính mình.'],
  LOAN_GUARANTOR_IS_BORROWER:  [422, 'LOAN_GUARANTOR_IS_BORROWER', 'Người vay không thể tự đứng ra bảo lãnh cho khoản vay của mình.'],
  SUBJECT_KEY_IMMUTABLE:       [409, 'SUBJECT_KEY_IMMUTABLE', 'Khoá này đã cấp nên không đổi được.'],
  SUBJECT_KEY_DESTROYED:       [409, 'SUBJECT_KEY_DESTROYED', 'Khoá đã hủy thì không hồi sinh được.'],
  SIGNER_IS_TARGET:            [403, 'SIGNER_IS_TARGET', 'Người bị ảnh hưởng bởi quyết định này không được ký duyệt nó.'],
  SIGNER_ROLE_REQUIRED:        [403, 'SIGNER_ROLE_REQUIRED', 'Bạn không có vai được ký duyệt việc này.'],
  TWO_SIGNATURES_REQUIRED:     [422, 'TWO_SIGNATURES_REQUIRED', 'Việc này cần đúng hai người khác nhau ký.'],
  CREATOR_SIGNATURE_MISSING:   [422, 'CREATOR_SIGNATURE_MISSING', 'Người đề xuất phải ký trước khi việc được thi hành.'],
};

export function mapPgError(err) {
  const raw = err?.message ?? '';
  for (const key of Object.keys(BY_MESSAGE)) {
    if (raw.includes(key)) {
      const [status, code, message] = BY_MESSAGE[key];
      return new AppError(code, message, { status });
    }
  }
  if (err?.code === '23505') return new AppError('DUPLICATE', 'Dữ liệu này đã tồn tại.', { status: 409 });
  if (err?.code === '23503') return new AppError('INVALID_REFERENCE', 'Dữ liệu tham chiếu không hợp lệ.', { status: 422 });
  // 42501 = permission denied. Đây là LỖI CỦA CHÚNG TA: một route đã cố làm việc thiết kế cấm.
  if (err?.code === '42501') {
    const e = new AppError('INTERNAL', 'Lỗi hệ thống.', { status: 500 });
    e.operationalAlert = true;
    return e;
  }
  return null;
}
