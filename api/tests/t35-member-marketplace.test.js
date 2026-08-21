import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { resetDb } from './helpers/db.js';
import { buildApp } from '../src/app.js';
import { config } from '../src/config/index.js';

let db, app, cid, areaId, poster, worker, stranger, posterToken, workerToken, strangerToken;
const auth = (token) => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  db = await resetDb();
  app = buildApp();
  const { rows: [community] } = await db.raw(
    `INSERT INTO communities (code, name) VALUES ('t35-market', 'T35 Market') RETURNING id`
  );
  cid = community.id;
  const { rows: [area] } = await db.raw(
    `INSERT INTO areas (community_id, name) VALUES (?, 'Khu vực thử') RETURNING id`, [cid]
  );
  areaId = area.id;
  async function member(name) {
    const { rows: [row] } = await db.raw(
      `INSERT INTO members (community_id, full_name, status, area_id, job)
       VALUES (?, ?, 'member', ?, 'Nghề thử') RETURNING id`, [cid, name, areaId]
    );
    return row.id;
  }
  poster = await member('Người đăng T35');
  worker = await member('Người làm T35');
  stranger = await member('Người lạ T35');
  const token = (id) => jwt.sign({ sub: id, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' });
  posterToken = token(poster); workerToken = token(worker); strangerToken = token(stranger);
});

afterAll(async () => { await db.destroy(); });

