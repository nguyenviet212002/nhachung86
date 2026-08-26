import { z } from 'zod';

const uuid = z.string().uuid();
const cell = z.object({ r: z.number().int().min(0).max(9), c: z.number().int().min(0).max(8) });

export const idParamSchema = z.object({ id: uuid });
export const challengeSchema = z.object({ opponent_member_id: uuid });
export const listQuerySchema = z.object({
  status: z.string().optional(),
  mine: z.enum(['true', 'false']).default('false'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export const moveSchema = z.object({ from: cell, to: cell });
