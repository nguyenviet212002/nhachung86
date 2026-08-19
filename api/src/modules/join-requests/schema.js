import { z } from 'zod';

export const REJECT_REASON_CODES = ['not_ready', 'no_meeting', 'referrer_misrepresented', 'other'];

export const listQuerySchema = z.object({
  status: z.enum(['draft', 'pending', 'met_confirmed', 'approved', 'rejected']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const idParamSchema = z.object({ id: z.string().uuid() });

// met_on là NGÀY gặp mặt, không phải dấu thời gian: dạng YYYY-MM-DD, và không
// được ở tương lai — không ai xác nhận được một buổi gặp chưa diễn ra.
export const confirmMetSchema = z.object({
  met_on: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày gặp mặt phải có dạng YYYY-MM-DD')
    .refine((s) => !Number.isNaN(Date.parse(s)), 'Ngày gặp mặt không hợp lệ')
    .refine((s) => Date.parse(`${s}T23:59:59Z`) <= Date.now() + 86_400_000, 'Ngày gặp mặt không được ở tương lai'),
  // Ghi chú tối thiểu 20 ký tự: cổng met_confirmed tồn tại để buộc một người
  // CỤ THỂ nói ra một điều CỤ THỂ. Một dấu tích chuột không phải lời khai.
  note: z.string().trim().min(20, 'Ghi chú cần ít nhất 20 ký tự'),
});

export const rejectSchema = z.object({
  reason_code: z.enum(REJECT_REASON_CODES),
  note: z.string().trim().min(20, 'Ghi chú cần ít nhất 20 ký tự'),
});
