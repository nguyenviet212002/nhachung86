import { z } from 'zod';

const uuid = z.string().uuid();

// Bảng thật (migration 020_fund.js): amount CÓ DẤU (dương = thu, âm = chi).
// Bút toán từ ngưỡng community.config.fund_two_approver_threshold trở lên
// (mặc định 1.000.000đ) cần đúng 2 chữ ký approver mới qua được lúc COMMIT
// (trg_fund_two_approvers) — module này CHƯA có luồng hai người ký cho bút
// toán lớn (chưa có action_key tương ứng trong fn_pending_action_role), nên
// tạo một bút toán lớn sẽ tự nhận lỗi FUND_TWO_APPROVERS_REQUIRED thật từ
// CSDL (đã ánh xạ sẵn ở core/errors.js) — không phải bug, là ranh giới thật
// của module hôm nay.
export const createEntrySchema = z.object({
  amount: z.coerce.number().refine((n) => n !== 0, 'Số tiền không được bằng 0'),
  purpose: z.string().trim().min(3).max(500),
  occurred_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải có dạng YYYY-MM-DD').optional(),
  activity_id: uuid.optional(),
});

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const idParamSchema = z.object({ id: uuid });
