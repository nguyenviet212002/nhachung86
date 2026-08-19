import { describe, it, expect, afterAll } from 'vitest';
import knexLib from 'knex';
import { ownerKnex, resetDb } from './helpers/db.js';

// Hồi quy cho phát hiện soát xét (Important): migration 002 từng ghép chuỗi
// literal đã quote (quote_literal()) vào MỘT câu knex.raw KHÁC còn kèm mảng
// bindings để bind identifier bằng `??`. knex ^3 quét toàn bộ chuỗi SQL bằng
// regex /\?\??/g bất cứ khi nào bindings là mảng — không biết gì về dấu nháy
// đơn của SQL — nên đếm nhầm ký tự "?" bên trong mật khẩu thành placeholder,
// ném "Expected N bindings, saw M". Bài này đặt mật khẩu thật có chứa "?" và
// "??" để đảm bảo lỗi đó không quay lại.
const originalPassword = process.env.APP_DB_PASSWORD;
const trickyPassword = 'mat?khau??test';

async function dropAppRole() {
  const owner = ownerKnex();
  try {
    // Vai trò có các đặc quyền đã cấp (USAGE ON SCHEMA, ALTER DEFAULT
    // PRIVILEGES, GRANT trên các bảng) nên phải DROP OWNED BY trước, nếu
    // không PostgreSQL từ chối DROP ROLE vì còn đối tượng phụ thuộc.
    await owner.raw('DROP OWNED BY app_role');
  } catch {
    // Role có thể chưa tồn tại hoặc chưa có đặc quyền nào — bỏ qua.
  }
  await owner.raw('DROP ROLE IF EXISTS app_role');
  await owner.destroy();
}

describe('Migration 002 — mật khẩu app_role chứa ký tự ?', () => {
  afterAll(async () => {
    // Khôi phục đúng mật khẩu chuẩn (test_app) — các bài test khác dùng
    // DATABASE_URL cố định trong .env.test và cần role tồn tại với mật khẩu đó.
    process.env.APP_DB_PASSWORD = originalPassword;
    await dropAppRole();
    const db = await resetDb();
    await db.destroy();
  });

  it('migration 002 tạo role thành công, không ném "Expected N bindings"', async () => {
    await dropAppRole();
    process.env.APP_DB_PASSWORD = trickyPassword;

    // resetDb() drop schema + chạy lại migrate.latest() từ đầu — vì role vừa
    // bị xóa ở trên, migration 002 sẽ phải CREATE ROLE lại với mật khẩu mới.
    const db = await resetDb();
    try {
      const { rows } = await db.raw('SELECT rolname FROM pg_roles WHERE rolname = ?', ['app_role']);
      expect(rows).toHaveLength(1);

      // Xác nhận mật khẩu THẬT SỰ được đặt đúng (không bị cắt/hỏng do quét
      // nhầm dấu ?) bằng cách kết nối thật bằng chính mật khẩu đó.
      const url = new URL('postgres://x:x@localhost:55432/nhachung_test');
      url.username = 'app_role';
      url.password = trickyPassword; // URL tự percent-encode ký tự đặc biệt
      const appDb = knexLib({ client: 'pg', connection: url.toString() });
      try {
        const { rows: pingRows } = await appDb.raw('select 1 as ok');
        expect(pingRows[0].ok).toBe(1);
      } finally {
        await appDb.destroy();
      }
    } finally {
      await db.destroy();
    }
  });
});
