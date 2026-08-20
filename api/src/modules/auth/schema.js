import { z } from 'zod';
import { inviteTokenSchema } from '../invites/schema.js';

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

// Đặc tả dòng 775: `{ refresh_token }`. Trước đây schema đòi `refreshToken`
// (camelCase của tầng JS lọt ra vỏ HTTP) nên client làm đúng đặc tả sẽ nhận
// VALIDATION_FAILED. Không bài test nào bắt được vì chưa bài nào gọi
// /auth/refresh qua HTTP.
export const refreshSchema = z.object({
  refresh_token: z.string().min(32),
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
  // QĐ-1: KHÔNG có ô nhập người bảo lãnh nữa. `referrer_id` từng là một uuid
  // do người nộp đơn gõ vào — tức một máy dò danh sách thành viên, và một cách
  // khai bừa tên người khác làm người bảo lãnh cho mình. Nay nó đến từ token
  // của đường link mà chính người bảo lãnh đã phát: người bảo lãnh phải hành
  // động TRƯỚC, đúng thứ tự nhân quả thật ngoài đời.
  invite_token: inviteTokenSchema,
  password: z.string().min(8, 'Mật khẩu cần ít nhất 8 ký tự'),
  terms: z.literal(true, { errorMap: () => ({ message: 'Phải đồng ý điều khoản' }) }),
});
