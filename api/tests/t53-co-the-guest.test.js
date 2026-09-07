import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { resetDb } from './helpers/db.js';
import { buildApp } from '../src/app.js';
import { config } from '../src/config/index.js';

let db, app, cid, alice, aliceToken;
const auth = (t) => ({ authorization: `Bearer ${t}` });

function validBoard() {
  const b = Array.from({ length: 10 }, () => Array(9).fill(null));
  b[9][4] = { side: 'r', type: 'general' };
  b[0][3] = { side: 'b', type: 'general' };
  return b;
}

beforeAll(async () => {
  db = await resetDb();
  app = buildApp();
  const { rows: [c] } = await db.raw(`INSERT INTO communities (code, name) VALUES ('t53-co-the', 'T53') RETURNING id`);
  cid = c.id;
  const { rows: [a] } = await db.raw(`INSERT INTO members (community_id, full_name, status) VALUES (?, 'Alice T53', 'member') RETURNING id`, [cid]);
  alice = a.id;
  aliceToken = jwt.sign({ sub: alice, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' });
});
afterAll(async () => { await db.destroy(); });

async function createSession() {
  const created = await supertest(app).post('/api/v1/co-the/positions').set(auth(aliceToken))
    .send({ board: validBoard(), side_to_move: 'r' }).expect(201);
  const session = await supertest(app).post('/api/v1/co-the/sessions').set(auth(aliceToken))
    .send({ position_id: created.body.id, mode: 'giai', opponent_level: 'manh' }).expect(201);
  return session.body;
}

describe('T53 Cờ Thế — màn khách/người xem', () => {
  it('tạo link mời, khách vào bằng token nhận được guest_token, xem được bàn cờ rút gọn', async () => {
    const session = await createSession();
    const invite = await supertest(app).post(`/api/v1/co-the/sessions/${session.id}/moi-xem`).set(auth(aliceToken)).expect(200);
    const joined = await supertest(app).post(`/api/v1/co-the/xem/${invite.body.invite_token}/vao`).expect(201);
    expect(joined.body.session_id).toBe(session.id);
    const view = await supertest(app).get(`/api/v1/co-the/xem/${invite.body.invite_token}`)
      .query({ guest_token: joined.body.guest_token }).expect(200);
    expect(view.body.board).toBeTruthy();
    expect(view.body).not.toHaveProperty('opponent_level');
  });

  it('sai guest_token thì 401', async () => {
    const session = await createSession();
    const invite = await supertest(app).post(`/api/v1/co-the/sessions/${session.id}/moi-xem`).set(auth(aliceToken)).expect(200);
    await supertest(app).get(`/api/v1/co-the/xem/${invite.body.invite_token}`)
      .query({ guest_token: '00000000-0000-0000-0000-000000000000' }).expect(401);
  });

  it('gọi lại /moi-xem lần 2 trả về CÙNG invite_token, không tạo mới', async () => {
    const session = await createSession();
    const first = await supertest(app).post(`/api/v1/co-the/sessions/${session.id}/moi-xem`).set(auth(aliceToken)).expect(200);
    const second = await supertest(app).post(`/api/v1/co-the/sessions/${session.id}/moi-xem`).set(auth(aliceToken)).expect(200);
    expect(second.body.invite_token).toBe(first.body.invite_token);
  });
});
