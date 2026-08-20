import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { resetDb } from './helpers/db.js';
import { withActor } from '../src/core/tx.js';
import { readContact } from '../src/core/privacy.js';

// ---------------------------------------------------------------------------
// T13 — BA CHỮ KÝ MỞ KÊNH (spec mục 4.2, migration 015).
//
// Số điện thoại của ứng viên chỉ đến tay người đăng tin khi CẢ BA cùng đồng ý:
// người giới thiệu, ứng viên, người đăng tin. Hai chữ ký là chưa đủ — và "chưa
// đủ" phải có nghĩa ở tầng CSDL chứ không phải ở một câu `if` trong service,
// vì đây đúng là chỗ mà một route viết sau sẽ quên.
//
// Hai lớp, và bài này canh cả hai:
//   * CHECK intro_three_consents: KHÔNG ĐẶT ĐƯỢC channel_opened_at khi thiếu
//     chữ ký. Đây là lớp giữ cho dữ liệu không bao giờ ở trạng thái sai.
//   * contact_read: nhánh "kênh đã mở" chỉ nhìn channel_opened_at, nên nó chỉ
//     mở khi lớp trên đã cho phép. Không kiểm lại ba cột consent_* — kiểm lại
//     là dựng bản sao thứ hai của cùng một luật, và bản sao sẽ trôi.
//
// Ba ranh giới cũng được canh, vì một cái cửa mở quá rộng cũng là cửa hỏng:
//   * người thứ tư không hưởng lây kênh của hai người khác;
//   * kênh KHÔNG lấn quyền được mức 'closed' (chủ hồ sơ đã nói không với MỌI
//     người thì ba người khác không ký thay được);
//   * kênh của cộng đồng khác không mở được gì.
// ---------------------------------------------------------------------------

let db, cid, introducer, candidate, poster, nguoiThuTu, intro;

const CANDIDATE_PHONE = '0912000777';
const POSTER_PHONE = '0912000888';

async function mk(name) {
  const { rows: [m] } = await db.raw(
    `INSERT INTO members (community_id, full_name, status) VALUES (?,?, 'member') RETURNING id`,
    [cid, name]);
  return m.id;
}

const read = (viewer, target) => withActor(viewer, (trx) => readContact(trx, target, 'phone'));

beforeAll(async () => {
  db = await resetDb();
  ({ rows: [{ id: cid }] } = await db.raw(
    `INSERT INTO communities (code,name) VALUES ('t13-intro','Hoi') RETURNING id`));

  introducer = await mk('Nguoi Gioi Thieu');
  candidate = await mk('Ung Vien');
  poster = await mk('Nguoi Dang Tin');
  nguoiThuTu = await mk('Nguoi Thu Tu');

  await db.raw(`UPDATE member_contacts SET phone = ? WHERE member_id = ?`, [CANDIDATE_PHONE, candidate]);
  await db.raw(`UPDATE member_contacts SET phone = ? WHERE member_id = ?`, [POSTER_PHONE, poster]);
  // Cả hai để 'on_consent' — mức mà ba chữ ký được phép thay cho một đơn xin.
  await db.raw(
    `UPDATE privacy_settings SET level = 'on_consent' WHERE field_key = 'phone' AND member_id = ANY(?)`,
    [[candidate, poster]]);
});

afterAll(async () => { await db.destroy(); });

beforeEach(async () => {
  await db.raw(`DELETE FROM introductions WHERE community_id = ?`, [cid]);
  const { rows: [r] } = await db.raw(
    `INSERT INTO introductions (community_id, introducer_id, candidate_id, poster_id)
     VALUES (?,?,?,?) RETURNING id`, [cid, introducer, candidate, poster]);
  intro = r.id;
  await db.raw(
    `UPDATE privacy_settings SET level = 'on_consent' WHERE field_key = 'phone' AND member_id = ANY(?)`,
    [[candidate, poster]]);
});

