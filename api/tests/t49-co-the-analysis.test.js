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

// Tướng khác cột (3 và 5) — tránh đối mặt trực tiếp (validatePosition, Task 1)
// mà không cần thêm quân chắn.
function validBoard() {
  const b = Array.from({ length: 10 }, () => Array(9).fill(null));
  b[9][3] = { side: 'r', type: 'general' };
  b[0][5] = { side: 'b', type: 'general' };
  return b;
}

beforeAll(async () => {
  db = await resetDb();
  app = buildApp();
  const { rows: [c] } = await db.raw(`INSERT INTO communities (code, name) VALUES ('t49-co-the', 'T49') RETURNING id`);
  cid = c.id;
  const { rows: [a] } = await db.raw(`INSERT INTO members (community_id, full_name, status) VALUES (?, 'Alice T49', 'member') RETURNING id`, [cid]);
  alice = a.id;
  aliceToken = jwt.sign({ sub: alice, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' });
});
afterAll(async () => { await db.destroy(); });

describe('T49 Cờ Thế — Phân tích + Tìm cách phá', () => {
  it('mate > 0 -> verdict thang, certainty chung-minh, lưu lại điểm', async () => {
    engineClient.bestMove.mockResolvedValue({ bestmove: 'a0a1', score_cp: 0, mate: 3, depth: 20, pv: ['a0a1'], lines: [] });
    const created = await supertest(app).post('/api/v1/co-the/positions').set(auth(aliceToken))
      .send({ board: validBoard(), side_to_move: 'r' }).expect(201);
    const res = await supertest(app).post(`/api/v1/co-the/positions/${created.body.id}/phan-tich`).set(auth(aliceToken)).expect(200);
    expect(res.body.verdict).toBe('thang');
    expect(res.body.verdict_certainty).toBe('chung-minh');
    expect(res.body.verdict_mate).toBe(3);
    expect(res.body.engine_version).toBeTruthy();
  });

  it('|score_cp| < 80, mate null -> verdict hoa, certainty uoc-luong', async () => {
    engineClient.bestMove.mockResolvedValue({ bestmove: 'a0a1', score_cp: 30, mate: null, depth: 18, pv: [], lines: [] });
    const created = await supertest(app).post('/api/v1/co-the/positions').set(auth(aliceToken))
      .send({ board: validBoard(), side_to_move: 'r' }).expect(201);
    const res = await supertest(app).post(`/api/v1/co-the/positions/${created.body.id}/phan-tich`).set(auth(aliceToken)).expect(200);
    expect(res.body.verdict).toBe('hoa');
  });

  it('tìm cách phá: chỉ liệt các nước có mate>0, sắp theo mate tăng dần', async () => {
    engineClient.bestMove.mockResolvedValue({
      bestmove: 'a', score_cp: 900, mate: null, depth: 20, pv: [],
      lines: [
        { move: 'cham', score_cp: null, mate: 5, depth: 20, pv: ['cham', 'x', 'y'] },
        { move: 'nhanh', score_cp: null, mate: 2, depth: 20, pv: ['nhanh', 'z'] },
        { move: 'khong-thang', score_cp: 900, mate: null, depth: 20, pv: [] },
      ],
    });
    const created = await supertest(app).post('/api/v1/co-the/positions').set(auth(aliceToken))
      .send({ board: validBoard(), side_to_move: 'r' }).expect(201);
    const res = await supertest(app).post(`/api/v1/co-the/positions/${created.body.id}/tim-cach-pha`).set(auth(aliceToken)).expect(200);
    expect(res.body.co_duong_thang).toBe(true);
    expect(res.body.duong.map((d) => d.first_move)).toEqual(['nhanh', 'cham']);
  });
});
