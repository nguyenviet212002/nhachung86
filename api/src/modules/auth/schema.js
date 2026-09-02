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

// Đăng ký nhận số điện thoại trực tiếp và dùng link mời làm bằng chứng bảo lãnh.
// OTP đã được bỏ khỏi luồng đăng ký; trường otp_token chỉ còn để tương thích với
// client cũ trong giai đoạn chuyển tiếp. Số điện thoại và mật khẩu tiếp tục được
// cất trong join_request_secrets, không đưa vào applicant_data có quyền đọc rộng.
//
// birth_year KHÔNG cố định 1986 ở tầng zod: đặc tả dòng 776 nói rõ con số này
// nằm trong communities.config, "không nằm trong mã nguồn" — cộng đồng sau có
// thể là năm khác. Service đối chiếu với config.
export const registerSchema = z.object({
  // OTP không còn bắt buộc khi đăng ký. Nếu client cũ vẫn gửi otp_token thì
  // service tiếp tục xác minh và tiêu thụ vé để giữ tương thích ngược.
  otp_token: z.string().min(20).optional(),
  phone: vnPhone,
  // Bắt buộc từ đây — người nộp đơn đồng ý các kênh này công khai với thành
  // viên khác ngay khi đơn được duyệt (contact_publish_on_join, migration 054),
  // không qua luồng "xin phép" nữa. zalo dùng cùng khuôn số điện thoại VN;
  // messenger là đường dẫn/tên người dùng Messenger, không có khuôn cố định.
  zalo: vnPhone,
  messenger: z.string().trim().min(3, 'Điền link hoặc tên người dùng Messenger').max(200),
  full_name: z.string().trim().min(2).max(120),
  birth_year: z.coerce.number().int().min(1900).max(2100),
  area_id: z.string().uuid(),
  // Số điện thoại chỉ là thông tin người dùng nhập để đối chiếu ngoài đời;
  // quan hệ bảo lãnh thật vẫn lấy từ invite_token đã ký, không tra theo số.
  referrer_phone: vnPhone.optional(),
  // QĐ-1: KHÔNG có ô nhập người bảo lãnh nữa. `referrer_id` từng là một uuid
  // do người nộp đơn gõ vào — tức một máy dò danh sách thành viên, và một cách
  // khai bừa tên người khác làm người bảo lãnh cho mình. Nay nó đến từ token
  // của đường link mà chính người bảo lãnh đã phát: người bảo lãnh phải hành
  // động TRƯỚC, đúng thứ tự nhân quả thật ngoài đời.
  invite_token: inviteTokenSchema,
  password: z.string().min(8, 'Mật khẩu cần ít nhất 8 ký tự'),
  terms: z.literal(true, { errorMap: () => ({ message: 'Phải đồng ý điều khoản' }) }),
});
