import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import argon2 from 'argon2';
import { resetDb, appKnex } from './helpers/db.js';
import * as twoPerson from '../src/core/twoPerson.js';

// ---------------------------------------------------------------------------
// T25 — KHUNG HAI NGƯỜI KÝ (đặc tả mục 7), và ba chỗ hở mục 7 của
// `docs/RANG-BUOC.md` mà nó vừa đóng.
//
// Bài nặng nhất ở đây là `#22`: `communities.config` là đòn bẩy dài nhất trong
// hệ thống. Vòng rà bất biến đã TÁI HIỆN được bằng chạy thật một câu
// `UPDATE communities SET config->'fund_two_approver_threshold'` rồi ghi bút
// toán **chi 50 triệu đồng mà không một chữ ký nào**. Bài
// "kịch bản 50 triệu" dưới đây dựng lại đúng kịch bản đó và khẳng định nó
// KHÔNG còn chạy được — bằng `app_role` thật, có đóng dấu người thực hiện,
// đúng hình dạng một request HTTP.
//
// Mỗi mục có cả vế CẤM và vế CHO PHÉP: một cánh cổng chặn tất cả cũng là một
// cánh cổng hỏng.
// ---------------------------------------------------------------------------

let db, app, cid;
let approverA, approverB, techC, nguoiThuong, nanNhan;

const PASSWORD = 'mat-khau-du-manh-t25';

const asActor = (actorId, fn) =>
  app.transaction(async (trx) => {
    await trx.raw(`SELECT set_config('app.actor_id', ?, true)`, [actorId ?? '']);
    return fn(trx);
  });

async function mk(name, roleKey = null, { withPassword = true } = {}) {
  const { rows: [m] } = await db.raw(
    `INSERT INTO members (community_id, full_name, status, password_hash)
     VALUES (?, ?, 'member', ?) RETURNING id`,
    [cid, name, withPassword ? await argon2.hash(PASSWORD) : null]
  );
  if (roleKey) {
    await db.raw(
      `INSERT INTO member_roles (member_id, role_id, community_id)
       SELECT ?, r.id, ? FROM roles r WHERE r.key = ?`,
      [m.id, cid, roleKey]
    );
  }
  return m.id;
}

const actorFor = (id, roles) => ({ id, communityId: cid, roles });

beforeAll(async () => {
  db = await resetDb();
  app = appKnex();
  ({ rows: [{ id: cid }] } = await db.raw(
    `INSERT INTO communities (code,name) VALUES ('t25','Hoi T25') RETURNING id`
  ));
  approverA = await mk('Duyet A T25', 'approver');
  approverB = await mk('Duyet B T25', 'approver');
  techC = await mk('Ky thuat C T25', 'tech');
  nguoiThuong = await mk('Nguoi Thuong T25');
  nanNhan = await mk('Nguoi Bi Nham T25');
});

afterAll(async () => {
  await app.destroy();
  await db.destroy();
});

