import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { resetDb } from './helpers/db.js';
import { withActor } from '../src/core/tx.js';
import { contactStates, envelope, FIELDS, CONTACT_FIELDS, PROFILE_FIELDS } from '../src/core/privacy.js';
import * as members from '../src/modules/members/service.js';

// ---------------------------------------------------------------------------
// T13 — TÁM trường riêng tư, MỘT luật (việc thừa kế (a), Ruling T11-f).
//
// Trước task này: job, area, price, family có hàng trong privacy_settings và
// màn "Quyền riêng tư" cho người dùng gạt nút, nhưng GET /members trả `job` và
// `area` như cột thường. Hai bên độc lập đã kiểm chứng: đặt job và area thành
// 'closed' ⇒ danh sách VẪN TRẢ ĐỦ.
//
// Một cái nút không nối vào đâu cả thì tệ hơn không có nút: nó hứa một sự bảo
// vệ không tồn tại, và người ta sẽ dựa vào lời hứa đó mà khai thật. Trong cộng
// đồng 52 người, `area` cộng `job` là đủ để định danh một người.
//
// Bài này canh BỐN thứ, xếp theo mức nguy hiểm giảm dần:
//   1. Gạt 'closed' thì giá trị THẬT SỰ biến mất khỏi danh sách và khỏi hồ sơ.
//   2. BỘ LỌC không thành kênh phụ: `?job=` và `?area_id=` không tìm ra được
//      người đã đóng trường đó. Che giá trị mà để hở bộ lọc là che một nửa.
//   3. Cả tám trường đi qua CÙNG MỘT luật (fn_privacy_state) — mở bằng đơn xin
//      quyền cho `job` phải hoạt động y hệt như với `phone`, không phải một
//      nhánh `if` riêng.
//   4. Ranh giới giữa hai nhóm vẫn nguyên: trường liên hệ KHÔNG BAO GIỜ mang
//      giá trị trong bao bì, kể cả khi được phép xem.
// ---------------------------------------------------------------------------

let db, cid, otherCid, areaId, areaOther, alice, bob, eve;
let aliceActor, bobActor;

async function mk(communityId, fullName, job, area) {
  const { rows: [m] } = await db.raw(
    `INSERT INTO members (community_id, full_name, job, area_id, status)
     VALUES (?,?,?,?, 'member') RETURNING id`, [communityId, fullName, job, area]);
  return m.id;
}

const setLevel = (id, field, level) => db.raw(
  `UPDATE privacy_settings SET level = ? WHERE member_id = ? AND field_key = ?`, [level, id, field]);

async function rowOf(actor, targetId, filters = {}) {
  const res = await members.list({ actor, filters, page: 1, limit: 100 });
  return res.data.find((m) => m.id === targetId);
}

beforeAll(async () => {
  db = await resetDb();
  ({ rows: [{ id: cid }] } = await db.raw(
    `INSERT INTO communities (code,name) VALUES ('community-t13-priv','Hoi') RETURNING id`));
  ({ rows: [{ id: otherCid }] } = await db.raw(
    `INSERT INTO communities (code,name) VALUES ('community-t13-priv-khac','Khac') RETURNING id`));
  ({ rows: [{ id: areaId }] } = await db.raw(
    `INSERT INTO areas (community_id, name) VALUES (?, 'Xa Khoai Chau') RETURNING id`, [cid]));
  ({ rows: [{ id: areaOther }] } = await db.raw(
    `INSERT INTO areas (community_id, name) VALUES (?, 'Khu khac') RETURNING id`, [otherCid]));

  alice = await mk(cid, 'Alice Nguoi Xem', 'Giao vien', areaId);
  bob = await mk(cid, 'Bob Bac Si', 'Bac si da khoa', areaId);
  eve = await mk(otherCid, 'Eve Cong Dong Khac', 'Bac si da khoa', areaOther);

  aliceActor = { id: alice, communityId: cid, roles: ['member'] };
  bobActor = { id: bob, communityId: cid, roles: ['member'] };
});

