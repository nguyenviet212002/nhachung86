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
  const { rows: [community] } = await db.raw(`INSERT INTO communities (code, name) VALUES ('t64-profile', 'T64 Profile') RETURNING id`);
  cid = community.id;
  const mk = async (name) => {
    const { rows: [m] } = await db.raw(`INSERT INTO members (community_id, full_name, status) VALUES (?, ?, 'member') RETURNING id`, [cid, name]);
    return { id: m.id, token: jwt.sign({ sub: m.id, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' }) };
  };
  ({ id: alice, token: aliceToken } = await mk('Alice T64'));
  ({ id: bob, token: bobToken } = await mk('Bob T64'));
});
afterAll(async () => { await db.destroy(); });

describe('T64 GET /games/members/:memberId/profile', () => {
  it('chưa ván nào đã mổ: hồ sơ rỗng nhưng không lỗi', async () => {
    const res = await supertest(app).get(`/api/v1/games/members/${bob}/profile`).set(auth(aliceToken)).expect(200);
    expect(res.body).toEqual({ games_count: 0, wins: 0, avg_loss: null });
  });
  it('sau 1 ván đã mổ (Alice thắng do Bob xin thua): hồ sơ Alice cộng 1 thắng + avg_loss có số thật', async () => {
    // Alice là người ĐÃ ĐI nước duy nhất trong ván (Bob xin thua trước khi đi
    // nước nào) — nên chỉ Alice có avg_loss thật (khác NULL); nếu test này lại
    // tra hồ sơ Bob thì avg_loss của Bob vẫn NULL (Bob chưa đi nước nào để có
    // gì mà tính trung bình), làm assertion "not.toBeNull()" sai một cách âm
    // thầm — cố ý tra hồ sơ ALICE, không phải Bob, để tránh đúng bẫy đó.
    engineClient.bestMove.mockResolvedValue({ bestmove: 'h2e2', score_cp: 10, mate: null, depth: 6, pv: ['h2e2'] });
    const challenge = await supertest(app).post('/api/v1/games/challenges').set(auth(aliceToken))
      .send({ opponent_member_id: bob }).expect(201);
    await supertest(app).post(`/api/v1/games/challenges/${challenge.body.id}/accept`).set(auth(bobToken)).expect(200);
    await supertest(app).post(`/api/v1/games/${challenge.body.id}/moves`).set(auth(aliceToken))
      .send({ from: { r: 7, c: 7 }, to: { r: 7, c: 4 } }).expect(200);
    await supertest(app).post(`/api/v1/games/${challenge.body.id}/resign`).set(auth(bobToken)).expect(200);
    await wait(200);

    const res = await supertest(app).get(`/api/v1/games/members/${alice}/profile`).set(auth(aliceToken)).expect(200);
    expect(res.body.games_count).toBe(1);
    expect(res.body.wins).toBe(1);
    expect(res.body.avg_loss).toBe(0);
  });
  it('không kèm token bị chặn 401', async () => {
    await supertest(app).get(`/api/v1/games/members/${bob}/profile`).expect(401);
  });
});
