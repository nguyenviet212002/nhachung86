import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetDb } from './helpers/db.js';
import { withActor } from '../src/core/tx.js';
import { contactStates, envelope } from '../src/core/privacy.js';

// Vòng sửa 1 (soát xét Task 6): trước bài này, contactStates() và envelope()
// — hàm dựng bao bì cho CẢ TRANG danh bạ bằng một truy vấn duy nhất — không
// có lưới hồi quy nào. envelope() là hàm nguy hiểm nhất của Task 6: nếu nó
// lỡ trả `value` thật thay vì `null` (kể cả ở state 'visible'/'self'), một
// trang danh bạ 20 người rò 20 số điện thoại cùng lúc, và không bài test nào
// bắt được — đúng kiểu sửa "sao trả null hết vậy, chắc quên" mà người sau dễ
// làm khi refactor. Bài dưới đây duyệt đủ SÁU trạng thái và khẳng định
// value === null ở MỌI trạng thái, kể cả 'self' và 'visible' — giá trị thật
// chỉ ra ở GET /members/:id/contacts/:field (readContact/contact_read), đó
// là lý do danh sách không sinh N lời gọi hàm và cũng không rò N số điện
// thoại cùng lúc.
let db, cid, alice, bob, carol;

beforeAll(async () => {
  db = await resetDb();
  ({ rows: [{ id: cid }] } = await db.raw(
    `INSERT INTO communities (code,name) VALUES ('community-006','X') RETURNING id`));
  const mk = async (name) => (await db.raw(
    `INSERT INTO members (community_id, full_name, status) VALUES (?,?,?) RETURNING id`,
    [cid, name, 'member'])).rows[0].id;
  alice = await mk('Alice'); // người xem (viewer)
  bob = await mk('Bob');
  carol = await mk('Carol');

  // UPDATE chứ không INSERT: từ migration 012, trg_member_bootstrap tạo sẵn hộp
  // liên hệ rỗng + 8 mức riêng tư mặc định ngay khi hàng members ra đời.
  const setContacts = (id, phone, zalo, messenger, address) => db.raw(
    `UPDATE member_contacts SET phone = ?, zalo = ?, messenger = ?, address = ? WHERE member_id = ?`,
    [phone, zalo, messenger, address, id]);
  await setContacts(bob, '0912000002', 'zalo-bob', 'fb.me/bob', '456 Bob Ave');
  await setContacts(carol, '0912000003', 'zalo-carol', 'fb.me/carol', '789 Carol Ave');

  // Bob: phone=public (visible), zalo=on_consent+đã approved cho alice
  // (visible), messenger=on_consent+đang chờ cho alice (requested),
  // address=on_consent+đã bị denied cho alice (denied).
  await db.raw(
    `UPDATE privacy_settings SET level = CASE field_key WHEN 'phone' THEN 'public' ELSE 'on_consent' END
      WHERE member_id = ? AND field_key IN ('phone','zalo','messenger','address')`, [bob]);
  await db.raw(
    `INSERT INTO contact_requests (community_id, requester_id, target_id, field_key, status) VALUES
       (?,?,?,?,'approved'),
       (?,?,?,?,'pending'),
       (?,?,?,?,'denied')`,
    [cid, alice, bob, 'zalo', cid, alice, bob, 'messenger', cid, alice, bob, 'address']);

  // Carol: phone=on_consent, alice chưa từng xin -> can_request.
  await db.raw(
    `UPDATE privacy_settings SET level = 'on_consent' WHERE member_id = ? AND field_key = 'phone'`,
    [carol]);
  // ...và XOÁ các trường còn lại của Carol để giữ nguyên kịch bản gốc của bài
  // này: "trường KHÔNG có hàng privacy_settings thì contactStates không sinh
  // trạng thái nào cho nó". trg_member_bootstrap nay tạo đủ 8 hàng cho mọi
  // member mới, nên phải xoá tường minh mới tái lập được kịch bản đó.
  await db.raw(`DELETE FROM privacy_settings WHERE member_id = ? AND field_key <> 'phone'`, [carol]);
});

