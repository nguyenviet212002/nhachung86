import { z } from 'zod';

// Bốn trường liên hệ mà contact_read chấp nhận (danh sách trắng ở migration
// 006/012a). Kiểm ở zod TRƯỚC khi giá trị chạm tới hàm CSDL: nhánh BAD_FIELD
// trong contact_read RAISE EXCEPTION, mà một ngoại lệ chưa bắt sẽ nhiễm độc cả
// giao dịch (bẫy 2 — xem Ruling T8-c). Chặn từ vỏ ngoài thì nhánh đó chỉ còn
// là lưới cuối, không phải đường đi thường ngày.
export const CONTACT_FIELDS = ['phone', 'zalo', 'messenger', 'address'];

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
