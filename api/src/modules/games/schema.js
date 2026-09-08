import { z } from 'zod';

const uuid = z.string().uuid();
const cell = z.object({ r: z.number().int().min(0).max(9), c: z.number().int().min(0).max(8) });

export const idParamSchema = z.object({ id: uuid });
export const memberIdParamSchema = z.object({ memberId: uuid });
export const challengeSchema = z.object({ opponent_member_id: uuid });
export const listQuerySchema = z.object({
  status: z.string().optional(),
  mine: z.enum(['true', 'false']).default('false'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export const moveSchema = z.object({ from: cell, to: cell });

// guest_name chỉ bắt buộc khi vào phòng KHÔNG kèm phiên thành viên (route
// join tự chấp nhận cả hai — xem optionalAuth ở routes.js) — thành viên đã
// đăng nhập lấy tên thẳng từ members.full_name, không cần gõ lại.
export const joinRoomSchema = z.object({ guest_name: z.string().trim().min(1).max(40).optional() });
export const aiLevelSchema = z.object({ level: z.enum(['sieu', 'thong-minh', 'xuat-sac']).nullable() });