afterAll(async () => { await db.destroy(); });

describe('T6 contactStates() — một truy vấn cho cả trang', () => {
  it('trả đúng bao bì cho nhiều người trong một lần gọi', async () => {
    const states = await withActor(alice, (trx) => contactStates(trx, alice, [bob, carol]));

    expect(states.get(bob).phone).toMatchObject({ level: 'public' });
    expect(states.get(bob).zalo).toMatchObject({ level: 'on_consent', requestStatus: 'approved' });
    expect(states.get(bob).messenger).toMatchObject({ level: 'on_consent', requestStatus: 'pending' });
    expect(states.get(bob).address).toMatchObject({ level: 'on_consent', requestStatus: 'denied' });

    // LEFT JOIN không khớp -> cr.status là SQL NULL, qua driver pg thành JS
    // null (không phải undefined) -- sửa kỳ vọng cho khớp hành vi thật.
    expect(states.get(carol).phone).toMatchObject({ level: 'on_consent', requestStatus: null });
    // Carol không cấu hình zalo/messenger/address -> không có dòng nào cho các trường đó.
    expect(states.get(carol).zalo).toBeUndefined();
  });

  it('không sinh lời gọi contact_read nào — chỉ đọc privacy_settings/contact_requests', async () => {
    // Kiểm gián tiếp: contactStates() không đụng member_contacts nên không
    // cách nào giá trị liên hệ thật rời khỏi hàm này. Nếu nó có gọi
    // contact_read, mỗi dòng sẽ tạo một dòng audit_log 'contact.read' —
    // ở đây phải là 0.
    const before = (await db.raw(`SELECT count(*)::int AS n FROM audit_log`)).rows[0].n;
    await withActor(alice, (trx) => contactStates(trx, alice, [bob, carol]));
    const after = (await db.raw(`SELECT count(*)::int AS n FROM audit_log`)).rows[0].n;
    expect(after).toBe(before);
  });
});

describe('T6 envelope() — value luôn null, kể cả self và visible', () => {
  it('duyệt đủ sáu trạng thái: value === null ở mọi trạng thái', async () => {
    const states = await withActor(alice, (trx) => contactStates(trx, alice, [bob, carol]));
    const eBob = envelope(states.get(bob), { viewerId: alice, targetId: bob });
    const eSelf = envelope(states.get(bob), { viewerId: bob, targetId: bob });
    const eCarol = envelope(states.get(carol), { viewerId: alice, targetId: carol });

    // self
    expect(eSelf.phone.state).toBe('self');
    expect(eSelf.phone.value).toBeNull();
    // visible (public)
    expect(eBob.phone.state).toBe('visible');
    expect(eBob.phone.value).toBeNull();
    // visible (on_consent đã approved)
    expect(eBob.zalo.state).toBe('visible');
    expect(eBob.zalo.value).toBeNull();
    // requested
    expect(eBob.messenger.state).toBe('requested');
    expect(eBob.messenger.value).toBeNull();
    // denied
    expect(eBob.address.state).toBe('denied');
    expect(eBob.address.value).toBeNull();
    // can_request
    expect(eCarol.phone.state).toBe('can_request');
    expect(eCarol.phone.value).toBeNull();
    // closed (carol chưa cấu hình zalo -> mặc định closed ở tầng envelope())
    expect(eCarol.zalo.state).toBe('closed');
    expect(eCarol.zalo.value).toBeNull();

    // Khẳng định gộp: TOÀN BỘ giá trị trong mọi bao bì đã dựng ở trên đều null.
    for (const env of [eBob, eSelf, eCarol]) {
      for (const field of Object.values(env)) {
        expect(field.value).toBeNull();
      }
    }
  });
});
