import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  MIGRATION_DATABASE_URL: z.string().min(1),
  APP_DB_USER: z.string().min(1),
  APP_DB_PASSWORD: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z.string().min(32),
  OTP_PEPPER: z.string().min(16),
  OTP_ADAPTER: z.enum(['console', 'zalo-zns', 'sms']).default('console'),
  S3_ENDPOINT: z.string().url().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  // Kho ảnh (Task 15). Cả bốn đều optional vì `core/storage.js` chọn trình
  // điều khiển theo chính S3_ENDPOINT: có thì đi MinIO, không thì ghi xuống
  // thư mục STORAGE_DIR. Không dùng NODE_ENV để chọn — một máy lập trình chưa
  // dựng MinIO vẫn phải chạy được, và một máy production quên đặt S3_ENDPOINT
  // phải hỏng ở chỗ nhìn thấy được chứ không âm thầm ghi ra đĩa container.
  S3_BUCKET: z.string().default('nhachung'),
  S3_REGION: z.string().default('us-east-1'),
  STORAGE_DIR: z.string().default('.storage'),
  CORS_ORIGIN: z.string().default('http://localhost'),
  LOG_LEVEL: z.string().default('info'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Chết ngay, không chạy nửa vời với cấu hình thiếu
  console.error('Cấu hình môi trường không hợp lệ:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export const isProd = config.NODE_ENV === 'production';
