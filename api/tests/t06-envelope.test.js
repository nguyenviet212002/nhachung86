import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetDb } from './helpers/db.js';
import { withActor } from '../src/core/tx.js';
import { contactStates, envelope, CONTACT_FIELDS } from '../src/core/privacy.js';

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
    const states = await withActor(alice, (trx) => contactStates(trx, alice, [bob, carol], cid));

    expect(states.get(bob).phone).toMatchObject({ level: 'public' });
    expect(states.get(bob).zalo).toMatchObject({ level: 'on_consent', requestStatus: 'approved' });
    expect(states.get(bob).messenger).toMatchObject({ level: 'on_consent', requestStatus: 'pending' });
    expect(states.get(bob).address).toMatchObject({ level: 'on_consent', requestStatus: 'denied' });

    // LEFT JOIN không khớp -> cr.status là SQL NULL, qua driver pg thành JS
    // null (không phải undefined) -- sửa kỳ vọng cho khớp hành vi thật.
    expect(states.get(carol).phone).toMatchObject({ level: 'on_consent', requestStatus: null });
    // Carol không cấu hình zalo/messenger/address. Từ Task 13 contactStates()
    // sinh đủ TÁM trường cho mỗi người thay vì chỉ những trường có hàng
    // privacy_settings: level là null (không có cấu hình) nhưng trạng thái vẫn
    // được tính, và nó là 'closed'. Trước đây chỗ này là `undefined` và người
    // gọi phải nhớ tự mặc định thành closed — một mặc định nằm ở phía người
    // gọi là một mặc định sẽ có ngày ai đó quên.
    expect(states.get(carol).zalo).toMatchObject({ level: null, state: 'closed' });
  });

  it('không sinh lời gọi contact_read nào — chỉ đọc privacy_settings/contact_requests', async () => {
    // Kiểm gián tiếp: contactStates() không đụng member_contacts nên không
    // cách nào giá trị liên hệ thật rời khỏi hàm này. Nếu nó có gọi
    // contact_read, mỗi dòng sẽ tạo một dòng audit_log 'contact.read' —
    // ở đây phải là 0.
    const before = (await db.raw(`SELECT count(*)::int AS n FROM audit_log`)).rows[0].n;
    await withActor(alice, (trx) => contactStates(trx, alice, [bob, carol], cid));
    const after = (await db.raw(`SELECT count(*)::int AS n FROM audit_log`)).rows[0].n;
    expect(after).toBe(before);
  });
});

describe('T6 envelope() — value luôn null, kể cả self và visible', () => {
  it('duyệt đủ sáu trạng thái: value === null ở mọi trạng thái', async () => {
    const states = await withActor(alice, (trx) => contactStates(trx, alice, [bob, carol], cid));
    // Trạng thái 'self' nay do fn_privacy_state (CSDL) quyết, nên phải hỏi với
    // ĐÚNG người xem là bob — trước đây envelope() tự suy ra từ hai tham số
    // viewerId/targetId, tức người gọi có thể truyền một cặp không khớp với
    // map trạng thái mình vừa lấy về. Bỏ hai tham số đó đi là bỏ luôn cái bẫy.
    const selfStates = await withActor(bob, (trx) => contactStates(trx, bob, [bob], cid));
    const eBob = envelope(states.get(bob));
    const eSelf = envelope(selfStates.get(bob));
    const eCarol = envelope(states.get(carol));

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

    // Khẳng định gộp: TOÀN BỘ giá trị của BỐN TRƯỜNG LIÊN HỆ trong mọi bao bì
    // đã dựng ở trên đều null, ở mọi trạng thái.
    //
    // Vì sao chỉ bốn trường liên hệ chứ không phải cả tám: từ Task 13 bao bì
    // mang thêm job/area/price/family, và với chúng `value` CÓ đi kèm khi được
    // phép — chúng là nội dung của danh bạ và không có endpoint riêng nào để
    // đọc từng cái. Ranh giới đó là chủ ý, khai rõ ở FIELD_SPEC trong
    // core/privacy.js và có bài riêng canh (t13-privacy-eight-fields).
    for (const env of [eBob, eSelf, eCarol]) {
      for (const field of CONTACT_FIELDS) {
        expect(env[field].value, `trường liên hệ ${field}`).toBeNull();
      }
    }
  });
});
