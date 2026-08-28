import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { resetDb } from './helpers/db.js';
import { buildApp } from '../src/app.js';
import { config } from '../src/config/index.js';

let db, app, cid, areaId, poster, introducer, candidate, posterToken, introducerToken, candidateToken;
const auth = (token) => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  db = await resetDb();
  app = buildApp();
  const { rows: [community] } = await db.raw(
    `INSERT INTO communities (code, name) VALUES ('t39-distribution', 'T39 Distribution') RETURNING id`
  );
  cid = community.id;
  const { rows: [area] } = await db.raw(
    `INSERT INTO areas (community_id, name) VALUES (?, 'Khu vực T39') RETURNING id`, [cid]
  );
  areaId = area.id;
  async function member(name) {
    const { rows: [row] } = await db.raw(
      `INSERT INTO members (community_id, full_name, status, area_id, job)
       VALUES (?, ?, 'member', ?, 'Nghề T39') RETURNING id`, [cid, name, areaId]
    );
    return row.id;
  }
  poster = await member('Người đăng T39');
  introducer = await member('Người giới thiệu T39');
  candidate = await member('Người nhận T39');
  const token = (id) => jwt.sign({ sub: id, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' });
  posterToken = token(poster);
  introducerToken = token(introducer);
  candidateToken = token(candidate);
});

afterAll(async () => { await db.destroy(); });

describe('T39 hợp nhất phát việc, giới thiệu và theo dõi', () => {
  it('ghi nhận đủ ba vai rồi chuyển lời giới thiệu thành kết nối việc làm', async () => {
    const job = await supertest(app).post('/api/v1/jobs').set(auth(posterToken)).send({
      title: 'Cần người nhận việc T39',
      description: 'Việc cần người phù hợp trong khu vực và có thể bắt đầu sớm.',
      area_id: areaId,
      allow_introductions: true,
    }).expect(201);

    const introduction = await supertest(app).post(`/api/v1/jobs/${job.body.id}/introductions`)
      .set(auth(introducerToken)).send({ candidate_id: candidate, note: 'Tôi đã từng làm cùng người này và biết họ phù hợp.' }).expect(201);
    expect(introduction.body.introducer_id).toBe(introducer);
    expect(introduction.body.candidate_id).toBe(candidate);

    const candidateDecision = await supertest(app).patch(`/api/v1/jobs/${job.body.id}/introductions/${introduction.body.id}`)
      .set(auth(candidateToken)).send({ consent: true }).expect(200);
    expect(candidateDecision.body.connection_id).toBeNull();

    const posterDecision = await supertest(app).patch(`/api/v1/jobs/${job.body.id}/introductions/${introduction.body.id}`)
      .set(auth(posterToken)).send({ consent: true }).expect(200);
    expect(posterDecision.body.connection_id).toBeTruthy();
    expect(posterDecision.body.connection_status).toBe('contacted');

    const workerStarted = await supertest(app).patch(`/api/v1/jobs/${job.body.id}/applications/${posterDecision.body.connection_id}`)
      .set(auth(candidateToken)).send({ status: 'working', note: 'Toi da nhan viec va bat dau thuc hien.' }).expect(422);
    expect(workerStarted.body.error?.code).toBe('INVALID_STATE');

    await supertest(app).patch(`/api/v1/jobs/${job.body.id}/applications/${posterDecision.body.connection_id}`)
      .set(auth(posterToken)).send({ status: 'agreed' }).expect(200);
    const workerWorking = await supertest(app).patch(`/api/v1/jobs/${job.body.id}/applications/${posterDecision.body.connection_id}`)
      .set(auth(candidateToken)).send({ status: 'working', note: 'Toi da nhan viec va bat dau thuc hien.' }).expect(200);
    expect(workerWorking.body.status).toBe('working');
    const workerDone = await supertest(app).patch(`/api/v1/jobs/${job.body.id}/applications/${posterDecision.body.connection_id}`)
      .set(auth(candidateToken)).send({ status: 'done', note: 'Toi da hoan tat cong viec.' }).expect(200);
    expect(workerDone.body.status).toBe('done');
    const { rows: [workerNotification] } = await db.raw(
      `SELECT recipient_id, actor_id FROM notifications WHERE target_id = ? ORDER BY created_at DESC LIMIT 1`,
      [job.body.id]
    );
    expect(workerNotification).toMatchObject({ recipient_id: poster, actor_id: candidate });

    const detail = await supertest(app).get(`/api/v1/jobs/${job.body.id}`).set(auth(posterToken)).expect(200);
    expect(detail.body.introductions).toHaveLength(1);
    expect(detail.body.introductions[0]).toMatchObject({
      introducer_id: introducer,
      candidate_id: candidate,
      consent_introducer: true,
      consent_candidate: true,
      consent_poster: true,
    });
    expect(detail.body.applications).toHaveLength(1);
    expect(detail.body.applications[0]).toMatchObject({ worker_id: candidate, status: 'done' });

    const connections = await supertest(app).get('/api/v1/jobs/connections').set(auth(posterToken)).expect(200);
    expect(connections.body.data[0]).toMatchObject({
      job_need_id: job.body.id,
      poster_id: poster,
      worker_id: candidate,
      introduction_id: introduction.body.id,
    });
  });
});
