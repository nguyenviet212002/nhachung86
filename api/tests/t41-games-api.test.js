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

describe('T41 games API — chơi thật', () => {
  let gameId;

  it('chuẩn bị một ván active giữa Bob (đỏ) và Carol (đen)', async () => {
    const created = await supertest(app).post('/api/v1/games/challenges').set(auth(bobToken))
      .send({ opponent_member_id: carol }).expect(201);
    gameId = created.body.id;
    await supertest(app).post(`/api/v1/games/challenges/${gameId}/accept`).set(auth(carolToken)).expect(200);
  });

  it('danh sách ván đang mở (GET /games?status=active) thấy được ván này kể cả người ngoài cuộc', async () => {
    const list = await supertest(app).get('/api/v1/games?status=active').set(auth(aliceToken)).expect(200);
    expect(list.body.data.some((g) => g.id === gameId)).toBe(true);
  });

  it('người ngoài cuộc xem được chi tiết ván nhưng không đi được quân', async () => {
    const detail = await supertest(app).get(`/api/v1/games/${gameId}`).set(auth(aliceToken)).expect(200);
    expect(detail.body.turn).toBe('r');
    await supertest(app).post(`/api/v1/games/${gameId}/moves`).set(auth(aliceToken))
      .send({ from: { r: 6, c: 0 }, to: { r: 5, c: 0 } }).expect(403);
  });

  it('sai lượt thì bị từ chối; đúng lượt, đúng luật thì đi được và đổi lượt', async () => {
    await supertest(app).post(`/api/v1/games/${gameId}/moves`).set(auth(carolToken))
      .send({ from: { r: 3, c: 0 }, to: { r: 4, c: 0 } }).expect(403);
    const moved = await supertest(app).post(`/api/v1/games/${gameId}/moves`).set(auth(bobToken))
      .send({ from: { r: 6, c: 0 }, to: { r: 5, c: 0 } }).expect(200);
    expect(moved.body.turn).toBe('b');
    expect(moved.body.board[5][0]).toEqual({ side: 'r', type: 'soldier' });
  });

  it('nước đi phi luật bị từ chối (422), không đổi lượt', async () => {
    await supertest(app).post(`/api/v1/games/${gameId}/moves`).set(auth(carolToken))
      .send({ from: { r: 0, c: 0 }, to: { r: 5, c: 5 } }).expect(422);
    const detail = await supertest(app).get(`/api/v1/games/${gameId}`).set(auth(carolToken)).expect(200);
    expect(detail.body.turn).toBe('b');
  });

  it('xin thua kết thúc ván, người xin thua không phải người thắng', async () => {
    const resigned = await supertest(app).post(`/api/v1/games/${gameId}/resign`).set(auth(carolToken)).expect(200);
    expect(resigned.body.status).toBe('finished');
    const detail = await supertest(app).get(`/api/v1/games/${gameId}`).set(auth(bobToken)).expect(200);
    expect(detail.body.status).toBe('finished');
    expect(detail.body.winner_member_id).toBe(bob);
    expect(detail.body.end_reason).toBe('resign');
    expect(detail.body.moves.length).toBe(1);
  });

  it('ván đã xong thì không đi/xin thua thêm được nữa', async () => {
    await supertest(app).post(`/api/v1/games/${gameId}/moves`).set(auth(bobToken))
      .send({ from: { r: 9, c: 0 }, to: { r: 8, c: 0 } }).expect(409);
    await supertest(app).post(`/api/v1/games/${gameId}/resign`).set(auth(bobToken)).expect(409);
  });

  it('GET /:id/stream từ chối ván không tồn tại và ván ở cộng đồng khác bằng 404, không mở kết nối treo', async () => {
    await supertest(app).get('/api/v1/games/00000000-0000-0000-0000-000000000000/stream')
      .set(auth(bobToken)).expect(404);

    const { rows: [otherCommunity] } = await db.raw(
      `INSERT INTO communities (code, name) VALUES ('t41-games-other', 'T41 Games Other') RETURNING id`
    );
    const { rows: [otherMember] } = await db.raw(
      `INSERT INTO members (community_id, full_name, status) VALUES (?, ?, 'member') RETURNING id`,
      [otherCommunity.id, 'Outsider T41']
    );
    const outsiderToken = jwt.sign(
      { sub: otherMember.id, cid: otherCommunity.id, typ: 'access' },
      config.JWT_SECRET, { expiresIn: '15m' }
    );
    // gameId (Bob vs Carol) belongs to `cid`, not `otherCommunity.id` — a
    // member of a different community must not be able to open the SSE
    // stream and receive its live moves.
    await supertest(app).get(`/api/v1/games/${gameId}/stream`).set(auth(outsiderToken)).expect(404);
  });
});