// ===========================================================================
describe('T25 vòng đời một việc chờ ký', () => {
  it('người tạo LÀ chữ ký thứ nhất, không phải một bước riêng', async () => {
    const pa = await twoPerson.create({
      actor: actorFor(approverA, ['approver']),
      actionKey: 'member.terminate',
      targetType: 'member',
      targetId: nanNhan,
      payload: { reason: 'thu nghiem' },
    });
    expect(pa.signatures).toBe(1);
    const { rows: [{ n }] } = await db.raw(
      `SELECT count(*)::int AS n FROM pending_action_signatures WHERE pending_action_id = ?`, [pa.id]);
    expect(n).toBe(1);
  });

  it('người tạo không ký lần hai được', async () => {
    const pa = await twoPerson.create({
      actor: actorFor(approverA, ['approver']),
      actionKey: 'member.terminate', targetType: 'member', targetId: nanNhan, payload: {},
    });
    await expect(
      twoPerson.sign({ actor: actorFor(approverA, ['approver']), id: pa.id, password: PASSWORD })
    ).rejects.toThrow(/thứ hai/);
  });

  it('sai mật khẩu thì không ký được dù phiên còn hạn', async () => {
    const pa = await twoPerson.create({
      actor: actorFor(approverA, ['approver']),
      actionKey: 'member.terminate', targetType: 'member', targetId: nanNhan, payload: {},
    });
    await expect(
      twoPerson.sign({ actor: actorFor(approverB, ['approver']), id: pa.id, password: 'sai-mat-khau' })
    ).rejects.toThrow(/Mật khẩu/);
    // Và chữ ký thứ hai KHÔNG được ghi — không có "ký hụt".
    const { rows: [{ n }] } = await db.raw(
      `SELECT count(*)::int AS n FROM pending_action_signatures WHERE pending_action_id = ?`, [pa.id]);
    expect(n).toBe(1);
  });

  it('quá hạn thì không ký được dù tác vụ dọn dẹp chưa chạy', async () => {
    const pa = await twoPerson.create({
      actor: actorFor(approverA, ['approver']),
      actionKey: 'member.terminate', targetType: 'member', targetId: nanNhan, payload: {},
    });
    await db.raw(`UPDATE pending_actions SET expires_at = now() - interval '1 minute' WHERE id = ?`, [pa.id]);
    await expect(
      twoPerson.sign({ actor: actorFor(approverB, ['approver']), id: pa.id, password: PASSWORD })
    ).rejects.toThrow(/quá hạn/);
  });

  it('người không mang vai của action_key thì không ký được', async () => {
    const pa = await twoPerson.create({
      actor: actorFor(approverA, ['approver']),
      actionKey: 'member.terminate', targetType: 'member', targetId: nanNhan, payload: {},
    });
    await expect(
      twoPerson.sign({ actor: actorFor(nguoiThuong, ['member']), id: pa.id, password: PASSWORD })
    ).rejects.toThrow(/vai/);
  });

  it('người ký không được là ĐỐI TƯỢNG — và chính CSDL chặn, không chỉ service', async () => {
    const paB = await twoPerson.create({
      actor: actorFor(approverA, ['approver']),
      actionKey: 'member.terminate', targetType: 'member', targetId: approverB, payload: {},
    });
    await expect(
      twoPerson.sign({ actor: actorFor(approverB, ['approver']), id: paB.id, password: PASSWORD })
    ).rejects.toThrow(/chính mình/);

    // Vế CSDL: bỏ qua hẳn service, ghi thẳng bằng app_role có đóng dấu.
    await expect(
      asActor(approverB, (trx) =>
        trx.raw(
          `INSERT INTO pending_action_signatures (pending_action_id, signer_id, community_id, payload_hash_at_sign)
           SELECT id, ?, community_id, payload_hash FROM pending_actions WHERE id = ?`,
          [approverB, paB.id]
        )
      )
    ).rejects.toThrow(/SIGNER_IS_TARGET/);
  });

  it('người thứ hai ký ⇒ thi hành NGAY trong cùng giao dịch', async () => {
    const pa = await twoPerson.create({
      actor: actorFor(approverA, ['approver']),
      actionKey: 'member.terminate', targetType: 'member', targetId: nanNhan, payload: {},
    });
    const out = await twoPerson.sign({
      actor: actorFor(approverB, ['approver']), id: pa.id, password: PASSWORD,
    });
    expect(out).toMatchObject({ status: 'executed', signatures: 2 });

    const { rows: [m] } = await db.raw(`SELECT status FROM members WHERE id = ?`, [nanNhan]);
    expect(m.status).toBe('left');
    const { rows: [r] } = await db.raw(`SELECT status, executed_at FROM pending_actions WHERE id = ?`, [pa.id]);
    expect(r.status).toBe('executed');
    expect(r.executed_at).not.toBeNull();
  });

  it('người đề xuất huỷ được việc mình tạo; người khác thì không', async () => {
    const pa = await twoPerson.create({
      actor: actorFor(approverA, ['approver']),
      actionKey: 'member.terminate', targetType: 'member', targetId: nguoiThuong, payload: {},
    });
    await expect(
      twoPerson.cancel({ actor: actorFor(approverB, ['approver']), id: pa.id })
    ).rejects.toThrow(/người đề xuất/);
    await expect(twoPerson.cancel({ actor: actorFor(approverA, ['approver']), id: pa.id }))
      .resolves.toMatchObject({ status: 'cancelled' });
  });
});

