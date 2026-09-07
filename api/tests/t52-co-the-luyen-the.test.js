import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { resetDb } from './helpers/db.js';
import { buildApp } from '../src/app.js';
import { config } from '../src/config/index.js';

vi.mock('../src/modules/games/engineClient.js', () => ({ bestMove: vi.fn() }));
import * as engineClient from '../src/modules/games/engineClient.js';

let db, app, cid, alice, aliceToken;
const auth = (t) => ({ authorization: `Bearer ${t}` });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Xe Đỏ (1,4) ăn thẳng Tướng Đen (0,4) ngay nước đầu -> mỗi ván mô phỏng
// dài ĐÚNG 1 nước, kết thúc lập tức, không cần vòng lặp dài trong test.
// UCI của nước này (theo squareToCell: r = 9 - rank): từ (1,4) -> "e8",
// đến (0,4) -> "e9" — KHÔNG PHẢI "e1e0" (đó là ô (8,4)->(9,4), không có
// quân nào ở đó trên bàn này).
function matIn1Board() {
  const b = Array.from({ length: 10 }, () => Array(9).fill(null));
  b[9][4] = { side: 'r', type: 'general' };
  b[0][4] = { side: 'b', type: 'general' };
  b[0][3] = { side: 'b', type: 'advisor' };
  b[0][5] = { side: 'b', type: 'advisor' };
  b[1][4] = { side: 'r', type: 'chariot' };
  return b;
}

beforeAll(async () => {
  db = await resetDb();
  app = buildApp();
  const { rows: [c] } = await db.raw(`INSERT INTO communities (code, name) VALUES ('t52-co-the', 'T52') RETURNING id`);
  cid = c.id;
  const { rows: [a] } = await db.raw(`INSERT INTO members (community_id, full_name, status) VALUES (?, 'Alice T52', 'member') RETURNING id`, [cid]);
  alice = a.id;
  aliceToken = jwt.sign({ sub: alice, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' });
});
afterAll(async () => { await db.destroy(); });

describe('T52 Cờ Thế — Luyện Thế', () => {
  it('chạy nền, kết thúc session, mỗi ván bắt tướng ngay nước đầu -> Hạ/Trung/Cao đều tồn tại và có nước đầu duy nhất', async () => {
    engineClient.bestMove.mockResolvedValue({
      bestmove: 'e8e9', score_cp: 0, mate: 1, depth: 20, pv: ['e8e9'],
      lines: [{ move: 'e8e9', score_cp: 0, mate: 1, depth: 20, pv: ['e8e9'] }],
    });
    const created = await supertest(app).post('/api/v1/co-the/positions').set(auth(aliceToken))
      .send({ board: matIn1Board(), side_to_move: 'r' }).expect(201);
    const session = await supertest(app).post('/api/v1/co-the/sessions').set(auth(aliceToken))
      .send({ position_id: created.body.id, mode: 'luyen-the', luyen_the_cap: 'ha' }).expect(201);
    await supertest(app).post(`/api/v1/co-the/sessions/${session.body.id}/luyen-the/chay`).set(auth(aliceToken)).expect(200);
    await wait(500);
    const detail = await supertest(app).get(`/api/v1/co-the/sessions/${session.body.id}`).set(auth(aliceToken)).expect(200);
    expect(detail.body.status).toBe('ket-thuc');
    expect(detail.body.end_reason).toBe('luyen-the-xong');
    // Kết quả Hạ/Trung/Cao phải LƯU LẠI (không chỉ phát qua SSE) — nếu không
    // ai đang mở kết nối lúc job nền xong thì SSE-only sẽ mất dữ liệu vĩnh viễn.
    expect(detail.body.luyen_the_result.tong_so_van).toBe(8);
    expect(detail.body.luyen_the_result.ha.first_move).toBe('e8e9');
    expect(detail.body.luyen_the_result.cao.first_move).toBe('e8e9');
  });

  it('không phải chế độ luyen-the thì không chạy được (409)', async () => {
    const created = await supertest(app).post('/api/v1/co-the/positions').set(auth(aliceToken))
      .send({ board: matIn1Board(), side_to_move: 'r' }).expect(201);
    const session = await supertest(app).post('/api/v1/co-the/sessions').set(auth(aliceToken))
      .send({ position_id: created.body.id, mode: 'giai', opponent_level: 'manh' }).expect(201);
    await supertest(app).post(`/api/v1/co-the/sessions/${session.body.id}/luyen-the/chay`).set(auth(aliceToken)).expect(409);
  });
});
