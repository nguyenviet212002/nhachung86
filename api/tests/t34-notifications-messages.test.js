import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { resetDb } from './helpers/db.js';
import { buildApp } from '../src/app.js';
import { config } from '../src/config/index.js';
import { subscribeMember, publishToMember } from '../src/core/realtime.js';

let db, app, cid, alice, bob, outsider, aliceToken, bobToken;
const auth = (token) => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  db = await resetDb();
  app = buildApp();
  const community = await db.raw(
    `INSERT INTO communities (code, name) VALUES ('t34-notify', 'T34 Notify') RETURNING id`
  );
  cid = community.rows[0].id;
  async function member(name, community = cid) {
    const { rows: [row] } = await db.raw(
      `INSERT INTO members (community_id, full_name, status) VALUES (?, ?, 'member') RETURNING id`,
      [community, name]
    );
    return row.id;
  }
  alice = await member('Alice T34');
  bob = await member('Bob T34');
  const { rows: [other] } = await db.raw(
    `INSERT INTO communities (code, name) VALUES ('t34-other', 'T34 Other') RETURNING id`
  );
  outsider = await member('Outsider T34', other.id);
  const token = (id, community = cid) => jwt.sign({ sub: id, cid: community, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' });
  aliceToken = token(alice);
  bobToken = token(bob);
});

afterAll(async () => { await db.destroy(); });

describe('T34 notifications and direct messages', () => {
  it('gửi tin nhắn tạo notification cùng lúc và người nhận đọc được realtime contract', async () => {
    const sent = await supertest(app).post('/api/v1/messages').set(auth(aliceToken)).send({
      recipient_id: bob, body: 'Chào Bob từ T34',
    }).expect(201);
    expect(sent.body.sender_id).toBe(alice);
    expect(sent.body.recipient_id).toBe(bob);

    const notices = await supertest(app).get('/api/v1/notifications?unread_only=true').set(auth(bobToken)).expect(200);
    expect(notices.body.data).toHaveLength(1);
    expect(notices.body.data[0].kind).toBe('message');

    const messages = await supertest(app).get(`/api/v1/messages?with_member_id=${alice}&limit=10`).set(auth(bobToken)).expect(200);
    expect(messages.body.data.at(-1).body).toBe('Chào Bob từ T34');
    const read = await supertest(app).post(`/api/v1/notifications/${notices.body.data[0].id}/read`).set(auth(bobToken)).expect(200);
    expect(read.body.read_at).toBeTruthy();
  });

  it('không gửi được qua cộng đồng khác và endpoint notification ghi target an toàn', async () => {
    await supertest(app).post('/api/v1/messages').set(auth(aliceToken)).send({ recipient_id: outsider, body: 'không được' }).expect(404);
    const created = await supertest(app).post('/api/v1/notifications').set(auth(aliceToken)).send({
      recipient_id: bob, kind: 'activity', title: 'Hoạt động mới', body: 'Có người vừa đăng hoạt động.', target_type: 'activity',
    }).expect(201);
    expect(created.body.recipient_id).toBe(bob);
    const count = await supertest(app).get('/api/v1/notifications/unread-count').set(auth(bobToken)).expect(200);
    expect(count.body.count).toBe(1);
  });

  it('fan-out realtime gửi đúng payload tới các kết nối của thành viên', () => {
    const chunks = [];
    const response = { write: (chunk) => chunks.push(chunk) };
    const unsubscribe = subscribeMember(bob, response);
    publishToMember(bob, 'notification', { id: 'n1', body: 'ting' });
    unsubscribe();
    expect(chunks.join('')).toContain('event: notification');
    expect(chunks.join('')).toContain('"body":"ting"');
  });
});
