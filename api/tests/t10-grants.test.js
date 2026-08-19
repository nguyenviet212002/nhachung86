import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resetDb } from './helpers/db.js';

const expected = JSON.parse(readFileSync(new URL('./expected-grants.json', import.meta.url)));
let db;
beforeAll(async () => { db = await resetDb(); });
afterAll(async () => { await db.destroy(); });

describe('T10 ma trận quyền của app_role', () => {
  it('mọi bảng public đều có mặt trong expected-grants.json', async () => {
    // Phân mảnh (audit_log_2026_08, ...) bị loại khỏi bài kiểm này bằng
    // `NOT c.relispartition` — tên phân mảnh sinh theo tháng nên không thể
    // khai báo tĩnh trong expected-grants.json. Chúng có bài kiểm riêng ở
    // dưới ('mọi phân mảnh audit_log cũng chỉ có SELECT, INSERT').
    const { rows } = await db.raw(`
      SELECT c.relname AS table_name
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND NOT c.relispartition
         AND c.relname <> 'knex_migrations' AND c.relname <> 'knex_migrations_lock'
    `);
    const missing = rows.map(r => r.table_name).filter(t => !(t in expected));
    expect(missing, `bảng chưa khai báo quyền: ${missing.join(', ')}`).toEqual([]);
  });

  it('quyền thực tế khớp khai báo — kể cả phân mảnh', async () => {
    for (const [table, want] of Object.entries(expected)) {
      const { rows } = await db.raw(`
        SELECT privilege_type FROM information_schema.table_privileges
         WHERE table_schema = 'public' AND table_name = ? AND grantee = 'app_role'
      `, [table]);
      const got = rows.map(r => r.privilege_type).sort();
      expect(got, `bảng ${table}`).toEqual([...want].sort());
    }
  });

  it('mọi phân mảnh audit_log cũng chỉ có SELECT, INSERT', async () => {
    const { rows } = await db.raw(`
      SELECT c.relname FROM pg_class c JOIN pg_inherits i ON i.inhrelid = c.oid
       WHERE i.inhparent = 'audit_log'::regclass
    `);
    expect(rows.length).toBeGreaterThan(0);
    for (const { relname } of rows) {
      const { rows: p } = await db.raw(`
        SELECT privilege_type FROM information_schema.table_privileges
         WHERE table_name = ? AND grantee = 'app_role'`, [relname]);
      expect(p.map(x => x.privilege_type).sort(), `phân mảnh ${relname}`)
        .toEqual(['INSERT', 'SELECT']);
    }
  });
});
