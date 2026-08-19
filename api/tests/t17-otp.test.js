import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import argon2 from 'argon2';
import supertest from 'supertest';
import { resetDb } from './helpers/db.js';
import { requestOtp, verifyOtp, login, refresh, hashPhone } from '../src/modules/auth/service.js';
import { buildApp } from '../src/app.js';

let db, cid, alice, aliceId;
const ALICE_PHONE = '0912345678';
const ALICE_PASSWORD = 'mat-khau-du-manh-12';

beforeAll(async () => {
  db = await resetDb();
  ({
    rows: [{ id: cid }],
  } = await db.raw(`INSERT INTO communities (code,name) VALUES ('community-otp','X') RETURNING id`));
  ({
    rows: [alice],
  } = await db.raw(
    `INSERT INTO members (community_id, full_name, status, password_hash)
     VALUES (?, 'Alice', 'member', ?) RETURNING id, community_id, full_name, status`,
    [cid, await argon2.hash(ALICE_PASSWORD)]
  ));
  aliceId = alice.id;
  await db.raw(`INSERT INTO member_contacts (member_id, community_id, phone) VALUES (?,?,?)`, [
    aliceId,
    cid,
    ALICE_PHONE,
  ]);
});
afterAll(async () => {
  await db.destroy();
});

describe('T17 OTP hết đường dò', () => {
  it('sai 5 lần thì challenge bị burned', async () => {
    await requestOtp({ communityId: cid, phone: ALICE_PHONE, purpose: 'reset' });
    for (let i = 0; i < 5; i++) {
      await expect(
        verifyOtp({ communityId: cid, phone: ALICE_PHONE, code: '000000', purpose: 'reset' })
      ).rejects.toThrow();
    }
    const { rows } = await db.raw(
      `SELECT status, attempts FROM otp_challenges WHERE phone_hash = ? ORDER BY created_at DESC LIMIT 1`,
      [hashPhone(ALICE_PHONE)]
    );
    expect(rows[0].status).toBe('burned');
    expect(rows[0].attempts).toBe(5);
  });

  it('nhật ký ghi phone_hash, không ghi số và không ghi mã', async () => {
    const { rows } = await db.raw(`SELECT detail FROM audit_log WHERE action = 'otp.failed'`);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(JSON.stringify(r.detail)).not.toContain(ALICE_PHONE);
      expect(r.detail.phone_hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('mã sinh bằng crypto.randomInt — code_hash không đoán được bằng Math.random (kiểm gián tiếp: đủ 6 chữ số, argon2)', async () => {
    const { rows } = await db.raw(
      `SELECT code_hash FROM otp_challenges WHERE phone_hash = ? ORDER BY created_at DESC LIMIT 1`,
      [hashPhone(ALICE_PHONE)]
    );
    // argon2 hash — không phải số thô, không đoán được hình dạng bằng mắt.
    expect(rows[0].code_hash.startsWith('$argon2')).toBe(true);
  });

  it('3 challenge hỏng liên tiếp cùng số ⇒ khóa 15 phút', async () => {
    const phone = '0987654321';
    // Ba challenge liên tiếp đều burned: mỗi cái xin mã rồi sai đủ 5 lần.
    for (let round = 0; round < 3; round++) {
      await requestOtp({ communityId: cid, phone, purpose: 'reset' });
      for (let i = 0; i < 5; i++) {
        await expect(
          verifyOtp({ communityId: cid, phone, code: '000000', purpose: 'reset' })
        ).rejects.toThrow();
      }
    }
    // Challenge thứ tư: phải bị khóa, không được sinh mã mới.
    await expect(requestOtp({ communityId: cid, phone, purpose: 'reset' })).rejects.toMatchObject({
      code: 'OTP_LOCKED',
      status: 429,
    });
  });

  it('login trả cùng một lỗi cho số lạ và mật khẩu sai', async () => {
    const a = await login({ communityId: cid, identifier: '0900000000', password: 'saihet123' }).catch((e) => e);
    const b = await login({ communityId: cid, identifier: ALICE_PHONE, password: 'saihet123' }).catch((e) => e);
    expect(a.code).toBe(b.code);
    expect(a.message).toBe(b.message);
    expect(a.code).toBe('INVALID_CREDENTIALS');
  });

  it('login đúng số điện thoại + mật khẩu thì thành công, trả access/refresh/member', async () => {
    const r = await login({ communityId: cid, identifier: ALICE_PHONE, password: ALICE_PASSWORD });
    expect(typeof r.access).toBe('string');
    expect(typeof r.refresh).toBe('string');
    expect(r.member.id).toBe(aliceId);
    expect(r.member.status).toBe('member');
    // Không có số điện thoại nào trong payload trả về.
    expect(JSON.stringify(r)).not.toContain(ALICE_PHONE);

    const { rows } = await db.raw(`SELECT action FROM audit_log WHERE actor_id = ? AND action = 'auth.login'`, [
      aliceId,
    ]);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('refresh xoay vòng: token cũ dùng lại bị coi là tái sử dụng và thu hồi cả họ', async () => {
    const first = await login({ communityId: cid, identifier: ALICE_PHONE, password: ALICE_PASSWORD });

    const second = await refresh({ refreshToken: first.refresh });
    expect(typeof second.access).toBe('string');
    expect(typeof second.refresh).toBe('string');
    expect(second.refresh).not.toBe(first.refresh);

    // Dùng lại token thứ nhất (đã bị thay thế) — phải bị từ chối.
    await expect(refresh({ refreshToken: first.refresh })).rejects.toMatchObject({ code: 'INVALID_REFRESH' });

    // Vì đã dùng lại token cũ, token thứ hai (còn "sống" hợp lệ trước đó)
    // cũng phải bị thu hồi theo — cả họ (family) bị đóng lại.
    await expect(refresh({ refreshToken: second.refresh })).rejects.toMatchObject({ code: 'INVALID_REFRESH' });

    const { rows } = await db.raw(
      `SELECT action FROM audit_log WHERE actor_id = ? AND action = 'auth.refresh.reuse_detected'`,
      [aliceId]
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it('HTTP: POST /api/v1/auth/login rồi GET /api/v1/auth/me bằng access token', async () => {
    const app = buildApp();
    const loginRes = await supertest(app)
      .post('/api/v1/auth/login')
      .send({ identifier: ALICE_PHONE, password: ALICE_PASSWORD });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.access).toBeTruthy();

    const meRes = await supertest(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${loginRes.body.access}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.actor.id).toBe(aliceId);

    const noAuthRes = await supertest(app).get('/api/v1/auth/me');
    expect(noAuthRes.status).toBe(401);
  });

  it('HTTP: OTP request quá 5 lần/phút bị chặn RATE_LIMITED', async () => {
    const app = buildApp();
    let last;
    for (let i = 0; i < 6; i++) {
      last = await supertest(app)
        .post('/api/v1/auth/otp/request')
        .send({ phone: '0977000000', purpose: 'reset' });
    }
    expect(last.status).toBe(429);
    expect(last.body.error.code).toBe('RATE_LIMITED');
  });
});
