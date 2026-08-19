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
