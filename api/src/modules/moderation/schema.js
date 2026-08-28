import { z } from 'zod';

const uuid = z.string().uuid();

// Bốn nguồn ảnh thật trong dự án: ba bảng ảnh riêng (job_need_images,
// capability_photos, aid_request_photos) + activities.image_url (một cột
// đơn, không có bảng ảnh riêng — "gỡ" nghĩa là xoá giá trị cột đó, không phải
// xoá một hàng).
export const MODERATION_TARGET_TYPES = ['job_photo', 'capability_photo', 'aid_photo', 'activity_photo'];

export const createSchema = z.object({
  target_type: z.enum(MODERATION_TARGET_TYPES),
  target_id: uuid,
  reason: z.string().trim().min(10).max(1000),
});

export const listQuerySchema = z.object({
  status: z.enum(['open', 'approved', 'rejected']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const idParamSchema = z.object({ id: uuid });

export const decideSchema = z.object({
  status: z.enum(['approved', 'rejected']),
});
