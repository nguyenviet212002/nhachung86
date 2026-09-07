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
  const { rows: [community] } = await db.raw(`INSERT INTO communities (code, name) VALUES ('t62-analyze', 'T62 Analyze') RETURNING id`);
  cid = community.id;
  const { rows: [a] } = await db.raw(
    `INSERT INTO members (community_id, full_name, status) VALUES (?, 'Alice T62', 'member') RETURNING id`, [cid]);
  alice = a.id;
  aliceToken = jwt.sign({ sub: alice, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' });
  const { rows: [b] } = await db.raw(
    `INSERT INTO members (community_id, full_name, status) VALUES (?, 'Bob T62', 'member') RETURNING id`, [cid]);
  bob = b.id;
  bobToken = jwt.sign({ sub: bob, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' });
});
afterAll(async () => { await db.destroy(); });

describe('T62 mổ ván tự động chạy khi ván kết thúc', () => {
  it('xin thua kích hoạt mổ ván: engine được gọi movetime=400/multipv=1 mỗi nước, cột được ghi', async () => {
    engineClient.bestMove.mockResolvedValue({ bestmove: 'h2e2', score_cp: 15, mate: null, depth: 6, pv: ['h2e2'] });

    const challenge = await supertest(app).post('/api/v1/games/challenges').set(auth(aliceToken))
      .send({ opponent_member_id: bob }).expect(201);
    await supertest(app).post(`/api/v1/games/challenges/${challenge.body.id}/accept`).set(auth(bobToken)).expect(200);
    await supertest(app).post(`/api/v1/games/${challenge.body.id}/moves`).set(auth(aliceToken))
      .send({ from: { r: 7, c: 7 }, to: { r: 7, c: 4 } }).expect(200);
    await supertest(app).post(`/api/v1/games/${challenge.body.id}/resign`).set(auth(bobToken)).expect(200);

    await wait(200);

    expect(engineClient.bestMove).toHaveBeenCalledWith(expect.objectContaining({ movetime: 400, multipv: 1 }));
    const { rows: [gameRow] } = await db.raw(`SELECT analyzed_at, red_avg_loss, black_avg_loss FROM games WHERE id = ?`, [challenge.body.id]);
    expect(gameRow.analyzed_at).not.toBeNull();
    expect(gameRow.red_avg_loss).toBe(0);
    expect(gameRow.black_avg_loss).toBeNull();
    const { rows: [moveRow] } = await db.raw(`SELECT eval_before_cp, eval_before_mate, win_loss FROM game_moves WHERE game_id = ? AND seq = 1`, [challenge.body.id]);
    expect(moveRow.eval_before_cp).toBe(15);
    expect(moveRow.eval_before_mate).toBeNull();
    expect(moveRow.win_loss).toBe(0);
  });

  it('engine lỗi không làm hỏng luồng xin thua: response vẫn 200, analyzed_at ở lại NULL', async () => {
    engineClient.bestMove.mockRejectedValue(new Error('engine không trả lời'));
    const challenge = await supertest(app).post('/api/v1/games/challenges').set(auth(aliceToken))
      .send({ opponent_member_id: bob }).expect(201);
    await supertest(app).post(`/api/v1/games/challenges/${challenge.body.id}/accept`).set(auth(bobToken)).expect(200);
    await supertest(app).post(`/api/v1/games/${challenge.body.id}/moves`).set(auth(aliceToken))
      .send({ from: { r: 7, c: 7 }, to: { r: 7, c: 4 } }).expect(200);

    await supertest(app).post(`/api/v1/games/${challenge.body.id}/resign`).set(auth(bobToken)).expect(200);
    await wait(200);

    const { rows: [gameRow] } = await db.raw(`SELECT analyzed_at FROM games WHERE id = ?`, [challenge.body.id]);
    expect(gameRow.analyzed_at).toBeNull();
  });
});
