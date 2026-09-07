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

// Tướng khác cột (Đỏ cột 4, Đen cột 3) tránh đối mặt. Xe Đỏ (1,5) và Xe Đen
// (0,0) đều ở cột khác cột hai Tướng — nước đi của cả hai bên trong test này
// không đụng chạm gì tới Tướng (không sinh chiếu), giữ test đơn giản.
function boardForMoveTest() {
  const b = Array.from({ length: 10 }, () => Array(9).fill(null));
  b[9][4] = { side: 'r', type: 'general' };
  b[0][3] = { side: 'b', type: 'general' };
  b[1][5] = { side: 'r', type: 'chariot' };
  b[0][0] = { side: 'b', type: 'chariot' };
  return b;
}

async function createPosAndSession(token, { mode = 'giai', opponent_level = 'manh' } = {}) {
  const created = await supertest(app).post('/api/v1/co-the/positions').set(auth(token))
    .send({ board: boardForMoveTest(), side_to_move: 'r' }).expect(201);
  const session = await supertest(app).post('/api/v1/co-the/sessions').set(auth(token))
    .send({ position_id: created.body.id, mode, opponent_level }).expect(201);
  return session.body;
}

beforeAll(async () => {
  db = await resetDb();
  app = buildApp();
  const { rows: [c] } = await db.raw(`INSERT INTO communities (code, name) VALUES ('t50-co-the', 'T50') RETURNING id`);
  cid = c.id;
  const { rows: [a] } = await db.raw(`INSERT INTO members (community_id, full_name, status) VALUES (?, 'Alice T50', 'member') RETURNING id`, [cid]);
  alice = a.id;
  aliceToken = jwt.sign({ sub: alice, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' });
});
afterAll(async () => { await db.destroy(); });

describe('T50 Cờ Thế — Sessions + Đang đấu', () => {
  it('tạo session: solver_side suy từ position.side_to_move, không nhận từ client', async () => {
    const s = await createPosAndSession(aliceToken);
    expect(s.solver_side).toBe('r');
    expect(s.status).toBe('dang-choi');
  });

  it('đi 1 nước hợp lệ, ván chưa xong -> máy tự đáp lễ NGAY trong response, KHÔNG cần chờ', async () => {
    // "a9a8": xe Đen (0,0) đi (1,0) — nước hợp lệ, không liên quan Tướng.
    engineClient.bestMove.mockResolvedValue({
      bestmove: 'a9a8', score_cp: -50, mate: null, depth: 10, pv: [],
      lines: [{ move: 'a9a8', score_cp: -50, mate: null, depth: 10, pv: ['a9a8'] }],
    });
    const s = await createPosAndSession(aliceToken);
    // Xe Đỏ (1,5) -> (5,5): thẳng cột 5, không đụng Tướng nào.
    const res = await supertest(app).post(`/api/v1/co-the/sessions/${s.id}/moves`).set(auth(aliceToken))
      .send({ from: { r: 1, c: 5 }, to: { r: 5, c: 5 } }).expect(200);
    expect(res.body.turn).toBe('r'); // Đỏ đi -> Đen (máy) đáp lễ ngay -> về lại lượt Đỏ
    const detail = await supertest(app).get(`/api/v1/co-the/sessions/${s.id}`).set(auth(aliceToken)).expect(200);
    expect(detail.body.moves).toHaveLength(2);
    expect(detail.body.moves[1].side).toBe('b');
  });

  it('không phải người giải thì không đi được (403)', async () => {
    const { rows: [bob] } = await db.raw(`INSERT INTO members (community_id, full_name, status) VALUES (?, 'Bob T50', 'member') RETURNING id`, [cid]);
    const bobToken = jwt.sign({ sub: bob.id, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' });
    const s = await createPosAndSession(aliceToken);
    await supertest(app).post(`/api/v1/co-the/sessions/${s.id}/moves`).set(auth(bobToken))
      .send({ from: { r: 1, c: 5 }, to: { r: 5, c: 5 } }).expect(403);
  });

  it('mách 1 nước không lưu vào lịch sử', async () => {
    engineClient.bestMove.mockResolvedValue({ bestmove: 'a9a8', score_cp: -50, mate: null, depth: 10, pv: [], lines: [] });
    const s = await createPosAndSession(aliceToken);
    await supertest(app).post(`/api/v1/co-the/sessions/${s.id}/mach-1-nuoc`).set(auth(aliceToken)).expect(200);
    const detail = await supertest(app).get(`/api/v1/co-the/sessions/${s.id}`).set(auth(aliceToken)).expect(200);
    expect(detail.body.moves).toHaveLength(0);
  });

  it('bỏ cuộc -> ket-thuc, result=thua, end_reason=bo-cuoc', async () => {
    const s = await createPosAndSession(aliceToken);
    const res = await supertest(app).post(`/api/v1/co-the/sessions/${s.id}/roi`).set(auth(aliceToken)).expect(200);
    expect(res.body.status).toBe('ket-thuc');
    expect(res.body.result).toBe('thua');
    expect(res.body.end_reason).toBe('bo-cuoc');
  });
});