// ===========================================================================
describe('T25 dữ liệu đổi giữa hai chữ ký (mục 7.3)', () => {
  it('đổi hồ sơ người bị nhắm ⇒ stale, KHÔNG thi hành, và dấu vết vẫn còn', async () => {
    const target = await mk('Nguoi Bi Nham Hai T25');
    const pa = await twoPerson.create({
      actor: actorFor(approverA, ['approver']),
      actionKey: 'member.terminate', targetType: 'member', targetId: target, payload: {},
    });
    await db.raw(`UPDATE members SET updated_at = now() + interval '1 second' WHERE id = ?`, [target]);

    await expect(
      twoPerson.sign({ actor: actorFor(approverB, ['approver']), id: pa.id, password: PASSWORD })
    ).rejects.toThrow(/thay đổi/);

    // BẪY 1 của đề bài, và mã mẫu kế hoạch mắc đúng nó: nếu nhánh này ghi log
    // rồi `throw` trong CÙNG giao dịch thì rollback xoá sạch cả hai vế dưới đây.
    const { rows: [r] } = await db.raw(`SELECT status FROM pending_actions WHERE id = ?`, [pa.id]);
    expect(r.status).toBe('stale');
    const { rows: [{ n }] } = await db.raw(
      `SELECT count(*)::int AS n FROM audit_log WHERE action = 'pending_action.stale' AND target_id = ?`, [pa.id]);
    expect(n).toBe(1);
    const { rows: [m] } = await db.raw(`SELECT status FROM members WHERE id = ?`, [target]);
    expect(m.status).toBe('member');   // KHÔNG thi hành
  });

  it('băm ổn định qua một vòng jsonb — không có gì đổi thì KHÔNG stale', async () => {
    // Mã mẫu kế hoạch dùng `JSON.stringify(payload)` thẳng. `jsonb` của
    // PostgreSQL sắp lại thứ tự khoá (theo độ dài rồi theo byte), nên băm tính
    // lại từ hàng đã lưu sẽ khác băm lúc tạo và MỌI hành động đều thành stale
    // ở chữ ký thứ hai. Payload dưới đây cố ý có thứ tự khoá mà jsonb sẽ đảo.
    const target = await mk('Nguoi Bi Nham Ba T25');
    const pa = await twoPerson.create({
      actor: actorFor(approverA, ['approver']),
      actionKey: 'member.terminate', targetType: 'member', targetId: target,
      payload: { zzz_ly_do_rat_dai: 'x', a: 1, mm: { b: 2, aaaa: 3 } },
    });
    const out = await twoPerson.sign({
      actor: actorFor(approverB, ['approver']), id: pa.id, password: PASSWORD,
    });
    expect(out.status).toBe('executed');
  });
});

