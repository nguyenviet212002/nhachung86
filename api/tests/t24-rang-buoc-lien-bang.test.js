import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetDb, appKnex } from './helpers/db.js';

// ---------------------------------------------------------------------------
// T24 — BẤT BIẾN LIÊN BẢNG (migration 027, tài liệu `docs/RANG-BUOC.md`)
//
// Khuôn hình mà bài này canh, một câu:
//
//     ràng buộc đặt trên bảng A không chạy khi người ta động vào bảng B.
//
// Dự án đã gặp nó năm lần trước vòng rà này (quỹ ← chữ ký, cạnh việc ← người
// tham gia, ảnh ký ức ← lời đồng ý, hành động chờ ← chữ ký, và ô `NOT NULL`
// điền được tên người khác). Vòng rà toàn bộ 71 bảng / 39 trigger tìm thêm mười
// chín chỗ; migration 027 vá mười ba chỗ trong số đó và bài này là lưới canh
// chúng.
//
// MỌI kịch bản dưới đây đều CHẠY BẰNG `app_role` VỚI DẤU NGƯỜI THỰC HIỆN —
// đúng hình dạng của một request HTTP thật. Chạy bằng kết nối owner sẽ KHÔNG
// chứng minh được gì cho ba trigger "chính chủ" của mục A, vì chúng cố ý bỏ qua
// đường của chính hệ thống (xem ghi chú đầu migration 027).
//
// Mỗi mục có cả vế CẤM và vế CHO PHÉP. Vế cho phép quan trọng ngang vế cấm:
// một trigger chặn tất cả cũng là một trigger hỏng, và nếu chỉ kiểm vế cấm thì
// bài test vẫn xanh khi ai đó siết quá tay.
// ---------------------------------------------------------------------------

let db, app, cid;
let alice, bob, carol;

const asActor = (actor, fn) =>
  app.transaction(async (trx) => {
    await trx.raw(`SELECT set_config('app.actor_id', ?, true)`, [actor ?? '']);
    return fn(trx);
  });

const mk = async (name, status = 'member') => {
  const { rows: [m] } = await db.raw(
    `INSERT INTO members (community_id, full_name, status) VALUES (?,?,?) RETURNING id`,
    [cid, name, status]);
  return m.id;
};

beforeAll(async () => {
  db = await resetDb();
  app = appKnex();
  ({ rows: [{ id: cid }] } = await db.raw(
    `INSERT INTO communities (code,name) VALUES ('t24','Hoi T24') RETURNING id`));
  alice = await mk('Alice T24');
  bob = await mk('Bob T24');
  carol = await mk('Carol T24');
  await db.raw(`UPDATE member_contacts SET phone = '0912000024' WHERE member_id = ?`, [bob]);
  await db.raw(
    `UPDATE privacy_settings SET level = 'on_consent' WHERE member_id = ? AND field_key = 'phone'`,
    [bob]);
});

afterAll(async () => { await app.destroy(); await db.destroy(); });

