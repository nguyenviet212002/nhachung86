import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetDb, appKnex } from './helpers/db.js';
import { withActor } from '../src/core/tx.js';
import { readContact } from '../src/core/privacy.js';

// Vòng sửa 1 (soát xét Task 6): T04 chỉ canh MỘT kịch bản (level='closed',
// allowed=false). Bài này canh phần còn lại của contact_read() — cả nhánh
// "mở cửa" (allowed=true, có ghi contact.read) lẫn hai nhánh từ chối còn lại,
// cộng ba nhánh RAISE vốn là lỗi lập trình chứ không phải hành vi người dùng.
let db, app, cid, alice, bob, carol;

beforeAll(async () => {
  db = await resetDb();
  app = appKnex();
  ({ rows: [{ id: cid }] } = await db.raw(
    `INSERT INTO communities (code,name) VALUES ('community-005','X') RETURNING id`));
  const mk = async (name) => (await db.raw(
    `INSERT INTO members (community_id, full_name, status) VALUES (?,?,?) RETURNING id`,
    [cid, name, 'member'])).rows[0].id;
  alice = await mk('Alice');
  bob = await mk('Bob');
  carol = await mk('Carol');

  await db.raw(
    `INSERT INTO member_contacts (member_id, community_id, phone, zalo, messenger, address)
     VALUES (?,?,?,?,?,?)`,
    [bob, cid, '0912000001', 'zalo-bob', 'fb.me/bob', '123 Bob St']);

  // phone, zalo: on_consent (cần xin). messenger: public. address: không cấu
  // hình gì -> mặc định closed ở tầng CSDL (đã canh riêng ở T04).
  await db.raw(
    `INSERT INTO privacy_settings (community_id, member_id, field_key, level) VALUES
       (?,?,'phone','on_consent'),
       (?,?,'zalo','on_consent'),
       (?,?,'messenger','public')`,
    [cid, bob, cid, bob, cid, bob]);

  // alice đã được duyệt cho 'zalo'.
  await db.raw(
    `INSERT INTO contact_requests (community_id, requester_id, target_id, field_key, status)
     VALUES (?,?,?,?,'approved')`,
    [cid, alice, bob, 'zalo']);
  // carol từng xin 'phone' và bị từ chối.
  await db.raw(
    `INSERT INTO contact_requests (community_id, requester_id, target_id, field_key, status)
     VALUES (?,?,?,?,'denied')`,
    [cid, carol, bob, 'phone']);
});

afterAll(async () => {
  await db.destroy();
  await app.destroy();
});

async function auditRows(actorId, targetId) {
  const { rows } = await db.raw(
    `SELECT action, detail FROM audit_log WHERE actor_id = ? AND target_id = ? ORDER BY seq`,
    [actorId, targetId]);
  return rows;
}

describe('T5 nhánh cho phép của contact_read — cửa hông thật sự mở đúng', () => {
  it('chủ hồ sơ tự xem trường của chính mình (bỏ qua mức riêng tư)', async () => {
    const before = (await auditRows(bob, bob)).length;
    const r = await withActor(bob, (trx) => readContact(trx, bob, 'phone'));
    expect(r).toEqual({ allowed: true, value: '0912000001', reason: null });

    const rows = await auditRows(bob, bob);
    expect(rows.length).toBe(before + 1);
    expect(rows.at(-1).action).toBe('contact.read');
    expect(rows.at(-1).detail).toEqual({ field: 'phone', reason: 'ok' });
  });

  it('mức public: người khác đọc được ngay, không cần xin', async () => {
    const r = await withActor(alice, (trx) => readContact(trx, bob, 'messenger'));
    expect(r).toEqual({ allowed: true, value: 'fb.me/bob', reason: null });

    const rows = await auditRows(alice, bob);
    const last = rows.at(-1);
    expect(last.action).toBe('contact.read');
    expect(last.detail).toEqual({ field: 'messenger', reason: 'ok' });
  });

  it('mức on_consent với contact_requests đã approved: đọc được', async () => {
    const r = await withActor(alice, (trx) => readContact(trx, bob, 'zalo'));
    expect(r).toEqual({ allowed: true, value: 'zalo-bob', reason: null });

    const rows = await auditRows(alice, bob);
    const zaloRow = rows.filter((x) => x.detail.field === 'zalo').at(-1);
    expect(zaloRow.action).toBe('contact.read');
  });
});

describe('T5 nhánh từ chối còn lại của contact_read — vẫn allowed=false, không RAISE', () => {
  it('mức on_consent, chưa từng xin: NEEDS_CONSENT', async () => {
    const r = await withActor(carol, (trx) => readContact(trx, bob, 'zalo'));
    expect(r).toEqual({ allowed: false, value: null, reason: 'NEEDS_CONSENT' });

    const rows = await auditRows(carol, bob);
    const zaloRow = rows.filter((x) => x.detail.field === 'zalo').at(-1);
    expect(zaloRow.action).toBe('contact.denied');
    expect(zaloRow.detail).toEqual({ field: 'zalo', reason: 'NEEDS_CONSENT' });
  });

  it('mức on_consent, đơn đã bị denied (không phải approved): vẫn NEEDS_CONSENT', async () => {
    // Ghi chú phát hiện: contact_read() chỉ phân biệt "có ít nhất một đơn
    // approved" hay không — nó KHÔNG có mã lý do riêng cho "đã từng bị từ
    // chối". Một đơn denied và một người chưa từng xin trả về CÙNG reason
    // ('NEEDS_CONSENT'). Đây là hành vi đúng thiết kế (chủ ý không rò thông
    // tin "đã từng bị từ chối" qua reason), không phải lỗi — ghi lại ở đây để
    // không ai "sửa" nhầm thành hai reason khác nhau.
    const r = await withActor(carol, (trx) => readContact(trx, bob, 'phone'));
    expect(r).toEqual({ allowed: false, value: null, reason: 'NEEDS_CONSENT' });

    const rows = await auditRows(carol, bob);
    const phoneRow = rows.filter((x) => x.detail.field === 'phone').at(-1);
    expect(phoneRow.action).toBe('contact.denied');
  });
});

describe('T5 ba nhánh RAISE — lỗi lập trình, không phải hành vi người dùng', () => {
  it('NO_ACTOR: gọi contact_read ngoài withActor() thì ném lỗi', async () => {
    // `app` là một pool app_role MỚI, chưa từng chạy set_config('app.actor_id', ...)
    // trên bất kỳ kết nối nào của nó — current_setting trả NULL, đúng kịch bản
    // "gọi ngoài giao dịch có actor".
    await expect(app.raw('SELECT * FROM contact_read(?, ?)', [bob, 'phone']))
      .rejects.toThrow(/NO_ACTOR/);
  });

  it('BAD_FIELD: tên trường ngoài danh sách trắng thì ném lỗi', async () => {
    await expect(withActor(alice, (trx) => readContact(trx, bob, 'job')))
      .rejects.toThrow(/BAD_FIELD/);
  });

  it('NO_TARGET: member không tồn tại thì ném lỗi', async () => {
    await expect(withActor(alice, (trx) =>
      readContact(trx, '00000000-0000-0000-0000-000000000000', 'phone')))
      .rejects.toThrow(/NO_TARGET/);
  });
});
