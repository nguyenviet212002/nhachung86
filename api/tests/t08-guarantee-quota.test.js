import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { resetDb, ownerKnex } from './helpers/db.js';
import { config } from '../src/config/index.js';
import { requestOtp, verifyOtp } from '../src/modules/auth/service.js';
import { consoleAdapter } from '../src/core/otp/console.js';
import { buildApp } from '../src/app.js';

let db, cid, areaId;

// Đúng MỘT cộng đồng trong tệp này: resolveCommunityId() lấy cộng đồng cũ
// nhất, nên tạo thêm cộng đồng thứ hai sẽ làm các bài đi qua HTTP nhắm nhầm.
beforeAll(async () => {
  db = await resetDb();
  ({ rows: [{ id: cid }] } = await db.raw(
    `INSERT INTO communities (code,name) VALUES ('community-join','Hoi dong nien 1986') RETURNING id`
  ));
  ({ rows: [{ id: areaId }] } = await db.raw(
    `INSERT INTO areas (community_id, name) VALUES (?, 'Xa Khoai Chau') RETURNING id`,
    [cid]
  ));
});
afterAll(async () => {
  await db.destroy();
});

let seq = 0;
async function newMember(status = 'member') {
  seq += 1;
  const { rows: [m] } = await db.raw(
    `INSERT INTO members (community_id, full_name, status) VALUES (?, ?, ?) RETURNING id`,
    [cid, `Nguoi thu ${seq}`, status]
  );
  return m.id;
}

function insertJr(referrerId, status = 'pending', createdAtSql = 'now()') {
  return db.raw(
    `INSERT INTO join_requests (community_id, applicant_data, referrer_id, status, created_at)
     VALUES (?, '{}'::jsonb, ?, ?, ${createdAtSql}) RETURNING id`,
    [cid, referrerId, status]
  );
}

async function grantRole(memberId, key) {
  await db.raw(
    `INSERT INTO member_roles (member_id, role_id, community_id)
     SELECT ?, r.id, ? FROM roles r WHERE r.key = ?`,
    [memberId, cid, key]
  );
}