// ===========================================================================
// HỌ A — `contact_read` không quyết định gì, nó ĐI HỎI ba bảng
//
// Cả kiến trúc bỏ công tách `member_contacts` ra khỏi `members` rồi `REVOKE ALL`
// để một route viết ẩu không làm lộ số điện thoại. Nhưng câu trả lời "cho xem
// hay không" được lấy từ `privacy_settings`, `contact_requests` và
// `introductions` — ba bảng mà trước migration 027 bất kỳ câu `UPDATE` nào của
// `app_role` cũng viết được. Cửa chính khoá ba lớp, công tắc mở cửa để ngoài hiên.
// ===========================================================================
describe('T24-A số điện thoại: ba cái công tắc mở cửa nay có người canh', () => {
  const readPhone = (viewer, target) =>
    asActor(viewer, async (trx) => (await trx.raw(`SELECT * FROM contact_read(?, 'phone')`, [target])).rows[0]);

  it('không ai đặt mức riêng tư của người khác', async () => {
    await expect(asActor(alice, (trx) => trx.raw(
      `UPDATE privacy_settings SET level = 'public' WHERE member_id = ? AND field_key = 'phone'`,
      [bob]))).rejects.toThrow(/SELF_ONLY/);

    // ... và số vẫn không ra.
    expect(await readPhone(alice, bob)).toMatchObject({ allowed: false, reason: 'NEEDS_CONSENT' });
  });

  it('không ai xoá hàng riêng tư của người khác để chèn lại hàng "public"', async () => {
    await expect(asActor(alice, (trx) => trx.raw(
      `DELETE FROM privacy_settings WHERE member_id = ? AND field_key = 'phone'`, [bob])))
      .rejects.toThrow(/SELF_ONLY/);
  });

  it('CHÍNH CHỦ vẫn đổi được mức của mình', async () => {
    await asActor(bob, (trx) => trx.raw(
      `UPDATE privacy_settings SET level = 'closed' WHERE member_id = ? AND field_key = 'phone'`,
      [bob]));
    expect(await readPhone(alice, bob)).toMatchObject({ allowed: false, reason: 'CLOSED' });
    await asActor(bob, (trx) => trx.raw(
      `UPDATE privacy_settings SET level = 'on_consent' WHERE member_id = ? AND field_key = 'phone'`,
      [bob]));
  });

  it('người XIN không tự duyệt đơn xin quyền của mình', async () => {
    await asActor(carol, (trx) => trx.raw(
      `INSERT INTO contact_requests (community_id, requester_id, target_id, field_key)
       VALUES (?,?,?,'phone')`, [cid, carol, bob]));

    await expect(asActor(carol, (trx) => trx.raw(
      `UPDATE contact_requests SET status = 'approved' WHERE requester_id = ? AND target_id = ?`,
      [carol, bob]))).rejects.toThrow(/SELF_ONLY/);

    expect(await readPhone(carol, bob)).toMatchObject({ allowed: false });
  });

  it('CHỦ HỒ SƠ duyệt thì đơn có hiệu lực, và số ra đúng lúc đó', async () => {
    await asActor(bob, (trx) => trx.raw(
      `UPDATE contact_requests SET status = 'approved', decided_at = now()
        WHERE requester_id = ? AND target_id = ?`, [carol, bob]));
    expect(await readPhone(carol, bob)).toMatchObject({ allowed: true, value: '0912000024' });
  });

  it('không ai nộp đơn xin quyền hộ người khác', async () => {
    await expect(asActor(alice, (trx) => trx.raw(
      `INSERT INTO contact_requests (community_id, requester_id, target_id, field_key)
       VALUES (?,?,?,'zalo')`, [cid, carol, bob]))).rejects.toThrow(/SELF_ONLY/);
  });

  it('một người không tự bật cả ba ô đồng ý để mở kênh giới thiệu', async () => {
    // `intro_distinct_candidate` chỉ cấm ứng viên trùng hai vai kia, nên một
    // người ĐƯỢC PHÉP vừa giới thiệu vừa đăng tin. Trước 027, người đó tự bật
    // cả ba ô rồi đọc số của "ứng viên" — CHECK intro_three_consents thấy ba ô
    // cùng bật nên không có gì để nói.
    await expect(asActor(alice, (trx) => trx.raw(
      `INSERT INTO introductions (community_id, introducer_id, candidate_id, poster_id,
          consent_introducer, consent_candidate, consent_poster, channel_opened_at)
       VALUES (?,?,?,?, true, true, true, now())`, [cid, alice, bob, alice])))
      .rejects.toThrow(/SELF_ONLY/);
  });

  it('mỗi người bật ô của mình thì kênh mở được như thường', async () => {
    const { rows: [i] } = await asActor(alice, (trx) => trx.raw(
      `INSERT INTO introductions (community_id, introducer_id, candidate_id, poster_id,
          consent_introducer)
       VALUES (?,?,?,?, true) RETURNING id`, [cid, alice, bob, carol]));
    await asActor(bob, (trx) => trx.raw(
      `UPDATE introductions SET consent_candidate = true WHERE id = ?`, [i.id]));
    await asActor(carol, (trx) => trx.raw(
      `UPDATE introductions SET consent_poster = true, channel_opened_at = now() WHERE id = ?`,
      [i.id]));
    const { rows: [r] } = await db.raw(
      `SELECT consent_introducer, consent_candidate, consent_poster, channel_opened_at IS NOT NULL AS opened
         FROM introductions WHERE id = ?`, [i.id]);
    expect(r).toMatchObject({ consent_introducer: true, consent_candidate: true, consent_poster: true, opened: true });
  });

  it('đã có chữ ký thì không đổi được tên người ở ba vai', async () => {
    const { rows: [i] } = await asActor(alice, (trx) => trx.raw(
      `INSERT INTO introductions (community_id, introducer_id, candidate_id, poster_id, consent_introducer)
       VALUES (?,?,?,?, true) RETURNING id`, [cid, alice, carol, bob]));
    await expect(asActor(alice, (trx) => trx.raw(
      `UPDATE introductions SET introducer_id = ? WHERE id = ?`, [bob, i.id])))
      .rejects.toThrow(/SELF_ONLY/);
  });
});

