import { z } from 'zod';

// Sáu `action_key` của đặc tả mục 7.5 + `community.config_change` (lượt 14,
// theo `docs/RANG-BUOC.md` #22). Danh sách này KHỚP với CHECK của
// `pending_actions` ở migration 022/028; nếu lệch thì zod trả
// VALIDATION_FAILED trước khi CSDL kịp nói — vẫn chặn đúng, chỉ khác câu chữ.
export const ACTION_KEYS = [
  'data.delete',
  'contacts.export',
  'backup.restore',
  'member.terminate',
  'guarantee.quota_override',
  'community.config_change',
];

export const idParamSchema = z.object({ id: z.string().uuid() });

export const createActionSchema = z.object({
  action_key: z.enum(ACTION_KEYS),
  target_type: z.enum(['member', 'community']).nullish(),
  target_id: z.string().uuid().nullish(),
  // `payload` là object PHẲNG-hay-lồng tuỳ hành động; nó KHÔNG đi vào
  // `audit_log.detail` nên không phải qua `assertSafeDetail`. Giới hạn duy
  // nhất là nó phải là một object (không phải mảng, không phải chuỗi) — cột
  // `payload jsonb NOT NULL` nhận cả ba, và một `payload` dạng chuỗi sẽ làm
  // `payload->'config'` trả NULL trong im lặng.
  payload: z.record(z.unknown()).default({}),
});

export const signActionSchema = z.object({
  // Mục 7.4 lớp 1: ký phải nhập lại mật khẩu. Không đặt `min(8)` ở đây — đây
  // là ô XÁC THỰC LẠI, không phải ô đặt mật khẩu mới; ràng buộc độ dài chỉ
  // làm lộ luật mật khẩu cho người đang đoán.
  password: z.string().min(1, 'Phải nhập lại mật khẩu để ký'),
});

export const listActionsSchema = z.object({
  status: z.enum(['pending', 'executed', 'expired', 'cancelled', 'stale']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
