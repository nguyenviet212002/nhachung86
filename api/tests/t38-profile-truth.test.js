import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { resetDb } from './helpers/db.js';
import { buildApp } from '../src/app.js';
import { config } from '../src/config/index.js';

let db, app, cid, areaId, inviterId, memberId, viewerId, inviterToken, memberToken, viewerToken, inviteId;
const auth = (token) => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  db = await resetDb();
  app = buildApp();
  const { rows: [community] } = await db.raw(
    `INSERT INTO communities (code, name) VALUES ('t38-profile', 'T38 Profile') RETURNING id`
  );
  cid = community.id;
  const { rows: [area] } = await db.raw(
    `INSERT INTO areas (community_id, name) VALUES (?, 'Khu vực T38') RETURNING id`, [cid]
  );
  areaId = area.id;
  const { rows: [inviter] } = await db.raw(
    `INSERT INTO members (community_id, full_name, status, joined_at)
     VALUES (?, 'Người gửi link T38', 'member', now()) RETURNING id`, [cid]
  );
  inviterId = inviter.id;
  const { rows: [member] } = await db.raw(
    `INSERT INTO members
       (community_id, full_name, status, referrer_id, area_id, job, bio, work_status)
     VALUES (?, 'Thành viên hồ sơ T38', 'guest', ?, ?, 'Thợ điện',
             'Nhận sửa điện dân dụng và hệ thống điện xưởng.', 'paused') RETURNING id`,
    [cid, inviterId, areaId]
  );
  memberId = member.id;
  const { rows: [viewer] } = await db.raw(
    `INSERT INTO members (community_id, full_name, status, joined_at)
     VALUES (?, 'Người xem T38', 'member', now()) RETURNING id`, [cid]
  );
  viewerId = viewer.id;

  const { rows: [request] } = await db.raw(
    `INSERT INTO join_requests
       (community_id, applicant_data, referrer_id, member_id, step, status, approved_by)
     VALUES (?, '{}'::jsonb, ?, ?, 2, 'approved', ?) RETURNING id`,
    [cid, inviterId, memberId, inviterId]
  );
  const note = 'Tôi đã làm việc cùng người này nhiều năm và trực tiếp gửi lời mời.';
  const { rows: [invite] } = await db.raw(
    `INSERT INTO guarantee_invites
       (community_id, referrer_id, token_hash, created_by, inviter_note,
        used_at, used_by_join_request)
     VALUES (?, ?, ?, ?, ?, now(), ?) RETURNING id`,
    [cid, inviterId, 'a'.repeat(64), inviterId, note, request.id]
  );
  inviteId = invite.id;
  await db.raw(
    `UPDATE members SET status = 'member', joined_at = now() WHERE id = ?`, [memberId]
  );

  await db.raw(
    `INSERT INTO capabilities
       (community_id, member_id, title, description, category, years_experience)
     VALUES (?, ?, 'Sửa điện xưởng', 'Khảo sát và sửa hệ thống điện xưởng.', 'Điện', 9)`,
    [cid, memberId]
  );
  await db.raw(
    `INSERT INTO ready_profiles
       (member_id, community_id, headline, availability, area_id, status)
     VALUES (?, ?, 'Thợ điện đang nhận việc', 'Trong tuần', ?, 'ready')`,
    [memberId, cid, areaId]
  );
  const { rows: [job] } = await db.raw(
    `INSERT INTO job_needs
       (community_id, poster_id, title, description, area_id, status)
     VALUES (?, ?, 'Sửa điện nhà xưởng T38', 'Công việc thật dùng kiểm tra hồ sơ.', ?, 'filled')
     RETURNING id`,
    [cid, inviterId, areaId]
  );
  await db.raw(
    `INSERT INTO connections
       (community_id, job_need_id, poster_id, worker_id, status)
     VALUES (?, ?, ?, ?, 'working')`,
    [cid, job.id, inviterId, memberId]
  );
  const { rows: [activity] } = await db.raw(
    `INSERT INTO activities
       (community_id, title, status, created_by)
     VALUES (?, 'Hoạt động T38', 'open', ?) RETURNING id`,
    [cid, inviterId]
  );
  await db.raw(
    `INSERT INTO activity_participants (community_id, activity_id, member_id)
     VALUES (?, ?, ?)`, [cid, activity.id, memberId]
  );

  const token = (id) => jwt.sign({ sub: id, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' });
  inviterToken = token(inviterId);
  memberToken = token(memberId);
  viewerToken = token(viewerId);
});

afterAll(async () => { await db.destroy(); });

describe('T38 hồ sơ chỉ hiển thị dữ liệu thật từ API', () => {
  it('không phát link mời mới nếu người gửi chưa viết ghi chú thật', async () => {
    const missing = await supertest(app)
      .post('/api/v1/guarantee-invites')
      .set(auth(inviterToken))
      .send({})
      .expect(400);
    expect(missing.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('trả ghi chú của đúng link mời, năng lực, trạng thái theo kết nối và lịch sử thật', async () => {
    const response = await supertest(app)
      .get(`/api/v1/members/${memberId}`)
      .set(auth(viewerToken))
      .expect(200);

    expect(response.body.referrer).toMatchObject({
      id: inviterId,
      full_name: 'Người gửi link T38',
      inviter_note: 'Tôi đã làm việc cùng người này nhiều năm và trực tiếp gửi lời mời.',
      note_author_id: inviterId,
      note_author_name: 'Người gửi link T38',
    });
    expect(response.body.capabilities).toEqual([
      expect.objectContaining({ title: 'Sửa điện xưởng', category: 'Điện', years_experience: 9 }),
    ]);
    expect(response.body.work_summary).toMatchObject({
      status: 'working', source: 'connection', role: 'worker', job_title: 'Sửa điện nhà xưởng T38',
    });
    expect(response.body.participation_history.map((row) => row.kind)).toEqual(
      expect.arrayContaining(['joined', 'capability', 'activity', 'job_connection'])
    );
  });

  it('ghi chú link mời đã phát là bất biến', async () => {
    await expect(
      db.raw(`UPDATE guarantee_invites SET inviter_note = 'Một ghi chú khác không được phép' WHERE id = ?`, [inviteId])
    ).rejects.toThrow(/INVITE_FROZEN/);
  });

  it('avatar chỉ nhận file ảnh đại diện của chính chủ và còn nguyên khi đọc lại hồ sơ', async () => {
    const { rows: [file] } = await db.raw(
      `INSERT INTO files
        (community_id, owner_id, storage_key, mime, source_mime, byte_size,
         width, height, sha256, attached_type, attached_id)
       VALUES (?, ?, 't38/avatar.jpg', 'image/jpeg', 'image/jpeg', 100,
               20, 20, ?, 'member_avatar', ?) RETURNING id`,
      [cid, memberId, 'b'.repeat(64), memberId]
    );
    const avatarUrl = `/files/${file.id}`;
    await supertest(app).patch('/api/v1/members/me').set(auth(memberToken))
      .send({ avatar_url: avatarUrl }).expect(200);
    const reloaded = await supertest(app).get('/api/v1/members/me').set(auth(memberToken)).expect(200);
    expect(reloaded.body.avatar_url).toBe(avatarUrl);

    await supertest(app).patch('/api/v1/members/me').set(auth(memberToken))
      .send({ avatar_url: 'https://example.invalid/fake.jpg' }).expect(422);
  });
});
