import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetDb } from './helpers/db.js';
import { withActor } from '../src/core/tx.js';
import { readContact } from '../src/core/privacy.js';

let db, cid, alice, bob;
beforeAll(async () => {
  db = await resetDb();
  ({ rows: [{ id: cid }] } = await db.raw(
    `INSERT INTO communities (code,name) VALUES ('community-001','X') RETURNING id`));
  ({ rows: [{ id: alice }] } = await db.raw(
    `INSERT INTO members (community_id, full_name, status) VALUES (?, 'Alice','member') RETURNING id`, [cid]));
  ({ rows: [{ id: bob }] } = await db.raw(
    `INSERT INTO members (community_id, full_name, status) VALUES (?, 'Bob','member') RETURNING id`, [cid]));
  await db.raw(`INSERT INTO member_contacts (member_id, community_id, phone) VALUES (?,?,'0912000000')`, [bob, cid]);
  await db.raw(`INSERT INTO privacy_settings (community_id, member_id, field_key, level)
                VALUES (?,?, 'phone','closed')`, [cid, bob]);
});
afterAll(async () => { await db.destroy(); });

describe('T4 lượt đọc bị từ chối vẫn để lại dấu', () => {
  it('trả allowed=false và ghi contact.denied', async () => {
    const r = await withActor(alice, (trx) => readContact(trx, bob, 'phone'));
    expect(r.allowed).toBe(false);
    expect(r.value).toBeNull();
    expect(r.reason).toBe('CLOSED');

    // Giao dịch đã commit — dòng nhật ký PHẢI còn.
    const { rows } = await db.raw(
      `SELECT action, detail FROM audit_log WHERE actor_id = ? AND target_id = ?`, [alice, bob]);
    expect(rows.map(x => x.action)).toContain('contact.denied');
    expect(rows[0].detail.phone).toBeUndefined();   // không ghi giá trị
  });
});
