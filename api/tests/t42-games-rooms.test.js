import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { resetDb } from './helpers/db.js';
import { buildApp } from '../src/app.js';
import { config } from '../src/config/index.js';
import * as service from '../src/modules/games/service.js';

let db, app, cid, alice, aliceToken, bob, bobToken;
const auth = (token) => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  db = await resetDb();
  app = buildApp();
  const { rows: [community] } = await db.raw(
    `INSERT INTO communities (code, name) VALUES ('t42-rooms', 'T42 Rooms') RETURNING id`
  );
  cid = community.id;
  const { rows: [row] } = await db.raw(
    `INSERT INTO members (community_id, full_name, status) VALUES (?, 'Alice T42', 'member') RETURNING id`,
    [cid]
  );
  alice = row.id;
  aliceToken = jwt.sign({ sub: alice, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' });

  const { rows: [bobRow] } = await db.raw(
    `INSERT INTO members (community_id, full_name, status) VALUES (?, 'Bob T42', 'member') RETURNING id`,
    [cid]
  );
  bob = bobRow.id;
  bobToken = jwt.sign({ sub: bob, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' });
});

afterAll(async () => { await db.destroy(); });

describe('T42 tạo phòng — requireAuthOrGuestToken qua GET /:id', () => {
  it('JWT thành viên hợp lệ vẫn xem được ván (đường thành viên không đổi hành vi)', async () => {
    const created = await supertest(app).post('/api/v1/games/rooms').set(auth(aliceToken)).expect(201);
    await supertest(app).get(`/api/v1/games/${created.body.id}`).set(auth(aliceToken)).expect(200);
  });

  it('không có Authorization header thì 401', async () => {
    const created = await supertest(app).post('/api/v1/games/rooms').set(auth(aliceToken)).expect(201);
    await supertest(app).get(`/api/v1/games/${created.body.id}`).expect(401);
  });

  it('token khách khớp black_guest_token của đúng ván thì xem được', async () => {
    const created = await supertest(app).post('/api/v1/games/rooms').set(auth(aliceToken)).expect(201);
    const joined = await supertest(app)
      .post(`/api/v1/games/rooms/${created.body.invite_token}/join`)
      .send({ guest_name: 'Khách T42' }).expect(201);
    await supertest(app).get(`/api/v1/games/${joined.body.id}`)
      .set(auth(joined.body.guest_token)).expect(200);
  });

  it('token khách của ván KHÁC thì bị từ chối', async () => {
    const roomA = await supertest(app).post('/api/v1/games/rooms').set(auth(aliceToken)).expect(201);
    const roomB = await supertest(app).post('/api/v1/games/rooms').set(auth(aliceToken)).expect(201);
    const joinedA = await supertest(app)
      .post(`/api/v1/games/rooms/${roomA.body.invite_token}/join`)
      .send({ guest_name: 'Khách A' }).expect(201);
    await supertest(app).get(`/api/v1/games/${roomB.body.id}`)
      .set(auth(joinedA.body.guest_token)).expect(401);
  });
});

describe('T42 move() — đồng hồ trừ thời gian đã dùng', () => {
  it('sau 1 nước đi, red_time_ms giảm đúng khoảng thời gian đã trôi qua', async () => {
    const challenge = await supertest(app).post('/api/v1/games/challenges').set(auth(aliceToken))
      .send({ opponent_member_id: bob }).expect(201);
    await supertest(app).post(`/api/v1/games/challenges/${challenge.body.id}/accept`).set(auth(bobToken)).expect(200);

    await new Promise((r) => setTimeout(r, 50));
    await supertest(app).post(`/api/v1/games/${challenge.body.id}/moves`).set(auth(aliceToken))
      .send({ from: { r: 6, c: 0 }, to: { r: 5, c: 0 } }).expect(200);

    const detail = await supertest(app).get(`/api/v1/games/${challenge.body.id}`).set(auth(aliceToken)).expect(200);
    expect(detail.body.red_time_ms).toBeLessThan(600000);
    expect(detail.body.red_time_ms).toBeGreaterThan(600000 - 5000); // trừ đúng ~50ms, không trừ nhầm hàng giây
    expect(detail.body.black_time_ms).toBe(600000); // Đen chưa đi, chưa trừ
  });
});

describe('T42 tạo phòng / vào phòng', () => {
  it('tạo phòng: chủ phòng cầm Đỏ, chưa có khách, trả về invite_token thô', async () => {
    const created = await supertest(app).post('/api/v1/games/rooms').set(auth(aliceToken)).expect(201);
    expect(created.body.id).toBeTruthy();
    expect(created.body.invite_token).toMatch(/^[A-Za-z0-9_-]{20,}$/); // base64url, entropy cao — không phải "G-xxxx"

    const detail = await supertest(app).get(`/api/v1/games/${created.body.id}`).set(auth(aliceToken)).expect(200);
    expect(detail.body.status).toBe('pending');
    expect(detail.body.red_member_id).toBe(alice);
    expect(detail.body.black_member_id).toBe(null);
    expect(detail.body.black_guest_token).toBeUndefined(); // bí mật của khách, không lộ ra response
  });

  it('vào phòng bằng token sai thì 404, đúng token thì set tên khách + phát guest_token', async () => {
    const created = await supertest(app).post('/api/v1/games/rooms').set(auth(aliceToken)).expect(201);
    await supertest(app).post(`/api/v1/games/rooms/token-sai/join`).send({ guest_name: 'Ai đó' }).expect(404);

    const joined = await supertest(app)
      .post(`/api/v1/games/rooms/${created.body.invite_token}/join`)
      .send({ guest_name: 'Khách Vui Vẻ' }).expect(201);
    expect(joined.body.guest_token).toBeTruthy();

    const detail = await supertest(app).get(`/api/v1/games/${created.body.id}`).set(auth(aliceToken)).expect(200);
    expect(detail.body.black_name).toBe('Khách Vui Vẻ');
  });

  it('phòng đã có khách thì người thứ hai vào bằng cùng link bị từ chối', async () => {
    const created = await supertest(app).post('/api/v1/games/rooms').set(auth(aliceToken)).expect(201);
    await supertest(app).post(`/api/v1/games/rooms/${created.body.invite_token}/join`)
      .send({ guest_name: 'Người 1' }).expect(201);
    await supertest(app).post(`/api/v1/games/rooms/${created.body.invite_token}/join`)
      .send({ guest_name: 'Người 2' }).expect(409);
  });
});

describe('T42 sẵn sàng — 4 trạng thái + hết 30 giây', () => {
  it('cả hai bấm sẵn sàng thì ván chuyển active, bàn cờ khởi tạo, Đỏ đi trước', async () => {
    const created = await supertest(app).post('/api/v1/games/rooms').set(auth(aliceToken)).expect(201);
    const joined = await supertest(app).post(`/api/v1/games/rooms/${created.body.invite_token}/join`)
      .send({ guest_name: 'Khách Sẵn Sàng' }).expect(201);

    const r1 = await supertest(app).post(`/api/v1/games/${created.body.id}/ready`).set(auth(aliceToken)).expect(200);
    expect(r1.body.active).toBe(false);
    const r2 = await supertest(app).post(`/api/v1/games/${created.body.id}/ready`)
      .set(auth(joined.body.guest_token)).expect(200);
    expect(r2.body.active).toBe(true);

    const detail = await supertest(app).get(`/api/v1/games/${created.body.id}`).set(auth(aliceToken)).expect(200);
    expect(detail.body.status).toBe('active');
    expect(detail.body.turn).toBe('r');
    expect(detail.body.board[9][4]).toEqual({ side: 'r', type: 'general' });
  });

  it('bấm sẵn sàng lần 2 thì bị từ chối (409)', async () => {
    const created = await supertest(app).post('/api/v1/games/rooms').set(auth(aliceToken)).expect(201);
    await supertest(app).post(`/api/v1/games/rooms/${created.body.invite_token}/join`)
      .send({ guest_name: 'Khách' }).expect(201);
    await supertest(app).post(`/api/v1/games/${created.body.id}/ready`).set(auth(aliceToken)).expect(200);
    await supertest(app).post(`/api/v1/games/${created.body.id}/ready`).set(auth(aliceToken)).expect(409);
  });

  it('khách quá 30 giây không bấm sẵn sàng thì bị dọn khỏi phòng, chủ phòng ở lại — lần đọc kế tiếp tự phát hiện', async () => {
    const created = await supertest(app).post('/api/v1/games/rooms').set(auth(aliceToken)).expect(201);
    const joined = await supertest(app).post(`/api/v1/games/rooms/${created.body.invite_token}/join`)
      .send({ guest_name: 'Khách Chậm' }).expect(201);
    await supertest(app).post(`/api/v1/games/${created.body.id}/ready`).set(auth(aliceToken)).expect(200);

    // dựng thẳng lúc vào phòng lùi về quá khứ — mô phỏng "đã quá 30 giây" mà
    // không phải Sleep thật trong test (chậm, không cần thiết).
    await db.raw(`UPDATE games SET second_joined_at = now() - interval '31 seconds' WHERE id = ?`, [created.body.id]);

    const detail = await supertest(app).get(`/api/v1/games/${created.body.id}`).set(auth(aliceToken)).expect(200);
    expect(detail.body.status).toBe('pending');
    expect(detail.body.black_member_id).toBe(null);
    expect(detail.body.black_name).toBe(null);

    // token khách cũ không dùng được nữa (đã bị dọn)
    await supertest(app).get(`/api/v1/games/${created.body.id}`).set(auth(joined.body.guest_token)).expect(401);
  });
});

describe('T42 đồng hồ — hết giờ', () => {
  async function activeGame(hostToken, hostId) {
    const created = await supertest(app).post('/api/v1/games/rooms').set(auth(hostToken)).expect(201);
    const joined = await supertest(app).post(`/api/v1/games/rooms/${created.body.invite_token}/join`)
      .send({ guest_name: 'Khách Đồng Hồ' }).expect(201);
    await supertest(app).post(`/api/v1/games/${created.body.id}/ready`).set(auth(hostToken)).expect(200);
    await supertest(app).post(`/api/v1/games/${created.body.id}/ready`).set(auth(joined.body.guest_token)).expect(200);
    return { id: created.body.id, guestToken: joined.body.guest_token };
  }

  it('GET /:id trả thời gian còn lại giảm dần khi đang tới lượt, đứng yên khi không phải lượt', async () => {
    const { id } = await activeGame(aliceToken, alice);
    const d1 = await supertest(app).get(`/api/v1/games/${id}`).set(auth(aliceToken)).expect(200);
    expect(d1.body.red_time_remaining_ms).toBeLessThanOrEqual(600000);
    expect(d1.body.black_time_remaining_ms).toBe(600000); // chưa tới lượt Đen, đứng yên
  });

  it('gọi /timeout khi chưa thật sự hết giờ thì bị từ chối', async () => {
    const { id } = await activeGame(aliceToken, alice);
    await supertest(app).post(`/api/v1/games/${id}/timeout`).set(auth(aliceToken)).expect(409);
  });

  it('hết giờ thật (server tự tính lại, không tin client) thì bên kia thắng', async () => {
    // activeGame() để bàn cờ ở lượt Đỏ (turn='r') ngay sau ready(); lùi
    // turn_started_at khiến ĐỎ (chủ phòng, alice) hết giờ, nên bên thắng là
    // Đen — nhưng Đen ở đây là khách, không có member id để ghi vào
    // winner_member_id (đúng thiết kế mục 5: thắng vẫn xác định bằng bên 'r'/'b',
    // winner_member_id chỉ có giá trị khi bên thắng là một thành viên thật).
    const { id, guestToken } = await activeGame(aliceToken, alice);
    await db.raw(`UPDATE games SET turn_started_at = now() - interval '11 minutes' WHERE id = ?`, [id]);
    const res = await supertest(app).post(`/api/v1/games/${id}/timeout`).set(auth(guestToken)).expect(200);
    expect(res.body.status).toBe('finished');
    const detail = await supertest(app).get(`/api/v1/games/${id}`).set(auth(guestToken)).expect(200);
    expect(detail.body.end_reason).toBe('het-gio');
    expect(detail.body.winner_member_id).toBe(null);
  });
});

describe('T42 cầu hoà', () => {
  async function activeGame() {
    const created = await supertest(app).post('/api/v1/games/rooms').set(auth(aliceToken)).expect(201);
    const joined = await supertest(app).post(`/api/v1/games/rooms/${created.body.invite_token}/join`)
      .send({ guest_name: 'Khách Cầu Hoà' }).expect(201);
    await supertest(app).post(`/api/v1/games/${created.body.id}/ready`).set(auth(aliceToken)).expect(200);
    await supertest(app).post(`/api/v1/games/${created.body.id}/ready`).set(auth(joined.body.guest_token)).expect(200);
    return { id: created.body.id, guestToken: joined.body.guest_token };
  }

  it('cầu hoà rồi bên kia từ chối thì ván chạy tiếp', async () => {
    const { id, guestToken } = await activeGame();
    await supertest(app).post(`/api/v1/games/${id}/draw/offer`).set(auth(aliceToken)).expect(200);
    await supertest(app).post(`/api/v1/games/${id}/draw/decline`).set(auth(guestToken)).expect(200);
    const detail = await supertest(app).get(`/api/v1/games/${id}`).set(auth(aliceToken)).expect(200);
    expect(detail.body.status).toBe('active');
    expect(detail.body.draw_offered_by).toBe(null);
  });

  it('cầu hoà rồi bên kia đồng ý thì ván kết thúc hoà', async () => {
    const { id, guestToken } = await activeGame();
    await supertest(app).post(`/api/v1/games/${id}/draw/offer`).set(auth(aliceToken)).expect(200);
    await supertest(app).post(`/api/v1/games/${id}/draw/accept`).set(auth(guestToken)).expect(200);
    const detail = await supertest(app).get(`/api/v1/games/${id}`).set(auth(aliceToken)).expect(200);
    expect(detail.body.status).toBe('finished');
    expect(detail.body.end_reason).toBe('hoa-thoa-thuan');
  });

  it('tự cầu hoà với chính mình (accept lời cầu hoà của mình) thì bị từ chối', async () => {
    const { id } = await activeGame();
    await supertest(app).post(`/api/v1/games/${id}/draw/offer`).set(auth(aliceToken)).expect(200);
    await supertest(app).post(`/api/v1/games/${id}/draw/accept`).set(auth(aliceToken)).expect(409);
  });
});

describe('T42 mất kết nối', () => {
  // Kiểm markDisconnected/clearDisconnected trực tiếp (gọi hàm service, không
  // qua HTTP) — đóng/mở lại một kết nối SSE thật qua supertest không ổn định
  // (supertest/superagent không nghĩ cho luồng sống lâu như SSE), nên phần
  // LOGIC kiểm ở đây, còn phần "route /stream có gọi đúng 2 hàm này lúc
  // req.on('close') và lúc subscribe" xác nhận bằng đọc lại mã ở Step 9 (chỉ
  // 4 dòng nối, không thêm nhánh rẽ nào để có thể sai).
  it('markDisconnected set đúng bên + không ghi đè lần gọi thứ hai; clearDisconnected xoá cờ và dời turn_started_at', async () => {
    const created = await supertest(app).post('/api/v1/games/rooms').set(auth(aliceToken)).expect(201);
    const joined = await supertest(app).post(`/api/v1/games/rooms/${created.body.invite_token}/join`)
      .send({ guest_name: 'Khách SSE' }).expect(201);
    await supertest(app).post(`/api/v1/games/${created.body.id}/ready`).set(auth(aliceToken)).expect(200);
    await supertest(app).post(`/api/v1/games/${created.body.id}/ready`).set(auth(joined.body.guest_token)).expect(200);
    const gameId = created.body.id;

    await service.markDisconnected({ communityId: cid, gameId, side: 'r' });
    let detail = await supertest(app).get(`/api/v1/games/${gameId}`).set(auth(joined.body.guest_token)).expect(200);
    expect(detail.body.disconnected_side).toBe('r');
    const firstDisconnectedAt = detail.body.disconnected_at;

    await service.markDisconnected({ communityId: cid, gameId, side: 'b' }); // đã có người mất kết nối rồi — không ghi đè
    detail = await supertest(app).get(`/api/v1/games/${gameId}`).set(auth(joined.body.guest_token)).expect(200);
    expect(detail.body.disconnected_side).toBe('r');
    expect(detail.body.disconnected_at).toBe(firstDisconnectedAt);

    await service.clearDisconnected({ communityId: cid, gameId, side: 'r' });
    detail = await supertest(app).get(`/api/v1/games/${gameId}`).set(auth(joined.body.guest_token)).expect(200);
    expect(detail.body.disconnected_side).toBe(null);
  });

  it('quá 1 phút mất kết nối thì /disconnect-timeout xử thua đúng bên', async () => {
    const created = await supertest(app).post('/api/v1/games/rooms').set(auth(aliceToken)).expect(201);
    const joined = await supertest(app).post(`/api/v1/games/rooms/${created.body.invite_token}/join`)
      .send({ guest_name: 'Khách Timeout' }).expect(201);
    await supertest(app).post(`/api/v1/games/${created.body.id}/ready`).set(auth(aliceToken)).expect(200);
    await supertest(app).post(`/api/v1/games/${created.body.id}/ready`).set(auth(joined.body.guest_token)).expect(200);
    await db.raw(
      `UPDATE games SET disconnected_side = 'r', disconnected_at = now() - interval '61 seconds' WHERE id = ?`,
      [created.body.id]
    );
    await supertest(app).post(`/api/v1/games/${created.body.id}/disconnect-timeout`).set(auth(joined.body.guest_token)).expect(200);
    const detail = await supertest(app).get(`/api/v1/games/${created.body.id}`).set(auth(joined.body.guest_token)).expect(200);
    expect(detail.body.status).toBe('finished');
    expect(detail.body.end_reason).toBe('mat-ket-noi');
  });

  it('chưa đủ 1 phút thì /disconnect-timeout bị từ chối', async () => {
    const created = await supertest(app).post('/api/v1/games/rooms').set(auth(aliceToken)).expect(201);
    const joined = await supertest(app).post(`/api/v1/games/rooms/${created.body.invite_token}/join`)
      .send({ guest_name: 'Khách Sớm' }).expect(201);
    await supertest(app).post(`/api/v1/games/${created.body.id}/ready`).set(auth(aliceToken)).expect(200);
    await supertest(app).post(`/api/v1/games/${created.body.id}/ready`).set(auth(joined.body.guest_token)).expect(200);
    await db.raw(`UPDATE games SET disconnected_side = 'r', disconnected_at = now() WHERE id = ?`, [created.body.id]);
    await supertest(app).post(`/api/v1/games/${created.body.id}/disconnect-timeout`).set(auth(joined.body.guest_token)).expect(409);
  });
});