function accessTokenFor(memberId) {
  return jwt.sign({ sub: memberId, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' });
}

// Dòng nhật ký "từ chối" do errorHandler ghi trong một giao dịch RIÊNG, không
// được await trước khi phản hồi HTTP trả về (cố ý: phản hồi không chờ nhật ký).
// Nên bài test phải chờ nó xuất hiện thay vì đọc một lần rồi kết luận — đọc
// một lần là một bài test chập chờn, đúng thứ dự án này đã cấm ở Task 7.
async function waitForRow(query, timeoutMs = 5000) {
  const start = Date.now();
  for (;;) {
    const { rows } = await query();
    if (rows.length > 0) return rows;
    if (Date.now() - start > timeoutMs) return [];
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function freshOtpToken(phone) {
  let code;
  const spy = vi.spyOn(consoleAdapter, 'send').mockImplementation(async (a) => {
    code = a.code;
  });
  try {
    await requestOtp({ communityId: cid, phone, purpose: 'register' });
  } finally {
    spy.mockRestore();
  }
  const { otpToken } = await verifyOtp({ communityId: cid, phone, code, purpose: 'register' });
  return otpToken;
}

// ---------------------------------------------------------------------------
describe('T8 hạn mức bảo lãnh — cưỡng chế ở CSDL, không phải lời hứa ở tầng app', () => {
  it('đơn thứ tư trong 12 tháng bị chặn', async () => {
    const referrer = await newMember();
    for (let i = 0; i < 3; i++) await insertJr(referrer);
    await expect(insertJr(referrer)).rejects.toThrow(/GUARANTEE_QUOTA_EXCEEDED/);
  });

  it('cửa sổ là 12 THÁNG TRƯỢT: ba đơn của 11 tháng trước vẫn chặn đơn hôm nay', async () => {
    // 11 tháng trước rơi vào NĂM DƯƠNG LỊCH TRƯỚC (hôm nay là tháng 8). Luật
    // "3 đơn mỗi năm dương lịch" sẽ cho đơn này qua; luật 12 tháng trượt thì
    // không. Đây là chỗ duy nhất phân biệt được hai luật bằng dữ liệu.
    const referrer = await newMember();
    for (let i = 0; i < 3; i++) await insertJr(referrer, 'pending', `now() - interval '11 months'`);
    await expect(insertJr(referrer)).rejects.toThrow(/GUARANTEE_QUOTA_EXCEEDED/);
  });

  it('đơn cũ hơn 12 tháng thì rơi ra khỏi cửa sổ, suất được trả lại', async () => {
    const referrer = await newMember();
    for (let i = 0; i < 3; i++) await insertJr(referrer, 'pending', `now() - interval '13 months'`);
    await expect(insertJr(referrer)).resolves.toBeTruthy();
  });

  it('hai giao dịch ĐỒNG THỜI cùng tranh suất cuối thì đúng MỘT cái qua', async () => {
    const referrer = await newMember();
    for (let i = 0; i < 2; i++) await insertJr(referrer); // 2/3 đã dùng

    const a = ownerKnex();
    const b = ownerKnex();
    try {
      const ta = await a.transaction();
      const tb = await b.transaction();
      const ins = (t) =>
        t.raw(
          `INSERT INTO join_requests (community_id, applicant_data, referrer_id, status)
           VALUES (?, '{}'::jsonb, ?, 'pending')`,
          [cid, referrer]
        );

      // ta chèn trước và GIỮ khóa tư vấn tới lúc commit. tb chèn ngay sau đó,
      // trong khi ta CHƯA commit: không có khóa thì tb đếm ra 2 (không thấy
      // hàng chưa commit của ta) và lọt — đây chính là bài toán bóng ma mà
      // FOR UPDATE không giải được. Có khóa thì tb xếp hàng, và khi ta commit
      // xong, câu đếm của tb chạy trên ảnh chụp MỚI (READ COMMITTED, mỗi câu
      // lệnh một ảnh chụp) nên thấy đủ 3.
      const r1 = await ins(ta).then(() => 'ok').catch(() => 'fail');
      const p2 = ins(tb).then(() => 'ok').catch(() => 'fail');
      await ta.commit();
      const r2 = await p2;
      await tb.rollback().catch(() => {});

      expect([r1, r2].filter((x) => x === 'ok')).toHaveLength(1);
    } finally {
      await a.destroy();
      await b.destroy();
    }
  });

  it('lách bằng draft rồi đẩy lên pending cũng bị chặn (vế UPDATE OF status)', async () => {
    const referrer = await newMember();
    for (let i = 0; i < 3; i++) await insertJr(referrer);
    // draft chưa tiêu suất nên chèn được — đúng thiết kế.
    const { rows: [draft] } = await insertJr(referrer, 'draft');
    await expect(
      db.raw(`UPDATE join_requests SET status = 'pending' WHERE id = ?`, [draft.id])
    ).rejects.toThrow(/GUARANTEE_QUOTA_EXCEEDED/);
  });

  it('rejected thường TRẢ LẠI suất', async () => {
    const referrer = await newMember();
    const ids = [];
    for (let i = 0; i < 3; i++) {
      const { rows: [r] } = await insertJr(referrer);
      ids.push(r.id);
    }
    await db.raw(`UPDATE join_requests SET status='rejected', reject_reason_code='not_ready' WHERE id = ?`, [ids[0]]);
    await expect(insertJr(referrer)).resolves.toBeTruthy();
  });

  it('rejected vì referrer_misrepresented thì KHÔNG trả lại suất', async () => {
    const referrer = await newMember();
    const ids = [];
    for (let i = 0; i < 3; i++) {
      const { rows: [r] } = await insertJr(referrer);
      ids.push(r.id);
    }
    await db.raw(
      `UPDATE join_requests SET status='rejected', reject_reason_code='referrer_misrepresented' WHERE id = ?`,
      [ids[0]]
    );
    await expect(insertJr(referrer)).rejects.toThrow(/GUARANTEE_QUOTA_EXCEEDED/);
  });

  it('referrer_id IS NULL ⇒ REFERRER_REQUIRED (không có bảo lãnh ẩn danh)', async () => {
    await expect(
      db.raw(`INSERT INTO join_requests (community_id, applicant_data, status) VALUES (?, '{}'::jsonb, 'draft')`, [cid])
    ).rejects.toThrow(/REFERRER_REQUIRED/);
  });

  it('guarantee_quota_overrides nới đúng số suất đã cấp, và hết hiệu lực theo valid_until', async () => {
    const referrer = await newMember();
    const approver = await newMember();
    for (let i = 0; i < 3; i++) await insertJr(referrer);
    await expect(insertJr(referrer)).rejects.toThrow(/GUARANTEE_QUOTA_EXCEEDED/);

    const { rows: [ov] } = await db.raw(
      `INSERT INTO guarantee_quota_overrides (community_id, referrer_id, extra_slots, reason, granted_by, valid_until)
       VALUES (?, ?, 1, 'truong hop dac biet', ?, now() + interval '1 day') RETURNING id`,
      [cid, referrer, approver]
    );
    await expect(insertJr(referrer)).resolves.toBeTruthy(); // suất thứ 4 nhờ nới lỏng
    await expect(insertJr(referrer)).rejects.toThrow(/GUARANTEE_QUOTA_EXCEEDED/); // suất thứ 5 thì không

    // Nới lỏng TỰ hết hạn: đẩy valid_until về quá khứ (chỉ owner làm được —
    // app_role bị REVOKE UPDATE, xem expected-grants.json).
    await db.raw(`UPDATE guarantee_quota_overrides SET valid_until = now() - interval '1 second' WHERE id = ?`, [ov.id]);
    await expect(insertJr(referrer)).rejects.toThrow(/GUARANTEE_QUOTA_EXCEEDED/);
  });

  it('hạn mức đọc từ communities.config, không phải hằng số trong mã', async () => {
    const referrer = await newMember();
    await db.raw(`UPDATE communities SET config = config || '{"guarantee_quota_per_year":1}'::jsonb WHERE id = ?`, [cid]);
    try {
      await expect(insertJr(referrer)).resolves.toBeTruthy();
      await expect(insertJr(referrer)).rejects.toThrow(/GUARANTEE_QUOTA_EXCEEDED/);
    } finally {
      await db.raw(`UPDATE communities SET config = config - 'guarantee_quota_per_year' WHERE id = ?`, [cid]);
    }
  });
});

// ---------------------------------------------------------------------------
describe('T8 cổng met_confirmed và sợi bảo lãnh đóng băng', () => {
  // CẢNH BÁO cho người viết bài test sau (tự vấp, mất một vòng): dạng giao
  // dịch THỦ CÔNG của knex (`const trx = await db.transaction()` rồi
  // `trx.commit()`) NUỐT lỗi của lệnh COMMIT — `trx.commit()` resolve bình
  // thường, bản thân đối tượng trx (thenable) cũng resolve, trong khi dữ liệu
  // KHÔNG hề được ghi. Đã kiểm bằng chạy thật: sau `commit()` "thành công",
  // `SELECT` không thấy hàng nào. Ràng buộc hoãn tới COMMIT là loại lỗi DUY
  // NHẤT chỉ xuất hiện ở lệnh COMMIT, nên bài test dùng dạng thủ công sẽ báo
  // xanh cả khi trigger bị gỡ. Dạng callback (`db.transaction(async trx =>
  // ...)`) reject đúng như mong đợi — và đó cũng là dạng core/tx.js dùng, nên
  // mã production không dính bẫy này.
  it('members.status=member khi chưa có xác nhận gặp mặt ⇒ hỏng lúc COMMIT, không phải lúc ghi', async () => {
    const referrer = await newMember();
    let insertResolved = false;
    await expect(
      db.transaction(async (trx) => {
        // Câu INSERT tự nó PHẢI thành công: ràng buộc được hoãn tới commit, đó
        // là toàn bộ lý do dùng CONSTRAINT TRIGGER thay vì BEFORE INSERT.
        await trx.raw(
          `INSERT INTO members (community_id, full_name, status, referrer_id) VALUES (?, 'Nguoi moi', 'member', ?)`,
          [cid, referrer]
        );
        insertResolved = true;
      })
    ).rejects.toThrow(/MEMBER_NEEDS_MET_CONFIRMATION/);
    expect(insertResolved, 'câu ghi phải qua được, chỉ COMMIT mới hỏng').toBe(true);

    const { rows } = await db.raw(`SELECT id FROM members WHERE full_name = 'Nguoi moi'`);
    expect(rows).toHaveLength(0);
  });

  it('đặt join_requests.member_id trong CÙNG giao dịch thì COMMIT qua được', async () => {
    const referrer = await newMember();
    const { rows: [jr] } = await insertJr(referrer, 'met_confirmed');
    await db.raw(`UPDATE join_requests SET met_confirmed_at = now(), met_confirmed_by = ? WHERE id = ?`, [
      referrer,
      jr.id,
    ]);

    await expect(
      db.transaction(async (trx) => {
        const { rows: [m] } = await trx.raw(
          `INSERT INTO members (community_id, full_name, status, referrer_id) VALUES (?, 'Nguoi moi hop le', 'member', ?) RETURNING id`,
          [cid, referrer]
        );
        await trx.raw(`UPDATE join_requests SET member_id = ?, status = 'approved' WHERE id = ?`, [m.id, jr.id]);
      })
    ).resolves.not.toThrow();

    const { rows } = await db.raw(`SELECT id FROM members WHERE full_name = 'Nguoi moi hop le'`);
    expect(rows).toHaveLength(1);
  });

  it('đổi referrer_id của một hàng status=member ⇒ REFERRER_FROZEN', async () => {
    const oldReferrer = await newMember();
    const newReferrer = await newMember();
    const { rows: [m] } = await db.raw(
      `INSERT INTO members (community_id, full_name, status, referrer_id) VALUES (?, 'Da la thanh vien', 'member', NULL) RETURNING id`,
      [cid]
    );
    // Đặt lần đầu khi còn NULL vẫn được (chưa có sợi nào để đóng băng)... nhưng
    // hàng này đã là 'member', nên theo đúng luật thì KHÔNG được.
    await expect(
      db.raw(`UPDATE members SET referrer_id = ? WHERE id = ?`, [oldReferrer, m.id])
    ).rejects.toThrow(/REFERRER_FROZEN/);

    // Và với một hàng chưa phải member thì đặt được, rồi vẫn đổi được khi còn guest.
    const { rows: [g] } = await db.raw(
      `INSERT INTO members (community_id, full_name, status) VALUES (?, 'Con la khach', 'guest') RETURNING id`,
      [cid]
    );
    await expect(db.raw(`UPDATE members SET referrer_id = ? WHERE id = ?`, [oldReferrer, g.id])).resolves.toBeTruthy();
    await expect(db.raw(`UPDATE members SET referrer_id = ? WHERE id = ?`, [newReferrer, g.id])).resolves.toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe('T8 POST /auth/register — ba nhánh hỏng không phân biệt được', () => {
  let app;
  beforeAll(() => {
    app = buildApp();
  });

  function body(extra) {
    return {
      full_name: 'Nguoi Nop Don',
      birth_year: 1986,
      area_id: areaId,
      password: 'mat-khau-du-manh-12',
      terms: true,
      ...extra,
    };
  }

  it('nộp đơn hợp lệ: trả join_request_id + step, ghi join_request.created', async () => {
    const referrer = await newMember();
    const phone = '0921000001';
    const res = await supertest(app)
      .post('/api/v1/auth/register')
      .send(body({ otp_token: await freshOtpToken(phone), phone, referrer_id: referrer }));

    expect(res.status).toBe(201);
    expect(res.body.join_request_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.step).toBe(2);

    const { rows } = await db.raw(`SELECT detail FROM audit_log WHERE action = 'join_request.created' AND target_id = ?`, [
      res.body.join_request_id,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].detail.referrer_id).toBe(referrer);
    // Nhật ký không bao giờ mang số điện thoại thô.
    expect(JSON.stringify(rows[0].detail)).not.toContain(phone);
  });

  it('otp_token không dùng lại được cho đơn thứ hai', async () => {
    const referrer = await newMember();
    const phone = '0921000002';
    const token = await freshOtpToken(phone);
    const first = await supertest(app)
      .post('/api/v1/auth/register')
      .send(body({ otp_token: token, phone, referrer_id: referrer }));
    expect(first.status).toBe(201);

    const second = await supertest(app)
      .post('/api/v1/auth/register')
      .send(body({ otp_token: token, phone, referrer_id: referrer }));
    expect(second.status).toBe(400);
    expect(second.body.error.code).toBe('OTP_INVALID');
  });

  it('ba nhánh hỏng trả CÙNG mã lỗi, CÙNG câu, và đều chậm ≥300ms', async () => {
    // Nhánh 1: referrer_id không tồn tại.
    const ghost = '00000000-0000-4000-8000-000000000abc';
    // Nhánh 2: tồn tại nhưng chưa phải member.
    const guest = await newMember('guest');
    // Nhánh 3: là member nhưng đã hết hạn mức.
    const exhausted = await newMember();
    for (let i = 0; i < 3; i++) await insertJr(exhausted);

    const results = [];
    let i = 0;
    for (const referrerId of [ghost, guest, exhausted]) {
      i += 1;
      const phone = `092200000${i}`;
      const startedAt = Date.now();
      const res = await supertest(app)
        .post('/api/v1/auth/register')
        .send(body({ otp_token: await freshOtpToken(phone), phone, referrer_id: referrerId }));
      results.push({ res, ms: Date.now() - startedAt });
    }

    for (const { res, ms } of results) {
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('REFERRAL_UNAVAILABLE');
      expect(ms).toBeGreaterThanOrEqual(300);
    }
    const messages = new Set(results.map((r) => r.res.body.error.message));
    expect(messages.size, `ba nhánh phải cùng MỘT câu, đang có: ${[...messages].join(' | ')}`).toBe(1);

    // Lý do THẬT vẫn được ghi lại phía máy chủ — người nộp đơn không phân biệt
    // được, người vận hành thì phải phân biệt được.
    const { rows } = await db.raw(
      `SELECT detail FROM audit_log WHERE action = 'join_request.denied' ORDER BY seq DESC LIMIT 3`
    );
    expect(rows.map((r) => r.detail.reason).sort()).toEqual([
      'quota_exceeded',
      'referrer_not_found',
      'referrer_not_member',
    ]);

    // Và cả ba nhánh để lại CÙNG dấu vết trạng thái: vé OTP đã tiêu. Nếu nhánh
    // hết hạn mức làm rollback cả giao dịch (không có SAVEPOINT), vé của nó
    // còn dùng được — ba nhánh lại phân biệt được, chỉ khác là qua trạng thái
    // thay vì qua câu chữ.
    const { rows: consumed } = await db.raw(
      `SELECT count(*)::int AS n FROM otp_challenges WHERE consumed_at IS NOT NULL AND purpose = 'register'`
    );
    expect(consumed[0].n).toBeGreaterThanOrEqual(5);
  });

  it('sai năm sinh thì báo đúng lỗi đó và KHÔNG tiêu vé OTP', async () => {
    const referrer = await newMember();
    const phone = '0923000001';
    const token = await freshOtpToken(phone);
    const bad = await supertest(app)
      .post('/api/v1/auth/register')
      .send(body({ otp_token: token, phone, referrer_id: referrer, birth_year: 1987 }));
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('BIRTH_YEAR_MISMATCH');

    // Lỗi gõ nhầm của người dùng không phải nhánh dò danh sách — vé phải còn.
    const ok = await supertest(app)
      .post('/api/v1/auth/register')
      .send(body({ otp_token: token, phone, referrer_id: referrer }));
    expect(ok.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
describe('T8 /join-requests — cổng met_confirmed ở tầng HTTP', () => {
  let app, referrer, stranger, approver, jrId;

  beforeAll(async () => {
    app = buildApp();
    referrer = await newMember();
    stranger = await newMember();
    approver = await newMember();
    await grantRole(referrer, 'member');
    await grantRole(stranger, 'member');
    await grantRole(approver, 'approver');

    const phone = '0924000001';
    const res = await supertest(app)
      .post('/api/v1/auth/register')
      .send({
        otp_token: await freshOtpToken(phone),
        phone,
        full_name: 'Nguoi Duoc Bao Lanh',
        birth_year: 1986,
        area_id: areaId,
        referrer_id: referrer,
        password: 'mat-khau-du-manh-12',
        terms: true,
      });
    expect(res.status).toBe(201);
    jrId = res.body.join_request_id;
  });

  it('danh sách: approver xem được, member thường thì không', async () => {
    const ok = await supertest(app)
      .get('/api/v1/join-requests?status=pending')
      .set('Authorization', `Bearer ${accessTokenFor(approver)}`);
    expect(ok.status).toBe(200);
    expect(ok.body.data.length).toBeGreaterThan(0);
    expect(ok.body.meta.total).toBeGreaterThan(0);

    const denied = await supertest(app)
      .get('/api/v1/join-requests')
      .set('Authorization', `Bearer ${accessTokenFor(stranger)}`);
    expect(denied.status).toBe(403);

    // MỘT dòng nhật ký cho cả trang, không phải một dòng mỗi đơn.
    const { rows } = await db.raw(`SELECT detail FROM audit_log WHERE action='join_request.list' AND actor_id = ?`, [
      approver,
    ]);
    expect(rows).toHaveLength(1);
  });

  it('applicant_data không bao giờ rời máy chủ nguyên vẹn (số điện thoại, băm mật khẩu)', async () => {
    const res = await supertest(app)
      .get(`/api/v1/join-requests/${jrId}`)
      .set('Authorization', `Bearer ${accessTokenFor(approver)}`);
    expect(res.status).toBe(200);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('0924000001');
    expect(raw).not.toContain('$argon2');
    expect(raw).not.toContain('password');
    // ...nhưng phần công khai thì vẫn phải có, nếu không đơn thành vô dụng.
    expect(res.body.applicant.full_name).toBe('Nguoi Duoc Bao Lanh');

    // Bằng chứng đối chứng: dữ liệu thô ĐANG nằm trong CSDL, tức bài trên kiểm
    // lớp lọc chứ không phải kiểm một cột rỗng.
    const { rows } = await db.raw(`SELECT applicant_data FROM join_requests WHERE id = ?`, [jrId]);
    expect(rows[0].applicant_data.phone).toBe('0924000001');
    expect(rows[0].applicant_data.password_hash.startsWith('$argon2')).toBe(true);
  });

  it('người lạ không xem được đơn của người khác', async () => {
    const res = await supertest(app)
      .get(`/api/v1/join-requests/${jrId}`)
      .set('Authorization', `Bearer ${accessTokenFor(stranger)}`);
    expect(res.status).toBe(403);
  });

  it('confirm-met bởi người KHÔNG phải người bảo lãnh ⇒ từ chối, và có dòng nhật ký từ chối', async () => {
    const res = await supertest(app)
      .post(`/api/v1/join-requests/${jrId}/confirm-met`)
      .set('Authorization', `Bearer ${accessTokenFor(stranger)}`)
      .send({ met_on: '2026-08-01', note: 'Toi khang dinh da gap mat nguoi nay o nha van hoa xa.' });
    expect(res.status).toBe(403);

    // Truy vấn phải nhắm ĐÚNG dòng của lượt từ chối này. Lọc rộng
    // (`action LIKE '%denied'`) sẽ trúng dòng từ chối của bài trước và trả về
    // ngay lập tức, biến waitForRow thành vô dụng — đúng loại bài test xanh giả.
    const rows = await waitForRow(() =>
      db.raw(`SELECT action, detail FROM audit_log WHERE actor_id = ? AND action LIKE '%confirm-met.denied'`, [stranger])
    );
    expect(rows.length, 'không tìm thấy dòng nhật ký từ chối cho confirm-met').toBeGreaterThan(0);
    expect(rows[0].detail.code).toBe('FORBIDDEN');

    // Và đơn KHÔNG đổi trạng thái.
    const { rows: jr } = await db.raw(`SELECT status FROM join_requests WHERE id = ?`, [jrId]);
    expect(jr[0].status).toBe('pending');
  });

  it('confirm-met bởi đúng người bảo lãnh ⇒ met_confirmed + nhật ký', async () => {
    const res = await supertest(app)
      .post(`/api/v1/join-requests/${jrId}/confirm-met`)
      .set('Authorization', `Bearer ${accessTokenFor(referrer)}`)
      .send({ met_on: '2026-08-01', note: 'Toi da gap mat nguoi nay tai nha van hoa xa hom mung 1.' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('met_confirmed');

    const { rows } = await db.raw(
      `SELECT met_on, met_confirmed_by, met_note FROM join_requests WHERE id = ?`,
      [jrId]
    );
    expect(rows[0].met_confirmed_by).toBe(referrer);
    expect(rows[0].met_note).toContain('nha van hoa xa');

    const { rows: log } = await db.raw(
      `SELECT detail FROM audit_log WHERE action='join_request.met_confirmed' AND target_id = ?`,
      [jrId]
    );
    expect(log).toHaveLength(1);
    // Nội dung ghi chú là văn bản tự do — không được lọt vào nhật ký.
    expect(JSON.stringify(log[0].detail)).not.toContain('nha van hoa');
  });

  it('ghi chú ngắn hơn 20 ký tự bị chặn ngay ở zod', async () => {
    const res = await supertest(app)
      .post(`/api/v1/join-requests/${jrId}/confirm-met`)
      .set('Authorization', `Bearer ${accessTokenFor(referrer)}`)
      .send({ met_on: '2026-08-01', note: 'da gap' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('reject: approver ghi reason_code vào nhật ký; member thường bị chặn', async () => {
    const denied = await supertest(app)
      .post(`/api/v1/join-requests/${jrId}/reject`)
      .set('Authorization', `Bearer ${accessTokenFor(referrer)}`)
      .send({ reason_code: 'not_ready', note: 'Chua du dieu kien theo danh gia cua toi.' });
    expect(denied.status).toBe(403);

    const res = await supertest(app)
      .post(`/api/v1/join-requests/${jrId}/reject`)
      .set('Authorization', `Bearer ${accessTokenFor(approver)}`)
      .send({ reason_code: 'referrer_misrepresented', note: 'Nguoi bao lanh khai khong dung su that.' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('rejected');

    const { rows } = await db.raw(
      `SELECT detail FROM audit_log WHERE action='join_request.rejected' AND target_id = ?`,
      [jrId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].detail.reason_code).toBe('referrer_misrepresented');
  });

  it('approve chưa làm — ném NOT_IMPLEMENTED thay vì làm nửa vời (ranh giới Task 9)', async () => {
    const res = await supertest(app)
      .post(`/api/v1/join-requests/${jrId}/approve`)
      .set('Authorization', `Bearer ${accessTokenFor(approver)}`)
      .send({});
    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('NOT_IMPLEMENTED');
  });
});
