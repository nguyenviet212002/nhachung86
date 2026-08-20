import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetDb } from './helpers/db.js';
import { withActor } from '../src/core/tx.js';
import { readContact, contactStates } from '../src/core/privacy.js';
import * as members from '../src/modules/members/service.js';
import * as areas from '../src/modules/areas/service.js';

// ---------------------------------------------------------------------------
// T10 — danh bạ. Đây là task làm lộ dữ liệu cá nhân nếu sai, nên bài test canh
// bốn thứ theo đúng thứ tự nguy hiểm giảm dần:
//
//   1. Danh sách KHÔNG BAO GIỜ trả `value`, kể cả trường mức public. Rò ở đây
//      là rò cả trang một lúc (nguyên tắc 4 — kịch bản tận thế của mục 5.2).
//   2. Không rò CHÉO CỘNG ĐỒNG: cả ở danh sách lẫn ở cửa đọc từng trường.
//   3. Bị từ chối đọc liên hệ thì VẪN PHẢI CÒN dòng nhật ký từ chối (bẫy 1:
//      contact_read ghi log rồi trả về, ném lỗi trong cùng giao dịch sẽ cuộn
//      mất dòng đó).
//   4. Mở một trang danh bạ đẻ ĐÚNG MỘT dòng member.list, không phải N dòng.
// ---------------------------------------------------------------------------

let db;
let cid, otherCid;
let areaHn, areaHy, areaOther;
let alice, bob, carol, dave, guestMan, eveOther;
let alicePage; // actor dùng chung

const PAGE_MEMBER_COUNT = 12; // dave + 11 người "Zz Filler" để phân trang có việc làm