// ===========================================================================
// HỌ B — `fn_self_only` chỉ được gắn ở `BEFORE INSERT`
//
// `UPDATE` biến một hàng cũ thành một hành động mới mà không đi qua `INSERT`
// lần nào. Đây là cùng lỗ hổng, chỉ ngắn hơn một bước so với "bảng A / bảng B".
// ===========================================================================
describe('T24-B trigger canh danh tính phải canh cả UPDATE và DELETE', () => {
  let slot1, slot2;

  beforeAll(async () => {
    const { rows: [req] } = await db.raw(
      `INSERT INTO aid_requests (community_id, requester_id, title) VALUES (?,?,'Nho giup') RETURNING id`,
      [cid, alice]);
    ({ rows: [{ id: slot1 }] } = await db.raw(
      `INSERT INTO aid_slots (community_id, aid_request_id, title, needed) VALUES (?,?,'Suat 1',1) RETURNING id`,
      [cid, req.id]));
    ({ rows: [{ id: slot2 }] } = await db.raw(
      `INSERT INTO aid_slots (community_id, aid_request_id, title, needed) VALUES (?,?,'Suat 2',1) RETURNING id`,
      [cid, req.id]));
    await asActor(carol, (trx) => trx.raw(
      `INSERT INTO aid_slot_takers (community_id, slot_id, member_id) VALUES (?,?,?)`, [cid, slot1, carol]));
    await asActor(alice, (trx) => trx.raw(
      `INSERT INTO aid_slot_takers (community_id, slot_id, member_id) VALUES (?,?,?)`, [cid, slot2, alice]));
  });

  it('không sang tên suất giúp của mình cho người chưa bấm gì', async () => {
    await expect(asActor(carol, (trx) => trx.raw(
      `UPDATE aid_slot_takers SET member_id = ? WHERE slot_id = ? AND member_id = ?`,
      [bob, slot1, carol]))).rejects.toThrow(/SELF_ONLY/);
  });

  it('không gỡ suất của người khác', async () => {
    await expect(asActor(bob, (trx) => trx.raw(
      `DELETE FROM aid_slot_takers WHERE slot_id = ? AND member_id = ?`, [slot1, carol])))
      .rejects.toThrow(/SELF_ONLY/);
  });

  it('sức chứa của suất cũng phải canh ở UPDATE, không chỉ ở INSERT', async () => {
    // Suất 2 khai `needed = 1` và đã có Alice. Carol dời suất của MÌNH sang đó:
    // `fn_self_only` không có gì để nói (member_id không đổi), nên chỉ còn
    // `fn_aid_slot_capacity` đứng giữa — và trước 027 nó chỉ khai BEFORE INSERT.
    await expect(asActor(carol, (trx) => trx.raw(
      `UPDATE aid_slot_takers SET slot_id = ? WHERE slot_id = ? AND member_id = ?`,
      [slot2, slot1, carol]))).rejects.toThrow(/AID_SLOT_FULL/);
  });

  it('chính chủ vẫn nhả suất của mình được', async () => {
    await asActor(carol, (trx) => trx.raw(
      `DELETE FROM aid_slot_takers WHERE slot_id = ? AND member_id = ?`, [slot1, carol]));
    const { rows } = await db.raw(`SELECT 1 FROM aid_slot_takers WHERE slot_id = ?`, [slot1]);
    expect(rows).toHaveLength(0);
  });

  it('không trả lời tín hiệu thay người khác bằng một câu UPDATE', async () => {
    const { rows: [s] } = await db.raw(
      `INSERT INTO signals (community_id, created_by, type, title)
       VALUES (?,?,'giup_gap','Can giup') RETURNING id`, [cid, alice]);
    await db.raw(
      `INSERT INTO signal_recipients (community_id, signal_id, member_id) VALUES (?,?,?),(?,?,?)`,
      [cid, s.id, bob, cid, s.id, carol]);
    await asActor(bob, (trx) => trx.raw(
      `INSERT INTO signal_responses (community_id, signal_id, responder_id, ability)
       VALUES (?,?,?, 'accept')`, [cid, s.id, bob]));

    await expect(asActor(bob, (trx) => trx.raw(
      `UPDATE signal_responses SET responder_id = ? WHERE signal_id = ?`, [carol, s.id])))
      .rejects.toThrow(/SELF_ONLY/);
  });
});

