import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetDb, appKnex } from './helpers/db.js';
import { withActor } from '../src/core/tx.js';

// ---------------------------------------------------------------------------
// T13 — NGUYÊN TẮC 1 ở tầng CSDL: không có gì ẩn danh, và không ai ký thay ai.
//
// Ba bảng mới của task này nhận một cam kết của một CON NGƯỜI CỤ THỂ:
//   * aid_slot_takers   — nhận một suất việc
//   * signal_responses  — trả lời một tín hiệu ("tôi nhận việc này")
//   * signal_forwards   — chuyển tiếp, tức ĐỨNG TÊN bảo đảm cho người mình giới thiệu
//
// Đặc tả chỉ nói `signal_forwards.from_member_id NOT NULL` + FK + CHECK. NOT
// NULL bắt được ô TRỐNG; nó KHÔNG bắt được ô điền TÊN NGƯỜI KHÁC. Ba trigger
// fn_self_only (migration 026) là vế còn lại.
//
// Kèm hai ràng buộc cấu trúc mà bài này cũng canh:
//   * chỉ người ĐÃ NHẬN tín hiệu mới trả lời / chuyển tiếp được nó (khoá ngoại
//     ghép sang signal_recipients);
//   * một suất cần N người thì không nhận quá N (fn_aid_slot_capacity).
// ---------------------------------------------------------------------------

let db, cid, sonNguoiPhat, tuanNhan, hoaNgoai, laiNhan, signalId, slotId;

async function mk(name) {
  const { rows: [m] } = await db.raw(
    `INSERT INTO members (community_id, full_name, status) VALUES (?,?, 'member') RETURNING id`,
    [cid, name]);
  return m.id;
}

beforeAll(async () => {
  db = await resetDb();
  ({ rows: [{ id: cid }] } = await db.raw(
    `INSERT INTO communities (code,name) VALUES ('t13-anon','Hoi') RETURNING id`));

  sonNguoiPhat = await mk('Do Van Son');
  tuanNhan = await mk('Nguyen Huu Tuan');   // là điểm nhận
  hoaNgoai = await mk('Ly Van Hoa');        // KHÔNG phải điểm nhận
  laiNhan = await mk('Tran Thi Lan');       // là điểm nhận

  ({ rows: [{ id: signalId }] } = await db.raw(
    `INSERT INTO signals (community_id, created_by, type, title)
     VALUES (?,?, 'can_nang_luc', 'Can tho op lat') RETURNING id`, [cid, sonNguoiPhat]));
  await db.raw(
    `INSERT INTO signal_recipients (community_id, signal_id, member_id, reason) VALUES (?,?,?,?),(?,?,?,?)`,
    [cid, signalId, tuanNhan, 'dung nghe', cid, signalId, laiNhan, 'cung khu vuc']);

  const { rows: [req] } = await db.raw(
    `INSERT INTO aid_requests (community_id, requester_id, title) VALUES (?,?,?) RETURNING id`,
    [cid, sonNguoiPhat, 'Dung rap dam hieu']);
  ({ rows: [{ id: slotId }] } = await db.raw(
    `INSERT INTO aid_slots (community_id, aid_request_id, title, needed)
     VALUES (?,?,?,1) RETURNING id`, [cid, req.id, 'Phu bung sang mai']));
});

afterAll(async () => { await db.destroy(); });

