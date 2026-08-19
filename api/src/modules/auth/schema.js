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
