import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { subscribeGame, publishToGame, isWatchingGame } from '../src/core/realtime.js';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { resetDb } from './helpers/db.js';
import { buildApp } from '../src/app.js';
import { config } from '../src/config/index.js';

let db, app, cid, alice, bob, carol, aliceToken, bobToken, carolToken;
const auth = (token) => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  db = await resetDb();
  app = buildApp();
  const { rows: [community] } = await db.raw(
    `INSERT INTO communities (code, name) VALUES ('t41-games', 'T41 Games') RETURNING id`
  );
  cid = community.id;
  async function member(name) {
    const { rows: [row] } = await db.raw(
      `INSERT INTO members (community_id, full_name, status) VALUES (?, ?, 'member') RETURNING id`,
      [cid, name]
    );
    return row.id;
  }
  alice = await member('Alice T41');
  bob = await member('Bob T41');
  carol = await member('Carol T41'); // người xem, không chơi
  const token = (id) => jwt.sign({ sub: id, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' });
  aliceToken = token(alice); bobToken = token(bob); carolToken = token(carol);
});

afterAll(async () => { await db.destroy(); });

describe('T41 realtime — phòng theo ván cờ', () => {
  it('publishToGame gửi đúng payload tới mọi kết nối trong phòng, không gửi phòng khác', () => {
    const chunksA = [], chunksB = [];
    const resA = { write: (c) => chunksA.push(c) };
    const resB = { write: (c) => chunksB.push(c) };
    const unsubA = subscribeGame('game-1', 'member-a', resA);
    const unsubB = subscribeGame('game-2', 'member-b', resB);

    publishToGame('game-1', 'move', { turn: 'b' });

    expect(chunksA.join('')).toContain('event: move');
    expect(chunksA.join('')).toContain('"turn":"b"');
    expect(chunksB.join('')).toBe(''); // phòng khác không nhận

    unsubA(); unsubB();
  });

  it('isWatchingGame biết đúng ai đang mở kết nối tới phòng nào', () => {
    const res = { write: () => {} };
    expect(isWatchingGame('game-3', 'member-c')).toBe(false);
    const unsub = subscribeGame('game-3', 'member-c', res);
    expect(isWatchingGame('game-3', 'member-c')).toBe(true);
    expect(isWatchingGame('game-3', 'member-x')).toBe(false);
    unsub();
    expect(isWatchingGame('game-3', 'member-c')).toBe(false);
  });
});

describe('T41 games API — thách đấu / nhận / từ chối', () => {
  it('thách đấu tạo ván pending và gửi notification cho người được mời', async () => {
    const created = await supertest(app).post('/api/v1/games/challenges').set(auth(aliceToken))
      .send({ opponent_member_id: bob }).expect(201);
    expect(created.body.id).toBeTruthy();

    const notices = await supertest(app).get('/api/v1/notifications?unread_only=true').set(auth(bobToken)).expect(200);
    expect(notices.body.data.some((n) => n.kind === 'game_challenge' && n.target_id === created.body.id)).toBe(true);
  });

  it('không thách đấu được chính mình, không thách đấu được người ngoài cộng đồng', async () => {
    await supertest(app).post('/api/v1/games/challenges').set(auth(aliceToken))
      .send({ opponent_member_id: alice }).expect(422);
    await supertest(app).post('/api/v1/games/challenges').set(auth(aliceToken))
      .send({ opponent_member_id: '00000000-0000-0000-0000-000000000000' }).expect(404);
  });

  it('không tạo được lời thách đấu thứ hai khi đã có ván pending/active giữa hai người', async () => {
    await supertest(app).post('/api/v1/games/challenges').set(auth(aliceToken))
      .send({ opponent_member_id: bob }).expect(409);
  });

  it('chỉ người được mời mới accept được; accept đúng người thì ván chuyển active với bàn cờ khởi tạo', async () => {
    const list = await supertest(app).get('/api/v1/games?mine=true&status=pending,active').set(auth(aliceToken)).expect(200);
    const gameId = list.body.data[0].id;

    await supertest(app).post(`/api/v1/games/challenges/${gameId}/accept`).set(auth(aliceToken)).expect(403);
    await supertest(app).post(`/api/v1/games/challenges/${gameId}/accept`).set(auth(bobToken)).expect(200);
    await supertest(app).post(`/api/v1/games/challenges/${gameId}/accept`).set(auth(bobToken)).expect(409); // đã accept rồi

    const detail = await supertest(app).get(`/api/v1/games/${gameId}`).set(auth(carolToken)).expect(200);
    expect(detail.body.status).toBe('active');
    expect(detail.body.turn).toBe('r');
    expect(detail.body.board[9][4]).toEqual({ side: 'r', type: 'general' });
  });

  it('decline chuyển ván sang finished/declined, không accept lại được nữa', async () => {
    const challenge = await supertest(app).post('/api/v1/games/challenges').set(auth(carolToken))
      .send({ opponent_member_id: alice }).expect(201);
    await supertest(app).post(`/api/v1/games/challenges/${challenge.body.id}/decline`).set(auth(aliceToken)).expect(200);
    await supertest(app).post(`/api/v1/games/challenges/${challenge.body.id}/accept`).set(auth(aliceToken)).expect(409);
  });

  it('chỉ mục duy nhất từng phần chặn được 2 ván pending/active cho cùng 1 cặp dù bỏ qua bước kiểm ở service.js', async () => {
    // Dave/Erin: cặp mới, chưa dùng ở đâu khác trong file này, để không đụng
    // trạng thái các test khác đã để lại.
    const dave = await (async () => {
      const { rows: [row] } = await db.raw(
        `INSERT INTO members (community_id, full_name, status) VALUES (?, ?, 'member') RETURNING id`,
        [cid, 'Dave T41']
      );
      return row.id;
    })();
    const erin = await (async () => {
      const { rows: [row] } = await db.raw(
        `INSERT INTO members (community_id, full_name, status) VALUES (?, ?, 'member') RETURNING id`,
        [cid, 'Erin T41']
      );
      return row.id;
    })();
    await db.raw(
      `INSERT INTO games (community_id, red_member_id, black_member_id, status, turn) VALUES (?, ?, ?, 'pending', 'r')`,
      [cid, dave, erin]
    );
    await expect(db.raw(
      `INSERT INTO games (community_id, red_member_id, black_member_id, status, turn) VALUES (?, ?, ?, 'pending', 'r')`,
      [cid, erin, dave] // reversed red/black — same PAIR, must still collide
    )).rejects.toMatchObject({ code: '23505' });
  });
});