// ===========================================================================
// HỌ C — trigger ngồi trên bảng CON, đọc một cột định danh ở bảng CHA
// ===========================================================================
describe('T24-C đổi cột định danh ở bảng cha không được lách trigger ở bảng con', () => {
  it('năng lực đã dẫn bằng chứng thì không chuyển sang tên người khác', async () => {
    const { rows: [wr] } = await db.raw(
      `INSERT INTO work_records (community_id, source_type, title, done_on, created_by)
       VALUES (?, 'signal', 'Viec that', current_date, ?) RETURNING id`, [cid, alice]);
    await db.raw(
      `INSERT INTO work_participants (community_id, work_record_id, member_id, role)
       VALUES (?,?,?,'doer'), (?,?,?,'receiver')`, [cid, wr.id, alice, cid, wr.id, bob]);
    for (const m of [alice, bob]) {
      await asActor(m, (trx) => trx.raw(
        `INSERT INTO work_confirmations (community_id, work_record_id, member_id) VALUES (?,?,?)`,
        [cid, wr.id, m]));
    }
    const { rows: [cap] } = await db.raw(
      `INSERT INTO capabilities (community_id, member_id, title) VALUES (?,?,'Op lat') RETURNING id`,
      [cid, alice]);
    await asActor(alice, (trx) => trx.raw(
      `INSERT INTO capability_evidence (community_id, capability_id, work_record_id) VALUES (?,?,?)`,
      [cid, cap.id, wr.id]));

    await expect(asActor(carol, (trx) => trx.raw(
      `UPDATE capabilities SET member_id = ? WHERE id = ?`, [carol, cap.id])))
      .rejects.toThrow(/CAPABILITY_OWNER_FROZEN/);

    // Sửa những cột khác thì vẫn tự do — luật chỉ chạm đúng chỗ nó cần.
    await asActor(alice, (trx) => trx.raw(
      `UPDATE capabilities SET title = 'Op lat va chong tham' WHERE id = ?`, [cap.id]));
  });

  it('người vay không trở thành người bảo lãnh của chính khoản vay mình', async () => {
    const { rows: [ln] } = await db.raw(
      `INSERT INTO loans (community_id, borrower_id, amount, purpose)
       VALUES (?,?,1000000,'sua nha') RETURNING id`, [cid, alice]);
    await db.raw(`INSERT INTO loan_guarantors (community_id, loan_id, member_id) VALUES (?,?,?)`,
      [cid, ln.id, bob]);

    await expect(asActor(alice, (trx) => trx.raw(
      `UPDATE loans SET borrower_id = ? WHERE id = ?`, [bob, ln.id])))
      .rejects.toThrow(/LOAN_GUARANTOR_IS_BORROWER/);

    // Chuyển sang một người KHÔNG bảo lãnh khoản này thì không có gì sai.
    await asActor(alice, (trx) => trx.raw(
      `UPDATE loans SET borrower_id = ? WHERE id = ?`, [carol, ln.id]));
  });

  it('tiếng "không" bị DỜI sang ảnh khác cũng bị chặn như bị xoá', async () => {
    // `DELETE` đã bị REVOKE với lý do "gỡ hàng của một người là cách xoá tiếng
    // 'không' của họ" (migration 019). Nhưng DỜI cũng là xoá, chỉ khác động từ —
    // và đó là chỗ hở nằm bên trong chính bản vá ấy.
    const { rows: [mem] } = await db.raw(
      `INSERT INTO memories (community_id, title, created_by) VALUES (?,'Ky uc T24',?) RETURNING id`,
      [cid, alice]);
    const photo = async (u) => (await db.raw(
      `INSERT INTO memory_photos (community_id, memory_id, url) VALUES (?,?,?) RETURNING id`,
      [cid, mem.id, u])).rows[0].id;
    const daDuyet = await photo('https://x/t24-1.jpg');
    const chuaDuyet = await photo('https://x/t24-2.jpg');

    await db.raw(
      `INSERT INTO memory_photo_people (community_id, photo_id, member_id, consent)
       VALUES (?,?,?, 'yes'), (?,?,?, 'yes')`,
      [cid, daDuyet, alice, cid, daDuyet, bob]);
    await db.raw(`UPDATE memory_photos SET status = 'approved' WHERE id = ?`, [daDuyet]);

    await expect(asActor(bob, (trx) => trx.raw(
      `UPDATE memory_photo_people SET photo_id = ? WHERE photo_id = ? AND member_id = ?`,
      [chuaDuyet, daDuyet, bob]))).rejects.toThrow(/PHOTO_PEOPLE_FROZEN/);

    // Đổi Ý thì vẫn là đường đúng, và nó vẫn bị lớp cũ (Ruling T13-b) chặn khi
    // ảnh đã duyệt — hai luật khác nhau, không luật nào thay luật nào.
    await expect(asActor(bob, (trx) => trx.raw(
      `UPDATE memory_photo_people SET consent = 'no' WHERE photo_id = ? AND member_id = ?`,
      [daDuyet, bob]))).rejects.toThrow(/PHOTO_CONSENT_INCOMPLETE/);
  });

  it('hành động đã có chữ ký thì nội dung và đối tượng đóng băng', async () => {
    const { rows: [{ id: roleId }] } = await db.raw(`SELECT id FROM roles WHERE key = 'approver'`);
    for (const m of [alice, bob]) {
      await db.raw(`INSERT INTO member_roles (member_id, role_id, community_id) VALUES (?,?,?)
                    ON CONFLICT DO NOTHING`, [m, roleId, cid]);
    }
    const { rows: [pa] } = await db.raw(
      `INSERT INTO pending_actions (community_id, action_key, target_type, target_id,
          payload, payload_hash, created_by)
       VALUES (?, 'member.terminate', 'member', ?, '{"who":"carol"}'::jsonb, 'HASH-CU', ?)
       RETURNING id`, [cid, carol, alice]);
    for (const m of [alice, bob]) {
      await asActor(m, (trx) => trx.raw(
        `INSERT INTO pending_action_signatures
           (pending_action_id, signer_id, community_id, payload_hash_at_sign)
         VALUES (?,?,?, 'HASH-CU')`, [pa.id, m, cid]));
    }

    // Đổi NỘI DUNG sau khi đã đủ hai chữ ký, rồi mới thi hành.
    await expect(asActor(alice, (trx) => trx.raw(
      `UPDATE pending_actions SET payload = '{"who":"alice-doi-y"}'::jsonb, payload_hash = 'HASH-MOI'
        WHERE id = ?`, [pa.id]))).rejects.toThrow(/PENDING_ACTION_FROZEN/);

    // Đổi ĐỐI TƯỢNG sang chính một trong hai người vừa ký (mục 7.2 cấm).
    await expect(asActor(alice, (trx) => trx.raw(
      `UPDATE pending_actions SET target_id = ? WHERE id = ?`, [bob, pa.id])))
      .rejects.toThrow(/PENDING_ACTION_FROZEN/);

    // Nhưng vẫn thi hành được như thường.
    await asActor(alice, (trx) => trx.raw(
      `UPDATE pending_actions SET status = 'executed', executed_at = now() WHERE id = ?`, [pa.id]));
  });

  it('chữ ký ký một nội dung KHÁC thì không được đếm', async () => {
    // `payload_hash_at_sign` nằm trong lược đồ từ đặc tả mục 7.1 và trước 027
    // không một câu SQL nào đọc nó. Hai người ký nội dung X mà hệ thống thi hành
    // nội dung Y thì "hai người ký" là một câu nói suông.
    const { rows: [{ id: roleId }] } = await db.raw(`SELECT id FROM roles WHERE key = 'approver'`);
    await db.raw(`INSERT INTO member_roles (member_id, role_id, community_id) VALUES (?,?,?)
                  ON CONFLICT DO NOTHING`, [carol, roleId, cid]);

    await expect(db.transaction(async (trx) => {
      const { rows: [pa] } = await trx.raw(
        `INSERT INTO pending_actions (community_id, action_key, payload, payload_hash, created_by,
            status, executed_at)
         VALUES (?, 'data.delete', '{}'::jsonb, 'HASH-THAT', ?, 'executed', now()) RETURNING id`,
        [cid, alice]);
      for (const m of [alice, carol]) {
        await trx.raw(
          `INSERT INTO pending_action_signatures
             (pending_action_id, signer_id, community_id, payload_hash_at_sign)
           VALUES (?,?,?, 'HASH-KHAC')`, [pa.id, m, cid]);
      }
    })).rejects.toThrow(/TWO_SIGNATURES_REQUIRED/);
  });
});

