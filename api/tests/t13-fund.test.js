import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetDb, appKnex } from './helpers/db.js';

// ---------------------------------------------------------------------------
// T13 — bút toán quỹ đã KHÓA là bất động (spec mục 4.5), và bản tổng kết hoạt
// động là điều kiện để mở hoạt động dùng quỹ tiếp theo (SUMMARY_REQUIRED).
//
// Hai lớp cho `locked`, đúng như mục 4.5 viết:
//   * trigger BEFORE UPDATE OR DELETE — chặn cả đường owner;
//   * REVOKE DELETE — chặn đường app_role trước cả khi trigger phải nói gì.
// ---------------------------------------------------------------------------

let db, cid, treasurer, approverA, approverB, locked, moi;

async function mkMember(name, roleKey = null) {
  const { rows: [m] } = await db.raw(
    `INSERT INTO members (community_id, full_name, status) VALUES (?,?, 'member') RETURNING id`,
    [cid, name]);
  if (roleKey) {
    await db.raw(
      `INSERT INTO member_roles (member_id, role_id, community_id)
       SELECT ?, r.id, ? FROM roles r WHERE r.key = ?`, [m.id, cid, roleKey]);
  }
  return m.id;
}

async function mkEntry(amount, { lock = false } = {}) {
  const id = await db.transaction(async (trx) => {
    const { rows: [e] } = await trx.raw(
      `INSERT INTO fund_entries (community_id, amount, purpose, created_by)
       VALUES (?,?,?,?) RETURNING id`, [cid, amount, 'But toan', treasurer]);
    if (Math.abs(amount) >= 1000000) {
      for (const s of [approverA, approverB]) {
        await trx.raw(
          `INSERT INTO fund_entry_approvals (entry_id, approver_id, community_id) VALUES (?,?,?)`,
          [e.id, s, cid]);
      }
    }
    return e.id;
  });
  if (lock) await db.raw(`UPDATE fund_entries SET locked = true WHERE id = ?`, [id]);
  return id;
}

beforeAll(async () => {
  db = await resetDb();
  ({ rows: [{ id: cid }] } = await db.raw(
    `INSERT INTO communities (code,name) VALUES ('t13-fund','Hoi') RETURNING id`));
  treasurer = await mkMember('Thu Quy', 'approver');
  approverA = await mkMember('Duyet A', 'approver');
  approverB = await mkMember('Duyet B', 'approver');

  locked = await mkEntry(-2000000, { lock: true });
  moi = await mkEntry(-300000);
});

afterAll(async () => { await db.destroy(); });