// ===========================================================================
describe('T25-#22 communities.config — kịch bản "chi 50 triệu không một chữ ký nào"', () => {
  it('app_role không còn UPDATE được communities', async () => {
    await expect(
      asActor(approverA, (trx) =>
        trx.raw(`UPDATE communities SET config = '{"fund_two_approver_threshold":999999999}'::jsonb WHERE id = ?`, [cid])
      )
    ).rejects.toThrow(/permission denied/i);
  });

  it('kể cả owner cũng không sửa được config bằng một câu UPDATE trần', async () => {
    await expect(
      db.raw(`UPDATE communities SET config = '{"fund_two_approver_threshold":999999999}'::jsonb WHERE id = ?`, [cid])
    ).rejects.toThrow(/CONFIG_CHANGE_UNSIGNED/);
  });

  it('kịch bản đầy đủ: nâng ngưỡng rồi chi 50 triệu — nay KHÔNG chạy được', async () => {
    // Bước 1 của kịch bản gốc: nâng ngưỡng. Chặn ngay tại đây.
    await expect(
      db.raw(`UPDATE communities SET config = config || '{"fund_two_approver_threshold":100000000}'::jsonb WHERE id = ?`, [cid])
    ).rejects.toThrow(/CONFIG_CHANGE_UNSIGNED/);

    // Bước 2 của kịch bản gốc: chi 50 triệu không chữ ký. Ngưỡng chưa đổi được
    // nên trigger quỹ vẫn đứng — đây là vế chứng minh rằng bước 1 mới là chỗ
    // đòn bẩy, không phải bước 2.
    await expect(
      db.transaction(async (trx) => {
        await trx.raw(
          `INSERT INTO fund_entries (community_id, amount, purpose, created_by) VALUES (?, ?, ?, ?)`,
          [cid, -50000000, 'Chi lon khong chu ky', approverA]
        );
      })
    ).rejects.toThrow(/FUND_TWO_APPROVERS_REQUIRED/);
  });

  it('một hành động ĐỦ HAI CHỮ KÝ thì đổi được — cánh cổng không chặn tất cả', async () => {
    const { rows: [before] } = await db.raw(`SELECT config FROM communities WHERE id = ?`, [cid]);
    const next = { ...before.config, fund_two_approver_threshold: 2000000 };

    const pa = await twoPerson.create({
      actor: actorFor(approverA, ['approver']),
      actionKey: 'community.config_change',
      payload: { config: next },
    });
    const out = await twoPerson.sign({
      actor: actorFor(approverB, ['approver']), id: pa.id, password: PASSWORD,
    });
    expect(out.status).toBe('executed');

    const { rows: [after] } = await db.raw(`SELECT config FROM communities WHERE id = ?`, [cid]);
    expect(after.config.fund_two_approver_threshold).toBe(2000000);

    // Ngưỡng mới CÓ HIỆU LỰC THẬT: 1,5 triệu nay dưới ngưỡng nên không cần chữ ký.
    const { rows: [e] } = await db.raw(
      `INSERT INTO fund_entries (community_id, amount, purpose, created_by) VALUES (?, ?, ?, ?) RETURNING id`,
      [cid, -1500000, 'Duoi nguong moi', approverA]
    );
    expect(e.id).toBeTruthy();
  });

  it('MỘT chữ ký thôi thì không đủ — và hành động vẫn nằm chờ', async () => {
    const { rows: [before] } = await db.raw(`SELECT config FROM communities WHERE id = ?`, [cid]);
    const pa = await twoPerson.create({
      actor: actorFor(approverA, ['approver']),
      actionKey: 'community.config_change',
      payload: { config: { ...before.config, fund_two_approver_threshold: 5 } },
    });
    // Đi thẳng vào hàm SECURITY DEFINER, bỏ qua `sign()`: đây là đường mà một
    // hàm viết ẩu ở task sau sẽ đi, và Ruling T10-a nói REVOKE không đỡ được nó.
    await expect(asActor(approverA, (trx) => trx.raw(`SELECT fn_community_config_apply(?)`, [pa.id])))
      .rejects.toThrow(/CONFIG_CHANGE_UNSIGNED/);

    const { rows: [after] } = await db.raw(`SELECT config FROM communities WHERE id = ?`, [cid]);
    expect(after.config.fund_two_approver_threshold).toBe(before.config.fund_two_approver_threshold);
  });
});

