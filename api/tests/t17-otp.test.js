import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import argon2 from 'argon2';
import supertest from 'supertest';
import { resetDb } from './helpers/db.js';
import { requestOtp, verifyOtp, login, refresh, hashPhone } from '../src/modules/auth/service.js';
import { buildApp } from '../src/app.js';
import { consoleAdapter } from '../src/core/otp/console.js';

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

  // Soát xét vòng 1 (Minor nhưng phải sửa): bài trước tên là "mã sinh bằng
  // crypto.randomInt..." nhưng assertion thật chỉ nhìn code_hash — sẽ xanh y
  // hệt nếu newCode() đổi sang Math.random(). Đổi tên cho khớp đúng thứ nó
  // kiểm (chỉ argon2, không kiểm nguồn ngẫu nhiên).
  //
  // Việc canh "crypto.randomInt, KHÔNG PHẢI Math.random" hiện dựa vào SOÁT
  // MÃ (xem comment ngay tại newCode() trong modules/auth/service.js), không
  // phải bài test tự động — nói thẳng ra còn hơn một cái tên hứa hão. Lý do
  // không viết test thống kê để "chứng minh" CSPRNG: một bài kiểm phân bố
  // (đủ dải, không trùng nhiều) không phân biệt được crypto.randomInt với
  // Math.random(), vì Math.random() cũng phân bố xấp xỉ đều trên nhiều mẫu —
  // cái Math.random() thiếu là tính KHÔNG DÒ ĐƯỢC trạng thái nội bộ, một
  // thuộc tính không quan sát được chỉ từ các giá trị đầu ra bên ngoài.
  it('mã OTP được băm bằng argon2 trước khi lưu — không lưu mã thô trong otp_challenges', async () => {
    const { rows } = await db.raw(
      `SELECT code_hash FROM otp_challenges WHERE phone_hash = ? ORDER BY created_at DESC LIMIT 1`,
      [hashPhone(ALICE_PHONE)]
    );
    expect(rows[0].code_hash.startsWith('$argon2')).toBe(true);
    expect(rows[0].code_hash).not.toMatch(/^\d{6}$/);
  });

  // Đây LÀ một thuộc tính kiểm được thật: mã luôn đúng 6 ký tự số, kể cả khi
  // giá trị ngẫu nhiên nhỏ hơn 100000 (có số 0 đứng đầu) — hồi quy cho lỗi
  // quên padStart()/String() sẽ làm lộ mã ngắn hơn 6 ký tự, dễ đoán hơn.
  it('mã OTP luôn đủ 6 chữ số, kể cả khi có số 0 đứng đầu', async () => {
    const seen = [];
    const spy = vi.spyOn(consoleAdapter, 'send').mockImplementation(async ({ code }) => {
      seen.push(code);
    });
    try {
      for (let i = 0; i < 50; i++) {
        await requestOtp({ communityId: cid, phone: '0966000000', purpose: 'reset' });
      }
    } finally {
      spy.mockRestore();
    }
    expect(seen).toHaveLength(50);
    for (const code of seen) {
      expect(code).toMatch(/^\d{6}$/);
    }
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

// Soát xét vòng 1 (Important): bốn câu truy vấn OTP trong requestOtp/verifyOtp
// từng chỉ lọc bằng phone_hash (+purpose), không có community_id — dù bảng
// otp_challenges có cột community_id NOT NULL và cả hai hàm đã nhận sẵn tham
// số communityId. Số điện thoại không phải định danh duy nhất toàn cục: hai
// cộng đồng khác nhau hoàn toàn có thể trùng số. Không lọc theo community_id
// nghĩa là challenge của cộng đồng A có thể bị verifyOtp của cộng đồng B so
// khớp/tiêu thụ, và 3 lần dò hỏng ở B khóa luôn số đó ở A — một cộng đồng gây
// từ chối dịch vụ cho cộng đồng khác. Đã thêm "AND community_id = ?" vào cả
// bốn câu; hai bài dưới đây khẳng định cách ly thật, không chỉ đọc code.
describe('T17 cách ly OTP theo community_id giữa hai cộng đồng', () => {
  let cidA, cidB;

  beforeAll(async () => {
    ({
      rows: [{ id: cidA }],
    } = await db.raw(`INSERT INTO communities (code,name) VALUES ('community-iso-a','A') RETURNING id`));
    ({
      rows: [{ id: cidB }],
    } = await db.raw(`INSERT INTO communities (code,name) VALUES ('community-iso-b','B') RETURNING id`));
  });

  it('verifyOtp ở cộng đồng B không tiêu thụ được challenge do cộng đồng A tạo, dù cùng số điện thoại', async () => {
    const SHARED_PHONE = '0933000000'; // trùng ở cả hai cộng đồng, có chủ đích

    // Mã đã bị argon2 băm trong CSDL, không đảo ngược được — bắt giá trị
    // thật qua spy lên consoleAdapter.send() thay vì đọc otp_challenges.
    let codeA;
    const spy = vi.spyOn(consoleAdapter, 'send').mockImplementation(async ({ code }) => {
      codeA = code;
    });
    try {
      await requestOtp({ communityId: cidA, phone: SHARED_PHONE, purpose: 'reset' });
    } finally {
      spy.mockRestore();
    }
    expect(codeA).toMatch(/^\d{6}$/);

    // B chưa từng requestOtp cho số này — verifyOtp bên B với ĐÚNG mã của A
    // phải thất bại, vì hàng của A không khớp community_id = B.
    await expect(
      verifyOtp({ communityId: cidB, phone: SHARED_PHONE, code: codeA, purpose: 'reset' })
    ).rejects.toMatchObject({ code: 'OTP_INVALID' });

    // Và challenge của A phải còn nguyên ('open', chưa bị B "tiêu thụ" hộ) —
    // verifyOtp bên A với đúng mã đó vẫn thành công.
    const r = await verifyOtp({ communityId: cidA, phone: SHARED_PHONE, code: codeA, purpose: 'reset' });
    expect(typeof r.otpToken).toBe('string');
  });

  it('3 challenge hỏng liên tiếp ở cộng đồng B không khóa số đó ở cộng đồng A', async () => {
    const SHARED_PHONE = '0933111111';

    for (let round = 0; round < 3; round++) {
      await requestOtp({ communityId: cidB, phone: SHARED_PHONE, purpose: 'reset' });
      for (let i = 0; i < 5; i++) {
        await expect(
          verifyOtp({ communityId: cidB, phone: SHARED_PHONE, code: '000000', purpose: 'reset' })
        ).rejects.toThrow();
      }
    }
    // B bị khóa đúng như thiết kế...
    await expect(requestOtp({ communityId: cidB, phone: SHARED_PHONE, purpose: 'reset' })).rejects.toMatchObject({
      code: 'OTP_LOCKED',
    });
    // ...nhưng A, dùng CÙNG số điện thoại đó, hoàn toàn không bị ảnh hưởng —
    // requestOtp phải thành công (không throw).
    await expect(
      requestOtp({ communityId: cidA, phone: SHARED_PHONE, purpose: 'reset' })
    ).resolves.toBeUndefined();
  });
});
