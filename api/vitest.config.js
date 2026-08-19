import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./tests/setup-env.js'],
    // Tất cả các file test dùng CHUNG một Postgres test singleton (không có
    // schema/role riêng cho từng file). Nhiều bài (resetDb(), DROP ROLE trong
    // t02-role-password) làm DDL cấp schema/cluster — nếu hai file chạy song
    // song, chúng có thể dẫm lên nhau (một file DROP SCHEMA khi file kia đang
    // migrate, hoặc DROP ROLE khi file kia đang mở kết nối app_role). Tắt
    // fileParallelism để các file luôn chạy tuần tự, đổi lấy tốc độ lấy an toàn.
    fileParallelism: false,
  },
});
