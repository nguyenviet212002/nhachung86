import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import argon2 from 'argon2';
import supertest from 'supertest';
import { resetDb } from './helpers/db.js';
import { buildApp } from '../src/app.js';
import { consoleAdapter } from '../src/core/otp/console.js';

// ---------------------------------------------------------------------------
// T21 — vỏ HTTP: canh HÌNH DẠNG phản hồi JSON, không phải hành vi nghiệp vụ
// (hành vi đã có T16/T17 canh).
//
// Ra đời từ soát xét độc lập Task 9: `member.fullName` (modules/auth/service.js,
// hàm issueTokens) rò camelCase của tầng JS ra vỏ HTTP, xác nhận bằng `curl`
// thật trên POST /auth/login. Task 9 đã sửa hai chỗ CÙNG HỌ lỗi (`otpToken` →
// `otp_token`, `refreshToken` → `refresh_token`) và ghi "đã rà toàn bộ" — chỗ
// `fullName` lọt lại NGAY TRONG MODULE đó. Lý do không bài nào bắt được trước
// đây: mọi bài test gọi thẳng hàm service (login(), verifyOtp(), …), không đi
// qua Express/HTTP — lớp vỏ, chỗ DUY NHẤT mà tên trường thật sự quan trọng với
// một client bên ngoài, không có lưới nào canh.
//
// assertSnakeKeys() là lưới CHUNG thay cho danh sách khoá cứng: mọi khoá
// trong thân JSON phải khớp /^[a-z0-9_]+$/, đệ quy qua object lồng nhau và
// mảng. Bốn route dưới đây đều trả object hình dạng CỐ ĐỊNH — không route nào
// dùng uuid hay dữ liệu người dùng nhập làm KHOÁ (chỉ làm GIÁ TRỊ, thứ hàm này
// cố tình không đụng tới), nên không cần khai ngoại lệ nào ở đây. Nếu một route
// sau này trả một object dạng map (khoá động, vd. khoá theo field_key hay theo
// id), thêm tham số bỏ qua ĐÚNG NHÁNH đó — đừng bỏ luật chung.
function assertSnakeKeys(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertSnakeKeys(v, `${path}[${i}]`));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, v] of Object.entries(value)) {
    expect(key, `khoá "${key}" tại ${path} phải khớp /^[a-z0-9_]+$/ (snake_case)`).toMatch(/^[a-z0-9_]+$/);
    assertSnakeKeys(v, `${path}.${key}`);
  }
}

let db, api, cid, areaId, referrerId;
const ALICE_PHONE = '0971000001';
const ALICE_FULL_NAME = 'Alice T21';
const ALICE_PASSWORD = 'mat-khau-du-manh-t21';

beforeAll(async () => {
  db = await resetDb();
  api = buildApp();

  ({
    rows: [{ id: cid }],
  } = await db.raw(`INSERT INTO communities (code,name) VALUES ('community-t21','X') RETURNING id`));
  ({
    rows: [{ id: areaId }],
  } = await db.raw(`INSERT INTO areas (community_id, name) VALUES (?, 'Khu T21') RETURNING id`, [cid]));

  const {
    rows: [alice],
  } = await db.raw(
    `INSERT INTO members (community_id, full_name, status, password_hash)
     VALUES (?, ?, 'member', ?) RETURNING id`,
    [cid, ALICE_FULL_NAME, await argon2.hash(ALICE_PASSWORD)]
  );
  // UPDATE, không INSERT: trg_member_bootstrap (migration 012) đã tạo sẵn hộp
  // liên hệ rỗng ngay khi hàng members ra đời.
  await db.raw(`UPDATE member_contacts SET phone = ? WHERE member_id = ?`, [ALICE_PHONE, alice.id]);

  const {
    rows: [referrer],
  } = await db.raw(
    `INSERT INTO members (community_id, full_name, status) VALUES (?, 'Bao Lanh T21', 'member') RETURNING id`,
    [cid]
  );
  referrerId = referrer.id;
});

afterAll(async () => {
  await db.destroy();
});

