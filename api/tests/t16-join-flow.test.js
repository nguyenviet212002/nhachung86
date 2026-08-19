import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import argon2 from 'argon2';
import supertest from 'supertest';
import { resetDb, appKnex } from './helpers/db.js';
import { config } from '../src/config/index.js';
import { requestOtp, verifyOtp } from '../src/modules/auth/service.js';
import { consoleAdapter } from '../src/core/otp/console.js';
import { buildApp } from '../src/app.js';
import { withActor } from '../src/core/tx.js';

// ---------------------------------------------------------------------------
// T16 — luồng gia nhập chạy đầu-cuối (MỐC 1).
//
// Điều bài này canh KHÔNG phải "approve() trả về 200". Nó canh rằng ba thứ mà
// service CỐ Ý KHÔNG ĐỘNG TỚI vẫn có mặt sau khi duyệt: hộp liên hệ, tám mức
// riêng tư, và cạnh bảo lãnh. Cả ba do trg_member_bootstrap sinh, và app_role
// không có quyền ghi vào hai bảng chứa chúng — nên nếu trigger bị gỡ, không có
// đường nào để service "vá tạm", luồng duyệt sẽ hỏng ngay chứ không âm thầm
// tạo ra một thành viên thiếu hồ sơ.
// ---------------------------------------------------------------------------

let db, app, api, cid, otherCid, areaId, referrer, approver, stranger;
let jrApproved, memberId;

const NEW_PHONE = '0961000001';
const NEW_PASSWORD = 'mat-khau-du-manh-16';

beforeAll(async () => {
  db = await resetDb();
  app = appKnex();
  api = buildApp();

  // Đúng MỘT cộng đồng lúc đầu: resolveCommunityId() lấy cộng đồng CŨ NHẤT.
  // otherCid được tạo sau nên không cướp mất các bài đi qua HTTP.
  ({ rows: [{ id: cid }] } = await db.raw(
    `INSERT INTO communities (code,name) VALUES ('community-t16','Hoi dong nien 1986') RETURNING id`));
  ({ rows: [{ id: areaId }] } = await db.raw(
    `INSERT INTO areas (community_id, name) VALUES (?, 'Xa Khoai Chau') RETURNING id`, [cid]));

  referrer = await newMember('Nguoi Bao Lanh');
  approver = await newMember('Nguoi Duyet');
  stranger = await newMember('Nguoi La');
  await grantRole(referrer, 'member', cid);
  await grantRole(approver, 'approver', cid);
  await grantRole(stranger, 'member', cid);

  ({ rows: [{ id: otherCid }] } = await db.raw(
    `INSERT INTO communities (code,name) VALUES ('community-t16-khac','Cong dong khac') RETURNING id`));
});

afterAll(async () => {
  await db.destroy();
  await app.destroy();
});

let seq = 0;
async function newMember(name, communityId = cid) {
  seq += 1;
  const { rows: [m] } = await db.raw(
    `INSERT INTO members (community_id, full_name, status) VALUES (?, ?, 'member') RETURNING id`,
    [communityId, `${name} ${seq}`]);
  return m.id;
}

async function grantRole(memberId_, key, communityId) {
  await db.raw(
    `INSERT INTO member_roles (member_id, role_id, community_id)
     SELECT ?, r.id, ? FROM roles r WHERE r.key = ?`, [memberId_, communityId, key]);
}