describe('T13 fund_entries.locked bất động', () => {
  it('owner UPDATE bút toán đã khóa ⇒ FUND_ENTRY_LOCKED', async () => {
    await expect(db.raw(`UPDATE fund_entries SET amount = 1 WHERE id = ?`, [locked]))
      .rejects.toThrow(/FUND_ENTRY_LOCKED/);
  });

  it('owner DELETE bút toán đã khóa ⇒ FUND_ENTRY_LOCKED (không phải xoá lặng lẽ)', async () => {
    await expect(db.raw(`DELETE FROM fund_entries WHERE id = ?`, [locked]))
      .rejects.toThrow(/FUND_ENTRY_LOCKED/);
  });

  it('không mở khóa lại được — locked là một chiều', async () => {
    await expect(db.raw(`UPDATE fund_entries SET locked = false WHERE id = ?`, [locked]))
      .rejects.toThrow(/FUND_ENTRY_LOCKED/);
  });

  it('không thêm được chữ ký vào bút toán đã khóa', async () => {
    const late = await mkMember('Duyet Muon', 'approver');
    await expect(db.transaction(async (trx) => {
      await trx.raw(
        `INSERT INTO fund_entry_approvals (entry_id, approver_id, community_id) VALUES (?,?,?)`,
        [locked, late, cid]);
    })).rejects.toThrow(/FUND_ENTRY_LOCKED/);
  });

  it('app_role không xoá được bút toán nào, khóa hay chưa', async () => {
    const app = appKnex();
    try {
      await expect(app.raw(`DELETE FROM fund_entries WHERE id = ?`, [locked]))
        .rejects.toThrow(/permission denied/i);
      await expect(app.raw(`DELETE FROM fund_entries WHERE id = ?`, [moi]))
        .rejects.toThrow(/permission denied/i);
    } finally { await app.destroy(); }
  });

  it('bút toán CHƯA khóa vẫn sửa được, và khóa được đúng một lần', async () => {
    // Đối chứng: nếu không có bài này thì năm bài trên xanh cả khi trigger cấm
    // sạch mọi UPDATE — tức bút toán không bao giờ khóa được, và luật "locked"
    // chưa từng có cơ hội chạy.
    await db.raw(`UPDATE fund_entries SET purpose = 'Da sua' WHERE id = ?`, [moi]);
    await db.raw(`UPDATE fund_entries SET locked = true WHERE id = ?`, [moi]);
    const { rows: [r] } = await db.raw(
      `SELECT purpose, locked FROM fund_entries WHERE id = ?`, [moi]);
    expect(r).toMatchObject({ purpose: 'Da sua', locked: true });
    await expect(db.raw(`UPDATE fund_entries SET purpose = 'Lan hai' WHERE id = ?`, [moi]))
      .rejects.toThrow(/FUND_ENTRY_LOCKED/);
  });
});

describe('T13 SUMMARY_REQUIRED — không mở hoạt động dùng quỹ mới khi còn món chưa tổng kết', () => {
  let cu;

  it('hoạt động dùng quỹ ĐẦU TIÊN mở được (chưa có món nào treo)', async () => {
    const { rows: [a] } = await db.raw(
      `INSERT INTO activities (community_id, title, uses_fund, status, created_by)
       VALUES (?, 'Hoat dong cu', true, 'done', ?) RETURNING id`, [cid, treasurer]);
    cu = a.id;
    expect(cu).toBeTruthy();
  });

  it('hoạt động dùng quỹ thứ hai bị chặn khi món cũ chưa tổng kết', async () => {
    await expect(db.raw(
      `INSERT INTO activities (community_id, title, uses_fund, created_by)
       VALUES (?, 'Hoat dong moi', true, ?)`, [cid, treasurer]))
      .rejects.toThrow(/SUMMARY_REQUIRED/);
  });

  it('hoạt động KHÔNG dùng quỹ vẫn mở được — luật chỉ chạm đúng chỗ nó cần chạm', async () => {
    const { rows: [a] } = await db.raw(
      `INSERT INTO activities (community_id, title, uses_fund, created_by)
       VALUES (?, 'Hoat dong khong dung quy', false, ?) RETURNING id`, [cid, treasurer]);
    expect(a.id).toBeTruthy();
  });

  it('nộp bản tổng kết xong thì mở được ngay', async () => {
    await db.raw(
      `INSERT INTO activity_summaries (community_id, activity_id, body, submitted_by)
       VALUES (?,?,?,?)`, [cid, cu, 'Da tieu 2 trieu, con lai tra quy', treasurer]);
    const { rows: [a] } = await db.raw(
      `INSERT INTO activities (community_id, title, uses_fund, created_by)
       VALUES (?, 'Hoat dong moi', true, ?) RETURNING id`, [cid, treasurer]);
    expect(a.id).toBeTruthy();
  });

  it('bản tổng kết không xoá được bằng app_role — xoá nó là mở lại cửa vừa đóng', async () => {
    const app = appKnex();
    try {
      await expect(app.raw(`DELETE FROM activity_summaries WHERE activity_id = ?`, [cu]))
        .rejects.toThrow(/permission denied/i);
    } finally { await app.destroy(); }
  });
});
