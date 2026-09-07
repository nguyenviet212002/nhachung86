import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { resetDb } from './helpers/db.js';
import { buildApp } from '../src/app.js';
import { config } from '../src/config/index.js';

vi.mock('../src/modules/games/engineClient.js', () => ({ bestMove: vi.fn() }));
import * as engineClient from '../src/modules/games/engineClient.js';

let db, app, cid, alice, aliceToken, bob, bobToken, carol, carolToken;
const auth = (token) => ({ authorization: `Bearer ${token}` });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  db = await resetDb();
  app = buildApp();
  const { rows: [community] } = await db.raw(`INSERT INTO communities (code, name) VALUES ('t63-analysis', 'T63 Analysis') RETURNING id`);
  cid = community.id;
  const mk = async (name) => {
    const { rows: [m] } = await db.raw(`INSERT INTO members (community_id, full_name, status) VALUES (?, ?, 'member') RETURNING id`, [cid, name]);
    return { id: m.id, token: jwt.sign({ sub: m.id, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' }) };
  };
  ({ id: alice, token: aliceToken } = await mk('Alice T63'));
  ({ id: bob, token: bobToken } = await mk('Bob T63'));
  ({ id: carol, token: carolToken } = await mk('Carol T63'));
});
afterAll(async () => { await db.destroy(); });

async function finishedGameId() {
  engineClient.bestMove.mockResolvedValue({ bestmove: 'h2e2', score_cp: 10, mate: null, depth: 6, pv: ['h2e2'] });
  const challenge = await supertest(app).post('/api/v1/games/challenges').set(auth(aliceToken))
    .send({ opponent_member_id: bob }).expect(201);
  await supertest(app).post(`/api/v1/games/challenges/${challenge.body.id}/accept`).set(auth(bobToken)).expect(200);
  await supertest(app).post(`/api/v1/games/${challenge.body.id}/moves`).set(auth(aliceToken))
    .send({ from: { r: 7, c: 7 }, to: { r: 7, c: 4 } }).expect(200);
  await supertest(app).post(`/api/v1/games/${challenge.body.id}/resign`).set(auth(bobToken)).expect(200);
  await wait(200);
  return challenge.body.id;
}

describe('T63 GET /games/:id/analysis', () => {
  it('một trong hai người chơi xem được, có moves + tóm tắt', async () => {
    const id = await finishedGameId();
    const res = await supertest(app).get(`/api/v1/games/${id}/analysis`).set(auth(aliceToken)).expect(200);
    expect(res.body.analyzed_at).not.toBeNull();
    expect(res.body.moves).toHaveLength(1);
    expect(res.body.moves[0]).toMatchObject({ seq: 1, side: 'r', eval_before_cp: 10, win_loss: 0 });
    expect(res.body.red_avg_loss).toBe(0);
  });
  it('người thứ ba (không chơi ván này) bị chặn 403', async () => {
    const id = await finishedGameId();
    await supertest(app).get(`/api/v1/games/${id}/analysis`).set(auth(carolToken)).expect(403);
  });
  it('không kèm token bị chặn 401', async () => {
    const id = await finishedGameId();
    await supertest(app).get(`/api/v1/games/${id}/analysis`).expect(401);
  });
  it('ván chưa kết thúc bị chặn 409', async () => {
    const challenge = await supertest(app).post('/api/v1/games/challenges').set(auth(aliceToken))
      .send({ opponent_member_id: bob }).expect(201);
    await supertest(app).post(`/api/v1/games/challenges/${challenge.body.id}/accept`).set(auth(bobToken)).expect(200);
    await supertest(app).get(`/api/v1/games/${challenge.body.id}/analysis`).set(auth(aliceToken)).expect(409);
    // Dọn dẹp để không vỡ idx_games_active_pair cho test sau trong cùng file.
    await supertest(app).post(`/api/v1/games/${challenge.body.id}/resign`).set(auth(bobToken)).expect(200);
  });
});
