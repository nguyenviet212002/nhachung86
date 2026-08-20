import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import argon2 from 'argon2';
import supertest from 'supertest';
import { resetDb } from './helpers/db.js';
import { mkInvite } from './helpers/invites.js';
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
      // QĐ-1: đầu vào là token của một đường link mời, không phải uuid người
      // bảo lãnh. Vỏ HTTP giữ snake_case như mọi khoá khác.
      invite_token: (await mkInvite(db, cid, referrerId)).token,
      password: 'mat-khau-du-manh-dang-ky',
      terms: true,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.join_request_id).toBeTruthy();
    expect(res.body.step).toBe(2);
    assertSnakeKeys(res.body);
  });

  // Lỗi thứ TƯ cùng họ, tìm ra sau khi ba lỗi trước đã được tuyên bố là "đã rà
  // toàn bộ". Nó lọt qua cả bài test này ở bản đầu vì `assertSnakeKeys` chỉ soi
  // những phản hồi mà bài test chịu khó gọi tới — một cái lưới rộng vẫn không
  // bắt được con cá bơi ở khúc sông không ai thả lưới. Mỗi route mới ở task sau
  // phải được thêm vào đây, nếu không lớp vỏ lại hở đúng chỗ cũ.
  it('GET /auth/me trả community_id — không đổ thẳng req.actor (camelCase) ra dây', async () => {
    const login = await supertest(api)
      .post('/api/v1/auth/login')
      .send({ identifier: ALICE_PHONE, password: ALICE_PASSWORD });
    expect(login.status, JSON.stringify(login.body)).toBe(200);

    const res = await supertest(api)
      .get('/api/v1/auth/me')
      .set('authorization', `Bearer ${login.body.access}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    expect(res.body.actor.id).toBeTruthy();
    expect(res.body.actor.community_id).toBeTruthy();
    expect(Array.isArray(res.body.actor.roles)).toBe(true);
    expect(res.body.actor.communityId, 'không được rò camelCase của tầng JS ra vỏ HTTP').toBeUndefined();

    assertSnakeKeys(res.body);
  });

  // -------------------------------------------------------------------------
  // Task 10 — bốn route danh bạ. Thêm vào đây theo đúng luật ở Ruling T9-e:
  // assertSnakeKeys chỉ soi những phản hồi mà bài test chịu khó gọi tới, nên
  // route mới KHÔNG được thêm vào t21 là route không có lưới nào canh lớp vỏ.
  //
  // `contacts` là object có khoá ĐỘNG theo nghĩa "khoá là tên trường liên hệ"
  // (phone/zalo/messenger/address) — bốn tên này đều đã là snake_case nên luật
  // chung vẫn áp được nguyên vẹn, không cần khai ngoại lệ.
  // -------------------------------------------------------------------------
  async function accessTokenForAlice() {
    const login = await supertest(api)
      .post('/api/v1/auth/login')
      .send({ identifier: ALICE_PHONE, password: ALICE_PASSWORD });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    return { token: login.body.access, memberId: login.body.member.id };
  }

  it('GET /areas trả data[] với id, name, parent_id, children', async () => {
    const { token } = await accessTokenForAlice();
    const res = await supertest(api).get('/api/v1/areas').set('authorization', `Bearer ${token}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0]).toMatchObject({ id: areaId, name: 'Khu T21', parent_id: null });
    expect(Array.isArray(res.body.data[0].children)).toBe(true);
    expect(res.body.data[0].parentId, 'không rò camelCase').toBeUndefined();
    assertSnakeKeys(res.body);
  });

  it('GET /members trả { data, meta{page,limit,total} } và contacts.*.value luôn null', async () => {
    const { token } = await accessTokenForAlice();
    const res = await supertest(api).get('/api/v1/members?page=1&limit=20').set('authorization', `Bearer ${token}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    expect(res.body.meta).toMatchObject({ page: 1, limit: 20 });
    expect(typeof res.body.meta.total).toBe('number');
    expect(res.body.data.length).toBeGreaterThan(0);

    const row = res.body.data[0];
    expect(row.full_name).toBeTruthy();
    expect(row.fullName, 'không rò camelCase').toBeUndefined();
    expect(row.workStatus, 'không rò camelCase').toBeUndefined();
    expect(row.avatarUrl, 'không rò camelCase').toBeUndefined();

    // Việc quan trọng nhất của Task 10, canh lại ở đúng lớp vỏ: số điện thoại
    // KHÔNG được có mặt trong thân phản hồi danh sách dưới bất kỳ hình dạng nào.
    for (const m of res.body.data) {
      for (const f of Object.values(m.contacts)) expect(f.value).toBeNull();
    }
    expect(JSON.stringify(res.body)).not.toContain(ALICE_PHONE);

    assertSnakeKeys(res.body);
  });

  it('GET /members/:id trả hồ sơ + contacts, không rò email/lat/lng', async () => {
    const { token, memberId } = await accessTokenForAlice();
    const res = await supertest(api).get(`/api/v1/members/${memberId}`).set('authorization', `Bearer ${token}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    expect(res.body.id).toBe(memberId);
    expect(res.body.full_name).toBe(ALICE_FULL_NAME);
    expect(res.body.contacts.phone.state).toBe('self');
    expect(res.body.contacts.phone.value).toBeNull();
    for (const forbidden of ['email', 'lat', 'lng', 'password_hash', 'community_id']) {
      expect(res.body[forbidden], `hồ sơ không được chứa ${forbidden}`).toBeUndefined();
    }
    expect(JSON.stringify(res.body)).not.toContain(ALICE_PHONE);

    assertSnakeKeys(res.body);
  });

  it('GET /members/:id/contacts/:field trả { value } — cửa DUY NHẤT có số thật', async () => {
    const { token, memberId } = await accessTokenForAlice();
    const res = await supertest(api)
      .get(`/api/v1/members/${memberId}/contacts/phone`)
      .set('authorization', `Bearer ${token}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ value: ALICE_PHONE });
    assertSnakeKeys(res.body);
  });

  // -------------------------------------------------------------------------
  // Task 16 — bảy route `/ops`. Thêm vào đây theo đúng luật Ruling T9-e:
  // `assertSnakeKeys` chỉ soi những phản hồi mà bài test chịu khó gọi tới, nên
  // một route mới KHÔNG có mặt ở đây là một route không có lưới nào canh lớp
  // vỏ — đúng chỗ bốn lỗi camelCase liên tiếp đã lọt qua.
  //
  // Ba route `/ops/pending-actions` của lượt 14 cũng được thêm ở đây, vì chúng
  // ra đời trước khi luật này được nhắc lại và chưa ai bù.
  // -------------------------------------------------------------------------
  let opsToken, opsMemberId, targetId;
  async function setUpOps() {
    if (opsToken) return;
    const email = 'tech-t21@nhachung.test';
    const {
      rows: [t],
    } = await db.raw(
      `INSERT INTO members (community_id, full_name, status, password_hash, email)
       VALUES (?, 'Tech T21', 'member', ?, ?) RETURNING id`,
      [cid, await argon2.hash(ALICE_PASSWORD), email]
    );
    opsMemberId = t.id;
    await db.raw(
      `INSERT INTO member_roles (member_id, role_id, community_id) SELECT ?, r.id, ? FROM roles r WHERE r.key = 'tech'`,
      [t.id, cid]
    );
    const {
      rows: [u],
    } = await db.raw(
      `INSERT INTO members (community_id, full_name, status) VALUES (?, 'Nhan Vai T21', 'member') RETURNING id`,
      [cid]
    );
    targetId = u.id;
    const login = await supertest(api).post('/api/v1/auth/login').send({ identifier: email, password: ALICE_PASSWORD });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    opsToken = login.body.access;
  }

  it('GET /ops/audit-log trả { data, meta } — không rò camelCase, không rò ip', async () => {
    await setUpOps();
    const res = await supertest(api)
      .get('/api/v1/ops/audit-log?page=1&limit=5')
      .set('authorization', `Bearer ${opsToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.meta).toMatchObject({ page: 1, limit: 5 });
    expect(res.body.data.length).toBeGreaterThan(0);
    const row = res.body.data[0];
    expect(row.actor_id !== undefined).toBe(true);
    expect(row.target_type !== undefined).toBe(true);
    expect(row.actorId, 'không rò camelCase').toBeUndefined();
    expect(row.targetType, 'không rò camelCase').toBeUndefined();
    // `ip` là dữ liệu cá nhân và đây là cửa đọc HÀNG LOẠT.
    expect(row.ip, 'địa chỉ IP không rời máy chủ ở cửa đọc hàng loạt').toBeUndefined();
    // `detail` là object có khoá ĐỘNG theo tên trường nghiệp vụ — bốn khoá
    // hiện có đều snake_case nên luật chung vẫn áp được nguyên vẹn.
    assertSnakeKeys(res.body);
  });

  it('GET /ops/audit-log/verify trả broken_at, không phải brokenAt', async () => {
    await setUpOps();
    const res = await supertest(api).get('/api/v1/ops/audit-log/verify').set('authorization', `Bearer ${opsToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.checked).toBe('number');
    expect(res.body).toHaveProperty('broken_at');
    expect(res.body.brokenAt, 'không rò camelCase — verifyChain() trả brokenAt ở tầng JS').toBeUndefined();
    assertSnakeKeys(res.body);
  });

  it('GET /ops/dashboard trả bốn cụm cảnh báo, mọi khoá snake_case', async () => {
    await setUpOps();
    const res = await supertest(api).get('/api/v1/ops/dashboard').set('authorization', `Bearer ${opsToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['audit_log', 'contact_denied', 'manual_ratio', 'two_person_same_ip']);
    expect(res.body.audit_log).toHaveProperty('rows_avg_30d');
    expect(res.body.audit_log.rowsAvg30d, 'không rò camelCase').toBeUndefined();
    assertSnakeKeys(res.body);
  });

  it('GET /ops/permissions trả { roles, permissions[] }', async () => {
    await setUpOps();
    const res = await supertest(api).get('/api/v1/ops/permissions').set('authorization', `Bearer ${opsToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.roles).toEqual(['tech']);
    expect(res.body.permissions.length).toBeGreaterThan(0);
    expect(Object.keys(res.body.permissions[0]).sort()).toEqual(['description', 'key', 'name']);
    assertSnakeKeys(res.body);
  });

  it('GET /ops/roles trả { data: [{ role, members[] }] }', async () => {
    await setUpOps();
    const res = await supertest(api).get('/api/v1/ops/roles').set('authorization', `Bearer ${opsToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const tech = res.body.data.find((r) => r.role === 'tech');
    expect(tech.members.map((m) => m.member_id)).toContain(opsMemberId);
    expect(tech.members[0].fullName, 'không rò camelCase').toBeUndefined();
    assertSnakeKeys(res.body);
  });

  it('PUT/DELETE /ops/members/:id/roles/:role trả member_id, role, granted/revoked', async () => {
    await setUpOps();
    const gan = await supertest(api)
      .put(`/api/v1/ops/members/${targetId}/roles/approver`)
      .set('authorization', `Bearer ${opsToken}`);
    expect(gan.status, JSON.stringify(gan.body)).toBe(200);
    expect(gan.body).toEqual({ member_id: targetId, role: 'approver', granted: true });
    assertSnakeKeys(gan.body);

    const go = await supertest(api)
      .delete(`/api/v1/ops/members/${targetId}/roles/approver`)
      .set('authorization', `Bearer ${opsToken}`);
    expect(go.status, JSON.stringify(go.body)).toBe(200);
    expect(go.body).toEqual({ member_id: targetId, role: 'approver', revoked: true });
    assertSnakeKeys(go.body);

    // Tên vai bịa bị chặn ngay ở zod, KHÔNG để CSDL phải nói `BAD_ROLE` — và
    // là 400, không phải 500 (bẫy 2: ngoại lệ trigger chưa bắt thành 500).
    const bia = await supertest(api)
      .put(`/api/v1/ops/members/${targetId}/roles/sieu_quan_tri`)
      .set('authorization', `Bearer ${opsToken}`);
    expect(bia.status, JSON.stringify(bia.body)).toBe(400);
    expect(bia.body.error.code).toBe('VALIDATION_FAILED');
    assertSnakeKeys(bia.body);
  });

  it('GET /ops/pending-actions trả { data, meta } — route của lượt 14, chưa ai thêm vào đây', async () => {
    await setUpOps();
    const res = await supertest(api)
      .get('/api/v1/ops/pending-actions?page=1&limit=10')
      .set('authorization', `Bearer ${opsToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.meta).toMatchObject({ page: 1, limit: 10 });
    expect(Array.isArray(res.body.data)).toBe(true);
    assertSnakeKeys(res.body);
  });

  it('POST /ops/pending-actions và /sign trả snake_case, và 403 cũng vậy', async () => {
    await setUpOps();
    // `backup.restore` đòi vai `tech` (bảng mục 7.5) nhưng CHƯA có người thi
    // hành, nên `core/twoPerson.js` chặn ngay lúc TẠO. Đó là hình dạng phản hồi
    // cần canh: một lỗi 422 đi qua `errorHandler` vẫn phải snake_case.
    const som = await supertest(api)
      .post('/api/v1/ops/pending-actions')
      .set('authorization', `Bearer ${opsToken}`)
      .send({ action_key: 'backup.restore', payload: {} });
    expect(som.status, JSON.stringify(som.body)).toBe(422);
    expect(som.body.error.code).toBe('ACTION_NOT_AVAILABLE');
    assertSnakeKeys(som.body);

    // `member.terminate` đòi vai `approver`; người này là `tech` ⇒ 403.
    const cam = await supertest(api)
      .post('/api/v1/ops/pending-actions')
      .set('authorization', `Bearer ${opsToken}`)
      .send({ action_key: 'member.terminate', target_type: 'member', target_id: targetId, payload: {} });
    expect(cam.status, JSON.stringify(cam.body)).toBe(403);
    assertSnakeKeys(cam.body);
  });

  // Ba route của lượt QĐ-1 (link mời bảo lãnh). Ruling T9-e: mọi route mới phải
  // có mặt ở đây, nếu không lớp vỏ lại hở đúng chỗ cũ.
  it('POST /guarantee-invites trả token ĐÚNG MỘT LẦN, mọi khoá snake_case', async () => {
    const { token } = await accessTokenForAlice();
    const res = await supertest(api)
      .post('/api/v1/guarantee-invites')
      .set('authorization', `Bearer ${token}`)
      .send({});
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.status).toBe('open');
    expect(res.body.created_on_behalf).toBe(false);
    expect(res.body.createdOnBehalf, 'không rò camelCase').toBeUndefined();
    // Băm KHÔNG ra dây: nó không giúp người dùng việc gì, mà lại là một chuỗi
    // trông giống token đủ để đi lạc vào một ảnh chụp màn hình.
    expect(res.body.token_hash).toBeUndefined();
    assertSnakeKeys(res.body);
  });

  it('GET /guarantee-invites trả { data, meta } và KHÔNG có token ở bất kỳ đâu', async () => {
    const { token } = await accessTokenForAlice();
    const tao = await supertest(api)
      .post('/api/v1/guarantee-invites')
      .set('authorization', `Bearer ${token}`)
      .send({});
    expect(tao.status, JSON.stringify(tao.body)).toBe(201);

    const res = await supertest(api)
      .get('/api/v1/guarantee-invites?page=1&limit=10')
      .set('authorization', `Bearer ${token}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.meta).toMatchObject({ page: 1, limit: 10 });
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(JSON.stringify(res.body), 'token chỉ ra khỏi máy chủ đúng một lần').not.toContain(tao.body.token);
    assertSnakeKeys(res.body);
  });

  it('POST /guarantee-invites/:id/revoke trả hàng đã thu hồi, và 400 khi thiếu lý do', async () => {
    const { token } = await accessTokenForAlice();
    const tao = await supertest(api)
      .post('/api/v1/guarantee-invites')
      .set('authorization', `Bearer ${token}`)
      .send({});
    expect(tao.status, JSON.stringify(tao.body)).toBe(201);

    const thieu = await supertest(api)
      .post(`/api/v1/guarantee-invites/${tao.body.id}/revoke`)
      .set('authorization', `Bearer ${token}`)
      .send({});
    expect(thieu.status, JSON.stringify(thieu.body)).toBe(400);
    expect(thieu.body.error.code).toBe('VALIDATION_FAILED');
    assertSnakeKeys(thieu.body);

    const res = await supertest(api)
      .post(`/api/v1/guarantee-invites/${tao.body.id}/revoke`)
      .set('authorization', `Bearer ${token}`)
      .send({ reason: 'phat nham nguoi' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe('revoked');
    expect(res.body.revoked_at).toBeTruthy();
    expect(res.body.revokedAt, 'không rò camelCase').toBeUndefined();
    assertSnakeKeys(res.body);
  });

  it('GET /members/:id/contacts/:field từ chối tên trường lạ ở vỏ ngoài (400, không phải 500)', async () => {
    const { token, memberId } = await accessTokenForAlice();
    // Chặn ở zod TRƯỚC khi chạm contact_read: nhánh BAD_FIELD của hàm CSDL
    // RAISE EXCEPTION, và ngoại lệ chưa bắt sẽ thành HTTP 500 (bẫy 2).
    const res = await supertest(api)
      .get(`/api/v1/members/${memberId}/contacts/password_hash`)
      .set('authorization', `Bearer ${token}`);
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    assertSnakeKeys(res.body);
  });
});
