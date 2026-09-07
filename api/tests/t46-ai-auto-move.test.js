import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { resetDb } from './helpers/db.js';
import { buildApp } from '../src/app.js';
import { config } from '../src/config/index.js';

vi.mock('../src/modules/games/engineClient.js', () => ({ bestMove: vi.fn() }));
import * as engineClient from '../src/modules/games/engineClient.js';

let db, app, cid, alice, aliceToken, bob, bobToken;
const auth = (token) => ({ authorization: `Bearer ${token}` });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  db = await resetDb();
  app = buildApp();
  const { rows: [community] } = await db.raw(`INSERT INTO communities (code, name) VALUES ('t46-ai', 'T46 AI') RETURNING id`);
  cid = community.id;
  const { rows: [a] } = await db.raw(
    `INSERT INTO members (community_id, full_name, status) VALUES (?, 'Alice T46', 'member') RETURNING id`, [cid]);
  alice = a.id;
  aliceToken = jwt.sign({ sub: alice, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' });
  const { rows: [b] } = await db.raw(
    `INSERT INTO members (community_id, full_name, status) VALUES (?, 'Bob T46', 'member') RETURNING id`, [cid]);
  bob = b.id;
  bobToken = jwt.sign({ sub: bob, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' });
});
afterAll(async () => { await db.destroy(); });

describe('T46 máy đi hộ — tự động đi khi tới lượt bên đã bật', () => {
  it('bật AI cho Đỏ đúng lúc đang là lượt Đỏ: gọi engine multipv=3, tự áp đúng 1 nước', async () => {
    engineClient.bestMove.mockResolvedValue({
      bestmove: 'h2e2', score_cp: 20, mate: null, depth: 10, pv: ['h2e2'],
      lines: [{ move: 'h2e2', score_cp: 20, mate: null, depth: 10, pv: ['h2e2'] }],
    });
    const challenge = await supertest(app).post('/api/v1/games/challenges').set(auth(aliceToken))
      .send({ opponent_member_id: bob }).expect(201);
    await supertest(app).post(`/api/v1/games/challenges/${challenge.body.id}/accept`).set(auth(bobToken)).expect(200);

    await supertest(app).post(`/api/v1/games/${challenge.body.id}/ai-level`).set(auth(aliceToken))
      .send({ level: 'sieu' }).expect(200);
    await wait(150);

    expect(engineClient.bestMove).toHaveBeenCalledWith(expect.objectContaining({ movetime: 8000, multipv: 3 }));
    const detail = await supertest(app).get(`/api/v1/games/${challenge.body.id}`).set(auth(aliceToken)).expect(200);
    expect(detail.body.turn).toBe('b');
    expect(detail.body.moves).toHaveLength(1);
    // h2e2 -> pháo Đỏ (7,7) sang (7,4), đúng nước khai cuộc kinh điển "pháo 2 bình 5"
    expect(detail.body.moves[0]).toMatchObject({ from_r: 7, from_c: 7, to_r: 7, to_c: 4, side: 'r' });
    // Dọn dẹp (thêm ngoài đúng nguyên văn task brief): ván này còn 'active' sau
    // đúng 1 nước máy đi (Đen chưa bật máy nên không tự đáp lễ) — chỉ mục duy
    // nhất từng phần idx_games_active_pair (migration 057, cùng bẫy đã xác nhận
    // ở t41-games-api.test.js dòng ~106) chỉ cho phép MỘT ván pending/active cho
    // mỗi cặp thành viên trong cùng cộng đồng. Không xin thua ở đây thì test kế
    // tiếp (challenge() Alice-Bob khác) vỡ ngay ở bước tạo với 409 DUPLICATE —
    // không liên quan gì tới đúng/sai của setAiLevel/maybeAutoMove đang kiểm.
    await supertest(app).post(`/api/v1/games/${challenge.body.id}/resign`).set(auth(bobToken)).expect(200);
    // resign() giờ tự kích hoạt analyzeGame() nền (fire-and-forget, task 3) —
    // đợi nó chạy xong trước khi sang test kế, nếu không lệnh gọi engine
    // movetime=400 của nó có thể rơi đúng vào cửa sổ đo "không tự đi nữa" của
    // test dưới và làm sai đếm mock, y hệt cách t62-analyze-game.test.js đợi.
    await wait(200);
  });

  it('tắt máy (level=null) thì không tự đi nữa', async () => {
    engineClient.bestMove.mockClear();
    const challenge = await supertest(app).post('/api/v1/games/challenges').set(auth(aliceToken))
      .send({ opponent_member_id: bob }).expect(201);
    await supertest(app).post(`/api/v1/games/challenges/${challenge.body.id}/accept`).set(auth(bobToken)).expect(200);
    await supertest(app).post(`/api/v1/games/${challenge.body.id}/ai-level`).set(auth(aliceToken))
      .send({ level: null }).expect(200);
    await wait(150);
    expect(engineClient.bestMove).not.toHaveBeenCalled();
    // Dọn dẹp, cùng lý do đã ghi ở test trên: ván vẫn 'active' (chưa ai đi nước
    // nào) — giải phóng cặp Alice-Bob cho test kế tiếp (403) tạo challenge mới.
    await supertest(app).post(`/api/v1/games/${challenge.body.id}/resign`).set(auth(bobToken)).expect(200);
  });

  it('người ngoài ván không bật được máy đi hộ (403)', async () => {
    const { rows: [c] } = await db.raw(
      `INSERT INTO members (community_id, full_name, status) VALUES (?, 'Carol T46', 'member') RETURNING id`, [cid]);
    const carolToken = jwt.sign({ sub: c.id, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' });
    const challenge = await supertest(app).post('/api/v1/games/challenges').set(auth(aliceToken))
      .send({ opponent_member_id: bob }).expect(201);
    await supertest(app).post(`/api/v1/games/challenges/${challenge.body.id}/accept`).set(auth(bobToken)).expect(200);
    await supertest(app).post(`/api/v1/games/${challenge.body.id}/ai-level`).set(auth(carolToken))
      .send({ level: 'sieu' }).expect(403);
  });

  it('bật AI cho Đen (khách qua link mời) rồi Đỏ đi 1 nước — máy tự đáp lễ đúng phe Đen', async () => {
    engineClient.bestMove.mockClear();
    engineClient.bestMove.mockResolvedValue({
      bestmove: 'h9g7', score_cp: -10, mate: null, depth: 10, pv: ['h9g7'],
      lines: [{ move: 'h9g7', score_cp: -10, mate: null, depth: 10, pv: ['h9g7'] }],
    });
    const room = await supertest(app).post('/api/v1/games/rooms').set(auth(aliceToken)).expect(201);
    const joined = await supertest(app).post(`/api/v1/games/rooms/${room.body.invite_token}/join`)
      .send({ guest_name: 'Khách T46' }).expect(201);
    await supertest(app).post(`/api/v1/games/${room.body.id}/ai-level`).set(auth(joined.body.guest_token))
      .send({ level: 'sieu' }).expect(200);
    await supertest(app).post(`/api/v1/games/${room.body.id}/ready`).set(auth(aliceToken)).expect(200);
    await supertest(app).post(`/api/v1/games/${room.body.id}/ready`).set(auth(joined.body.guest_token)).expect(200);

    await supertest(app).post(`/api/v1/games/${room.body.id}/moves`).set(auth(aliceToken))
      .send({ from: { r: 6, c: 0 }, to: { r: 5, c: 0 } }).expect(200);
    await wait(150);

    const detail = await supertest(app).get(`/api/v1/games/${room.body.id}`).set(auth(aliceToken)).expect(200);
    expect(detail.body.moves).toHaveLength(2);
    expect(detail.body.moves[1]).toMatchObject({ side: 'b' });
    expect(detail.body.turn).toBe('r');
  });
});
