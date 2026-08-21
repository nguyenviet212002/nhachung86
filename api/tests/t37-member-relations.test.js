import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { resetDb } from './helpers/db.js';
import { buildApp } from '../src/app.js';
import { config } from '../src/config/index.js';

let db, app, communityId, actorId, inviterId, inviteeId, coworkerId, actorToken;
const auth = (token) => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  db = await resetDb();
  app = buildApp();
  const { rows: [community] } = await db.raw(
    `INSERT INTO communities (code, name) VALUES ('t37-relations', 'T37 Relations') RETURNING id`
  );
  communityId = community.id;

  async function member(fullName) {
    const { rows: [row] } = await db.raw(
      `INSERT INTO members (community_id, full_name, status, job)
       VALUES (?, ?, 'member', 'Nghề kiểm thử') RETURNING id`,
      [communityId, fullName]
    );
    return row.id;
  }

  inviterId = await member('Người đã mời T37');
  actorId = await member('Tôi T37');
  inviteeId = await member('Người tôi mời T37');
  coworkerId = await member('Bạn cùng làm T37');
  await db.raw(
    `INSERT INTO member_relations (community_id, kind, member_a, member_b)
     VALUES (?, 'guarantee', ?, ?), (?, 'guarantee', ?, ?)`,
    [communityId, inviterId, actorId, communityId, actorId, inviteeId]
  );
  const [memberA, memberB] = [actorId, coworkerId].sort();
  const { rows: [work] } = await db.raw(
    `INSERT INTO work_records (community_id, source_type, title, done_on, created_by)
     VALUES (?, 'manual', 'Việc chung T37', CURRENT_DATE, ?) RETURNING id`,
    [communityId, actorId]
  );
  await db.raw(
    `INSERT INTO member_relations
       (community_id, kind, member_a, member_b, first_work_record_id)
     VALUES (?, 'worked_together', ?, ?, ?)`,
    [communityId, memberA, memberB, work.id]
  );

  actorToken = jwt.sign(
    { sub: actorId, cid: communityId, typ: 'access' },
    config.JWT_SECRET,
    { expiresIn: '15m' }
  );
});

afterAll(async () => { await db.destroy(); });

describe('T37 quan hệ thật của thành viên', () => {
  it('trả đúng chiều người mời, người được mời và người đã cùng làm', async () => {
    const response = await supertest(app)
      .get('/api/v1/members/me/relations')
      .set(auth(actorToken))
      .expect(200);

    expect(response.body.invited_by.map((x) => x.member.id)).toEqual([inviterId]);
    expect(response.body.invited_by[0].member.full_name).toBe('Người đã mời T37');
    expect(response.body.invited_members.map((x) => x.member.id)).toEqual([inviteeId]);
    expect(response.body.invited_members[0].member.full_name).toBe('Người tôi mời T37');
    expect(response.body.worked_together.map((x) => x.member.id)).toEqual([coworkerId]);
    expect(response.body.worked_together[0].first_work_title).toBe('Việc chung T37');
  });

  it('chỉ đọc cạnh trong cộng đồng của token và ghi đúng một dấu audit', async () => {
    const { rows: [otherCommunity] } = await db.raw(
      `INSERT INTO communities (code, name) VALUES ('t37-other', 'T37 Other') RETURNING id`
    );
    const { rows: [otherMember] } = await db.raw(
      `INSERT INTO members (community_id, full_name, status)
       VALUES (?, 'Không được lộ T37', 'member') RETURNING id`,
      [otherCommunity.id]
    );

    const response = await supertest(app)
      .get('/api/v1/members/me/relations')
      .set(auth(actorToken))
      .expect(200);
    const allIds = [
      ...response.body.invited_by,
      ...response.body.invited_members,
      ...response.body.worked_together,
    ].map((x) => x.member.id);
    expect(allIds).not.toContain(otherMember.id);

    const { rows: [audit] } = await db.raw(
      `SELECT count(*)::int AS n FROM audit_log
       WHERE community_id = ? AND actor_id = ? AND action = 'member_relations.list'`,
      [communityId, actorId]
    );
    expect(audit.n).toBeGreaterThanOrEqual(1);
  });
});