describe('T13 ba chữ ký — số điện thoại không lộ khi mới 2/3', () => {
  it('không đặt được channel_opened_at khi chưa đủ ba chữ ký', async () => {
    // 0/3
    await expect(db.raw(`UPDATE introductions SET channel_opened_at = now() WHERE id = ?`, [intro]))
      .rejects.toThrow(/intro_three_consents/);
    // 2/3 — chỗ dễ lọt nhất, vì "gần đủ" trông giống đủ
    await db.raw(
      `UPDATE introductions SET consent_introducer = true, consent_candidate = true WHERE id = ?`, [intro]);
    await expect(db.raw(`UPDATE introductions SET channel_opened_at = now() WHERE id = ?`, [intro]))
      .rejects.toThrow(/intro_three_consents/);
  });

  it('0/3, 1/3, 2/3 đều không đọc được số; đủ 3 thì đọc được', async () => {
    expect((await read(poster, candidate)).allowed).toBe(false);

    await db.raw(`UPDATE introductions SET consent_introducer = true WHERE id = ?`, [intro]);
    expect((await read(poster, candidate)).allowed).toBe(false);

    await db.raw(`UPDATE introductions SET consent_candidate = true WHERE id = ?`, [intro]);
    expect((await read(poster, candidate)).allowed).toBe(false);

    await db.raw(
      `UPDATE introductions SET consent_poster = true, channel_opened_at = now() WHERE id = ?`, [intro]);
    const r = await read(poster, candidate);
    expect(r.allowed).toBe(true);
    expect(r.value).toBe(CANDIDATE_PHONE);
  });

  it('kênh đi CẢ HAI CHIỀU — ứng viên cũng gọi lại được người đăng tin', async () => {
    await db.raw(
      `UPDATE introductions SET consent_introducer = true, consent_candidate = true,
              consent_poster = true, channel_opened_at = now() WHERE id = ?`, [intro]);
    const r = await read(candidate, poster);
    expect(r).toMatchObject({ allowed: true, value: POSTER_PHONE });
  });

  it('rút lại một chữ ký sau khi đã mở kênh cũng bị CHECK chặn', async () => {
    await db.raw(
      `UPDATE introductions SET consent_introducer = true, consent_candidate = true,
              consent_poster = true, channel_opened_at = now() WHERE id = ?`, [intro]);
    // Không cần trigger riêng: cùng một CHECK đọc theo chiều ngược lại. Trạng
    // thái "kênh mở nhưng thiếu chữ ký" không tồn tại được, dù đi vào từ phía nào.
    await expect(db.raw(`UPDATE introductions SET consent_candidate = false WHERE id = ?`, [intro]))
      .rejects.toThrow(/intro_three_consents/);
  });
});

describe('T13 ba chữ ký — ranh giới của cái kênh vừa mở', () => {
  beforeEach(async () => {
    await db.raw(
      `UPDATE introductions SET consent_introducer = true, consent_candidate = true,
              consent_poster = true, channel_opened_at = now() WHERE id = ?`, [intro]);
  });

  it('người thứ tư không hưởng lây', async () => {
    const r = await read(nguoiThuTu, candidate);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('NEEDS_CONSENT');
  });

  it('người GIỚI THIỆU cũng không tự động đọc được số của ứng viên', async () => {
    // Họ đứng tên bảo đảm cho lời giới thiệu, không phải đầu bên kia của kênh.
    // Nếu chỗ này mở thì "ba chữ ký mở kênh" thành "ba chữ ký mở kênh cho ba
    // người", tức rộng hơn đúng một người so với điều cả ba đã đồng ý.
    expect((await read(introducer, candidate)).allowed).toBe(false);
  });

  it('mức closed KHÔNG bị kênh lấn quyền', async () => {
    await db.raw(
      `UPDATE privacy_settings SET level = 'closed' WHERE member_id = ? AND field_key = 'phone'`,
      [candidate]);
    const r = await read(poster, candidate);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('CLOSED');
  });

  it('vẫn ghi đúng một dòng nhật ký cho mỗi lượt đọc, kể cả lượt được kênh mở', async () => {
    const before = (await db.raw(
      `SELECT count(*)::int AS n FROM audit_log WHERE action = 'contact.read' AND community_id = ?`,
      [cid])).rows[0].n;
    await read(poster, candidate);
    const after = (await db.raw(
      `SELECT count(*)::int AS n FROM audit_log WHERE action = 'contact.read' AND community_id = ?`,
      [cid])).rows[0].n;
    expect(after - before).toBe(1);
  });
});

describe('T13 ba chữ ký — không bắc cầu sang cộng đồng khác', () => {
  it('không tạo nổi lời giới thiệu ghép người của hai cộng đồng', async () => {
    const { rows: [{ id: cidKhac }] } = await db.raw(
      `INSERT INTO communities (code,name) VALUES ('t13-intro-khac','Khac') RETURNING id`);
    const { rows: [{ id: nguoiLa }] } = await db.raw(
      `INSERT INTO members (community_id, full_name, status) VALUES (?,?, 'member') RETURNING id`,
      [cidKhac, 'Nguoi La']);

    // Khoá ngoại GHÉP (candidate_id, community_id) -> members (id, community_id)
    // chặn ngay ở tầng CSDL, không cần một câu kiểm nào ở service.
    await expect(db.raw(
      `INSERT INTO introductions (community_id, introducer_id, candidate_id, poster_id)
       VALUES (?,?,?,?)`, [cid, introducer, nguoiLa, poster]))
      .rejects.toThrow(/foreign key/i);
  });
});
