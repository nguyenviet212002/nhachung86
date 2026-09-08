import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { resetDb } from './helpers/db.js';
import { buildApp } from '../src/app.js';
import { config } from '../src/config/index.js';

vi.mock('../src/modules/games/engineClient.js', () => ({ bestMove: vi.fn() }));
import * as engineClient from '../src/modules/games/engineClient.js';

let db, app, cid, alice, aliceToken;
const auth = (t) => ({ authorization: `Bearer ${t}` });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Tướng Đen bị bí ngay nước đầu — KHÔNG phải kiểu "Xe ăn thẳng Tướng" bản
// trước (đó là thế BẤT HỢP LỆ thật: bên chưa đi đã bị chiếu sẵn ngay từ lúc
// bày, validatePosition giờ chặn đúng thế đó, và Pikafish thật cũng từ chối
// thẳng — "Unsupported position. King can be captured." — tự tay xác nhận
// qua log lỗi thật, không phải suy diễn). Thế NÀY hợp lệ (chưa ai bị chiếu
// sẵn khi bày): Xe Đỏ (1,1) đi sang (1,0) — không ăn quân nào, cũng không
// chiếu — nhưng Tướng Đen ở (0,3) bị BÍT hết cả 2 nước đi trong cung: sang
// (0,4) thì phạm lộ mặt Tướng (cùng cột 4 với Tướng Đỏ ở (9,4), không quân
// nào chắn giữa), xuống (1,3) thì lọt vào đúng hàng ngang của Xe (1,0) sau
// khi đi — hết nước đi (hết-nước-đi/"het-nuoc-di", vẫn tính bên đó THUA theo
// luật cờ tướng thật, khác cờ vua coi hết nước là hoà). Đã tự chạy qua CẢ
// engine thật (Pikafish, báo mate 1, gợi ý đúng nước b8a8) LẪN rules.js thật
// (applyMove trả gameOver=true, winner='r') trước khi đưa vào test — không
// suy luận suông trên giấy.
function matIn1Board() {
  const b = Array.from({ length: 10 }, () => Array(9).fill(null));
  b[9][4] = { side: 'r', type: 'general' };
  b[0][3] = { side: 'b', type: 'general' };
  b[1][1] = { side: 'r', type: 'chariot' };
  return b;
}

beforeAll(async () => {
  db = await resetDb();
  app = buildApp();
  const { rows: [c] } = await db.raw(`INSERT INTO communities (code, name) VALUES ('t52-co-the', 'T52') RETURNING id`);
  cid = c.id;
  const { rows: [a] } = await db.raw(`INSERT INTO members (community_id, full_name, status) VALUES (?, 'Alice T52', 'member') RETURNING id`, [cid]);
  alice = a.id;
  aliceToken = jwt.sign({ sub: alice, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' });
});
afterAll(async () => { await db.destroy(); });

describe('T52 Cờ Thế — Luyện Thế', () => {
  it('chạy nền, kết thúc session, mỗi ván bắt tướng ngay nước đầu -> Hạ/Trung/Cao đều tồn tại và có nước đầu duy nhất', async () => {
    engineClient.bestMove.mockResolvedValue({
      bestmove: 'b8a8', score_cp: 0, mate: 1, depth: 20, pv: ['b8a8'],
      lines: [{ move: 'b8a8', score_cp: 0, mate: 1, depth: 20, pv: ['b8a8'] }],
    });
    const created = await supertest(app).post('/api/v1/co-the/positions').set(auth(aliceToken))
      .send({ board: matIn1Board(), side_to_move: 'r' }).expect(201);
    const session = await supertest(app).post('/api/v1/co-the/sessions').set(auth(aliceToken))
      .send({ position_id: created.body.id, mode: 'luyen-the', luyen_the_cap: 'ha' }).expect(201);
    await supertest(app).post(`/api/v1/co-the/sessions/${session.body.id}/luyen-the/chay`).set(auth(aliceToken)).expect(200);
    await wait(500);
    const detail = await supertest(app).get(`/api/v1/co-the/sessions/${session.body.id}`).set(auth(aliceToken)).expect(200);
    expect(detail.body.status).toBe('ket-thuc');
    expect(detail.body.end_reason).toBe('luyen-the-xong');
    // Kết quả Hạ/Trung/Cao phải LƯU LẠI (không chỉ phát qua SSE) — nếu không
    // ai đang mở kết nối lúc job nền xong thì SSE-only sẽ mất dữ liệu vĩnh viễn.
    expect(detail.body.luyen_the_result.tong_so_van).toBe(8);
    expect(detail.body.luyen_the_result.ha.first_move).toBe('b8a8');
    expect(detail.body.luyen_the_result.cao.first_move).toBe('b8a8');
  });

  it('không phải chế độ luyen-the thì không chạy được (409)', async () => {
    const created = await supertest(app).post('/api/v1/co-the/positions').set(auth(aliceToken))
      .send({ board: matIn1Board(), side_to_move: 'r' }).expect(201);
    const session = await supertest(app).post('/api/v1/co-the/sessions').set(auth(aliceToken))
      .send({ position_id: created.body.id, mode: 'giai', opponent_level: 'manh' }).expect(201);
    await supertest(app).post(`/api/v1/co-the/sessions/${session.body.id}/luyen-the/chay`).set(auth(aliceToken)).expect(409);
  });
});
