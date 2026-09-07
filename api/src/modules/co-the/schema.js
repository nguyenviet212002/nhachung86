import { z } from 'zod';

const uuid = z.string().uuid();
const piece = z.object({
  side: z.enum(['r', 'b']),
  type: z.enum(['general', 'advisor', 'elephant', 'horse', 'chariot', 'cannon', 'soldier']),
}).nullable();
const board = z.array(z.array(piece).length(9)).length(10);
const CATEGORY = ['tan-cuoc-it-quan', 'sat-cuoc', 'nghe-thuat', 'nhieu-nghiem', 'loi'];

export const idParamSchema = z.object({ id: uuid });
export const createPositionSchema = z.object({ board, side_to_move: z.enum(['r', 'b']) });
export const saveToLibrarySchema = z.object({
  label: z.string().trim().min(1).max(80),
  category: z.enum(CATEGORY).nullable(),
});
export const listPositionsQuerySchema = z.object({
  origin: z.enum(['tu-soan', 'kho-co-dien']).optional(),
  category: z.enum(CATEGORY).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const createSessionSchema = z.object({
  position_id: uuid,
  mode: z.enum(['giai', 'luyen-the']),
  opponent_level: z.enum(['yeu', 'vua', 'manh']).nullable().default(null),
  luyen_the_cap: z.enum(['ha', 'trung', 'cao']).nullable().default(null),
});
const cell = z.object({ r: z.number().int().min(0).max(9), c: z.number().int().min(0).max(8) });
export const moveSchema = z.object({ from: cell, to: cell });

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const guestJoinParamsSchema = z.object({ token: z.string().min(1) });
export const guestViewQuerySchema = z.object({ guest_token: uuid });
