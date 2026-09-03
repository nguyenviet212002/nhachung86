import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { resetDb } from './helpers/db.js';
import { buildApp } from '../src/app.js';
import { config } from '../src/config/index.js';

let db, app, communityId, areaId, borrowerId, otherMemberId, adminId, borrowerToken, otherMemberToken, adminToken;
const auth = (token) => ({ authorization: `Bearer ${token}` });
const token = (id) => jwt.sign({ sub: id, cid: communityId, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' });

beforeAll(async () => {
  db = await resetDb();
  app = buildApp();
  const { rows: [community] } = await db.raw(
    `INSERT INTO communities (code, name) VALUES ('t42-loans', 'T42 Loans') RETURNING id`
  );
  communityId = community.id;
  const { rows: [area] } = await db.raw(
    `INSERT INTO areas (community_id, name) VALUES (?, 'Xa test T42') RETURNING id`,
    [communityId]
  );
  areaId = area.id;
  const { rows: [borrower] } = await db.raw(
    `INSERT INTO members (community_id, full_name, status, area_id)
     VALUES (?, 'Nguoi xin vay T42', 'member', ?) RETURNING id`,
    [communityId, areaId]
  );
  const { rows: [otherMember] } = await db.raw(
    `INSERT INTO members (community_id, full_name, status, area_id)
     VALUES (?, 'Thanh vien khac T42', 'member', ?) RETURNING id`,
    [communityId, areaId]
  );
  const { rows: [admin] } = await db.raw(
    `INSERT INTO members (community_id, full_name, status, area_id)
     VALUES (?, 'Admin duyet T42', 'member', ?) RETURNING id`,
    [communityId, areaId]
  );
  await db.raw(
    `INSERT INTO member_roles (member_id, role_id, community_id)
     SELECT ?, r.id, ? FROM roles r WHERE r.key = 'approver'`,
    [admin.id, communityId]
  );
  borrowerId = borrower.id;
  otherMemberId = otherMember.id;
  adminId = admin.id;
  borrowerToken = token(borrowerId);
  otherMemberToken = token(otherMemberId);
  adminToken = token(adminId);
}, 30_000);

afterAll(async () => { await db.destroy(); }, 30_000);

describe('T42 loans API cho quỹ vay giai đoạn 1', () => {
  it('từ chối số tiền vượt hạn mức 3.000.000đ', async () => {
    await supertest(app)
      .post('/api/v1/loans')
      .set(auth(borrowerToken))
      .send({ amount: 3_500_000, purpose: 'Vay vuot han muc de kiem tra rang buoc.' })
      .expect(400);
  });

  it('thành viên thường không xem được hàng đợi duyệt', async () => {
    await supertest(app).get('/api/v1/loans').set(auth(otherMemberToken)).expect(403);
  });

  it('gửi đơn xin vay, báo Ban điều hành, rồi được duyệt', async () => {
    const created = await supertest(app)
      .post('/api/v1/loans')
      .set(auth(borrowerToken))
      .send({ amount: 3_000_000, purpose: 'Vay dong hoc phi cho con dau nam hoc.' })
      .expect(201);
    expect(created.body.status).toBe('requested');
    expect(created.body.amount).toBe(3_000_000);

    const mine = await supertest(app).get('/api/v1/loans/me').set(auth(borrowerToken)).expect(200);
    expect(mine.body.data.map((r) => r.id)).toContain(created.body.id);
    expect(mine.body.data[0].status).toBe('requested');

    const queue = await supertest(app).get('/api/v1/loans').set(auth(adminToken)).expect(200);
    const row = queue.body.data.find((r) => r.id === created.body.id);
    expect(row).toBeTruthy();
    expect(row.borrower_name).toBe('Nguoi xin vay T42');

    await supertest(app)
      .post(`/api/v1/loans/${created.body.id}/approve`)
      .set(auth(borrowerToken))
      .send({})
      .expect(403);

    const approved = await supertest(app)
      .post(`/api/v1/loans/${created.body.id}/approve`)
      .set(auth(adminToken))
      .send({})
      .expect(200);
    expect(approved.body.status).toBe('approved');

    const mineAfter = await supertest(app).get('/api/v1/loans/me').set(auth(borrowerToken)).expect(200);
    expect(mineAfter.body.data.find((r) => r.id === created.body.id).status).toBe('approved');

    await supertest(app)
      .post(`/api/v1/loans/${created.body.id}/approve`)
      .set(auth(adminToken))
      .send({})
      .expect(409);
  });

  it('từ chối một đơn khác, người vay thấy đúng trạng thái', async () => {
    const created = await supertest(app)
      .post('/api/v1/loans')
      .set(auth(borrowerToken))
      .send({ amount: 1_000_000, purpose: 'Vay sua xe may di lam hang ngay.' })
      .expect(201);

    const rejected = await supertest(app)
      .post(`/api/v1/loans/${created.body.id}/reject`)
      .set(auth(adminToken))
      .send({ note: 'Chua du ho so, lien he lai sau.' })
      .expect(200);
    expect(rejected.body.status).toBe('rejected');

    const mine = await supertest(app).get('/api/v1/loans/me').set(auth(borrowerToken)).expect(200);
    expect(mine.body.data.find((r) => r.id === created.body.id).status).toBe('rejected');
  });
});
