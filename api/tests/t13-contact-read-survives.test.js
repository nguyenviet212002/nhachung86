import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetDb } from './helpers/db.js';
import { withActor } from '../src/core/tx.js';
import { readContact } from '../src/core/privacy.js';

// ---------------------------------------------------------------------------
// T13 — bản vá lỗ RÒ DỮ LIỆU CÁ NHÂN CHÉO CỘNG ĐỒNG phải SỐNG SÓT qua mọi lần
// contact_read bị viết lại (việc thừa kế (b), Ruling T10-a).
//
// Bối cảnh: hàm contact_read dựng ở migration 006 đọc community_id của người
// BỊ XEM nhưng không bao giờ so với cộng đồng của người XEM. Người ở cộng đồng
// A gọi contact_read(<member cộng đồng B>, 'phone') nhận về
// {allowed: true, value: '0912999999'} — số điện thoại thật. Lỗ đó nằm trong
// một hàm SECURITY DEFINER nên REVOKE ALL trên member_contacts KHÔNG đỡ được.
// Migration 012a vá bằng hai câu kiểm cộng đồng.
//
// VÌ SAO CẦN RIÊNG BÀI NÀY: migration 015 (Task 13) CREATE OR REPLACE lại
// chính hàm đó để thêm nhánh "lời giới thiệu đủ ba chữ ký". CREATE OR REPLACE
// ghi đè TOÀN BỘ thân hàm. Quên hai câu kiểm ⇒ bản vá bị xoá TRONG IM LẶNG,
// lỗ hổng quay lại nguyên vẹn, không lỗi, không cảnh báo, và bài t10 hiện có
// vẫn xanh nếu nó chạy trên một CSDL chưa áp 015.
//
// Bài này cố ý chạy resetDb() — tức áp ĐỦ MỌI migration tới tệp cuối cùng —
// rồi mới hỏi. Nó là cái chốt cửa cho mọi lần viết lại về sau, không riêng 015.
// ---------------------------------------------------------------------------

let db, cidA, cidB, alice, bruno;

beforeAll(async () => {
  db = await resetDb();

  ({ rows: [{ id: cidA }] } = await db.raw(
    `INSERT INTO communities (code,name) VALUES ('t13-cross-a','Cong dong A') RETURNING id`));
  ({ rows: [{ id: cidB }] } = await db.raw(
    `INSERT INTO communities (code,name) VALUES ('t13-cross-b','Cong dong B') RETURNING id`));

  const mk = async (cid, name) => (await db.raw(
    `INSERT INTO members (community_id, full_name, status) VALUES (?,?, 'member') RETURNING id`,
    [cid, name])).rows[0].id;
  alice = await mk(cidA, 'Alice A');
  bruno = await mk(cidB, 'Bruno B');

  // Bruno để MỌI trường ở mức 'public' — kịch bản dễ rò nhất có thể: nếu chốt
  // chặn cộng đồng biến mất thì không còn lớp nào khác chặn.
  await db.raw(`UPDATE privacy_settings SET level = 'public' WHERE member_id = ?`, [bruno]);
  await db.raw(
    `UPDATE member_contacts SET phone = ?, zalo = ?, messenger = ?, address = ? WHERE member_id = ?`,
    ['0912999999', 'zalo-bruno', 'fb.me/bruno', 'Nha Bruno', bruno]);
});

afterAll(async () => { await db.destroy(); });

describe('T13 contact_read giữ chốt chặn cộng đồng sau khi mọi migration đã áp', () => {
  it('người xem ở cộng đồng A không đọc được BẤT KỲ trường nào của người ở cộng đồng B', async () => {
    for (const field of ['phone', 'zalo', 'messenger', 'address']) {
      await expect(
        withActor(alice, (trx) => readContact(trx, bruno, field)),
        `trường ${field} rò chéo cộng đồng`
      ).rejects.toThrow(/NO_TARGET/);
    }
  });

  it('vẫn dùng chung mã NO_TARGET với "không tồn tại" — không phân biệt được từ ngoài', async () => {
    // Đặc tả mục 5.3: thông báo lỗi không được thành công cụ dò danh sách thành
    // viên cộng đồng khác. Hai tình huống phải cho ra CÙNG một câu trả lời.
    const khongTonTai = '00000000-0000-0000-0000-000000000000';
    await expect(withActor(alice, (trx) => readContact(trx, khongTonTai, 'phone')))
      .rejects.toThrow(/NO_TARGET/);
  });

  it('đối chứng: cùng lời gọi đó TRONG cùng cộng đồng thì đọc được', async () => {
    // Không có bài đối chứng thì bài trên xanh cả khi contact_read hỏng hoàn
    // toàn (ví dụ luôn ném NO_TARGET). Đây là vế chứng minh cửa vẫn mở đúng.
    const brunoCungCongDong = (await db.raw(
      `INSERT INTO members (community_id, full_name, status) VALUES (?,?, 'member') RETURNING id`,
      [cidA, 'Bruno cua A'])).rows[0].id;
    await db.raw(`UPDATE privacy_settings SET level = 'public' WHERE member_id = ?`, [brunoCungCongDong]);
    await db.raw(`UPDATE member_contacts SET phone = ? WHERE member_id = ?`, ['0911000001', brunoCungCongDong]);

    const r = await withActor(alice, (trx) => readContact(trx, brunoCungCongDong, 'phone'));
    expect(r).toMatchObject({ allowed: true, value: '0911000001' });
  });

  it('thân hàm contact_read đang chạy CÓ hai câu kiểm cộng đồng', async () => {
    // Lưới thứ hai, và nó canh thứ khác với ba bài trên: ba bài kia canh HÀNH
    // VI, bài này canh sự CÓ MẶT của chính hai câu lệnh. Một bản viết lại vô ý
    // có thể vẫn từ chối đúng vì lý do khác (ví dụ trường không có cấu hình nên
    // mặc định closed) và làm ba bài kia xanh giả.
    const { rows: [{ src }] } = await db.raw(
      `SELECT prosrc AS src FROM pg_proc WHERE proname = 'contact_read'`);
    expect(src).toMatch(/v_viewer_cid/);
    expect(src).toMatch(/IS DISTINCT FROM v_cid/);
  });
});