// ===========================================================================
describe('T25-#20 nới hạn mức bảo lãnh phải qua khung hai người ký', () => {
  it('đủ hai chữ ký thì hàng nới hạn mức ra đời, và nó nới thật', async () => {
    const referrer = await mk('Nguoi Bao Lanh T25');
    for (let i = 0; i < 3; i++) {
      await db.raw(
        `INSERT INTO join_requests (community_id, applicant_data, referrer_id, status)
         VALUES (?, '{}'::jsonb, ?, 'pending')`, [cid, referrer]);
    }
    await expect(
      db.raw(`INSERT INTO join_requests (community_id, applicant_data, referrer_id, status)
              VALUES (?, '{}'::jsonb, ?, 'pending')`, [cid, referrer])
    ).rejects.toThrow(/GUARANTEE_QUOTA_EXCEEDED/);

    const pa = await twoPerson.create({
      actor: actorFor(approverA, ['approver']),
      actionKey: 'guarantee.quota_override',
      targetType: 'member', targetId: referrer,
      payload: { extra_slots: 1, reason: 'truong hop dac biet', valid_months: 6 },
    });
    const out = await twoPerson.sign({
      actor: actorFor(approverB, ['approver']), id: pa.id, password: PASSWORD,
    });
    expect(out.status).toBe('executed');

    const { rows: [ov] } = await db.raw(
      `SELECT granted_by, pending_action_id FROM guarantee_quota_overrides WHERE referrer_id = ?`, [referrer]);
    expect(ov.pending_action_id).toBe(pa.id);
    expect(ov.granted_by).toBe(approverA);   // người ĐỀ XUẤT, không phải ô tự khai

    await expect(
      db.raw(`INSERT INTO join_requests (community_id, applicant_data, referrer_id, status)
              VALUES (?, '{}'::jsonb, ?, 'pending')`, [cid, referrer])
    ).resolves.toBeTruthy();
  });

  it('không ai tự ký nới hạn mức cho chính mình', async () => {
    await expect(
      twoPerson.create({
        actor: actorFor(approverA, ['approver']),
        actionKey: 'guarantee.quota_override',
        targetType: 'member', targetId: approverA,
        payload: { extra_slots: 3 },
      })
    ).rejects.toThrow(/chính mình/);
  });
});

// ===========================================================================
describe('T25-#24 ảnh chụp vai tại thời điểm ký', () => {
  it('gỡ vai approver của người ĐÃ KÝ không làm bút toán quỹ mất hiệu lực ngược', async () => {
    const thuQuy = await mk('Thu Quy T25', 'approver');
    const kyX = await mk('Duyet X T25', 'approver');
    const kyY = await mk('Duyet Y T25', 'approver');

    const entry = await db.transaction(async (trx) => {
      const { rows: [e] } = await trx.raw(
        `INSERT INTO fund_entries (community_id, amount, purpose, created_by)
         VALUES (?, ?, ?, ?) RETURNING id`, [cid, -3000000, 'But toan lon', thuQuy]);
      for (const s of [kyX, kyY]) {
        await trx.raw(
          `INSERT INTO fund_entry_approvals (entry_id, approver_id, community_id) VALUES (?,?,?)`,
          [e.id, s, cid]);
      }
      return e.id;
    });

    const { rows: [snap] } = await db.raw(
      `SELECT count(*)::int AS n FROM fund_entry_approvals WHERE entry_id = ? AND role_at_sign = 'approver'`,
      [entry]);
    expect(snap.n).toBe(2);

    // Gỡ vai của cả hai người đã ký. Trước bản vá, hàm đếm JOIN member_roles
    // nên con số tụt về 0 và bút toán đã COMMIT thành một bút toán không chữ ký.
    await db.raw(
      `DELETE FROM member_roles WHERE member_id IN (?, ?) AND community_id = ?`, [kyX, kyY, cid]);

    const { rows: [{ n }] } = await db.raw(`SELECT fn_fund_valid_signatures(?) AS n`, [entry]);
    expect(n).toBe(2);

    // Và bút toán vẫn sửa được (trigger hoãn đếm lại lúc COMMIT) — nếu chữ ký
    // mất hiệu lực ngược thì câu này sẽ hỏng với FUND_TWO_APPROVERS_REQUIRED.
    await expect(db.raw(`UPDATE fund_entries SET purpose = 'Da sua' WHERE id = ?`, [entry]))
      .resolves.toBeTruthy();
  });

  it('ảnh chụp vai KHÔNG nhận giá trị ứng dụng gửi lên', async () => {
    const thuQuy = await mk('Thu Quy Hai T25', 'approver');
    const keAn = await mk('Ke Gia Mao T25');   // không mang vai nào
    const entry = await db.transaction(async (trx) => {
      const { rows: [e] } = await trx.raw(
        `INSERT INTO fund_entries (community_id, amount, purpose, created_by)
         VALUES (?, ?, ?, ?) RETURNING id`, [cid, -100, 'But toan nho', thuQuy]);
      // Tự khai `role_at_sign = 'approver'` — trigger ghi đè bằng sự thật.
      await trx.raw(
        `INSERT INTO fund_entry_approvals (entry_id, approver_id, community_id, role_at_sign)
         VALUES (?,?,?, 'approver')`, [e.id, keAn, cid]);
      return e.id;
    });
    const { rows: [r] } = await db.raw(
      `SELECT role_at_sign FROM fund_entry_approvals WHERE entry_id = ?`, [entry]);
    expect(r.role_at_sign).toBeNull();
  });
});

