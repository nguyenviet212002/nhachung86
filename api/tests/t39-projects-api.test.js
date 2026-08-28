import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { resetDb } from './helpers/db.js';
import { buildApp } from '../src/app.js';
import { config } from '../src/config/index.js';

let db, app, communityId, areaId, ownerId, memberId, adminId, projectFileId, ownerToken, memberToken, adminToken;
const auth = (token) => ({ authorization: `Bearer ${token}` });
const token = (id) => jwt.sign({ sub: id, cid: communityId, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' });

beforeAll(async () => {
  db = await resetDb();
  app = buildApp();
  const { rows: [community] } = await db.raw(
    `INSERT INTO communities (code, name) VALUES ('t39-projects', 'T39 Projects') RETURNING id`
  );
  communityId = community.id;
  const { rows: [area] } = await db.raw(
    `INSERT INTO areas (community_id, name) VALUES (?, 'Xa test T39') RETURNING id`,
    [communityId]
  );
  areaId = area.id;
  const { rows: [owner] } = await db.raw(
    `INSERT INTO members (community_id, full_name, status, area_id)
     VALUES (?, 'Nguoi tao T39', 'member', ?) RETURNING id`,
    [communityId, areaId]
  );
  const { rows: [member] } = await db.raw(
    `INSERT INTO members (community_id, full_name, status, area_id)
     VALUES (?, 'Nguoi tham gia T39', 'member', ?) RETURNING id`,
    [communityId, areaId]
  );
  const { rows: [admin] } = await db.raw(
    `INSERT INTO members (community_id, full_name, status, area_id)
     VALUES (?, 'Admin duyet T39', 'member', ?) RETURNING id`,
    [communityId, areaId]
  );
  await db.raw(
    `INSERT INTO member_roles (member_id, role_id, community_id)
     SELECT ?, r.id, ? FROM roles r WHERE r.key = 'approver'`,
    [admin.id, communityId]
  );
  ownerId = owner.id;
  memberId = member.id;
  adminId = admin.id;
  const { rows: [file] } = await db.raw(
    `INSERT INTO files
       (community_id, owner_id, storage_key, mime, source_mime, byte_size, width, height, sha256)
     VALUES (?, ?, 't39/project-image.jpg', 'image/jpeg', 'image/jpeg', 128, 32, 32, ?)
     RETURNING id`,
    [communityId, ownerId, 'a'.repeat(64)]
  );
  projectFileId = file.id;
  ownerToken = token(ownerId);
  memberToken = token(memberId);
  adminToken = token(adminId);
}, 30_000);

afterAll(async () => { await db.destroy(); }, 30_000);

describe('T39 projects API for Viec chung', () => {
  it('forces member-created projects into admin approval queue', async () => {
    const startsAt = new Date(Date.now() + 86400000).toISOString();
    const endsAt = new Date(Date.now() + 90000000).toISOString();
    const created = await supertest(app)
      .post('/api/v1/projects')
      .set(auth(ownerToken))
      .send({
        title: 'Viec chung API T39',
        description: 'Mo ta viec chung du dai de tao duoc tren API.',
        area_id: areaId,
        category: 'Cong dong',
        location: 'Nha van hoa T39',
        image_url: `/files/${projectFileId}`,
        starts_at: startsAt,
        ends_at: endsAt,
        capacity: 2,
      })
      .expect(201);

    expect(created.body.title).toBe('Viec chung API T39');
    expect(created.body.image_url).toBe(`/files/${projectFileId}`);
    expect(created.body.location).toBe('Nha van hoa T39');
    expect(created.body.status).toBe('planned');
    expect(created.body.participant_count).toBe(1);
    expect(created.body.joined).toBe(true);
    expect(created.body.participants).toHaveLength(1);
    expect(created.body.participants[0].role).toBe('organizer');

    const publicList = await supertest(app)
      .get('/api/v1/projects')
      .set(auth(memberToken))
      .expect(200);
    expect(publicList.body.data.map((row) => row.id)).not.toContain(created.body.id);

    const mineList = await supertest(app)
      .get('/api/v1/projects?mine=true')
      .set(auth(ownerToken))
      .expect(200);
    expect(mineList.body.data.map((row) => row.id)).toContain(created.body.id);
    expect(mineList.body.data.find((row) => row.id === created.body.id).status).toBe('planned');

    const pendingForAdmin = await supertest(app)
      .get('/api/v1/projects?status=planned')
      .set(auth(adminToken))
      .expect(200);
    expect(pendingForAdmin.body.data.map((row) => row.id)).toContain(created.body.id);

    await supertest(app)
      .post(`/api/v1/projects/${created.body.id}/join`)
      .set(auth(memberToken))
      .send({})
      .expect(409);
  });

  it('lets admin approve before members can see and join', async () => {
    const startsAt = new Date(Date.now() + 172800000).toISOString();
    const created = await supertest(app)
      .post('/api/v1/projects')
      .set(auth(ownerToken))
      .send({
        title: 'Tham gia API T39',
        description: 'Mo ta viec chung cho thanh vien khac bam tham gia.',
        location: 'San dinh T39',
        starts_at: startsAt,
        capacity: 2,
      })
      .expect(201);

    await supertest(app)
      .patch(`/api/v1/projects/${created.body.id}`)
      .set(auth(ownerToken))
      .send({ status: 'open' })
      .expect(403);

    const approved = await supertest(app)
      .patch(`/api/v1/projects/${created.body.id}`)
      .set(auth(adminToken))
      .send({ status: 'open', title: 'Tham gia API T39 da duyet' })
      .expect(200);
    expect(approved.body.status).toBe('open');
    expect(approved.body.title).toBe('Tham gia API T39 da duyet');

    const listed = await supertest(app)
      .get('/api/v1/projects')
      .set(auth(memberToken))
      .expect(200);
    expect(listed.body.data.map((row) => row.id)).toContain(created.body.id);

    const joined = await supertest(app)
      .post(`/api/v1/projects/${created.body.id}/join`)
      .set(auth(memberToken))
      .send({})
      .expect(200);
    expect(joined.body.joined).toBe(true);
    expect(joined.body.participant_count).toBe(2);
    expect(joined.body.participants.map((row) => row.member_id)).toEqual([ownerId, memberId]);

    const again = await supertest(app)
      .post(`/api/v1/projects/${created.body.id}/join`)
      .set(auth(memberToken))
      .send({})
      .expect(200);
    expect(again.body.participant_count).toBe(2);
  });

  it('lets admin edit and delete projects while regular members cannot', async () => {
    const startsAt = new Date(Date.now() + 259200000).toISOString();
    const created = await supertest(app)
      .post('/api/v1/projects')
      .set(auth(adminToken))
      .send({
        title: 'Xoa sua API T39',
        description: 'Mo ta viec chung de admin sua va xoa tren API.',
        location: 'Nha van hoa de xoa',
        starts_at: startsAt,
        capacity: 5,
        status: 'open',
      })
      .expect(201);
    expect(created.body.status).toBe('open');

    await supertest(app)
      .delete(`/api/v1/projects/${created.body.id}`)
      .set(auth(memberToken))
      .expect(403);

    const updated = await supertest(app)
      .patch(`/api/v1/projects/${created.body.id}`)
      .set(auth(adminToken))
      .send({ location: 'San van dong T39', capacity: 8, status: 'running' })
      .expect(200);
    expect(updated.body.location).toBe('San van dong T39');
    expect(updated.body.capacity).toBe(8);
    expect(updated.body.status).toBe('running');

    await supertest(app)
      .delete(`/api/v1/projects/${created.body.id}`)
      .set(auth(adminToken))
      .expect(204);

    await supertest(app)
      .get(`/api/v1/projects/${created.body.id}`)
      .set(auth(adminToken))
      .expect(404);
  });
});
