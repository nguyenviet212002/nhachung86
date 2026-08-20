import { z } from 'zod';

const uuid = z.string().uuid();
export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  unread_only: z.enum(['true', 'false']).default('false'),
  with_member_id: uuid.optional(),
});
export const idParamSchema = z.object({ id: uuid });
export const createSchema = z.object({
  recipient_id: uuid,
  kind: z.enum(['content', 'activity', 'system', 'role']),
  title: z.string().trim().min(2).max(160),
  body: z.string().trim().min(1).max(1000),
  target_type: z.enum(['member', 'post', 'activity', 'notification']).optional(),
  target_id: uuid.optional(),
});
export const messageSchema = z.object({
  recipient_id: uuid,
  body: z.string().trim().min(1).max(2000),
});