describe('T13 chuyển tiếp tín hiệu không ẩn danh được', () => {
  it('điền tên người khác vào from_member_id ⇒ SELF_ONLY', async () => {
    // Đây là điều NOT NULL không bắt được: ô có giá trị, chỉ là giá trị của
    // người khác. Lan đang đăng nhập mà ghi Tuấn là người chuyển tiếp.
    await expect(withActor(laiNhan, (trx) => trx.raw(
      `INSERT INTO signal_forwards (community_id, signal_id, from_member_id, to_member_id)
       VALUES (?,?,?,?)`, [cid, signalId, tuanNhan, hoaNgoai])))
      .rejects.toThrow(/SELF_ONLY/);
  });

  it('chuyển tiếp ngoài giao dịch có dấu người thực hiện ⇒ NO_ACTOR', async () => {
    await expect(db.raw(
      `INSERT INTO signal_forwards (community_id, signal_id, from_member_id, to_member_id)
       VALUES (?,?,?,?)`, [cid, signalId, tuanNhan, hoaNgoai]))
      .rejects.toThrow(/NO_ACTOR/);
  });

  it('người CHƯA NHẬN tín hiệu không chuyển tiếp được nó', async () => {
    await expect(withActor(hoaNgoai, (trx) => trx.raw(
      `INSERT INTO signal_forwards (community_id, signal_id, from_member_id, to_member_id)
       VALUES (?,?,?,?)`, [cid, signalId, hoaNgoai, laiNhan])))
      .rejects.toThrow(/foreign key|sig_fwd_from_recipient/i);
  });

  it('không chuyển tiếp cho chính mình', async () => {
    await expect(withActor(tuanNhan, (trx) => trx.raw(
      `INSERT INTO signal_forwards (community_id, signal_id, from_member_id, to_member_id)
       VALUES (?,?,?,?)`, [cid, signalId, tuanNhan, tuanNhan])))
      .rejects.toThrow(/sig_fwd_not_self/);
  });

  it('chuyển tiếp hợp lệ SINH RA một điểm nhận mới, và view thấy đủ', async () => {
    await withActor(tuanNhan, (trx) => trx.raw(
      `INSERT INTO signal_forwards (community_id, signal_id, from_member_id, to_member_id, note)
       VALUES (?,?,?,?,?)`, [cid, signalId, tuanNhan, hoaNgoai, 'to tho quen']));

    const { rows } = await db.raw(
      `SELECT member_id, response FROM v_signal_recipients WHERE signal_id = ? ORDER BY created_at`,
      [signalId]);
    expect(rows.map((r) => r.member_id)).toContain(hoaNgoai);
    // Chưa ai trả lời ⇒ view trả NULL, không phải một cột `response` lưu sẵn
    // ở signal_recipients (spec mục 2, #6 — cột đó đã bị bỏ).
    expect(rows.every((r) => r.response === null)).toBe(true);
  });

  it('chuyển tiếp không rút lại được — app_role không UPDATE/DELETE', async () => {
    const app = appKnex();
    try {
      await expect(app.raw(`DELETE FROM signal_forwards WHERE signal_id = ?`, [signalId]))
        .rejects.toThrow(/permission denied/i);
      await expect(app.raw(`UPDATE signal_forwards SET note = 'x' WHERE signal_id = ?`, [signalId]))
        .rejects.toThrow(/permission denied/i);
    } finally { await app.destroy(); }
  });
});

describe('T13 trả lời tín hiệu là cam kết của một người cụ thể', () => {
  it('trả lời thay người khác ⇒ SELF_ONLY', async () => {
    await expect(withActor(laiNhan, (trx) => trx.raw(
      `INSERT INTO signal_responses (community_id, signal_id, responder_id, ability)
       VALUES (?,?,?, 'accept')`, [cid, signalId, tuanNhan])))
      .rejects.toThrow(/SELF_ONLY/);
  });

  it('người không nhận tín hiệu thì không trả lời được', async () => {
    // Hoà nay ĐÃ là điểm nhận (qua chuyển tiếp ở bài trên), nên lấy một người
    // hoàn toàn mới để kịch bản đúng thứ nó nói.
    const nguoiLa = await mk('Nguoi Ngoai Cuoc');
    await expect(withActor(nguoiLa, (trx) => trx.raw(
      `INSERT INTO signal_responses (community_id, signal_id, responder_id, ability)
       VALUES (?,?,?, 'accept')`, [cid, signalId, nguoiLa])))
      .rejects.toThrow(/foreign key|sig_resp_recipient/i);
  });

  it('chính chủ trả lời thì được — bài trên không đỏ vì lý do sai', async () => {
    await withActor(tuanNhan, (trx) => trx.raw(
      `INSERT INTO signal_responses (community_id, signal_id, responder_id, ability, note)
       VALUES (?,?,?, 'refer', 'gioi thieu to tho quen')`, [cid, signalId, tuanNhan]));
    const { rows: [r] } = await db.raw(
      `SELECT response FROM v_signal_recipients WHERE signal_id = ? AND member_id = ?`,
      [signalId, tuanNhan]);
    expect(r.response).toBe('refer');
  });
});

describe('T13 nhận suất giúp nhau: tự nhận, không điền hộ, không quá số cần', () => {
  it('điền hộ người khác ⇒ SELF_ONLY', async () => {
    await expect(withActor(sonNguoiPhat, (trx) => trx.raw(
      `INSERT INTO aid_slot_takers (community_id, slot_id, member_id) VALUES (?,?,?)`,
      [cid, slotId, tuanNhan])))
      .rejects.toThrow(/SELF_ONLY/);
  });

  it('tự nhận thì được', async () => {
    await withActor(tuanNhan, (trx) => trx.raw(
      `INSERT INTO aid_slot_takers (community_id, slot_id, member_id) VALUES (?,?,?)`,
      [cid, slotId, tuanNhan]));
    const { rows: [{ n }] } = await db.raw(
      `SELECT count(*)::int AS n FROM aid_slot_takers WHERE slot_id = ?`, [slotId]);
    expect(n).toBe(1);
  });

  it('người thứ hai vào suất chỉ cần 1 người ⇒ AID_SLOT_FULL', async () => {
    await expect(withActor(laiNhan, (trx) => trx.raw(
      `INSERT INTO aid_slot_takers (community_id, slot_id, member_id) VALUES (?,?,?)`,
      [cid, slotId, laiNhan])))
      .rejects.toThrow(/AID_SLOT_FULL/);
  });
});
