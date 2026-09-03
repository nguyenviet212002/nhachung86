import { z } from 'zod';

const uuid = z.string().uuid();

// Hạn mức 3.000.000đ/khoản là chính sách quỹ vay giai đoạn 1 (xem
// web/index.html#quyvay và docs/superpowers/plans/2026-08-18-nha-chung-giai-doan-1.md).
// Chưa đọc từ communities.config như fund_two_approver_threshold — quỹ vay
// mới chỉ có luồng xin/duyệt, chưa tới phần cấu hình cần hai chữ ký đổi chính
// sách (migration 028). Ràng buộc ở đây, KHÔNG ở CSDL: bảng loans (migration
// 021) cố ý không có CHECK theo số tiền, để không khoá cứng hạn mức vào lược
// đồ trước khi luồng vay đầy đủ (giai đoạn 6) định hình.
export const LOAN_MAX_AMOUNT = 3_000_000;

export const createLoanSchema = z.object({
  amount: z.coerce.number()
    .positive('Số tiền vay phải lớn hơn 0')
    .max(LOAN_MAX_AMOUNT, `Mỗi khoản vay tối đa ${LOAN_MAX_AMOUNT.toLocaleString('vi-VN')}đ theo quy định quỹ vay giai đoạn 1`),
  purpose: z.string().trim().min(10, 'Mô tả lý do vay cần ít nhất 10 ký tự').max(500),
});

export const listQuerySchema = z.object({
  status: z.enum(['requested', 'approved', 'rejected', 'disbursed', 'repaying', 'closed']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const idParamSchema = z.object({ id: uuid });

export const decisionSchema = z.object({
  note: z.string().trim().min(1).max(1000).optional(),
});
