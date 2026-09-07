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