afterAll(async () => { await db.destroy(); });

// Mỗi bài tự đặt lại mức về mặc định của fn_member_bootstrap để không phụ
// thuộc thứ tự chạy (bài phụ thuộc trạng thái bài trước là bài giòn).
beforeEach(async () => {
  await db.raw(
    `UPDATE privacy_settings SET level = 'public' WHERE member_id = ? AND field_key IN ('job','area')`,
    [bob]);
  await db.raw(`DELETE FROM contact_requests WHERE target_id = ?`, [bob]);
});

describe('T13.1 gạt "closed" thì job/area THẬT SỰ biến mất', () => {
  it('mặc định public: danh bạ có nghề và khu vực', async () => {
    const r = await rowOf(aliceActor, bob);
    expect(r.job).toBe('Bac si da khoa');
    expect(r.area).toMatchObject({ id: areaId, name: 'Xa Khoai Chau' });
    expect(r.profile_fields.job.state).toBe('visible');
  });

  it('job=closed ⇒ danh bạ trả job null (đây chính là lỗ hổng Ruling T11-f)', async () => {
    await setLevel(bob, 'job', 'closed');
    const r = await rowOf(aliceActor, bob);
    expect(r.job).toBeNull();
    expect(r.profile_fields.job).toMatchObject({ level: 'closed', state: 'closed', value: null });
    // ...và khu vực KHÔNG bị che lây: hai trường là hai quyết định riêng.
    expect(r.area).toMatchObject({ id: areaId });
  });

  it('area=closed ⇒ danh bạ trả area null', async () => {
    await setLevel(bob, 'area', 'closed');
    const r = await rowOf(aliceActor, bob);
    expect(r.area).toBeNull();
    expect(r.profile_fields.area).toMatchObject({ level: 'closed', state: 'closed' });
    expect(r.job).toBe('Bac si da khoa');
  });

  it('hồ sơ chi tiết che y như danh sách — không có cửa sau nào', async () => {
    await setLevel(bob, 'job', 'closed');
    await setLevel(bob, 'area', 'closed');
    const p = await members.get({ actor: aliceActor, id: bob });
    expect(p.job).toBeNull();
    expect(p.area).toBeNull();
    expect(p.profile_fields.job.state).toBe('closed');
  });

  it('chính chủ vẫn thấy hồ sơ mình dù đã đóng hết', async () => {
    await setLevel(bob, 'job', 'closed');
    await setLevel(bob, 'area', 'closed');
    const p = await members.get({ actor: bobActor, id: bob });
    expect(p.job).toBe('Bac si da khoa');
    expect(p.area).toMatchObject({ id: areaId });
    expect(p.profile_fields.job.state).toBe('self');
  });
});

describe('T13.2 bộ lọc không được thành kênh phụ đọc chính trường vừa bị che', () => {
  it('job public: lọc theo nghề tìm thấy — đối chứng để bài dưới có nghĩa', async () => {
    expect(await rowOf(aliceActor, bob, { job: 'Bac si' })).toBeTruthy();
  });

  it('job closed: lọc theo nghề KHÔNG tìm thấy nữa', async () => {
    await setLevel(bob, 'job', 'closed');
    expect(await rowOf(aliceActor, bob, { job: 'Bac si' })).toBeUndefined();
    // ...nhưng người đó vẫn còn trong danh bạ khi không lọc — bị ẩn NGHỀ, không
    // phải bị xoá khỏi cộng đồng.
    expect(await rowOf(aliceActor, bob, {})).toBeTruthy();
  });

  it('area closed: lọc theo khu vực KHÔNG tìm thấy nữa', async () => {
    expect(await rowOf(aliceActor, bob, { areaId })).toBeTruthy();
    await setLevel(bob, 'area', 'closed');
    expect(await rowOf(aliceActor, bob, { areaId })).toBeUndefined();
  });

  it('chính chủ lọc hồ sơ mình thì vẫn ra, dù đã đóng', async () => {
    await setLevel(bob, 'job', 'closed');
    expect(await rowOf(bobActor, bob, { job: 'Bac si' })).toBeTruthy();
  });
});

