import { z } from 'zod';

// Khớp đúng bảng thật (migration 016_aid.js) — requester_id/on_behalf_of/
// urgency(normal|urgent)/status(queued|matched|done|closed|cancelled), KHÔNG
// phải asker_id/urgent-boolean/status(open|helped|...) như bản nháp đầu.
const uuid = z.string().uuid();
const fields = {
  title: z.string().trim().min(6).max(200),
  description: z.string().trim().max(3000).nullable().optional(),
  on_behalf_of: z.string().trim().max(160).nullable().optional(),
  category: z.string().trim().max(100).nullable().optional(),
  area_id: uuid.nullable().optional(),
  urgency: z.enum(['normal', 'urgent']).optional(),
  status: z.enum(['queued', 'matched', 'done', 'closed', 'cancelled']).optional(),
};

export const listQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  category: z.string().trim().min(1).max(100).optional(),
  status: z.enum(['queued', 'matched', 'done', 'closed', 'cancelled']).optional(),
  urgency: z.enum(['normal', 'urgent']).optional(),
  mine: z.enum(['true', 'false']).default('false'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export const idParamSchema = z.object({ id: uuid });
export const createSchema = z.object(fields);
export const updateSchema = z.object(fields).partial().refine((v) => Object.keys(v).length > 0, {
  message: 'Cần có ít nhất một trường để cập nhật.',
});
export const offerSchema = z.object({ note: z.string().trim().min(10).max(1000).nullable().optional() });
export const photoSchema = z.object({
  url: z.string().trim().min(1).max(500),
  caption: z.string().trim().max(300).nullable().optional(),
  sort_order: z.number().int().min(0).max(20).optional(),
});
export const photoParamSchema = z.object({ id: uuid, photoId: uuid });
