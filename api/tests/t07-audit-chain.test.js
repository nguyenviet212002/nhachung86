import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetDb } from './helpers/db.js';
import { verifyChain, logDenied } from '../src/core/audit.js';
import { withActor } from '../src/core/tx.js';
import { AppError } from '../src/core/errors.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

let db, cid;
beforeAll(async () => {
  db = await resetDb();
  const { rows } = await db.raw(
    `INSERT INTO communities (code, name) VALUES ('community-001','X') RETURNING id`);
  cid = rows[0].id;
  for (let i = 0; i < 5; i++) {
    await db.raw(`INSERT INTO audit_log (community_id, action) VALUES (?, ?)`, [cid, `test.a${i}`]);
  }
});
afterAll(async () => { await db.destroy(); });

describe('T7 chuỗi băm', () => {
  it('chuỗi liên mạch khi chưa ai đụng vào', async () => {
    const r = await verifyChain(db, { communityId: cid });
    expect(r.ok).toBe(true);
    expect(r.checked).toBe(5);
  });

  it('sửa một dòng giữa chuỗi thì phát hiện được', async () => {
    // Dùng vai OWNER — app_role vốn không sửa nổi, dùng nó thì test xanh giả.
    const { rows } = await db.raw(
      `SELECT seq FROM audit_log WHERE community_id = ? ORDER BY seq OFFSET 2 LIMIT 1`, [cid]);
    const seq = rows[0].seq;
    await db.raw(`UPDATE audit_log SET action = 'da-bi-sua' WHERE seq = ?`, [seq]);
    const r = await verifyChain(db, { communityId: cid });
    expect(r.ok).toBe(false);
    expect(String(r.brokenAt)).toBe(String(seq));
  });
});

// Bẫy mục 3 của brief: nếu một hàm ghi nhật ký RỒI mới RAISE, ngoại lệ hủy cả
// giao dịch và xóa luôn dòng nhật ký vừa ghi — người dò hồ sơ bị từ chối mười
// lần thì hệ thống không lưu được lần nào. logDenied() phải mở một giao dịch
// RIÊNG, sau khi giao dịch chính đã rollback — đây là hồi quy xác nhận điều
// đó thật sự đúng, không chỉ đúng trên lý thuyết.
describe('T7 logDenied sống sót qua rollback của giao dịch chính', () => {
  it('logDenied ghi được dòng dù giao dịch chính vừa rollback ngay trước đó', async () => {
    try {
      await withActor(null, async (trx) => {
        await trx.raw('SELECT 1');
        throw new Error('mô phỏng lỗi khiến giao dịch chính rollback');
      });
    } catch {
      // Cố ý nuốt — mục đích chỉ là để lại một giao dịch đã rollback thật sự.
    }

    await logDenied({
      communityId: cid, actorId: null, action: 'get:/api/v1/thu-nghiem',
      detail: { code: 'FORBIDDEN' },
    });

    const { rows } = await db.raw(
      `SELECT action FROM audit_log WHERE community_id = ? AND action = 'get:/api/v1/thu-nghiem.denied'`,
      [cid]
    );
    expect(rows).toHaveLength(1);
  });

  // Hồi quy: mã lỗi thật của AppError/mapPgError (core/errors.js) theo quy ước
  // UPPER_SNAKE_CASE (vd. 'DUPLICATE', 'INTERNAL'). errorHandler đưa thẳng
  // mapped.code vào detail.code khi gọi logDenied — nếu assertSafeDetail chỉ
  // nhận chữ thường, mọi lời gọi logDenied thật sẽ ném lỗi (bị .catch() trong
  // errorHandler nuốt âm thầm) và KHÔNG BAO GIỜ ghi được dòng nào. Bài này gọi
  // errorHandler thật (không mock audit.js) với req.actor có sẵn để xác nhận
  // dòng nhật ký thật sự xuất hiện trong CSDL.
  it('errorHandler ghi được dòng từ chối thật với mã lỗi UPPER_SNAKE_CASE', async () => {
    const err = new AppError('SELF_ONLY', 'Việc này chỉ chính người đó làm được.', { status: 403 });
    const req = {
      actor: { communityId: cid, id: null },
      method: 'GET',
      path: '/api/v1/rieng-tu',
      route: { path: '/api/v1/rieng-tu' },
      log: { error: () => {} },
    };
    const res = {
      statusCode: undefined,
      body: undefined,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; },
    };

    errorHandler(err, req, res, () => {});
    expect(res.statusCode).toBe(403);

    // logDenied chạy fire-and-forget (không await trong errorHandler) —
    // chờ có giới hạn cho tới khi dòng xuất hiện, thay vì sleep cố định.
    let rows = [];
    for (let i = 0; i < 20; i++) {
      const r = await db.raw(
        `SELECT detail FROM audit_log WHERE community_id = ? AND action = 'get:/api/v1/rieng-tu.denied'`,
        [cid]
      );
      rows = r.rows;
      if (rows.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(rows).toHaveLength(1);
    expect(rows[0].detail).toEqual({ code: 'SELF_ONLY' });
  });
});