describe('T13.3 tám trường, một luật', () => {
  it('bao bì có đủ tám trường, đúng hai nhóm', async () => {
    const r = await rowOf(aliceActor, bob);
    expect(Object.keys(r.contacts).sort()).toEqual([...CONTACT_FIELDS].sort());
    expect(Object.keys(r.profile_fields).sort()).toEqual([...PROFILE_FIELDS].sort());
    expect(FIELDS).toHaveLength(8);
  });

  it('on_consent + đơn được duyệt mở `job` y hệt như mở `phone`', async () => {
    await setLevel(bob, 'job', 'on_consent');
    // chưa xin: đóng
    let r = await rowOf(aliceActor, bob);
    expect(r.job).toBeNull();
    expect(r.profile_fields.job.state).toBe('can_request');

    // đang chờ: vẫn đóng, nhưng trạng thái nói đúng chuyện gì đang xảy ra
    const { rows: [req] } = await db.raw(
      `INSERT INTO contact_requests (community_id, requester_id, target_id, field_key, status)
       VALUES (?,?,?, 'job', 'pending') RETURNING id`, [cid, alice, bob]);
    r = await rowOf(aliceActor, bob);
    expect(r.job).toBeNull();
    expect(r.profile_fields.job).toMatchObject({ state: 'requested', request_id: req.id });

    // được duyệt: mở
    await db.raw(`UPDATE contact_requests SET status = 'approved' WHERE id = ?`, [req.id]);
    r = await rowOf(aliceActor, bob);
    expect(r.job).toBe('Bac si da khoa');
    expect(r.profile_fields.job.state).toBe('visible');
    // và bộ lọc mở theo cùng một luật, không phải luật thứ hai
    expect(await rowOf(aliceActor, bob, { job: 'Bac si' })).toBeTruthy();
  });

  it('fn_privacy_state là nguồn duy nhất: cùng câu trả lời cho cả tám trường', async () => {
    await db.raw(`UPDATE privacy_settings SET level = 'closed' WHERE member_id = ?`, [bob]);
    const states = await withActor(alice, (trx) => contactStates(trx, alice, [bob], cid));
    for (const f of FIELDS) {
      expect(states.get(bob)[f].state, `trường ${f}`).toBe('closed');
    }
  });

  it('người xem thuộc cộng đồng khác không nhận được trạng thái nào', async () => {
    const leaked = await withActor(alice, (trx) => contactStates(trx, alice, [eve], cid));
    expect(leaked.get(eve)).toBeUndefined();
    // Bao bì dựng từ chỗ trống phải ĐÓNG, không phải mở — mặc định an toàn.
    const env = envelope(leaked.get(eve), { job: 'Bac si da khoa' });
    expect(env.job.value).toBeNull();
    expect(env.job.state).toBe('closed');
  });
});

describe('T13.4 ranh giới giữa hai nhóm vẫn nguyên', () => {
  it('trường liên hệ không mang giá trị kể cả khi mức public', async () => {
    await db.raw(
      `UPDATE privacy_settings SET level = 'public' WHERE member_id = ? AND field_key = 'phone'`, [bob]);
    await db.raw(`UPDATE member_contacts SET phone = '0912000002' WHERE member_id = ?`, [bob]);
    const r = await rowOf(aliceActor, bob);
    expect(r.contacts.phone.state).toBe('visible');
    expect(r.contacts.phone.value).toBeNull();
  });

  it('envelope() không cho giá trị liên hệ đi kèm dù người gọi cố truyền vào', async () => {
    const states = await withActor(alice, (trx) => contactStates(trx, alice, [bob], cid));
    const env = envelope(states.get(bob), { phone: '0912000002', job: 'Bac si da khoa' });
    expect(env.phone.value).toBeNull();   // chặn bằng FIELD_SPEC, không bằng lời dặn
    expect(env.job.value).toBe('Bac si da khoa');
  });
});
