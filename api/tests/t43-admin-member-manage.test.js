import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { resetDb } from './helpers/db.js';
import { buildApp } from '../src/app.js';
import { config } from '../src/config/index.js';

let db, app, cid, approverId, memberId, approverToken, memberToken;
const auth = (token) => ({ authorization: `Bearer ${token}` });

async function grantRole(memberId_, key, communityId) {
  await db.raw(
    `INSERT INTO member_roles (member_id, role_id, community_id)
     SELECT ?, r.id, ? FROM roles r WHERE r.key = ?`, [memberId_, communityId, key]);
}

beforeAll(async () => {
  db = await resetDb();
  app = buildApp();
  const { rows: [community] } = await db.raw(
    `INSERT INTO communities (code, name) VALUES ('t43-admin-member', 'T43 Admin Member') RETURNING id`
  );
  cid = community.id;
  const { rows: [approver] } = await db.raw(
    `INSERT INTO members (community_id, full_name, status, joined_at)
     VALUES (?, 'Người duyệt T43', 'member', now()) RETURNING id`, [cid]
  );
  approverId = approver.id;
  await grantRole(approverId, 'approver', cid);
  const { rows: [member] } = await db.raw(
    `INSERT INTO members (community_id, full_name, status, joined_at)
     VALUES (?, 'Thành viên thường T43', 'member', now()) RETURNING id`, [cid]
  );
  memberId = member.id;

  const token = (id) => jwt.sign({ sub: id, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' });
  approverToken = token(approverId);
  memberToken = token(memberId);
});

afterAll(async () => { await db.destroy(); });

describe('T43 admin tạo thành viên (POST /members)', () => {
  it('approver tạo được thành viên mới; hộp liên hệ/mức riêng tư mặc định đúng', async () => {
    const res = await supertest(app)
      .post('/api/v1/members')
      .set(auth(approverToken))
      .send({ full_name: 'Người mới T43', job: 'Thợ mộc', phone: '0987000111' })
      .expect(201);
    expect(res.body.full_name).toBe('Người mới T43');
    expect(res.body.job).toBe('Thợ mộc');

    const detail = await supertest(app)
      .get(`/api/v1/members/${res.body.id}`)
      .set(auth(approverToken))
      .expect(200);
    // approver không phải chính chủ, chưa "xin xem" — mặc định phone là
    // on_consent (fn_member_bootstrap), nên state phải là can_request chứ
    // không phải visible dù chính admin vừa ghi giá trị này vào.
    expect(detail.body.contacts.phone.state).toBe('can_request');
  });

  it('member thường (không có vai approver) bị chặn 403', async () => {
    const res = await supertest(app)
      .post('/api/v1/members')
      .set(auth(memberToken))
      .send({ full_name: 'Không được tạo' })
      .expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('thiếu họ tên thì bị từ chối 400', async () => {
    const res = await supertest(app)
      .post('/api/v1/members')
      .set(auth(approverToken))
      .send({ job: 'Không có tên' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('T43 admin xoá thành viên (DELETE /members/:id)', () => {
  it('approver xoá được một thành viên; người bị xoá mất quyền truy cập ngay', async () => {
    const { rows: [target] } = await db.raw(
      `INSERT INTO members (community_id, full_name, status, joined_at)
       VALUES (?, 'Sắp bị xoá T43', 'member', now()) RETURNING id`, [cid]
    );
    const targetToken = jwt.sign({ sub: target.id, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' });

    await supertest(app).get('/api/v1/members/me').set(auth(targetToken)).expect(200);

    const res = await supertest(app)
      .delete(`/api/v1/members/${target.id}`)
      .set(auth(approverToken))
      .expect(200);
    expect(res.body.id).toBe(target.id);

    const { rows: [row] } = await db.raw(`SELECT status FROM members WHERE id = ?`, [target.id]);
    expect(row.status).toBe('left');

    await supertest(app).get('/api/v1/members/me').set(auth(targetToken)).expect(401);
  });

  it('member thường (không có vai approver) bị chặn 403', async () => {
    const res = await supertest(app)
      .delete(`/api/v1/members/${memberId}`)
      .set(auth(memberToken))
      .expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('không tự xoá được chính mình', async () => {
    const res = await supertest(app)
      .delete(`/api/v1/members/${approverId}`)
      .set(auth(approverToken))
      .expect(422);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('xoá người đã left từ trước hoặc id không tồn tại thì báo 404', async () => {
    const { rows: [already] } = await db.raw(
      `INSERT INTO members (community_id, full_name, status, joined_at)
       VALUES (?, 'Đã rời từ trước T43', 'left', now()) RETURNING id`, [cid]
    );
    const res = await supertest(app)
      .delete(`/api/v1/members/${already.id}`)
      .set(auth(approverToken))
      .expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');

    await supertest(app)
      .delete(`/api/v1/members/00000000-0000-4000-8000-000000000000`)
      .set(auth(approverToken))
      .expect(404);
  });
});
