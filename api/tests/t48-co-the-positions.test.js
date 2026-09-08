import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { resetDb } from './helpers/db.js';
import { buildApp } from '../src/app.js';
import { config } from '../src/config/index.js';

let db, app, cid, alice, aliceToken, bob, bobToken;
const auth = (t) => ({ authorization: `Bearer ${t}` });

function validBoard() {
  const b = Array.from({ length: 10 }, () => Array(9).fill(null));
  b[9][4] = { side: 'r', type: 'general' };
  b[0][4] = { side: 'b', type: 'general' };
  b[5][4] = { side: 'r', type: 'chariot' };
  return b;
}

beforeAll(async () => {
  db = await resetDb();
  app = buildApp();
  const { rows: [c] } = await db.raw(`INSERT INTO communities (code, name) VALUES ('t48-co-the', 'T48') RETURNING id`);
  cid = c.id;
  const { rows: [a] } = await db.raw(`INSERT INTO members (community_id, full_name, status) VALUES (?, 'Alice T48', 'member') RETURNING id`, [cid]);
  alice = a.id;
  aliceToken = jwt.sign({ sub: alice, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' });
  const { rows: [b2] } = await db.raw(`INSERT INTO members (community_id, full_name, status) VALUES (?, 'Bob T48', 'member') RETURNING id`, [cid]);
  bob = b2.id;
  bobToken = jwt.sign({ sub: bob, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' });
});
afterAll(async () => { await db.destroy(); });

describe('T48 Cờ Thế — soạn thế, kiểm, Kho thế', () => {
  it('soạn thế hợp lệ -> 201, saved_to_library=false mặc định', async () => {
    const res = await supertest(app).post('/api/v1/co-the/positions').set(auth(aliceToken))
      .send({ board: validBoard(), side_to_move: 'r' }).expect(201);
    expect(res.body.saved_to_library).toBe(false);
    expect(res.body.origin).toBe('tu-soan');
  });

  it('soạn thế thiếu Tướng -> 422, không tạo row', async () => {
    const b = Array.from({ length: 10 }, () => Array(9).fill(null));
    b[9][4] = { side: 'r', type: 'general' };
    await supertest(app).post('/api/v1/co-the/positions').set(auth(aliceToken))
      .send({ board: b, side_to_move: 'r' }).expect(422);
  });

  // Thế thật đã bắt được lỗi này qua log: Xe kề ngay Tướng đối phương, chưa
  // ai đi, nếu cho chốt thì "Phân tích ngay"/"Tìm cách phá" gọi engine thật
  // sẽ nhận về "Pikafish thoát bất ngờ (mã 1)" thay vì kết quả — phải chặn
  // ngay từ lúc chốt thế (fail-closed), không để lộ ra tận lúc phân tích.
  it('soạn thế để bên chưa đi bị chiếu sẵn (Tướng bắt được ngay) -> 422', async () => {
    const b = Array.from({ length: 10 }, () => Array(9).fill(null));
    b[9][4] = { side: 'r', type: 'general' };
    b[0][4] = { side: 'b', type: 'general' };
    b[1][4] = { side: 'r', type: 'chariot' };
    await supertest(app).post('/api/v1/co-the/positions').set(auth(aliceToken))
      .send({ board: b, side_to_move: 'r' }).expect(422);
  });

  it('lưu Kho thế rồi liệt kê thấy đúng thế đó, thành viên KHÁC trong cộng đồng cũng xem được', async () => {
    const created = await supertest(app).post('/api/v1/co-the/positions').set(auth(aliceToken))
      .send({ board: validBoard(), side_to_move: 'r' }).expect(201);
    await supertest(app).post(`/api/v1/co-the/positions/${created.body.id}/luu-kho`).set(auth(aliceToken))
      .send({ label: 'Thế mẫu T48', category: 'sat-cuoc' }).expect(200);
    const list = await supertest(app).get('/api/v1/co-the/positions').set(auth(bobToken)).expect(200);
    expect(list.body.data.some((p) => p.id === created.body.id)).toBe(true);
  });

  it('thế chưa lưu Kho thế thì KHÔNG xuất hiện trong danh sách', async () => {
    const created = await supertest(app).post('/api/v1/co-the/positions').set(auth(aliceToken))
      .send({ board: validBoard(), side_to_move: 'r' }).expect(201);
    const list = await supertest(app).get('/api/v1/co-the/positions').set(auth(aliceToken)).expect(200);
    expect(list.body.data.some((p) => p.id === created.body.id)).toBe(false);
  });
});
