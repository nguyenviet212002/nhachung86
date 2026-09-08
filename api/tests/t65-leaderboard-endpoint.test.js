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

// Chơi 1 ván xong hẳn qua API thật: hostToken thách winnerIsHost ? host : guest
// thắng bằng cách bên thua xin thua ngay sau đúng 1 nước của bên thắng — cùng
// khuôn t64 dùng để có 1 ván 'finished' + đã mổ (analyzed_at khác NULL).
async function playFinishedGame(app, hostToken, guestId, guestToken, hostWins) {
  engineClient.bestMove.mockResolvedValue({ bestmove: 'h2e2', score_cp: 10, mate: null, depth: 6, pv: ['h2e2'] });
  const challenge = await supertest(app).post('/api/v1/games/challenges').set(auth(hostToken))
    .send({ opponent_member_id: guestId }).expect(201);
  await supertest(app).post(`/api/v1/games/challenges/${challenge.body.id}/accept`).set(auth(guestToken)).expect(200);
  const [moverToken, resignerToken] = hostWins ? [hostToken, guestToken] : [guestToken, hostToken];
  await supertest(app).post(`/api/v1/games/${challenge.body.id}/moves`).set(auth(moverToken))
    .send({ from: { r: 7, c: 7 }, to: { r: 7, c: 4 } }).expect(200);
  await supertest(app).post(`/api/v1/games/${challenge.body.id}/resign`).set(auth(resignerToken)).expect(200);
  await wait(200);
}

beforeAll(async () => {
  db = await resetDb();
  app = buildApp();
  const { rows: [community] } = await db.raw(`INSERT INTO communities (code, name) VALUES ('t65-leaderboard', 'T65 Leaderboard') RETURNING id`);
  cid = community.id;
  const mk = async (name) => {
    const { rows: [m] } = await db.raw(`INSERT INTO members (community_id, full_name, status) VALUES (?, ?, 'member') RETURNING id`, [cid, name]);
    return { id: m.id, token: jwt.sign({ sub: m.id, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' }) };
  };
  ({ id: alice, token: aliceToken } = await mk('Alice T65'));
  ({ id: bob, token: bobToken } = await mk('Bob T65'));
  ({ id: carol, token: carolToken } = await mk('Carol T65'));

  // Alice thắng Bob 5 ván liền — cả hai đạt đúng ngưỡng 5 ván đã mổ.
  for (let i = 0; i < 5; i++) {
    await playFinishedGame(app, aliceToken, bob, bobToken, true);
  }
  // Alice thắng Carol 2 ván — Carol chỉ có 2 ván, dưới ngưỡng 5.
  for (let i = 0; i < 2; i++) {
    await playFinishedGame(app, aliceToken, carol, carolToken, true);
  }
}, 30000);
afterAll(async () => { await db.destroy(); });

describe('T65 GET /games/leaderboard', () => {
  it('đủ 5 ván đã mổ mới lên bảng, sắp theo tỉ lệ thắng giảm dần', async () => {
    const res = await supertest(app).get('/api/v1/games/leaderboard').set(auth(carolToken)).expect(200);
    const ids = res.body.data.map((r) => r.member_id);
    expect(ids).toContain(alice);
    expect(ids).toContain(bob);
    expect(ids).not.toContain(carol); // chỉ 2 ván, dưới ngưỡng 5

    // Alice tổng cộng 7 ván đã mổ (5 với Bob + 2 với Carol) — getLeaderboard
    // gộp TOÀN BỘ ván của member trên nền tảng, không riêng từng cặp đối thủ
    // (cùng thiết kế getMemberProfile) — nên games_count/wins của Alice là 7,
    // không phải 5, dù chỉ tính riêng loạt đấu với Bob là 5 ván.
    const aliceRow = res.body.data.find((r) => r.member_id === alice);
    expect(aliceRow.games_count).toBe(7);
    expect(aliceRow.wins).toBe(7);
    expect(aliceRow.win_rate).toBe(100);
    expect(aliceRow.avg_loss).not.toBeNull();

    const bobRow = res.body.data.find((r) => r.member_id === bob);
    expect(bobRow.games_count).toBe(5);
    expect(bobRow.wins).toBe(0);
    expect(bobRow.win_rate).toBe(0);

    // Alice (100%) đứng trên Bob (0%).
    expect(ids.indexOf(alice)).toBeLessThan(ids.indexOf(bob));
  });
  it('không kèm token bị chặn 401', async () => {
    await supertest(app).get('/api/v1/games/leaderboard').expect(401);
  });
});
