import { z } from 'zod';

const uuid = z.string().uuid();
const fields = {
  title: z.string().trim().min(4).max(160),
  description: z.string().trim().max(3000).nullable().optional(),
  category: z.string().trim().max(100).nullable().optional(),
  price: z.string().trim().max(300).nullable().optional(),
  service_area: z.string().trim().max(300).nullable().optional(),
  scope: z.string().trim().max(300).nullable().optional(),
  availability: z.string().trim().max(300).nullable().optional(),
  conditions: z.string().trim().max(1000).nullable().optional(),
  years_experience: z.coerce.number().int().min(0).max(80).nullable().optional(),
  status: z.enum(['draft', 'published', 'hidden']).optional(),
};

export const listQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  category: z.string().trim().min(1).max(100).optional(),
  area_id: uuid.optional(),
  member_id: uuid.optional(),
  mine: z.enum(['true', 'false']).default('false'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(24),
});
export const idParamSchema = z.object({ id: uuid });
export const createSchema = z.object(fields);
export const updateSchema = z.object(fields).partial().refine((v) => Object.keys(v).length > 0, {
  message: 'Cần có ít nhất một trường để cập nhật.',
});
export const photoSchema = z.object({
  url: z.string().trim().min(1).max(500),
  caption: z.string().trim().max(300).nullable().optional(),
  sort_order: z.number().int().min(0).max(20).optional(),
});
export const photoParamSchema = z.object({ id: uuid, photoId: uuid });
