import { z } from 'zod';

const uuid = z.string().uuid();

// Bảng thật (migration 018_verify_endorse_complaints.js): kind là 1-trong-4
// loại cố định (identity/address/skill/business), UNIQUE (member_id, kind) —
// mỗi người chỉ có MỘT hàng cho mỗi loại, xem lại được sau khi bị từ chối
// (service.create() upsert lại về 'pending').
export const VERIFICATION_KINDS = ['identity', 'address', 'skill', 'business'];

export const createSchema = z.object({
  kind: z.enum(VERIFICATION_KINDS),
  note: z.string().trim().max(1000).optional(),
});

export const listQuerySchema = z.object({
  status: z.enum(['pending', 'verified', 'rejected']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const idParamSchema = z.object({ id: uuid });

export const decideSchema = z.object({
  status: z.enum(['verified', 'rejected']),
  note: z.string().trim().max(1000).nullable().optional(),
});
