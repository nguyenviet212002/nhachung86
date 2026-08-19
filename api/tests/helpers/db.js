import knexLib from 'knex';
import { fileURLToPath } from 'node:url';

const OWNER_URL = process.env.TEST_DATABASE_URL
  ?? 'postgres://nhachung_owner:test@localhost:55432/nhachung_test';

export function ownerKnex() {
  return knexLib({
    client: 'pg',
    connection: OWNER_URL,
    // Sửa: `.pathname` trên URL Windows trả về "/D:/..." (thừa dấu / trước ổ đĩa),
    // khiến knex resolve sai đường dẫn. fileURLToPath() xử lý đúng trên cả Windows lẫn POSIX.
    migrations: { directory: fileURLToPath(new URL('../../src/db/migrations', import.meta.url)) },
  });
}

export function appKnex() {
  const url = new URL(OWNER_URL);
  url.username = 'app_role';
  // Ruling C1: không cứng mật khẩu ở đây — dùng chung nguồn với migration 002 (Task 2)
  url.password = process.env.APP_DB_PASSWORD ?? 'test_app';
  return knexLib({ client: 'pg', connection: url.toString() });
}

export async function resetDb() {
  const db = ownerKnex();
  await db.raw('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await db.migrate.latest();
  return db;
}
