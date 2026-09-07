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

// Xe Đỏ (1,4) đi thẳng ăn Tướng Đen (0,4) ngay nước đầu -> "bắt tướng" lập
// tức, ván kết thúc ở ĐÚNG nước đầu của người giải (không có nước máy đáp
// lễ, không có nước 2). Xe đứng giữa hai Tướng nên KHÔNG vi phạm luật đối
// mặt lúc soạn thế (validatePosition chỉ chặn khi không có quân chắn giữa).
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
  const { rows: [c] } = await db.raw(`INSERT INTO communities (code, name) VALUES ('t51-co-the', 'T51') RETURNING id`);
  cid = c.id;
  const { rows: [a] } = await db.raw(`INSERT INTO members (community_id, full_name, status) VALUES (?, 'Alice T51', 'member') RETURNING id`, [cid]);
  alice = a.id;
  aliceToken = jwt.sign({ sub: alice, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' });
});
afterAll(async () => { await db.destroy(); });

describe('T51 Cờ Thế — Mổ ván + Diễn giải + Hồ sơ', () => {
  it('bắt tướng ngay nước đầu: mo-van có sẵn ngay (nước đầu copy điểm gốc, không cần gọi engine nền), giữ thế thắng', async () => {
    engineClient.bestMove.mockResolvedValue({ bestmove: 'e1e0', score_cp: 0, mate: 1, depth: 20, pv: ['e1e0'], lines: [] });
    const created = await supertest(app).post('/api/v1/co-the/positions').set(auth(aliceToken))
      .send({ board: matIn1Board(), side_to_move: 'r' }).expect(201);
    await supertest(app).post(`/api/v1/co-the/positions/${created.body.id}/phan-tich`).set(auth(aliceToken)).expect(200);
    const session = await supertest(app).post('/api/v1/co-the/sessions').set(auth(aliceToken))
      .send({ position_id: created.body.id, mode: 'giai', opponent_level: 'manh' }).expect(201);
    const moveRes = await supertest(app).post(`/api/v1/co-the/sessions/${session.body.id}/moves`).set(auth(aliceToken))
      .send({ from: { r: 1, c: 4 }, to: { r: 0, c: 4 } }).expect(200);
    expect(moveRes.body.status).toBe('ket-thuc');
    expect(moveRes.body.result).toBe('thang');

    await wait(200); // scoreSessionMoves nền — nước đầu chỉ copy điểm gốc (không gọi engine) nên xong rất nhanh, chờ ngắn cho chắc
    const moVan = await supertest(app).get(`/api/v1/co-the/sessions/${session.body.id}/mo-van`).set(auth(aliceToken)).expect(200);
    expect(moVan.body.available).toBe(true);
    expect(moVan.body.moves).toHaveLength(1);
    expect(moVan.body.moves[0].giu_the).toBe(true);
    expect(moVan.body.moves[0].dien_giai).toContain('Vẫn giữ thế');
  });

  it('hồ sơ liệt kê đúng ván vừa xong của chính người giải', async () => {
    const list = await supertest(app).get('/api/v1/co-the/sessions').set(auth(aliceToken)).expect(200);
    expect(list.body.data.length).toBeGreaterThan(0);
    expect(list.body.data[0].status).toBe('ket-thuc');
  });

  it('ván chưa kết thúc thì mo-van trả 409', async () => {
    engineClient.bestMove.mockResolvedValue({ bestmove: 'a', score_cp: 200, mate: null, depth: 10, pv: [], lines: [{ move: 'a', score_cp: 200, mate: null, depth: 10, pv: [] }] });
    const created = await supertest(app).post('/api/v1/co-the/positions').set(auth(aliceToken))
      .send({ board: matIn1Board(), side_to_move: 'r' }).expect(201);
    const session = await supertest(app).post('/api/v1/co-the/sessions').set(auth(aliceToken))
      .send({ position_id: created.body.id, mode: 'giai', opponent_level: 'manh' }).expect(201);
    await supertest(app).get(`/api/v1/co-the/sessions/${session.body.id}/mo-van`).set(auth(aliceToken)).expect(409);
    await supertest(app).post(`/api/v1/co-the/sessions/${session.body.id}/roi`).set(auth(aliceToken)).expect(200);
    await wait(50); // để scoreSessionMoves nền (kích hoạt bởi giveUp) không rơi vào test sau khi DB đã destroy
  });
});