// ===========================================================================
// HỌ D — luật đọc trạng thái đổi được, và không ai đóng băng trạng thái đó
// ===========================================================================
describe('T24-D dữ kiện mà hạn mức và lịch sử dựa vào phải đóng băng', () => {
  let jrRejected;

  beforeAll(async () => {
    const { rows: [jr] } = await db.raw(
      `INSERT INTO join_requests (community_id, applicant_data, referrer_id, status)
       VALUES (?, '{}'::jsonb, ?, 'pending') RETURNING id`, [cid, alice]);
    await db.raw(
      `UPDATE join_requests SET status = 'rejected', reject_reason_code = 'referrer_misrepresented'
        WHERE id = ?`, [jr.id]);
    jrRejected = jr.id;
  });

  const suatDangTieu = async () => (await db.raw(
    `SELECT count(*)::int AS n FROM join_requests
      WHERE referrer_id = ? AND created_at > now() - interval '12 months'
        AND (status IN ('pending','met_confirmed','approved')
          OR (status = 'rejected' AND reject_reason_code = 'referrer_misrepresented'))`,
    [alice])).rows[0].n;

  it('lý do từ chối đã ghi thì không sửa lại — nó quyết định suất có được trả lại không', async () => {
    expect(await suatDangTieu()).toBe(1);
    await expect(asActor(alice, (trx) => trx.raw(
      `UPDATE join_requests SET reject_reason_code = 'not_ready' WHERE id = ?`, [jrRejected])))
      .rejects.toThrow(/JOIN_REQUEST_FROZEN/);
    expect(await suatDangTieu()).toBe(1);
  });

  it('không kéo lùi ngày nộp đơn để cửa sổ 12 tháng tự rỗng', async () => {
    await expect(asActor(alice, (trx) => trx.raw(
      `UPDATE join_requests SET created_at = now() - interval '18 months' WHERE id = ?`, [jrRejected])))
      .rejects.toThrow(/JOIN_REQUEST_FROZEN/);
  });

  it('không gỡ người bảo lãnh khỏi một đơn đã nộp', async () => {
    await expect(asActor(alice, (trx) => trx.raw(
      `UPDATE join_requests SET referrer_id = NULL WHERE id = ?`, [jrRejected])))
      .rejects.toThrow(/JOIN_REQUEST_FROZEN/);
  });

  it('những cột khác của đơn vẫn sửa được bình thường', async () => {
    await asActor(alice, (trx) => trx.raw(
      `UPDATE join_requests SET note = 'ghi chu moi' WHERE id = ?`, [jrRejected]));
  });

  it('sợi bảo lãnh không viết lại được bằng đường vòng qua trạng thái "left"', async () => {
    // `trg_referrer_frozen` chỉ chặn khi OLD.status = 'member', mà status có BA
    // giá trị. Hai câu UPDATE trong một giao dịch là đủ — đúng lúc đặc tả mục 10
    // nói hồ sơ người rời phải thành bia mộ.
    const { rows: [g] } = await db.raw(
      `INSERT INTO members (community_id, full_name, status, referrer_id)
       VALUES (?, 'Nguoi Da Roi', 'guest', ?) RETURNING id`, [cid, alice]);
    await db.raw(`UPDATE members SET status = 'left' WHERE id = ?`, [g.id]);

    await expect(asActor(bob, (trx) => trx.raw(
      `UPDATE members SET referrer_id = ? WHERE id = ?`, [bob, g.id])))
      .rejects.toThrow(/REFERRER_FROZEN/);
  });

  it('người còn là KHÁCH thì sợi bảo lãnh chưa thành sự thật lịch sử', async () => {
    const { rows: [g] } = await db.raw(
      `INSERT INTO members (community_id, full_name, status, referrer_id)
       VALUES (?, 'Con La Khach', 'guest', ?) RETURNING id`, [cid, alice]);
    await asActor(bob, (trx) => trx.raw(
      `UPDATE members SET referrer_id = ? WHERE id = ?`, [bob, g.id]));
    const { rows: [r] } = await db.raw(`SELECT referrer_id FROM members WHERE id = ?`, [g.id]);
    expect(r.referrer_id).toBe(bob);
  });
});
