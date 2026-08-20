import { z } from 'zod';

export const ON_BEHALF_REASON_CODES = [
  'khong_mo_duoc_link',
  'khong_dung_dien_thoai_thong_minh',
  'link_het_han',
  'khac',
];

// Token đi trong đường link: base64url của 32 byte = 43 ký tự. Nới xuống 32 và
// lên 64 để một lần đổi độ dài token về sau không làm chết mọi link đang lưu
// hành, nhưng KHÔNG nới bảng chữ cái — `+`/`/` không phải base64url, và một
// chuỗi lọt vào đây rồi mới hỏng ở CSDL là một câu 500 thay cho một câu 400.
export const inviteTokenSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{32,64}$/, 'Đường link mời không đúng dạng');

// `referrer_id` ở đây KHÔNG phải ô nhập của người đăng ký — nó là đường dự
// phòng, chỗ một người của ban duyệt phát link HỘ một thành viên. Vắng mặt thì
// người phát link tự đứng tên mình.
//
// zod chỉ canh HÌNH DẠNG (có mã lý do không, lý do dài bao nhiêu). Luật thật
// — ai được phát hộ, lý do có bắt buộc không — nằm ở `trg_guarantee_invite_creator`
// (migration 031), vì zod chỉ canh một đường vào là route.
export const createSchema = z
  .object({
    referrer_id: z.string().uuid().optional(),
    on_behalf_reason_code: z.enum(ON_BEHALF_REASON_CODES).optional(),
    on_behalf_reason: z.string().trim().min(20, 'Lý do phát hộ cần ít nhất 20 ký tự').max(1000).optional(),
  })
  .strict();

export const listQuerySchema = z.object({
  referrer_id: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const idParamSchema = z.object({ id: z.string().uuid() });

// Thu hồi phải nói vì sao. Ngưỡng 5 ký tự chứ không phải 20 như lý do phát hộ:
// thu hồi là việc người bảo lãnh làm với link CỦA CHÍNH MÌNH, không phải một
// đường vòng cần giải trình với người khác — "phat nham" đã là một câu trả lời
// đủ. Ngưỡng đó cũng chính là ngưỡng CHECK ở migration 031.
export const revokeSchema = z.object({
  reason: z.string().trim().min(5, 'Lý do thu hồi cần ít nhất 5 ký tự').max(1000),
});
