import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetDb, appKnex } from './helpers/db.js';

let db, app;
beforeAll(async () => { db = await resetDb(); app = appKnex(); });
afterAll(async () => { await db.destroy(); await app.destroy(); });

describe('T3 số điện thoại không nằm trong members', () => {
  it('bảng members không có cột liên hệ nào', async () => {
    const { rows } = await db.raw(`
      SELECT column_name FROM information_schema.columns
       WHERE table_name = 'members'`);
    const cols = rows.map(r => r.column_name);
    for (const forbidden of ['phone', 'zalo', 'messenger', 'address']) {
      expect(cols, `members không được có cột ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('app_role không SELECT được member_contacts', async () => {
    await expect(app.raw('SELECT * FROM member_contacts')).rejects.toThrow(/permission denied/i);
  });

  it('app_role không INSERT được member_contacts', async () => {
    await expect(
      app.raw(`INSERT INTO member_contacts (member_id, community_id) VALUES (gen_random_uuid(), gen_random_uuid())`)
    ).rejects.toThrow(/permission denied/i);
  });
});