async function mkMember(communityId, { fullName, job = null, areaId = null, status = 'member', workStatus = 'available' }) {
  const { rows: [m] } = await db.raw(
    `INSERT INTO members (community_id, full_name, job, area_id, status, work_status)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    [communityId, fullName, job, areaId, status, workStatus]
  );
  return m.id;
}

// member_contacts bị REVOKE ALL khỏi app_role; ở đây dùng kết nối OWNER của test
// để gieo dữ liệu, và là UPDATE chứ không INSERT vì trg_member_bootstrap
// (migration 012) đã tạo sẵn hộp rỗng ngay khi hàng members ra đời.
async function setContacts(id, { phone = null, zalo = null, messenger = null, address = null }) {
  await db.raw(
    `UPDATE member_contacts SET phone=?, zalo=?, messenger=?, address=? WHERE member_id = ?`,
    [phone, zalo, messenger, address, id]
  );
}

async function setLevel(id, field, level) {
  await db.raw(`UPDATE privacy_settings SET level = ? WHERE member_id = ? AND field_key = ?`, [level, id, field]);
}

async function countAudit(action, communityId = cid) {
  const { rows: [{ n }] } = await db.raw(
    `SELECT count(*)::int AS n FROM audit_log WHERE action = ? AND community_id = ?`,
    [action, communityId]
  );
  return n;
}

beforeAll(async () => {
  db = await resetDb();

  ({ rows: [{ id: cid }] } = await db.raw(
    `INSERT INTO communities (code,name) VALUES ('community-t10','Hoi dong nien 1986') RETURNING id`));
  ({ rows: [{ id: otherCid }] } = await db.raw(
    `INSERT INTO communities (code,name) VALUES ('community-t10-khac','Cong dong khac') RETURNING id`));

  ({ rows: [{ id: areaHn }] } = await db.raw(
    `INSERT INTO areas (community_id, name) VALUES (?, 'Xa Khoai Chau') RETURNING id`, [cid]));
  ({ rows: [{ id: areaHy }] } = await db.raw(
    `INSERT INTO areas (community_id, name, parent_id) VALUES (?, 'Thon Dong', ?) RETURNING id`, [cid, areaHn]));
  ({ rows: [{ id: areaOther }] } = await db.raw(
    `INSERT INTO areas (community_id, name) VALUES (?, 'Khu vuc cong dong khac') RETURNING id`, [otherCid]));

  alice = await mkMember(cid, { fullName: 'Alice Nguoi Xem', job: 'Giao vien', areaId: areaHn });
  bob = await mkMember(cid, { fullName: 'Bob Tho Dien', job: 'Tho dien nuoc', areaId: areaHn });
  carol = await mkMember(cid, { fullName: 'Carol Tho Han', job: 'Tho han', areaId: areaHy, workStatus: 'paused' });
  dave = await mkMember(cid, { fullName: 'Dave Tho Dien', job: 'Tho dien nuoc', areaId: areaHy });
  guestMan = await mkMember(cid, { fullName: 'Guest Chua Duyet', job: 'Tho moc', areaId: areaHn, status: 'guest' });

  for (let i = 0; i < PAGE_MEMBER_COUNT - 1; i += 1) {
    await mkMember(cid, { fullName: `Zz Filler ${String(i).padStart(2, '0')}`, job: 'Tho xay', areaId: areaHn });
  }

  eveOther = await mkMember(otherCid, { fullName: 'Eve Cong Dong Khac', job: 'Tho dien nuoc', areaId: areaOther });

  await setContacts(bob, { phone: '0912000002', zalo: 'zalo-bob', messenger: 'fb.me/bob', address: '456 Bob' });
  await setContacts(carol, { phone: '0912000003', zalo: 'zalo-carol', messenger: 'fb.me/carol', address: '789 Carol' });
  await setContacts(eveOther, { phone: '0912999999', zalo: 'zalo-eve', messenger: 'fb.me/eve', address: 'Nha Eve' });

  // Bob: phone công khai — đây là ca then chốt của bài 1 (mức public mà danh
  // sách VẪN không được trả giá trị).
  await setLevel(bob, 'phone', 'public');
  // Carol: address đóng hẳn, phone giữ mặc định on_consent.
  await setLevel(carol, 'address', 'closed');
  // Eve ở cộng đồng khác để phone công khai — nếu có đường rò chéo cộng đồng
  // thì đây là hàng dữ liệu sẽ chảy ra.
  await setLevel(eveOther, 'phone', 'public');

  alicePage = { id: alice, communityId: cid, roles: ['member'] };
});

afterAll(async () => {
  await db.destroy();
});

// ---------------------------------------------------------------------------
describe('T10.1 danh sách KHÔNG BAO GIỜ trả value, kể cả trường mức public', () => {
  it('mọi trường của mọi người trong trang đều có value === null', async () => {
    const res = await members.list({ actor: alicePage, filters: {}, page: 1, limit: 100 });

    let fieldCount = 0;
    for (const m of res.data) {
      for (const f of Object.values(m.contacts)) {
        expect(f.value, `${m.full_name} rò giá trị liên hệ ra danh sách`).toBeNull();
        fieldCount += 1;
      }
    }
    // Khẳng định bài test THẬT SỰ có gì để duyệt: 4 trường × số người.
    expect(fieldCount).toBe(res.data.length * 4);
    expect(res.data.length).toBeGreaterThan(10);
  });

  it('có ít nhất một trường state="visible" trong trang — và nó vẫn value null', async () => {
    const res = await members.list({ actor: alicePage, filters: {}, page: 1, limit: 100 });
    const bobRow = res.data.find((m) => m.id === bob);

    // phone của Bob mức public ⇒ state 'visible' (được phép xem), nhưng danh
    // sách vẫn không đưa số ra. Nếu khẳng định này rớt thì hoặc envelope() đã
    // đổi nghĩa, hoặc dữ liệu gieo sai — cả hai đều làm bài trên mất sức nặng.
    expect(bobRow.contacts.phone.state).toBe('visible');
    expect(bobRow.contacts.phone.level).toBe('public');
    expect(bobRow.contacts.phone.value).toBeNull();

    const visible = res.data.flatMap((m) => Object.values(m.contacts)).filter((f) => f.state === 'visible');
    expect(visible.length).toBeGreaterThan(0);
    for (const f of visible) expect(f.value).toBeNull();
  });

  it('hồ sơ chi tiết cũng không trả value, và không trả email/lat/lng/password_hash', async () => {
    const profile = await members.get({ actor: alicePage, id: bob });
    for (const f of Object.values(profile.contacts)) expect(f.value).toBeNull();

    // Vỏ HTTP chỉ được chứa những khoá đã có người quyết định đưa ra. Danh sách
    // này là bản sao tường minh của members/service.js#detailRow.
    expect(Object.keys(profile).sort()).toEqual(
      ['area', 'avatar_url', 'bio', 'birth_year', 'contacts', 'cover_url', 'full_name', 'id', 'job', 'joined_at', 'profile_fields', 'status', 'work_status'].sort()
    );
    for (const forbidden of ['email', 'lat', 'lng', 'password_hash', 'erased_at', 'community_id', 'referrer_id']) {
      expect(profile[forbidden], `hồ sơ không được chứa ${forbidden}`).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
describe('T10.2 bị từ chối đọc liên hệ VẪN để lại dòng nhật ký (bẫy 1)', () => {
  it('phone mức on_consent chưa xin: ném CONTACT_NEEDS_CONSENT và dòng contact.denied SỐNG SÓT', async () => {
    const before = await countAudit('contact.denied');

    await expect(
      members.readContactField({ actor: alicePage, id: carol, field: 'phone' })
    ).rejects.toMatchObject({ code: 'CONTACT_NEEDS_CONSENT', status: 403 });

    // Đây là phép canh bẫy 1. Nếu readContactField ném AppError TRONG giao dịch
    // withActor (đúng như mã mẫu kế hoạch viết), rollback xoá luôn dòng nhật ký
    // mà contact_read vừa ghi, và con số dưới đây bằng `before`.
    expect(await countAudit('contact.denied')).toBe(before + 1);

    const { rows: [last] } = await db.raw(
      `SELECT actor_id, target_id, detail FROM audit_log
        WHERE action = 'contact.denied' AND community_id = ? ORDER BY seq DESC LIMIT 1`, [cid]);
    expect(last.actor_id).toBe(alice);
    expect(last.target_id).toBe(carol);
    expect(last.detail).toEqual({ field: 'phone', reason: 'NEEDS_CONSENT' });
  });

  it('address mức closed: ném CONTACT_CLOSED và dòng contact.denied cũng sống sót', async () => {
    const before = await countAudit('contact.denied');

    await expect(
      members.readContactField({ actor: alicePage, id: carol, field: 'address' })
    ).rejects.toMatchObject({ code: 'CONTACT_CLOSED', status: 403 });

    expect(await countAudit('contact.denied')).toBe(before + 1);
    const { rows: [last] } = await db.raw(
      `SELECT detail FROM audit_log WHERE action = 'contact.denied' AND community_id = ?
        ORDER BY seq DESC LIMIT 1`, [cid]);
    expect(last.detail).toEqual({ field: 'address', reason: 'CLOSED' });
  });

  it('được phép đọc: trả giá trị thật và ghi contact.read', async () => {
    const before = await countAudit('contact.read');
    const res = await members.readContactField({ actor: alicePage, id: bob, field: 'phone' });
    expect(res).toEqual({ value: '0912000002' });
    expect(await countAudit('contact.read')).toBe(before + 1);
  });

  it('tự đọc liên hệ của chính mình luôn được', async () => {
    await setContacts(alice, { phone: '0912000001' });
    const res = await members.readContactField({ actor: alicePage, id: alice, field: 'phone' });
    expect(res).toEqual({ value: '0912000001' });
  });
});

// ---------------------------------------------------------------------------
describe('T10.3 lọc, phân trang, và KHÔNG rò người của cộng đồng khác', () => {
  it('không có người của cộng đồng khác trong danh sách, dù trùng nghề', async () => {
    const res = await members.list({ actor: alicePage, filters: { job: 'Tho dien nuoc' }, page: 1, limit: 100 });
    const ids = res.data.map((m) => m.id);
    expect(ids).toContain(bob);
    expect(ids).toContain(dave);
    expect(ids, 'Eve thuộc cộng đồng khác, không được xuất hiện').not.toContain(eveOther);
    expect(res.meta.total).toBe(2);
  });

  it('lọc theo area_id chỉ trả người của đúng khu vực đó', async () => {
    const res = await members.list({ actor: alicePage, filters: { areaId: areaHy }, page: 1, limit: 100 });
    const ids = res.data.map((m) => m.id).sort();
    expect(ids).toEqual([carol, dave].sort());
    for (const m of res.data) expect(m.area.id).toBe(areaHy);
  });

  it('area_id của cộng đồng khác trả 0 người, không trả Eve', async () => {
    const res = await members.list({ actor: alicePage, filters: { areaId: areaOther }, page: 1, limit: 100 });
    expect(res.data).toEqual([]);
    expect(res.meta.total).toBe(0);
  });

  it('lọc theo status: guest tách khỏi member', async () => {
    const guests = await members.list({ actor: alicePage, filters: { status: 'guest' }, page: 1, limit: 100 });
    expect(guests.data.map((m) => m.id)).toEqual([guestMan]);

    const asMembers = await members.list({ actor: alicePage, filters: { status: 'member' }, page: 1, limit: 100 });
    expect(asMembers.data.map((m) => m.id)).not.toContain(guestMan);
  });

  // Mặc định là quyết định về riêng tư, không phải chuyện tiện tay: `guest` là
  // người chưa được duyệt, `left` là người đã rời. Hiện họ trong danh bạ đang
  // hoạt động là rò trạng thái tư cách thành viên của họ cho cả cộng đồng.
  it('KHÔNG khai status thì mặc định chỉ trả member — không lộ guest, không lộ left', async () => {
    const mac_dinh = await members.list({ actor: alicePage, filters: {}, page: 1, limit: 100 });
    for (const m of mac_dinh.data) {
      expect(m.status, `"${m.full_name}" không phải member mà vẫn lọt vào danh bạ mặc định`).toBe('member');
    }
    expect(mac_dinh.data.map((m) => m.id)).not.toContain(guestMan);

    // Và khai rõ thì vẫn xem được — đây là mặc định an toàn, không phải cấm cửa.
    const khai_ro = await members.list({ actor: alicePage, filters: { status: 'guest' }, page: 1, limit: 100 });
    expect(khai_ro.data.map((m) => m.id)).toContain(guestMan);
  });

  it('lọc theo work_status', async () => {
    const res = await members.list({ actor: alicePage, filters: { workStatus: 'paused' }, page: 1, limit: 100 });
    expect(res.data.map((m) => m.id)).toEqual([carol]);
  });

  it('q tìm theo tên, bỏ dấu', async () => {
    const res = await members.list({ actor: alicePage, filters: { q: 'carol' }, page: 1, limit: 100 });
    expect(res.data.map((m) => m.id)).toEqual([carol]);
  });

  it('ký tự đại diện của LIKE do người dùng gõ bị thoát, không biến bộ lọc thành "khớp tất cả"', async () => {
    // '%' trong mẫu tìm kiếm phải là KÝ TỰ PHẦN TRĂM, không phải wildcard —
    // nếu không, một bộ lọc nghề nghiệp im lặng ngừng lọc.
    const res = await members.list({ actor: alicePage, filters: { job: '%' }, page: 1, limit: 100 });
    expect(res.data).toEqual([]);
  });

  it('phân trang: hai trang rời nhau, tổng đúng kể cả khi trang vượt quá cuối', async () => {
    const all = await members.list({ actor: alicePage, filters: {}, page: 1, limit: 100 });
    const total = all.meta.total;
    expect(total).toBeGreaterThan(10);

    const p1 = await members.list({ actor: alicePage, filters: {}, page: 1, limit: 5 });
    const p2 = await members.list({ actor: alicePage, filters: {}, page: 2, limit: 5 });
    expect(p1.data).toHaveLength(5);
    expect(p2.data).toHaveLength(5);
    expect(p1.meta).toMatchObject({ page: 1, limit: 5, total });
    expect(p2.meta).toMatchObject({ page: 2, limit: 5, total });

    const overlap = p1.data.map((m) => m.id).filter((id) => p2.data.some((m) => m.id === id));
    expect(overlap).toEqual([]);
    // Thứ tự ổn định theo full_name: trang 1 + trang 2 phải khớp 10 người đầu.
    expect([...p1.data, ...p2.data].map((m) => m.id)).toEqual(all.data.slice(0, 10).map((m) => m.id));

    // Trang vượt quá cuối: KHÔNG được báo total = 0. Đây là chỗ mã mẫu kế hoạch
    // (`count(*) OVER ()` rồi đọc `rows[0]?.total ?? 0`) sai — trang rỗng không
    // có hàng nào để đọc `total` ra.
    const beyond = await members.list({ actor: alicePage, filters: {}, page: 99, limit: 5 });
    expect(beyond.data).toEqual([]);
    expect(beyond.meta.total).toBe(total);
  });
});

// ---------------------------------------------------------------------------
describe('T10.4 chặn đọc liên hệ CHÉO CỘNG ĐỒNG', () => {
  it('readContactField với người của cộng đồng khác trả NOT_FOUND, không trả số', async () => {
    await expect(
      members.readContactField({ actor: alicePage, id: eveOther, field: 'phone' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('contact_read (tầng CSDL) tự chặn, không dựa vào service — migration 012a', async () => {
    // Đây mới là chốt thật. Nếu chỉ có service kiểm thì route thứ hai nào gọi
    // contact_read mà quên kiểm sẽ mở lại nguyên vẹn đường rò. Trước 012a, câu
    // dưới đây trả {allowed: true, value: '0912999999'} — đã tái hiện thật.
    await expect(
      withActor(alice, (trx) => readContact(trx, eveOther, 'phone'))
    ).rejects.toThrow(/NO_TARGET/);
  });

  it('contactStates() lọc community_id, không chỉ lọc theo danh sách id truyền vào', async () => {
    // Người gọi hôm nay luôn truyền ids đã lọc cộng đồng, nên nếu không có bài
    // này thì bộ lọc community_id trong contactStates() là trang trí: gỡ ra
    // không bài nào đỏ. Bài này gọi thẳng hàm với một id CỐ Ý sai cộng đồng.
    const leaked = await withActor(alice, (trx) => contactStates(trx, alice, [eveOther], cid));
    expect(leaked.get(eveOther), 'không được trả trạng thái của người thuộc cộng đồng khác').toBeUndefined();

    // Và khẳng định đối chứng: cùng câu đó với ĐÚNG cộng đồng của Eve thì có dữ
    // liệu — tức bài trên đỏ vì bộ lọc chứ không phải vì Eve không có hàng nào.
    const real = await withActor(alice, (trx) => contactStates(trx, alice, [eveOther], otherCid));
    expect(real.get(eveOther).phone).toMatchObject({ level: 'public' });
  });

  it('contactStates() từ chối chạy khi thiếu communityId thay vì im lặng bỏ lọc', async () => {
    await expect(withActor(alice, (trx) => contactStates(trx, alice, [bob]))).rejects.toThrow(/communityId/);
  });

  it('GET hồ sơ người của cộng đồng khác trả NOT_FOUND', async () => {
    await expect(members.get({ actor: alicePage, id: eveOther })).rejects.toMatchObject({
      code: 'NOT_FOUND', status: 404,
    });
  });
});

// ---------------------------------------------------------------------------
describe('T10.5 nhật ký: MỘT dòng cho cả trang, không phải N dòng', () => {
  it('mở một trang 12 người sinh đúng MỘT dòng member.list', async () => {
    const before = await countAudit('member.list');
    const res = await members.list({ actor: alicePage, filters: {}, page: 1, limit: 12 });
    expect(res.data).toHaveLength(12);
    expect(await countAudit('member.list')).toBe(before + 1);
  });

  it('mở một trang KHÔNG sinh dòng contact.read/contact.denied nào', async () => {
    const readBefore = await countAudit('contact.read');
    const deniedBefore = await countAudit('contact.denied');
    await members.list({ actor: alicePage, filters: {}, page: 1, limit: 100 });
    // Nếu danh sách lỡ gọi contact_read từng người (bài toán N+1 mà mục 6 đặc
    // tả nói "không tồn tại do thiết kế"), mỗi người sẽ đẻ một dòng ở đây.
    expect(await countAudit('contact.read')).toBe(readBefore);
    expect(await countAudit('contact.denied')).toBe(deniedBefore);
  });

  it('detail của member.list chỉ chứa số đếm/bộ lọc, KHÔNG chứa chuỗi tìm kiếm', async () => {
    await members.list({ actor: alicePage, filters: { q: '0912000002', job: 'Tho dien nuoc' }, page: 2, limit: 7 });
    const { rows: [row] } = await db.raw(
      `SELECT detail FROM audit_log WHERE action = 'member.list' AND community_id = ?
        ORDER BY seq DESC LIMIT 1`, [cid]);

    expect(row.detail).toMatchObject({ page: 2, limit: 7, has_q: true, has_job: true });
    const asText = JSON.stringify(row.detail);
    expect(asText, 'chuỗi người dùng gõ không được vào nhật ký').not.toContain('0912000002');
    expect(asText).not.toContain('Tho dien nuoc');
  });
});

// ---------------------------------------------------------------------------
describe('T10.6 profile_views + audit profile.view', () => {
  it('xem hồ sơ người khác ghi một hàng profile_views và một dòng profile.view', async () => {
    const { rows: [{ n: pvBefore }] } = await db.raw(
      `SELECT count(*)::int AS n FROM profile_views WHERE target_id = ?`, [bob]);
    const auditBefore = await countAudit('profile.view');

    await members.get({ actor: alicePage, id: bob });

    const { rows: [{ n: pvAfter }] } = await db.raw(
      `SELECT count(*)::int AS n FROM profile_views WHERE target_id = ? AND viewer_id = ?`, [bob, alice]);
    expect(pvAfter).toBe(pvBefore + 1);
    expect(await countAudit('profile.view')).toBe(auditBefore + 1);
  });

  it('tự xem hồ sơ mình KHÔNG ghi profile_views (nhưng vẫn ghi nhật ký)', async () => {
    const { rows: [{ n: before }] } = await db.raw(
      `SELECT count(*)::int AS n FROM profile_views WHERE target_id = ?`, [alice]);
    const auditBefore = await countAudit('profile.view');

    const me = await members.get({ actor: alicePage, id: alice });
    expect(me.contacts.phone.state).toBe('self');
    expect(me.contacts.phone.value).toBeNull();

    const { rows: [{ n: after }] } = await db.raw(
      `SELECT count(*)::int AS n FROM profile_views WHERE target_id = ?`, [alice]);
    expect(after).toBe(before);
    expect(await countAudit('profile.view')).toBe(auditBefore + 1);
  });
});

// ---------------------------------------------------------------------------
describe('T10.7 GET /areas — cây khu vực của đúng cộng đồng người gọi', () => {
  it('trả cây lồng nhau, không lẫn khu vực của cộng đồng khác', async () => {
    const res = await areas.tree({ actor: alicePage });
    expect(res.data).toHaveLength(1);
    expect(res.data[0]).toMatchObject({ id: areaHn, name: 'Xa Khoai Chau', parent_id: null });
    expect(res.data[0].children).toHaveLength(1);
    expect(res.data[0].children[0]).toMatchObject({ id: areaHy, name: 'Thon Dong', parent_id: areaHn });

    const flat = JSON.stringify(res.data);
    expect(flat).not.toContain(areaOther);
    expect(flat).not.toContain('Khu vuc cong dong khac');
  });

  // Người đang điền đơn gia nhập CHƯA đăng nhập, mà `POST /auth/register` bắt
  // buộc `area_id` — nên danh mục khu vực phải với tới được khi chưa có actor.
  // Mở được vì `areas` là tên thôn/xã, danh mục hành chính công khai, không gắn
  // với người nào. Ranh giới dừng đúng ở đây: mở danh sách THÀNH VIÊN thì vô
  // hiệu hoá toàn bộ cơ chế chống dò của `/auth/register`.
  it('gọi được khi CHƯA đăng nhập — không có actor vẫn ra cây khu vực', async () => {
    const res = await areas.tree({ actor: undefined, communityId: cid });
    expect(res.data).toHaveLength(1);
    expect(res.data[0].name).toBe('Xa Khoai Chau');

    const flat = JSON.stringify(res.data);
    expect(flat, 'khách chưa đăng nhập vẫn không được thấy cộng đồng khác').not.toContain(areaOther);
  });
});
