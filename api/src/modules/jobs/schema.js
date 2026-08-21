import { z } from 'zod';

const uuid = z.string().uuid();
const jobFields = {
  title: z.string().trim().min(6).max(200),
  description: z.string().trim().min(10).max(5000).nullable().optional(),
  terms: z.string().trim().max(2000).nullable().optional(),
  area_id: uuid.nullable().optional(),
  job_type: z.enum(['dai_han', 'thoi_vu', 'hop_tac', 'hoc_nghe']).optional(),
  status: z.enum(['open', 'closed', 'filled', 'cancelled']).optional(),
  close_at: z.string().datetime({ offset: true }).nullable().optional(),
};
export const listQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  job_type: z.enum(['dai_han', 'thoi_vu', 'hop_tac', 'hoc_nghe']).optional(),
  status: z.enum(['open', 'closed', 'filled', 'cancelled']).default('open'),
  mine: z.enum(['true', 'false']).default('false'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export const idParamSchema = z.object({ id: uuid });
export const applicationParamSchema = z.object({ id: uuid, connectionId: uuid });
export const createSchema = z.object(jobFields);
export const updateSchema = z.object(jobFields).partial().refine((v) => Object.keys(v).length > 0, {
  message: 'Cần có ít nhất một trường để cập nhật.',
});
export const applySchema = z.object({ note: z.string().trim().min(10).max(1000) });
export const applicationUpdateSchema = z.object({
  status: z.enum(['contacted', 'agreed', 'working', 'done', 'failed']),
  note: z.string().trim().max(1000).optional(),
});
export const readyQuerySchema = z.object({
  status: z.enum(['ready', 'by_appointment', 'paused']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export const readySchema = z.object({
  headline: z.string().trim().min(3).max(200),
  availability: z.string().trim().max(500).nullable().optional(),
  area_id: uuid.nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
  status: z.enum(['ready', 'by_appointment', 'paused']).default('ready'),
});
