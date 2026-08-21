import { z } from 'zod';

// Bốn trường liên hệ mà contact_read chấp nhận (danh sách trắng ở migration
// 006/012a). Kiểm ở zod TRƯỚC khi giá trị chạm tới hàm CSDL: nhánh BAD_FIELD
// trong contact_read RAISE EXCEPTION, mà một ngoại lệ chưa bắt sẽ nhiễm độc cả
// giao dịch (bẫy 2 — xem Ruling T8-c). Chặn từ vỏ ngoài thì nhánh đó chỉ còn
// là lưới cuối, không phải đường đi thường ngày.
export const CONTACT_FIELDS = ['phone', 'zalo', 'messenger', 'address'];
export const PRIVACY_FIELDS = [...CONTACT_FIELDS, 'job', 'area', 'price', 'family'];

export const listQuerySchema = z.object({
  // q: tìm theo họ tên (đặc tả dòng 868). Giới hạn độ dài để không ai gửi một
  // mẫu tìm kiếm dài vài chục KB làm ILIKE quét vô ích.
  q: z.string().trim().min(1).max(100).optional(),
  job: z.string().trim().min(1).max(100).optional(),
  area_id: z.string().uuid().optional(),
  status: z.enum(['guest', 'member', 'left']).optional(),
  work_status: z.enum(['available', 'by_appointment', 'paused']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const idParamSchema = z.object({ id: z.string().uuid() });

export const contactFieldParamSchema = z.object({
  id: z.string().uuid(),
  field: z.enum(CONTACT_FIELDS),
});

export const updateMeSchema = z.object({
  full_name: z.string().trim().min(2).max(160).optional(),
  email: z.string().trim().email().max(254).nullable().optional(),
  job: z.string().trim().max(160).nullable().optional(),
  area_id: z.string().uuid().nullable().optional(),
  bio: z.string().trim().max(3000).nullable().optional(),
  work_status: z.enum(['available', 'by_appointment', 'paused']).optional(),
  avatar_url: z.string().trim().max(500).nullable().optional(),
  phone: z.string().regex(/^0\d{9}$/).nullable().optional(),
  zalo: z.string().trim().max(160).nullable().optional(),
  messenger: z.string().trim().max(300).nullable().optional(),
  address: z.string().trim().max(500).nullable().optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'Cần có ít nhất một trường để cập nhật.' });

export const contactRequestSchema = z.object({
  field_key: z.enum(CONTACT_FIELDS),
  message: z.string().trim().max(500).nullable().optional(),
});
export const contactRequestQuerySchema = z.object({
  direction: z.enum(['incoming', 'outgoing']).default('incoming'),
  status: z.enum(['pending', 'approved', 'denied']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export const contactRequestParamSchema = z.object({ id: z.string().uuid() });
export const contactDecisionSchema = z.object({ status: z.enum(['approved', 'denied']) });
export const privacyParamSchema = z.object({ field: z.enum(PRIVACY_FIELDS) });
export const privacyUpdateSchema = z.object({ level: z.enum(['public', 'on_consent', 'closed']) });
export const profileViewsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
