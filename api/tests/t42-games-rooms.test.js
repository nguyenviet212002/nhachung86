import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { resetDb } from './helpers/db.js';
import { buildApp } from '../src/app.js';
import { config } from '../src/config/index.js';
import * as service from '../src/modules/games/service.js';
import { subscribeGame, isSideWatchingGame } from '../src/core/realtime.js';

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

  it('T42-extra: GET /games?mine=true liệt kê được phòng có khách (chưa phải thành viên)', async () => {
    const created = await supertest(app).post('/api/v1/games/rooms').set(auth(aliceToken)).expect(201);
    const roomId = created.body.id;
    const guestName = 'Khách Phòng Đấu';
    await supertest(app).post(`/api/v1/games/rooms/${created.body.invite_token}/join`)
      .send({ guest_name: guestName }).expect(201);
    // black_member_id vẫn NULL (khách, không phải thành viên) — trước bản vá
    // list() dùng INNER JOIN cho bên Đen nên hàng này bị loại hẳn khỏi kết quả.
    const res = await supertest(app).get('/api/v1/games?mine=true&status=pending,active').set(auth(aliceToken)).expect(200);
    const row = res.body.data.find((g) => g.id === roomId);
    expect(row).toBeDefined();
    expect(row.black_name).toBe(guestName); // COALESCE lấy black_guest_name vì black_member_id NULL
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

  // Vòng soát xét cuối cùng (Important): UPDATE quyết định của claimTimeout()
  // trước bản vá này chỉ khoá WHERE status='active', thiếu khoá thêm phần
  // trạng thái (turn) mà nó vừa đọc để QUYẾT ĐỊNH bên nào hết giờ — khác mọi
  // hàm ghi trạng thái khác trong service.js (move(), acceptDraw(),
  // claimDisconnectTimeout() đều khoá thêm đúng phần trạng thái riêng của
  // từng hàm). Nếu bên bị coi là hết giờ vừa đi được một nước hợp lệ (đổi
  // turn) NGAY TRƯỚC KHI UPDATE của claimTimeout chạy, bản thiếu khoá vẫn
  // khớp WHERE (status vẫn 'active') và kết thúc ván trên dữ liệu đã cũ.
  //
  // claimTimeout() đọc rồi ghi trong CÙNG một lời gọi, sát nhau, không có chỗ
  // nào để một test đơn luồng chen một thay đổi thật vào giữa hai bước đó (và
  // dùng Promise.all hai request thật để đua timing thì thứ tự thắng-thua của
  // hai giao dịch song song không kiểm soát được — chạy test không ổn định).
  // Vì vậy test này tái hiện đúng CHUỖI BA BƯỚC mà claimTimeout() thực hiện,
  // tách rời để kiểm soát được thứ tự: (1) đọc turn hiện tại — y hệt bước đầu
  // của loadGame() trong claimTimeout(); (2) mô phỏng "đối thủ vừa đi nước xen
  // giữa" bằng cách đổi hẳn turn qua db.raw (turn đổi thật, đã commit); (3)
  // chạy ĐÚNG câu UPDATE mà claimTimeout() dùng, với turn=? lấy từ giá trị đã
  // đọc ở bước (1) — tức bước "claim" dùng dữ liệu đã cũ. Guard AND turn=?
  // phải chặn đúng, y hệt guard thật trong service.js.
  it('turn đổi xen giữa lúc đọc và lúc UPDATE claim chạy thì UPDATE không khớp — không kết thúc ván trên dữ liệu cũ', async () => {
    const { id } = await activeGame(aliceToken, alice); // turn='r' ngay sau ready()
    await db.raw(`UPDATE games SET turn_started_at = now() - interval '11 minutes' WHERE id = ?`, [id]);

    // Bước 1: đọc turn hiện tại — y hệt `game.turn` mà claimTimeout() đã đọc.
    const { rows: [{ turn: turnAtRead }] } = await db.raw(`SELECT turn FROM games WHERE id = ?`, [id]);
    expect(turnAtRead).toBe('r');

    // Bước 2: "đối thủ vừa đi nước" xen giữa lúc claimTimeout() đọc xong và
    // lúc UPDATE của nó chạy — turn đổi sang 'b', đã commit thật vào CSDL.
    await db.raw(`UPDATE games SET turn = 'b' WHERE id = ?`, [id]);

    // Bước 3: "cái claim" — đúng câu UPDATE trong claimTimeout(), dùng turn=?
    // lấy từ giá trị đã đọc ở bước 1 (đã cũ, không còn khớp CSDL thật nữa).
    const { rows: [row] } = await db.raw(
      `UPDATE games SET status = 'finished', end_reason = 'het-gio', finished_at = now()
        WHERE id = ? AND status = 'active' AND turn = ? RETURNING id`,
      [id, turnAtRead]
    );
    expect(row).toBeUndefined(); // guard chặn đúng — turn đã đổi, 'r' không còn khớp

    const { rows: [after] } = await db.raw(`SELECT status FROM games WHERE id = ?`, [id]);
    expect(after.status).toBe('active'); // ván không bị kết thúc oan trên dữ liệu cũ
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

  // Task 10 §3.2: khi bên KHÔNG mất kết nối đang cầm lượt suốt lúc đối thủ mất
  // kết nối (không đi nước nào nên turn không đổi), việc kết nối lại phải chỉ
  // trừ đúng khoảng thời gian mất kết nối khỏi đồng hồ của bên đang cầm lượt —
  // không trừ oan toàn bộ (kể cả phần họ đã thật sự nghĩ trước khi đối thủ mất
  // kết nối), và không tha luôn phần đã nghĩ thật đó. Tái hiện đúng kịch bản đã
  // báo cáo: turn_started_at lùi 6 phút (Đỏ đã nghĩ thật 2 phút trước khi Đen
  // mất kết nối), disconnected_at lùi 4 phút (mất kết nối kéo dài 4 phút) —
  // sau khi kết nối lại, đồng hồ Đỏ phải còn ~480000ms (600000 - 120000),
  // không phải ~240000ms (lỗi cũ: trừ oan cả 6 phút) và không phải ~600000ms
  // (tha quá tay: xoá sạch cả 2 phút nghĩ thật).
  it('kết nối lại chỉ trừ đúng khoảng mất kết nối khỏi đồng hồ bên đang cầm lượt, không trừ oan và không tha hết', async () => {
    const created = await supertest(app).post('/api/v1/games/rooms').set(auth(aliceToken)).expect(201);
    const joined = await supertest(app).post(`/api/v1/games/rooms/${created.body.invite_token}/join`)
      .send({ guest_name: 'Khách Lệch Giờ' }).expect(201);
    await supertest(app).post(`/api/v1/games/${created.body.id}/ready`).set(auth(aliceToken)).expect(200);
    await supertest(app).post(`/api/v1/games/${created.body.id}/ready`).set(auth(joined.body.guest_token)).expect(200);
    const gameId = created.body.id;

    await service.markDisconnected({ communityId: cid, gameId, side: 'b' });
    await db.raw(
      `UPDATE games SET turn_started_at = now() - interval '6 minutes', disconnected_at = now() - interval '4 minutes' WHERE id = ?`,
      [gameId]
    );
    await service.clearDisconnected({ communityId: cid, gameId, side: 'b' });

    const detail = await supertest(app).get(`/api/v1/games/${gameId}`).set(auth(aliceToken)).expect(200);
    expect(detail.body.red_time_remaining_ms).toBeGreaterThan(480000 - 15000);
    expect(detail.body.red_time_remaining_ms).toBeLessThan(480000 + 15000);

    // Còn cách xa lúc hết giờ thật — /timeout phải vẫn bị từ chối. Đây chính là
    // phép kiểm khoá lại lỗ hổng "ăn chực đồng hồ": trước khi sửa, bên vừa mất
    // kết nối kết nối lại xong có thể báo /timeout thắng ngay dù Đỏ chưa hề đi
    // nước nào.
    await supertest(app).post(`/api/v1/games/${gameId}/timeout`).set(auth(joined.body.guest_token)).expect(409);
  });

  // Task 10 §9 (vòng sửa thứ hai): công thức dời turn_started_at ở phép kiểm
  // trên ngầm định turn_started_at <= disconnected_at — đúng khi không ai đi
  // thêm nước nào trong lúc mất kết nối. Nhưng move() (không sửa ở Task 10,
  // không biết tới disconnected_side) vẫn cho bên ĐANG kết nối đi nước bình
  // thường trong lúc đối thủ mất kết nối, và mỗi nước dời turn_started_at tới
  // NGAY LÚC ĐI — có thể muộn hơn disconnected_at. Khi đó công thức dời (chưa
  // kẹp) vọt QUÁ hiện tại, làm phồng thời gian còn lại của bên vừa nhận lượt
  // (luôn là bên vừa kết nối lại) vượt cả ngân sách ban đầu 600000ms.
  it('bên đang kết nối đi một nước trong lúc đối thủ mất kết nối thì lúc đối thủ kết nối lại, đồng hồ họ không bị phồng vượt ngân sách', async () => {
    const created = await supertest(app).post('/api/v1/games/rooms').set(auth(aliceToken)).expect(201);
    const joined = await supertest(app).post(`/api/v1/games/rooms/${created.body.invite_token}/join`)
      .send({ guest_name: 'Khách Đi Xen' }).expect(201);
    await supertest(app).post(`/api/v1/games/${created.body.id}/ready`).set(auth(aliceToken)).expect(200);
    await supertest(app).post(`/api/v1/games/${created.body.id}/ready`).set(auth(joined.body.guest_token)).expect(200);
    const gameId = created.body.id;

    // Đen mất kết nối, đã được 2 phút.
    await service.markDisconnected({ communityId: cid, gameId, side: 'b' });
    await db.raw(`UPDATE games SET disconnected_at = now() - interval '2 minutes' WHERE id = ?`, [gameId]);

    // Đỏ (đang kết nối, turn='r') vẫn đi một nước bình thường — move() thành
    // công vì không hề kiểm disconnected_side, và dời turn_started_at tới
    // ĐÚNG BÂY GIỜ (muộn hơn disconnected_at ở trên 2 phút — chính là điều
    // kiện "vọt quá hiện tại" của công thức dời). Turn chuyển sang 'b'.
    await supertest(app).post(`/api/v1/games/${gameId}/moves`).set(auth(aliceToken))
      .send({ from: { r: 6, c: 0 }, to: { r: 5, c: 0 } }).expect(200);

    // Đen kết nối lại — disconnected_side vẫn còn 'b' (move() không đụng tới),
    // và turn giờ đã là 'b' (đúng bên vừa kết nối lại).
    await service.clearDisconnected({ communityId: cid, gameId, side: 'b' });

    const detail = await supertest(app).get(`/api/v1/games/${gameId}`).set(auth(joined.body.guest_token)).expect(200);
    // Bất biến cứng: không bao giờ được vượt ngân sách ban đầu — công thức dời
    // chưa kẹp bằng LEAST sẽ vọt quá hiện tại và làm giá trị này VƯỢT 600000
    // (tái hiện thật của reviewer: 659987).
    expect(detail.body.black_time_remaining_ms).toBeLessThanOrEqual(600000);
    // Hợp lý: Đen vừa kết nối lại, chưa kịp nghĩ gì cho lượt vừa nhận (lượt
    // được trao trong lúc họ còn mất kết nối) — phải là một khởi đầu mới, gần
    // sát 600000.
    expect(detail.body.black_time_remaining_ms).toBeGreaterThan(600000 - 15000);
  });

  // Task 10 §10 (vòng sửa thứ ba, từ phát hiện leo thang của reviewer trên
  // §9.4): chính bên bị đánh dấu mất kết nối vẫn còn đi nước được (SSE rớt
  // nhưng request/response HTTP vẫn sống) — disconnected_side/disconnected_at
  // không hề đổi (move() không đụng tới), nên nếu không kiểm, /disconnect-timeout
  // của đối thủ sẽ xử THẮNG THẬT sau 60 giây kể từ mốc cũ, dù bên kia vẫn chơi
  // bình thường suốt — thắng oan, không cần đợi họ kết nối lại.
  it('bên bị đánh dấu mất kết nối nhưng vẫn đi nước bình thường thì /disconnect-timeout của đối thủ bị từ chối, không xử thắng oan', async () => {
    const created = await supertest(app).post('/api/v1/games/rooms').set(auth(aliceToken)).expect(201);
    const joined = await supertest(app).post(`/api/v1/games/rooms/${created.body.invite_token}/join`)
      .send({ guest_name: 'Khách Vẫn Chơi' }).expect(201);
    await supertest(app).post(`/api/v1/games/${created.body.id}/ready`).set(auth(aliceToken)).expect(200);
    await supertest(app).post(`/api/v1/games/${created.body.id}/ready`).set(auth(joined.body.guest_token)).expect(200);
    const gameId = created.body.id;

    // Đỏ (đang cầm lượt, turn='r') bị đánh dấu mất kết nối từ hơn 60 giây trước.
    await service.markDisconnected({ communityId: cid, gameId, side: 'r' });
    await db.raw(`UPDATE games SET disconnected_at = now() - interval '61 seconds' WHERE id = ?`, [gameId]);

    // Nhưng Đỏ vẫn đi nước bình thường qua HTTP (kênh khác vẫn sống dù SSE đã
    // rớt) — move() thành công vì không hề kiểm disconnected_side.
    await supertest(app).post(`/api/v1/games/${gameId}/moves`).set(auth(aliceToken))
      .send({ from: { r: 6, c: 0 }, to: { r: 5, c: 0 } }).expect(200);

    // Đối thủ (khách, Đen) báo /disconnect-timeout — phải bị từ chối, KHÔNG
    // được xử thắng, vì cờ mất kết nối đã cũ (Đỏ vừa chứng minh còn sống).
    await supertest(app).post(`/api/v1/games/${gameId}/disconnect-timeout`).set(auth(joined.body.guest_token)).expect(409);

    const detail = await supertest(app).get(`/api/v1/games/${gameId}`).set(auth(joined.body.guest_token)).expect(200);
    expect(detail.body.status).toBe('active'); // không bị xử thua/kết thúc oan
    expect(detail.body.disconnected_side).toBe(null); // tự dọn cờ cũ
  });

  // Vòng soát xét cuối cùng (Critical): trước bản vá này, gameClients (core/
  // realtime.js) chỉ giữ memberId cạnh mỗi kết nối, không hề có khái niệm
  // "bên" — route /:id/stream gọi markDisconnected() ngay khi BẤT KỲ MỘT kết
  // nối nào của ván đóng lại, không kiểm còn kết nối nào khác của cùng bên
  // đang mở hay không. Người chơi mở ván ở hai tab, đóng một tab (tab kia vẫn
  // sống) bị đánh dấu mất kết nối oan — đối thủ báo /disconnect-timeout thắng
  // thật dù người kia vẫn đang chơi bình thường ở tab còn lại.
  //
  // SSE thật không kiểm ổn định qua supertest (xem ghi chú đầu describe này),
  // nên test dưới đây kiểm trực tiếp bằng subscribeGame()/isSideWatchingGame()
  // — hai hàm nguyên thuỷ mà route /:id/stream dùng — và mô phỏng ĐÚNG thứ tự
  // routes.js chạy trong req.on('close'): unsubscribe() (xoá kết nối của
  // CHÍNH request đó) LUÔN chạy trước khi kiểm isSideWatchingGame(), nên phép
  // kiểm dưới đây cũng đóng kết nối trước rồi mới hỏi "còn kết nối nào khác
  // không" — đúng thứ tự thật, không phải một cách kiểm khác đi.
  it('còn một kết nối khác (vd. tab thứ hai) của cùng bên thì không bị đánh dấu mất kết nối oan; hết sạch kết nối thì vẫn phát hiện đúng', async () => {
    const created = await supertest(app).post('/api/v1/games/rooms').set(auth(aliceToken)).expect(201);
    const joined = await supertest(app).post(`/api/v1/games/rooms/${created.body.invite_token}/join`)
      .send({ guest_name: 'Khách Hai Tab' }).expect(201);
    await supertest(app).post(`/api/v1/games/${created.body.id}/ready`).set(auth(aliceToken)).expect(200);
    await supertest(app).post(`/api/v1/games/${created.body.id}/ready`).set(auth(joined.body.guest_token)).expect(200);
    const gameId = created.body.id;

    // Alice (Đỏ) mở ván ở hai "tab" — hai kết nối SSE riêng biệt, cùng bên 'r'.
    const resTab1 = { write: () => {} };
    const resTab2 = { write: () => {} };
    const unsubTab1 = subscribeGame(gameId, alice, 'r', resTab1);
    const unsubTab2 = subscribeGame(gameId, alice, 'r', resTab2);

    // Đóng tab 1. Gate y hệt routes.js: chỉ gọi markDisconnected khi KHÔNG còn
    // kết nối nào khác của bên này.
    unsubTab1();
    expect(isSideWatchingGame(gameId, 'r')).toBe(true); // tab 2 vẫn còn sống
    if (!isSideWatchingGame(gameId, 'r')) {
      await service.markDisconnected({ communityId: cid, gameId, side: 'r' });
    }
    let detail = await supertest(app).get(`/api/v1/games/${gameId}`).set(auth(joined.body.guest_token)).expect(200);
    expect(detail.body.disconnected_side).toBe(null); // KHÔNG bị đánh dấu oan — tab 2 vẫn mở

    // Đóng nốt tab 2 — giờ không còn kết nối nào của Đỏ nữa.
    unsubTab2();
    expect(isSideWatchingGame(gameId, 'r')).toBe(false);
    if (!isSideWatchingGame(gameId, 'r')) {
      await service.markDisconnected({ communityId: cid, gameId, side: 'r' });
    }
    detail = await supertest(app).get(`/api/v1/games/${gameId}`).set(auth(joined.body.guest_token)).expect(200);
    expect(detail.body.disconnected_side).toBe('r'); // hết kết nối thật thì vẫn phát hiện đúng
  });
});

describe('T42 rời phòng', () => {
  it('chưa vào trận: chủ phòng rời thì phòng bị xoá hẳn', async () => {
    const created = await supertest(app).post('/api/v1/games/rooms').set(auth(aliceToken)).expect(201);
    await supertest(app).post(`/api/v1/games/${created.body.id}/leave`).set(auth(aliceToken)).expect(200);
    await supertest(app).get(`/api/v1/games/${created.body.id}`).set(auth(aliceToken)).expect(404);
  });

  it('đang đấu: rời phòng tính như xin thua, ván vẫn còn (không bị xoá)', async () => {
    const created = await supertest(app).post('/api/v1/games/rooms').set(auth(aliceToken)).expect(201);
    const joined = await supertest(app).post(`/api/v1/games/rooms/${created.body.invite_token}/join`)
      .send({ guest_name: 'Khách Rời' }).expect(201);
    await supertest(app).post(`/api/v1/games/${created.body.id}/ready`).set(auth(aliceToken)).expect(200);
    await supertest(app).post(`/api/v1/games/${created.body.id}/ready`).set(auth(joined.body.guest_token)).expect(200);

    await supertest(app).post(`/api/v1/games/${created.body.id}/leave`).set(auth(aliceToken)).expect(200);
    const detail = await supertest(app).get(`/api/v1/games/${created.body.id}`).set(auth(joined.body.guest_token)).expect(200);
    expect(detail.body.status).toBe('finished');
    expect(detail.body.end_reason).toBe('resign');
  });

  it('người ngoài (không phải người chơi trong ván) không rời được', async () => {
    const created = await supertest(app).post('/api/v1/games/rooms').set(auth(aliceToken)).expect(201);
    await supertest(app).post(`/api/v1/games/${created.body.id}/leave`).set(auth(bobToken)).expect(403);
  });

  // Vòng soát xét cuối cùng (Important): trước bản vá này, nhánh "chưa vào
  // trận" xoá CẢ VÁN bất kể người rời là chủ phòng hay khách — một khách vào
  // phòng (dù chưa hề bấm sẵn sàng) gọi /leave xoá sạch phòng của CHỦ PHÒNG,
  // link mời mất theo, lặp lại được vô hạn lần chừng nào link còn lưu hành.
  // Trái nguyên tắc "chủ phòng tuyệt đối" mà evictStaleGuestIfNeeded() (đuổi
  // khách trễ giờ) đã áp dụng: chỉ dọn CHỖ CỦA KHÁCH, không đụng phòng của chủ.
  it('chưa vào trận: khách rời phòng chỉ dọn chỗ của khách, phòng + link mời của chủ vẫn còn, trạng thái sẵn sàng của chủ không mất', async () => {
    const created = await supertest(app).post('/api/v1/games/rooms').set(auth(aliceToken)).expect(201);
    const joined = await supertest(app).post(`/api/v1/games/rooms/${created.body.invite_token}/join`)
      .send({ guest_name: 'Khách Rời Sớm' }).expect(201);
    // Chủ bấm sẵn sàng SAU khi khách vào (ready() đòi phải có đối thủ trong
    // phòng mới cho bấm — xem game.black_name ở ready()), rồi khách đổi ý rời
    // mà KHÔNG hề bấm sẵn sàng — để kiểm red_ready_at của chủ sống sót qua
    // việc khách vào-rồi-rời, không phải chỉ còn giá trị null từ đầu.
    await supertest(app).post(`/api/v1/games/${created.body.id}/ready`).set(auth(aliceToken)).expect(200);
    const { rows: [beforeLeave] } = await db.raw(`SELECT red_ready_at FROM games WHERE id = ?`, [created.body.id]);
    expect(beforeLeave.red_ready_at).not.toBe(null);

    await supertest(app).post(`/api/v1/games/${created.body.id}/leave`).set(auth(joined.body.guest_token)).expect(200);

    // Phòng vẫn còn, chủ vẫn xem được, vẫn đang chờ khách — không bị xoá.
    const detail = await supertest(app).get(`/api/v1/games/${created.body.id}`).set(auth(aliceToken)).expect(200);
    expect(detail.body.status).toBe('pending');
    expect(detail.body.black_member_id).toBe(null);
    expect(detail.body.black_name).toBe(null);

    // Trạng thái "đã sẵn sàng" của chủ không bị xoá theo — không phải bấm lại.
    const { rows: [afterLeave] } = await db.raw(`SELECT red_ready_at FROM games WHERE id = ?`, [created.body.id]);
    expect(afterLeave.red_ready_at.getTime()).toBe(beforeLeave.red_ready_at.getTime());

    // Token khách cũ không dùng được nữa (đã bị dọn khỏi phòng).
    await supertest(app).get(`/api/v1/games/${created.body.id}`).set(auth(joined.body.guest_token)).expect(401);

    // Link mời vẫn còn hiệu lực — khách mới vào được; và vì chủ đã sẵn sàng từ
    // trước (giữ nguyên), khách mới chỉ cần bấm sẵn sàng một lần là ván bắt
    // đầu ngay — chứng minh red_ready_at không chỉ còn giá trị trong cột mà
    // còn hoạt động đúng ý nghĩa nghiệp vụ của nó.
    const joined2 = await supertest(app).post(`/api/v1/games/rooms/${created.body.invite_token}/join`)
      .send({ guest_name: 'Khách Mới' }).expect(201);
    const readyRes = await supertest(app).post(`/api/v1/games/${created.body.id}/ready`)
      .set(auth(joined2.body.guest_token)).expect(200);
    expect(readyRes.body.active).toBe(true);
  });
});