describe('T35 thành viên và tuyển dụng dùng chung một tài khoản member', () => {
  let capabilityId;
  let jobId;
  let applicationId;

  it('thành viên sửa hồ sơ thật và luồng xin xem liên hệ chạy đầu-cuối', async () => {
    const profile = await supertest(app).patch('/api/v1/members/me').set(auth(posterToken)).send({
      job: 'Chủ xưởng kiêm người tuyển', bio: 'Vừa là thành viên vừa đăng nhu cầu khi cần.',
      area_id: areaId, phone: '0912345678', work_status: 'available',
    }).expect(200);
    expect(profile.body.job).toBe('Chủ xưởng kiêm người tuyển');
    const mine = await supertest(app).get('/api/v1/members/me').set(auth(posterToken)).expect(200);
    expect(mine.body.area_id).toBe(areaId);
    expect(mine.body.contact_values.phone).toBe('0912345678');

    await supertest(app).patch('/api/v1/members/me/privacy/address').set(auth(posterToken))
      .send({ level: 'public' }).expect(200);
    const privacy = await supertest(app).get('/api/v1/members/me/privacy').set(auth(posterToken)).expect(200);
    expect(privacy.body.data.find((x) => x.field_key === 'address').level).toBe('public');

    await supertest(app).get(`/api/v1/members/${poster}`).set(auth(workerToken)).expect(200);
    const views = await supertest(app).get('/api/v1/members/me/profile-views').set(auth(posterToken)).expect(200);
    expect(views.body.data.some((x) => x.viewer_id === worker)).toBe(true);

    const request = await supertest(app).post(`/api/v1/members/${poster}/contact-requests`)
      .set(auth(workerToken)).send({ field_key: 'phone', message: 'Xin số để trao đổi công việc.' }).expect(201);
    const incoming = await supertest(app).get('/api/v1/members/me/contact-requests?direction=incoming')
      .set(auth(posterToken)).expect(200);
    expect(incoming.body.data.some((x) => x.id === request.body.id)).toBe(true);
    await supertest(app).patch(`/api/v1/members/me/contact-requests/${request.body.id}`)
      .set(auth(posterToken)).send({ status: 'approved' }).expect(200);
    const phone = await supertest(app).get(`/api/v1/members/${poster}/contacts/phone`)
      .set(auth(workerToken)).expect(200);
    expect(phone.body.value).toBe('0912345678');
  });

  it('thành viên thường CRUD năng lực của chính mình, người khác không sửa được', async () => {
    const created = await supertest(app).post('/api/v1/capabilities').set(auth(posterToken)).send({
      title: 'Sửa điện dân dụng', description: 'Nhận sửa điện trong khu vực.',
      category: 'Điện', years_experience: 8, price: 'Khảo sát rồi báo giá',
    }).expect(201);
    capabilityId = created.body.id;
    expect(created.body.member_id).toBe(poster);

    const list = await supertest(app).get('/api/v1/capabilities').set(auth(workerToken)).expect(200);
    expect(list.body.data.some((x) => x.id === capabilityId)).toBe(true);

    await supertest(app).patch(`/api/v1/capabilities/${capabilityId}`).set(auth(strangerToken))
      .send({ title: 'Không được sửa' }).expect(403);
    const updated = await supertest(app).patch(`/api/v1/capabilities/${capabilityId}`).set(auth(posterToken))
      .send({ title: 'Sửa điện và nước dân dụng' }).expect(200);
    expect(updated.body.title).toBe('Sửa điện và nước dân dụng');
  });

  it('cùng tài khoản member đăng nhu cầu và hồ sơ sẵn sàng, không cần role recruiter', async () => {
    const ready = await supertest(app).put('/api/v1/jobs/ready/me').set(auth(workerToken)).send({
      headline: 'Thợ điện đang nhận việc', availability: 'Nhận việc trong tuần',
      area_id: areaId, status: 'ready', note: 'Có đồ nghề',
    }).expect(200);
    expect(ready.body.member_id).toBe(worker);

    const created = await supertest(app).post('/api/v1/jobs').set(auth(posterToken)).send({
      title: 'Cần một thợ điện sửa xưởng', description: 'Kiểm tra và sửa hệ thống điện xưởng nhỏ.',
      terms: 'Thỏa thuận sau khi khảo sát', area_id: areaId, job_type: 'thoi_vu',
    }).expect(201);
    jobId = created.body.id;
    expect(created.body.poster_id).toBe(poster);

    const jobs = await supertest(app).get('/api/v1/jobs').set(auth(workerToken)).expect(200);
    expect(jobs.body.data.some((x) => x.id === jobId)).toBe(true);
  });

  it('không nhận area_id của cộng đồng khác cho tin và hồ sơ sẵn sàng', async () => {
    const { rows: [otherCommunity] } = await db.raw(
      `INSERT INTO communities (code, name) VALUES ('t35-other', 'T35 Other') RETURNING id`
    );
    const { rows: [otherArea] } = await db.raw(
      `INSERT INTO areas (community_id, name) VALUES (?, 'Khu vực ngoài') RETURNING id`, [otherCommunity.id]
    );
    await supertest(app).post('/api/v1/jobs').set(auth(posterToken)).send({
      title: 'Tin dùng khu vực không hợp lệ',
      description: 'Không được phép tham chiếu khu vực của cộng đồng khác.',
      area_id: otherArea.id,
    }).expect(422);
    await supertest(app).put('/api/v1/jobs/ready/me').set(auth(workerToken)).send({
      headline: 'Hồ sơ sai khu vực', area_id: otherArea.id, status: 'ready',
    }).expect(422);
  });

  it('ứng tuyển tạo thông báo tức thì; chủ tin xử lý được và người lạ bị chặn', async () => {
    const applied = await supertest(app).post(`/api/v1/jobs/${jobId}/applications`).set(auth(workerToken))
      .send({ note: 'Tôi có tám năm kinh nghiệm và có thể tới khảo sát ngày mai.' }).expect(201);
    applicationId = applied.body.id;

    await supertest(app).post(`/api/v1/jobs/${jobId}/applications`).set(auth(workerToken))
      .send({ note: 'Không được ứng tuyển hai lần vào cùng một nhu cầu.' }).expect(409);

    const notices = await supertest(app).get('/api/v1/notifications?unread_only=true').set(auth(posterToken)).expect(200);
    expect(notices.body.data.some((x) => x.target_id === jobId)).toBe(true);

    await supertest(app).patch(`/api/v1/jobs/${jobId}/applications/${applicationId}`).set(auth(strangerToken))
      .send({ status: 'agreed' }).expect(403);
    const accepted = await supertest(app).patch(`/api/v1/jobs/${jobId}/applications/${applicationId}`).set(auth(posterToken))
      .send({ status: 'agreed', note: 'Đã trao đổi và thống nhất khảo sát.' }).expect(200);
    expect(accepted.body.status).toBe('agreed');
  });

  it('chủ tin sửa/đóng được; tin có ứng viên không bị xóa làm mất lịch sử', async () => {
    const updated = await supertest(app).patch(`/api/v1/jobs/${jobId}`).set(auth(posterToken))
      .send({ status: 'filled', terms: 'Đã tìm được người phù hợp' }).expect(200);
    expect(updated.body.status).toBe('filled');
    await supertest(app).delete(`/api/v1/jobs/${jobId}`).set(auth(posterToken)).expect(409);

    await supertest(app).delete(`/api/v1/capabilities/${capabilityId}`).set(auth(posterToken)).expect(204);
    await supertest(app).get(`/api/v1/capabilities/${capabilityId}`).set(auth(posterToken)).expect(404);
  });
});