function accessTokenFor(memberId_) {
  return jwt.sign({ sub: memberId_, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' });
}

async function freshOtpToken(phone) {
  let code;
  const spy = vi.spyOn(consoleAdapter, 'send').mockImplementation(async (a) => { code = a.code; });
  try {
    await requestOtp({ communityId: cid, phone, purpose: 'register' });
  } finally {
    spy.mockRestore();
  }
  const { otpToken } = await verifyOtp({ communityId: cid, phone, code, purpose: 'register' });
  return otpToken;
}

// Nộp đơn thật qua HTTP rồi (tuỳ chọn) cho người bảo lãnh xác nhận gặp mặt.
//
// referrerId mặc định là `referrer` nhưng phải truyền được: hạn mức bảo lãnh là
// 3 đơn / 12 tháng và trigger fn_guarantee_quota cưỡng chế thật, nên bài thứ tư
// dùng chung một người bảo lãnh sẽ hỏng vì REFERRAL_UNAVAILABLE — hỏng vì lý do
// không liên quan tới điều nó định kiểm.
async function submitJoinRequest({ phone, fullName, confirmMet = true, referrerId = referrer }) {
  const res = await supertest(api).post('/api/v1/auth/register').send({
    otp_token: await freshOtpToken(phone),
    phone,
    full_name: fullName,
    birth_year: 1986,
    area_id: areaId,
    referrer_id: referrerId,
    password: NEW_PASSWORD,
    terms: true,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const id = res.body.join_request_id;

  if (confirmMet) {
    const met = await supertest(api)
      .post(`/api/v1/join-requests/${id}/confirm-met`)
      .set('Authorization', `Bearer ${accessTokenFor(referrerId)}`)
      .send({ met_on: '2026-08-01', note: 'Toi da gap mat nguoi nay tai nha van hoa xa.' });
    expect(met.status, JSON.stringify(met.body)).toBe(200);
  }
  return id;
}

// ---------------------------------------------------------------------------
describe('T16 duyệt xong: hộp liên hệ, 8 mức riêng tư, đúng MỘT cạnh guarantee', () => {
  it('luồng đầy đủ xin mã → nộp đơn → xác nhận gặp mặt → duyệt', async () => {
    jrApproved = await submitJoinRequest({ phone: NEW_PHONE, fullName: 'Nguoi Moi Gia Nhap' });

    const res = await supertest(api)
      .post(`/api/v1/join-requests/${jrApproved}/approve`)
      .set('Authorization', `Bearer ${accessTokenFor(approver)}`)
      .send({ note: 'Ho so day du, nguoi bao lanh da xac nhan gap mat.' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    memberId = res.body.member_id;
    expect(memberId).toBeTruthy();

    const { rows: [m] } = await db.raw(`SELECT * FROM members WHERE id = ?`, [memberId]);
    expect(m.status).toBe('member');
    expect(m.full_name).toBe('Nguoi Moi Gia Nhap');
    expect(m.referrer_id).toBe(referrer);
    expect(m.joined_at).toBeTruthy();

    const { rows: [jr] } = await db.raw(`SELECT * FROM join_requests WHERE id = ?`, [jrApproved]);
    expect(jr.status).toBe('approved');
    expect(jr.member_id).toBe(memberId);
    expect(jr.approved_by).toBe(approver);
  });

  it('hộp liên hệ do trg_member_bootstrap sinh, và số điện thoại vào đúng ô', async () => {
    const { rows } = await db.raw(`SELECT * FROM member_contacts WHERE member_id = ?`, [memberId]);
    expect(rows, 'trg_member_bootstrap phải tạo hàng liên hệ').toHaveLength(1);
    expect(rows[0].phone).toBe(NEW_PHONE);
    expect(rows[0].community_id).toBe(cid);
    // Ba ô còn lại phải TRỐNG: approve() chỉ được điền số điện thoại, không
    // được đoán hộ zalo/messenger/địa chỉ từ số đó.
    expect(rows[0].zalo).toBeNull();
    expect(rows[0].messenger).toBeNull();
    expect(rows[0].address).toBeNull();
  });

  it('đúng TÁM mức riêng tư, đúng mặc định của spec dòng 852', async () => {
    const { rows } = await db.raw(
      `SELECT field_key, level FROM privacy_settings WHERE member_id = ? ORDER BY field_key`, [memberId]);
    expect(rows).toHaveLength(8);

    const byKey = Object.fromEntries(rows.map((r) => [r.field_key, r.level]));
    expect(byKey.phone).toBe('on_consent');
    expect(byKey.zalo).toBe('on_consent');
    expect(byKey.address).toBe('closed');
    expect(byKey.family).toBe('closed');
    expect(byKey.messenger).toBe('public');
    expect(byKey.job).toBe('public');
    expect(byKey.area).toBe('public');
    expect(byKey.price).toBe('public');
  });

  it('đúng MỘT cạnh guarantee, đi từ người bảo lãnh sang người mới', async () => {
    const { rows } = await db.raw(
      `SELECT * FROM member_relations WHERE kind = 'guarantee' AND member_b = ?`, [memberId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].member_a).toBe(referrer);
    expect(rows[0].community_id).toBe(cid);
    expect(rows[0].first_work_record_id).toBeNull();
  });

  it('mật khẩu người nộp đơn chọn sống sót qua bảng bí mật và verify được', async () => {
    const { rows: [m] } = await db.raw(`SELECT password_hash FROM members WHERE id = ?`, [memberId]);
    expect(m.password_hash.startsWith('$argon2')).toBe(true);
    expect(await argon2.verify(m.password_hash, NEW_PASSWORD)).toBe(true);
  });

  it('bảng bí mật được ĐỐT sau khi duyệt — số điện thoại thô không còn bản sao ngoài member_contacts', async () => {
    const { rows } = await db.raw(
      `SELECT * FROM join_request_secrets WHERE join_request_id = ?`, [jrApproved]);
    expect(rows, 'join_secret_consume phải xoá hàng sau khi trả về').toHaveLength(0);

    // Và không còn nằm trong applicant_data (đường rò cũ mà Ruling T8-f đóng).
    const { rows: [jr] } = await db.raw(`SELECT applicant_data FROM join_requests WHERE id = ?`, [jrApproved]);
    expect(JSON.stringify(jr.applicant_data)).not.toContain(NEW_PHONE);
    expect(JSON.stringify(jr.applicant_data)).not.toContain('$argon2');
  });

  it('nhật ký ghi đủ ba việc, và không dòng nào chứa số điện thoại', async () => {
    const { rows } = await db.raw(
      `SELECT action, detail FROM audit_log WHERE target_id IN (?, ?) ORDER BY seq`, [jrApproved, memberId]);
    const actions = rows.map((r) => r.action);
    expect(actions).toContain('join_request.secret_consumed');
    expect(actions).toContain('contact.written');
    expect(actions).toContain('join_request.approved');

    const written = rows.find((r) => r.action === 'contact.written');
    expect(written.detail).toEqual({ field: 'phone', first_fill: true });

    expect(JSON.stringify(rows)).not.toContain(NEW_PHONE);
  });

  it('người mới có mặt trong danh bạ (GET /members là Task 10 — đọc thẳng CSDL)', async () => {
    const { rows } = await db.raw(
      `SELECT m.full_name FROM members m
        WHERE m.community_id = ? AND m.status = 'member' ORDER BY m.full_name`, [cid]);
    expect(rows.map((r) => r.full_name)).toContain('Nguoi Moi Gia Nhap');
  });
});

// ---------------------------------------------------------------------------
describe('T16 hai bảng nằm ngoài tầm với của app_role', () => {
  it('app_role KHÔNG ghi được vào member_relations — nếu service lỡ chạm sẽ chết', async () => {
    await expect(app.raw(
      `INSERT INTO member_relations (community_id, kind, member_a, member_b)
       VALUES (?, 'guarantee', ?, ?)`, [cid, referrer, stranger]))
      .rejects.toThrow(/permission denied/i);

    await expect(app.raw(
      `UPDATE member_relations SET established_at = now() WHERE member_b = ?`, [memberId]))
      .rejects.toThrow(/permission denied/i);

    await expect(app.raw(`DELETE FROM member_relations WHERE member_b = ?`, [memberId]))
      .rejects.toThrow(/permission denied/i);

    // ...nhưng ĐỌC thì được: GET /members/me/relations sẽ cần đúng câu này.
    const { rows } = await app.raw(
      `SELECT kind FROM member_relations WHERE member_b = ?`, [memberId]);
    expect(rows).toHaveLength(1);
  });

  it('app_role KHÔNG đọc được join_request_secrets bằng SELECT thẳng', async () => {
    // Ràng buộc của CSDL, không phải danh sách cho phép ở tầng service. Một
    // route mới viết `SELECT * FROM join_request_secrets` sẽ chết ngay ở CSDL.
    await expect(app.raw(`SELECT * FROM join_request_secrets`))
      .rejects.toThrow(/permission denied/i);
    await expect(app.raw(`SELECT phone FROM join_request_secrets WHERE community_id = ?`, [cid]))
      .rejects.toThrow(/permission denied/i);
    await expect(app.raw(`UPDATE join_request_secrets SET phone = '0900000000'`))
      .rejects.toThrow(/permission denied/i);
    await expect(app.raw(`DELETE FROM join_request_secrets`))
      .rejects.toThrow(/permission denied/i);
  });

  it('join_secret_consume: chỉ approver CỦA CHÍNH CỘNG ĐỒNG ĐÓ gọi được', async () => {
    const jr = await submitJoinRequest({
      phone: '0961000009', fullName: 'Don Cho Duyet',
      referrerId: await newMember('Bao Lanh Rieng'),
    });

    // stranger có vai 'member', không phải approver.
    await expect(withActor(stranger, (trx) => trx.raw(`SELECT * FROM join_secret_consume(?)`, [jr])))
      .rejects.toThrow(/JOIN_SECRET_DENIED/);

    // Approver của cộng đồng KHÁC cũng không.
    const otherApprover = await newMember('Duyet Cong Dong Khac', otherCid);
    await grantRole(otherApprover, 'approver', otherCid);
    await expect(withActor(otherApprover, (trx) => trx.raw(`SELECT * FROM join_secret_consume(?)`, [jr])))
      .rejects.toThrow(/JOIN_SECRET_DENIED/);

    // Ngoài giao dịch có dấu người thực hiện thì không ai gọi được.
    await expect(app.raw(`SELECT * FROM join_secret_consume(?)`, [jr])).rejects.toThrow(/NO_ACTOR/);

    // Bí mật vẫn nguyên vẹn sau ba lượt bị từ chối.
    const { rows } = await db.raw(`SELECT count(*)::int AS n FROM join_request_secrets WHERE join_request_id = ?`, [jr]);
    expect(rows[0].n).toBe(1);
  });

  it('join_secret_consume: cửa chỉ mở đúng khoảnh khắc duyệt, không sớm hơn', async () => {
    // Đơn còn 'pending' (chưa ai xác nhận gặp mặt). approve() đã chặn ở tầng
    // ứng dụng, nhưng cổng này nằm trong CSDL để một route khác viết sau —
    // hoặc một kết nối app_role bị chiếm — cũng không mở sớm được.
    const jr = await submitJoinRequest({
      phone: '0961000010', fullName: 'Don Con Cho Gap Mat', confirmMet: false,
      referrerId: await newMember('Bao Lanh Rieng'),
    });
    await expect(withActor(approver, (trx) => trx.raw(`SELECT * FROM join_secret_consume(?)`, [jr])))
      .rejects.toThrow(/JOIN_SECRET_DENIED/);

    // ...và sau khi đơn đã được duyệt xong thì cửa đóng lại, không đọc lần hai.
    await expect(withActor(approver, (trx) => trx.raw(`SELECT * FROM join_secret_consume(?)`, [jrApproved])))
      .rejects.toThrow(/JOIN_SECRET_DENIED/);
  });
});

// ---------------------------------------------------------------------------
describe('T16 cổng met_confirmed — chặn ở CẢ tầng ứng dụng lẫn tầng CSDL', () => {
  it('đơn chưa xác nhận gặp mặt: approve trả 422, không tạo thành viên nào', async () => {
    const jr = await submitJoinRequest({
      phone: '0961000002', fullName: 'Chua Gap Mat', confirmMet: false,
      referrerId: await newMember('Bao Lanh Rieng'),
    });
    const before = (await db.raw(`SELECT count(*)::int AS n FROM members WHERE community_id = ?`, [cid])).rows[0].n;

    const res = await supertest(api)
      .post(`/api/v1/join-requests/${jr}/approve`)
      .set('Authorization', `Bearer ${accessTokenFor(approver)}`)
      .send({});
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('MET_CONFIRMATION_REQUIRED');

    const after = (await db.raw(`SELECT count(*)::int AS n FROM members WHERE community_id = ?`, [cid])).rows[0].n;
    expect(after).toBe(before);
  });

  // Ruling C11: bài trên MỘT MÌNH chỉ chạm chốt chặn viết trong approve(), nên
  // nó vẫn xanh cả khi trg_member_status_gate bị gỡ khỏi CSDL. Bài dưới đi
  // thẳng vào CSDL, bỏ qua hoàn toàn tầng ứng dụng.
  //
  // BẪY 3 (Ruling T8-g) — PHẢI dùng dạng CALLBACK db.transaction(async trx =>):
  // dạng thủ công `const trx = await db.transaction()` … `await trx.commit()`
  // RESOLVE BÌNH THƯỜNG dù ràng buộc hoãn tới COMMIT thất bại, và dữ liệu không
  // hề được ghi. Ràng buộc hoãn là loại lỗi DUY NHẤT chỉ xuất hiện ở lệnh
  // COMMIT, nên bài này viết bằng dạng thủ công sẽ xanh giả cả khi trigger bị gỡ.
  it('CSDL tự chặn: hàng members có referrer_id mà không đơn nào nối tới ⇒ COMMIT hỏng', async () => {
    await expect(
      db.transaction(async (trx) => {
        await trx.raw(
          `INSERT INTO members (community_id, full_name, status, referrer_id)
           VALUES (?, 'Lot Cong Met Confirmed', 'member', ?)`, [cid, referrer]);
        // Cố ý KHÔNG đặt join_requests.member_id. Câu INSERT trên chạy trót
        // lọt; chỉ tới lệnh COMMIT trigger hoãn mới soi và ném.
      })
    ).rejects.toThrow(/MEMBER_NEEDS_MET_CONFIRMATION/);

    const { rows } = await db.raw(
      `SELECT count(*)::int AS n FROM members WHERE full_name = 'Lot Cong Met Confirmed'`);
    expect(rows[0].n, 'giao dịch phải bị cuộn lại hoàn toàn').toBe(0);
  });

  it('đơn CHỈ có met_confirmed_at mới mở được cổng — nối đơn thôi chưa đủ', async () => {
    // Đơn ở trạng thái 'pending' (chưa ai xác nhận gặp mặt) nhưng vẫn được nối
    // member_id: cổng phải đọc met_confirmed_at, không phải chỉ sự tồn tại của
    // mối nối.
    const jr = await submitJoinRequest({
      phone: '0961000003', fullName: 'Noi Don Nhung Chua Gap', confirmMet: false,
      referrerId: await newMember('Bao Lanh Rieng'),
    });
    await expect(
      db.transaction(async (trx) => {
        const { rows: [m] } = await trx.raw(
          `INSERT INTO members (community_id, full_name, status, referrer_id)
           VALUES (?, 'Noi Don Nhung Chua Gap', 'member', ?) RETURNING id`, [cid, referrer]);
        await trx.raw(`UPDATE join_requests SET member_id = ? WHERE id = ?`, [m.id, jr]);
      })
    ).rejects.toThrow(/MEMBER_NEEDS_MET_CONFIRMATION/);
  });
});

// ---------------------------------------------------------------------------
describe('T16 sợi bảo lãnh là sự thật lịch sử', () => {
  it('không sửa lại được referrer_id của một người đã là member', async () => {
    await expect(db.raw(`UPDATE members SET referrer_id = ? WHERE id = ?`, [stranger, memberId]))
      .rejects.toThrow(/REFERRER_FROZEN/);
    await expect(db.raw(`UPDATE members SET referrer_id = NULL WHERE id = ?`, [memberId]))
      .rejects.toThrow(/REFERRER_FROZEN/);

    const { rows } = await db.raw(`SELECT referrer_id FROM members WHERE id = ?`, [memberId]);
    expect(rows[0].referrer_id).toBe(referrer);
  });

  it('cạnh guarantee chỉ tồn tại MỘT hướng: (B→A) bị chặn khi đã có (A→B)', async () => {
    // app_role không ghi được vào bảng này, nên phép thử phải chạy bằng owner —
    // đúng kịch bản "migration hoặc backfill viết sai" mà chỉ mục này canh
    // (spec mục 4.7 nói thẳng: đây là lưới an toàn, không phải rào chặn cho
    // luồng hằng ngày).
    await expect(db.raw(
      `INSERT INTO member_relations (community_id, kind, member_a, member_b)
       VALUES (?, 'guarantee', ?, ?)`, [cid, memberId, referrer]))
      .rejects.toThrow(/rel_guarantee_one_direction/);
  });

  it('cạnh guarantee không nối được hai cộng đồng', async () => {
    // members.referrer_id là khóa ngoại ĐƠN CỘT nên hàng members này chèn được;
    // chính trg_member_bootstrap mới là chỗ vỡ, vì member_relations dùng khóa
    // ngoại GHÉP (member_a, community_id). Nếu đổi về khóa đơn cột như spec
    // viết, câu này QUA và cộng đồng khác có một sợi bảo lãnh xuyên biên.
    const outsider = await newMember('Nguoi Cong Dong Khac', otherCid);
    await expect(db.raw(
      `INSERT INTO members (community_id, full_name, status, referrer_id)
       VALUES (?, 'Duoc Nguoi Cong Dong Khac Bao Lanh', 'guest', ?)`, [cid, outsider]))
      .rejects.toThrow(/rel_a_same_community|violates foreign key/i);
  });
});

// ---------------------------------------------------------------------------
describe('T16 contact_upsert — approver chỉ điền được ô còn trống', () => {
  it('approver không ghi đè được số điện thoại đã có', async () => {
    await expect(withActor(approver, (trx) =>
      trx.raw(`SELECT contact_upsert(?, 'phone', ?)`, [memberId, '0999999999'])))
      .rejects.toThrow(/CONTACT_WRITE_DENIED/);

    const { rows } = await db.raw(`SELECT phone FROM member_contacts WHERE member_id = ?`, [memberId]);
    expect(rows[0].phone).toBe(NEW_PHONE);
  });

  it('approver điền được ô CÒN TRỐNG, và lần đó có dấu vết', async () => {
    await withActor(approver, (trx) => trx.raw(`SELECT contact_upsert(?, 'zalo', ?)`, [memberId, 'zalo-nguoi-moi']));
    const { rows } = await db.raw(`SELECT zalo FROM member_contacts WHERE member_id = ?`, [memberId]);
    expect(rows[0].zalo).toBe('zalo-nguoi-moi');

    const { rows: log } = await db.raw(
      `SELECT detail FROM audit_log WHERE action = 'contact.written' AND target_id = ? ORDER BY seq DESC LIMIT 1`,
      [memberId]);
    expect(log[0].detail).toEqual({ field: 'zalo', first_fill: true });

    // ...và đúng một lần: lần thứ hai ô không còn trống nữa.
    await expect(withActor(approver, (trx) =>
      trx.raw(`SELECT contact_upsert(?, 'zalo', ?)`, [memberId, 'zalo-khac'])))
      .rejects.toThrow(/CONTACT_WRITE_DENIED/);
  });

  it('chính chủ thì sửa được bất cứ lúc nào', async () => {
    await withActor(memberId, (trx) => trx.raw(`SELECT contact_upsert(?, 'phone', ?)`, [memberId, '0961000099']));
    const { rows } = await db.raw(`SELECT phone FROM member_contacts WHERE member_id = ?`, [memberId]);
    expect(rows[0].phone).toBe('0961000099');
  });

  it('người ngoài không sờ được ô liên hệ của người khác', async () => {
    await expect(withActor(stranger, (trx) =>
      trx.raw(`SELECT contact_upsert(?, 'address', ?)`, [memberId, 'Dia chi bia'])))
      .rejects.toThrow(/CONTACT_WRITE_DENIED/);
  });

  it('tên trường ngoài danh sách trắng bị chặn TRƯỚC khi chạm format(%I)', async () => {
    await expect(withActor(memberId, (trx) =>
      trx.raw(`SELECT contact_upsert(?, ?, 'x')`, [memberId, 'password_hash'])))
      .rejects.toThrow(/BAD_FIELD/);
    await expect(withActor(memberId, (trx) =>
      trx.raw(`SELECT contact_upsert(?, ?, 'x')`, [memberId, 'phone" , address = "hacked'])))
      .rejects.toThrow(/BAD_FIELD/);
  });
});