// Xin OTP thật qua HTTP rồi bắt mã bằng spy lên consoleAdapter — mã đã bị
// argon2 băm trong CSDL, không đảo ngược lại được bằng cách nào khác.
async function freshOtp(phone, purpose) {
  let code;
  const spy = vi.spyOn(consoleAdapter, 'send').mockImplementation(async (a) => {
    code = a.code;
  });
  try {
    const res = await supertest(api).post('/api/v1/auth/otp/request').send({ phone, purpose });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
  } finally {
    spy.mockRestore();
  }
  return code;
}

describe('T21 vỏ HTTP: hình dạng phản hồi khớp đặc tả mục 5 (snake_case)', () => {
  it('POST /auth/otp/verify trả otp_token — không rò otpToken', async () => {
    const phone = '0971000002';
    const code = await freshOtp(phone, 'register');

    const res = await supertest(api).post('/api/v1/auth/otp/verify').send({ phone, code, purpose: 'register' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.otp_token).toBeTruthy();
    expect(res.body.otpToken, 'không được rò camelCase của tầng JS ra vỏ HTTP').toBeUndefined();
    assertSnakeKeys(res.body);
  });

  it('POST /auth/login trả access, refresh, member{id, full_name, status} — không rò fullName', async () => {
    const res = await supertest(api)
      .post('/api/v1/auth/login')
      .send({ identifier: ALICE_PHONE, password: ALICE_PASSWORD });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    expect(typeof res.body.access).toBe('string');
    expect(typeof res.body.refresh).toBe('string');
    expect(res.body.member.id).toBeTruthy();
    expect(res.body.member.full_name).toBe(ALICE_FULL_NAME);
    expect(res.body.member.status).toBe('member');
    // Việc 1 chính là đây: bản trước trả `fullName`, không phải `full_name`.
    expect(res.body.member.fullName, 'không được rò camelCase của tầng JS ra vỏ HTTP').toBeUndefined();

    assertSnakeKeys(res.body);
  });

  it('POST /auth/refresh NHẬN refresh_token — refreshToken (camelCase) không được server hiểu', async () => {
    const login = await supertest(api)
      .post('/api/v1/auth/login')
      .send({ identifier: ALICE_PHONE, password: ALICE_PASSWORD });
    expect(login.status, JSON.stringify(login.body)).toBe(200);

    // Một client làm ĐÚNG đặc tả dòng 775 (gửi refreshToken kiểu camelCase,
    // tức là làm SAI) phải nhận VALIDATION_FAILED — khẳng định server đọc
    // đúng khoá `refresh_token`, không phải chấp nhận cả hai cho dễ.
    const wrongKey = await supertest(api).post('/api/v1/auth/refresh').send({ refreshToken: login.body.refresh });
    expect(wrongKey.status, JSON.stringify(wrongKey.body)).toBe(400);
    expect(wrongKey.body.error.code).toBe('VALIDATION_FAILED');

    const ok = await supertest(api).post('/api/v1/auth/refresh').send({ refresh_token: login.body.refresh });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(typeof ok.body.access).toBe('string');
    expect(typeof ok.body.refresh).toBe('string');
    assertSnakeKeys(ok.body);
  });

  it('POST /auth/register trả join_request_id, step', async () => {
    const phone = '0971000003';
    const code = await freshOtp(phone, 'register');
    const verify = await supertest(api).post('/api/v1/auth/otp/verify').send({ phone, code, purpose: 'register' });
    expect(verify.status, JSON.stringify(verify.body)).toBe(200);

    const res = await supertest(api).post('/api/v1/auth/register').send({
      otp_token: verify.body.otp_token,
      phone,
      full_name: 'Nguoi Dang Ky T21',
      birth_year: 1986,
      area_id: areaId,
      referrer_id: referrerId,
      password: 'mat-khau-du-manh-dang-ky',
      terms: true,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.join_request_id).toBeTruthy();
    expect(res.body.step).toBe(2);
    assertSnakeKeys(res.body);
  });
});
