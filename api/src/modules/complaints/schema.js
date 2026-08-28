import { z } from 'zod';

const uuid = z.string().uuid();

// Bảng thật (migration 018_verify_endorse_complaints.js) có HAI cách gắn đối
// tượng, độc lập nhau: subject_member_id (khiếu nại về MỘT NGƯỜI cụ thể,
// complaint_not_self chặn tự báo cáo chính mình) và subject_type+subject_id
// (khiếu nại về một việc/lời nhờ/hoạt động/năng lực — không phải người).
// Không có cột `category` — chỉ `body` tự do, đúng tên cột thật.
export const createSchema = z.object({
  subject_member_id: uuid.optional(),
  subject_type: z.enum(['job', 'aid', 'activity', 'capability']).optional(),
  subject_id: uuid.optional(),
  body: z.string().trim().min(10).max(2000),
}).refine((v) => Boolean(v.subject_type) === Boolean(v.subject_id), {
  message: 'Cần cả loại đối tượng và id, hoặc bỏ trống cả hai.',
});

export const listQuerySchema = z.object({
  status: z.enum(['open', 'reviewing', 'resolved', 'dismissed']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const idParamSchema = z.object({ id: uuid });

export const decideSchema = z.object({
  status: z.enum(['reviewing', 'resolved', 'dismissed']),
  note: z.string().trim().max(2000).nullable().optional(),
});
