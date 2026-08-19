import { z } from 'zod';

export const vnPhone = z
  .string()
  .trim()
  .regex(/^0\d{9}$/, 'Số điện thoại phải có 10 chữ số, bắt đầu bằng 0');

export const otpRequestSchema = z.object({
  phone: vnPhone,
  purpose: z.enum(['register', 'reset']),
});

export const otpVerifySchema = z.object({
  phone: vnPhone,
  code: z.string().regex(/^\d{6}$/, 'Mã xác minh gồm đúng 6 chữ số'),
  purpose: z.enum(['register', 'reset']),
});

export const loginSchema = z.object({
  identifier: z.string().trim().min(3),
  password: z.string().min(8),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(32),
});

// Đăng ký — đặc tả dòng 770.
//
// LỆCH CÓ CHỦ ĐÍCH khỏi danh sách trường của đặc tả: thêm `phone`. Đặc tả liệt
// kê đầu vào là { otp_token, full_name, birth_year, area_id, referrer_id,
// password, terms } — không có số điện thoại. Nhưng dòng 855 lại đòi approve
// chạy `contact_upsert(<member_id>, 'phone', <số từ applicant_data>)`, tức
// applicant_data PHẢI chứa số. Số đó không thể suy ra từ otp_token: hệ thống
// cố ý chỉ lưu HMAC (phone_hash), không lưu số thô ở bất cứ đâu, và HMAC không
// đảo ngược được. Vậy hoặc client gửi lại số, hoặc luồng duyệt của Task 9
// không có gì để điền. Gửi lại số và ĐỐI CHIẾU với `ph` trong otp_token là
// cách duy nhất vừa có số vừa không cho phép khai một số khác số đã xác minh.
//
// birth_year KHÔNG cố định 1986 ở tầng zod: đặc tả dòng 776 nói rõ con số này
// nằm trong communities.config, "không nằm trong mã nguồn" — cộng đồng sau có
// thể là năm khác. Service đối chiếu với config.
export const registerSchema = z.object({
  otp_token: z.string().min(20),
  phone: vnPhone,
  full_name: z.string().trim().min(2).max(120),
  birth_year: z.coerce.number().int().min(1900).max(2100),
  area_id: z.string().uuid(),
  referrer_id: z.string().uuid(),
  password: z.string().min(8, 'Mật khẩu cần ít nhất 8 ký tự'),
  terms: z.literal(true, { errorMap: () => ({ message: 'Phải đồng ý điều khoản' }) }),
});