// ===========================================================================
describe('T25 QĐ-2 — bảo chứng đòi vai approver cả hai người', () => {
  it('người không mang vai approver không ký bảo chứng được', async () => {
    const chuThe = await mk('Nguoi Duoc Bao Chung T25');
    const { rows: [e] } = await db.raw(
      `INSERT INTO endorsements (community_id, member_id, body) VALUES (?,?,?) RETURNING id`,
      [cid, chuThe, 'Nguoi lam viec tin cay']);
    await expect(
      db.raw(`INSERT INTO endorsement_signatures (endorsement_id, signer_id, community_id) VALUES (?,?,?)`,
        [e.id, nguoiThuong, cid])
    ).rejects.toThrow(/ENDORSER_ROLE_REQUIRED/);
  });

  it('tự bảo chứng cho mình vẫn nghe ĐÚNG lý do (thứ tự trigger)', async () => {
    // `trg_endorsement_signer_valid` phải trả lời TRƯỚC `trg_endorsement_z_role`:
    // người tự ký cho mình cần nghe "không ai tự bảo chứng cho chính mình",
    // không phải một câu về vai.
    const chuThe = await mk('Nguoi Tu Bao Chung T25');
    const { rows: [e] } = await db.raw(
      `INSERT INTO endorsements (community_id, member_id, body) VALUES (?,?,?) RETURNING id`,
      [cid, chuThe, 'x']);
    await expect(
      db.raw(`INSERT INTO endorsement_signatures (endorsement_id, signer_id, community_id) VALUES (?,?,?)`,
        [e.id, chuThe, cid])
    ).rejects.toThrow(/ENDORSEMENT_SELF_SIGN/);
  });

  it('hai approver ký thì bảo chứng thành active được', async () => {
    const chuThe = await mk('Nguoi Duoc Bao Chung Hai T25');
    await expect(db.transaction(async (trx) => {
      const { rows: [e] } = await trx.raw(
        `INSERT INTO endorsements (community_id, member_id, body, status)
         VALUES (?,?,?, 'active') RETURNING id`, [cid, chuThe, 'Nguoi lam viec tin cay']);
      for (const s of [approverA, approverB]) {
        await trx.raw(
          `INSERT INTO endorsement_signatures (endorsement_id, signer_id, community_id) VALUES (?,?,?)`,
          [e.id, s, cid]);
      }
    })).resolves.toBeUndefined();
  });
});

// ===========================================================================
describe('T25 ba hành động chưa có người thi hành thì chưa mở để ký', () => {
  for (const key of ['contacts.export', 'backup.restore', 'data.delete']) {
    it(`${key} bị từ chối NGAY LÚC TẠO, không phải sau khi gom đủ hai chữ ký`, async () => {
      const roles = key === 'data.delete' ? ['approver'] : ['tech'];
      const who = key === 'data.delete' ? approverA : techC;
      await expect(
        twoPerson.create({ actor: actorFor(who, roles), actionKey: key, payload: {} })
      ).rejects.toThrow(/chưa có phần thi hành/);
    });
  }
});
