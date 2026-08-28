import { z } from 'zod';

const uuid = z.string().uuid();
const status = z.enum(['planned', 'open', 'running', 'done', 'cancelled']);
const filePath = z.string().trim().regex(
  /^\/files\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  'Duong dan anh phai la /files/<uuid>.'
);
const imageUrl = z.union([z.string().trim().url().max(1000), filePath]).nullable().optional();

export const listQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  status: status.optional(),
  mine: z.enum(['true', 'false']).default('false'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const idParamSchema = z.object({ id: uuid });

export const createSchema = z.object({
  title: z.string().trim().min(6).max(200),
  description: z.string().trim().min(20).max(5000),
  area_id: uuid.nullable().optional(),
  category: z.string().trim().min(2).max(100).nullable().optional(),
  location: z.string().trim().min(2).max(300).nullable().optional(),
  image_url: imageUrl,
  starts_at: z.string().datetime({ offset: true }),
  ends_at: z.string().datetime({ offset: true }).nullable().optional(),
  capacity: z.coerce.number().int().min(1).max(10000),
  status: status.optional(),
}).refine((v) => !v.ends_at || new Date(v.ends_at) >= new Date(v.starts_at), {
  path: ['ends_at'],
  message: 'Thoi gian ket thuc phai sau thoi gian bat dau.',
});

export const updateSchema = z.object({
  title: z.string().trim().min(6).max(200).optional(),
  description: z.string().trim().min(20).max(5000).optional(),
  area_id: uuid.nullable().optional(),
  category: z.string().trim().min(2).max(100).nullable().optional(),
  location: z.string().trim().min(2).max(300).nullable().optional(),
  image_url: imageUrl,
  starts_at: z.string().datetime({ offset: true }).optional(),
  ends_at: z.string().datetime({ offset: true }).nullable().optional(),
  capacity: z.coerce.number().int().min(1).max(10000).optional(),
  status: status.optional(),
}).refine((v) => Object.keys(v).length > 0, {
  message: 'Can it nhat mot truong de cap nhat.',
}).refine((v) => {
  if (!v.starts_at || !v.ends_at) return true;
  return new Date(v.ends_at) >= new Date(v.starts_at);
}, {
  path: ['ends_at'],
  message: 'Thoi gian ket thuc phai sau thoi gian bat dau.',
});
