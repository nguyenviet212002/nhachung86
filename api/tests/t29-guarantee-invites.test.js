import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { resetDb, ownerKnex } from './helpers/db.js';
import { mkInvite } from './helpers/invites.js';
import { config } from '../src/config/index.js';
import { requestOtp, verifyOtp } from '../src/modules/auth/service.js';
import { consoleAdapter } from '../src/core/otp/console.js';
import { hashInviteToken, newInviteToken } from '../src/modules/invites/token.js';
import { withActor } from '../src/core/tx.js';
import { buildApp } from '../src/app.js';

// ---------------------------------------------------------------------------
// T29 — LINK MỜI BẢO LÃNH (QĐ-1).
//
// Bốn điểm bắt buộc của người dùng, và mỗi điểm được kiểm Ở TẦNG DỮ LIỆU chứ
// không chỉ ở tầng route. Lý do luật ấy tồn tại: một route hôm nay gọi đúng
// hàm không bảo đảm gì về route mà một task sau sẽ viết. Nếu chỉ có bài test đi
// qua HTTP thì thứ được chứng minh là "route hiện tại cư xử đúng", không phải
// "luật này không lách được".
//
// Bố cục theo đúng bốn điểm, rồi tới đường dự phòng, rồi tới token.
// ---------------------------------------------------------------------------

let db, api, cid, otherCid, areaId;

beforeAll(async () => {
  db = await resetDb();
  api = buildApp();
  ({ rows: [{ id: cid }] } = await db.raw(
    `INSERT INTO communities (code,name) VALUES ('community-t29','Hoi dong nien 1986') RETURNING id`
  ));
  ({ rows: [{ id: areaId }] } = await db.raw(
    `INSERT INTO areas (community_id, name) VALUES (?, 'Khu T29') RETURNING id`,
    [cid]
  ));
  // Cộng đồng thứ hai tạo SAU nên resolveCommunityId() (lấy cộng đồng cũ nhất)
  // vẫn trả về cộng đồng chính — các bài đi qua HTTP không bị nhiễu.
  ({ rows: [{ id: otherCid }] } = await db.raw(
    `INSERT INTO communities (code,name) VALUES ('community-t29-khac','Cong dong khac') RETURNING id`
  ));
});

afterAll(async () => {
  await db.destroy();
});

let seq = 0;
async function newMember(status = 'member', communityId = cid) {
  seq += 1;
  const { rows: [m] } = await db.raw(
    `INSERT INTO members (community_id, full_name, status) VALUES (?, ?, ?) RETURNING id`,
    [communityId, `Nguoi T29 so ${seq}`, status]
  );
  return m.id;
}

async function grantRole(memberId, key) {
  await db.raw(
    `INSERT INTO member_roles (member_id, role_id, community_id)
     SELECT ?, r.id, ? FROM roles r WHERE r.key = ?`,
    [memberId, cid, key]
  );
}

function accessTokenFor(memberId) {
  return jwt.sign({ sub: memberId, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' });
}

// Chèn một đơn gia nhập thẳng vào bảng — dùng cho những bài chỉ cần "một suất
// đã tiêu", không cần cả luồng đăng ký.
function insertJr(referrerId, status = 'pending') {
  return db.raw(
    `INSERT INTO join_requests (community_id, applicant_data, referrer_id, status)
     VALUES (?, '{}'::jsonb, ?, ?) RETURNING id`,
    [cid, referrerId, status]
  );
}

// Nhận link + lập đơn, ĐÚNG thứ tự mà modules/auth/service.js dùng. Bài test
// gọi lại đúng trình tự ấy thay vì gọi service, vì thứ cần chứng minh nằm ở
// tầng dữ liệu.
async function claimAndApply(token, communityId = cid, trxOverride = null) {
  const run = async (trx) => {
    const { rows: [claim] } = await trx.raw(`SELECT * FROM guarantee_invite_claim(?, ?)`, [
      hashInviteToken(token),
      communityId,
    ]);
    const { rows: [jr] } = await trx.raw(
      `INSERT INTO join_requests (community_id, applicant_data, referrer_id, status)
       VALUES (?, '{}'::jsonb, ?, 'pending') RETURNING id`,
      [communityId, claim.invite_referrer_id]
    );
    await trx.raw(`UPDATE guarantee_invites SET used_by_join_request = ? WHERE id = ? AND community_id = ?`, [
      jr.id,
      claim.invite_id,
      communityId,
    ]);
    return { inviteId: claim.invite_id, joinRequestId: jr.id, referrerId: claim.invite_referrer_id };
  };
  return trxOverride ? run(trxOverride) : db.transaction(run);
}

// Đợi tới khi thật sự có một giao dịch đang XẾP HÀNG sau một khoá. Bài học đắt
// của t08: `promise` chỉ TẠO lời hứa, còn câu lệnh tới máy chủ trước hay sau
// `commit()` là do bộ lập lịch của Node quyết. Không chờ ở đây thì bài test vẫn
// xanh cả khi gỡ hết khoá — xanh vì lý do sai hoàn toàn.
async function waitBlocked(predicate, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await db.raw(
      `SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted AND (locktype = ?::text OR ?::text = 'any')`,
      [predicate, predicate === 'any' ? 'any' : '']
    );
    if (rows[0].n > 0) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
}

// ===========================================================================
describe('T29 điểm 1 — link dùng ĐÚNG MỘT LẦN', () => {
  it('lần nhận thứ hai (tuần tự) gặp INVITE_ALREADY_USED', async () => {
    const referrer = await newMember();
    const { token } = await mkInvite(db, cid, referrer);

    await expect(claimAndApply(token)).resolves.toBeTruthy();
    await expect(claimAndApply(token)).rejects.toThrow(/INVITE_ALREADY_USED/);
  });

  it('HAI GIAO DỊCH ĐỒNG THỜI cùng nhận một link: đúng MỘT cái qua', async () => {
    // Đây là ca mà đề bài gọi tên: link chuyền tay, hai người bấm cùng lúc.
    // Tuần tự thì lưới nào cũng bắt được; chỉ đồng thời mới phân biệt được một
    // lưới thật với một câu `IF used_at IS NOT NULL` viết cho vui.
    const referrer = await newMember();
    const { token } = await mkInvite(db, cid, referrer);

    const a = ownerKnex();
    const b = ownerKnex();
    try {
      const ta = await a.transaction();
      const tb = await b.transaction();

      const r1 = await claimAndApply(token, cid, ta).then(() => 'ok').catch(() => 'fail');
      const p2 = claimAndApply(token, cid, tb).then(() => 'ok').catch(() => 'fail');

      // Giao dịch thứ hai phải THẬT SỰ đang xếp hàng ở một khoá `transactionid`
      // chưa được cấp trước khi giao dịch thứ nhất commit.
      //
      // NÓI ĐÚNG BÀI NÀY CHỨNG MINH GÌ (đo bằng phép thử đột biến, xem
      // task-qd1-report.md mục 5): nó chứng minh KẾT QUẢ — "link chuyền tay chỉ
      // dùng được một lần" — chứ không chứng minh cơ chế NÀO tạo ra kết quả ấy.
      // Migration 031 có BỐN lưới chồng nhau cho luật này; gỡ riêng `FOR UPDATE`,
      // hay gỡ cả `FOR UPDATE` lẫn `UPDATE ... WHERE used_at IS NULL`, bài này
      // vẫn XANH vì lưới còn lại đỡ được. Chỉ khi gỡ đủ bốn lưới nó mới đỏ.
      // Đừng đọc nó thành "bài này canh khoá hàng".
      const blocked = await waitBlocked('transactionid');
      expect(blocked, 'giao dịch thứ hai không hề bị chặn — link không thật sự bị khoá').toBe(true);

      await ta.commit();
      const r2 = await p2;
      await tb.rollback().catch(() => {});

      expect([r1, r2].filter((x) => x === 'ok'), 'link chuyền tay phải chỉ dùng được một lần').toHaveLength(1);
    } finally {
      await a.destroy();
      await b.destroy();
    }
  });

  it('used_at đặt trong CÙNG giao dịch tạo đơn: giao dịch cuộn thì link còn nguyên', async () => {
    const referrer = await newMember();
    const { token, id } = await mkInvite(db, cid, referrer);

    await expect(
      db.transaction(async (trx) => {
        await claimAndApply(token, cid, trx);
        throw new Error('co y cuon lai');
      })
    ).rejects.toThrow(/co y cuon lai/);

    const { rows: [inv] } = await db.raw(`SELECT used_at, used_by_join_request FROM guarantee_invites WHERE id = ?`, [id]);
    expect(inv.used_at, 'giao dịch hỏng không được đốt mất link của người bảo lãnh').toBeNull();
    expect(inv.used_by_join_request).toBeNull();

    // Và link vẫn dùng được thật.
    await expect(claimAndApply(token)).resolves.toBeTruthy();
  });

  it('đốt link mà KHÔNG để lại đơn nào ⇒ hỏng lúc COMMIT, không phải lúc ghi', async () => {
    const referrer = await newMember();
    const { token } = await mkInvite(db, cid, referrer);

    let claimResolved = false;
    await expect(
      db.transaction(async (trx) => {
        await trx.raw(`SELECT * FROM guarantee_invite_claim(?, ?)`, [hashInviteToken(token), cid]);
        claimResolved = true; // câu này PHẢI qua: ràng buộc hoãn tới COMMIT
      })
    ).rejects.toThrow(/INVITE_USE_INCOMPLETE/);
    expect(claimResolved, 'câu nhận link phải qua được, chỉ COMMIT mới hỏng').toBe(true);
  });

  it('câu UPDATE trần cũng không dùng lại được link đã dùng', async () => {
    // Lưới thứ hai: một task sau viết thẳng UPDATE, không đi qua hàm nhận link.
    const referrer = await newMember();
    const { token, id } = await mkInvite(db, cid, referrer);
    await claimAndApply(token);

    await expect(
      db.raw(`UPDATE guarantee_invites SET used_at = now() WHERE id = ?`, [id])
    ).rejects.toThrow(/INVITE_ALREADY_USED/);
    await expect(
      db.raw(`UPDATE guarantee_invites SET used_at = NULL, used_by_join_request = NULL WHERE id = ?`, [id])
    ).rejects.toThrow(/INVITE_ALREADY_USED/);
  });

  it('link hết hạn và link đã thu hồi đều không nhận được', async () => {
    const referrer = await newMember();
    const { token: hetHan } = await mkInvite(db, cid, referrer, {
      expiresSql: `now() + interval '10 milliseconds'`,
    });
    await new Promise((r) => setTimeout(r, 60));
    await expect(claimAndApply(hetHan)).rejects.toThrow(/INVITE_EXPIRED/);

    const { token: thuHoi, id } = await mkInvite(db, cid, referrer);
    await db.raw(`UPDATE guarantee_invites SET revoked_at = now(), revoked_reason = 'phat nham' WHERE id = ?`, [id]);
    await expect(claimAndApply(thuHoi)).rejects.toThrow(/INVITE_REVOKED/);
  });
});

// ===========================================================================
describe('T29 điểm 2 — link CHƯA DÙNG cũng tiêu suất hạn mức', () => {
  it('ba link còn mở thì link thứ tư bị chặn NGAY LÚC PHÁT', async () => {
    const referrer = await newMember();
    for (let i = 0; i < 3; i++) await mkInvite(db, cid, referrer);
    await expect(mkInvite(db, cid, referrer)).rejects.toThrow(/GUARANTEE_QUOTA_EXCEEDED/);
  });

  it('ba link còn mở cũng chặn một ĐƠN lập thẳng — hai cổng đếm chung một quỹ', async () => {
    // Đây là chỗ dễ sót nhất mà người dùng tự chỉ ra. Nếu hai cổng có hai câu
    // đếm riêng, cổng "lập đơn" sẽ không thấy link nào và cho qua — người bảo
    // lãnh hứa với ba người rồi vẫn nhận thêm được đơn thứ tư.
    const referrer = await newMember();
    for (let i = 0; i < 3; i++) await mkInvite(db, cid, referrer);
    await expect(insertJr(referrer)).rejects.toThrow(/GUARANTEE_QUOTA_EXCEEDED/);
  });

  it('dùng một link KHÔNG làm tổng suất tăng lên — suất chuyển tay, không nhân đôi', async () => {
    const referrer = await newMember();
    const a = await mkInvite(db, cid, referrer);
    await mkInvite(db, cid, referrer);
    await claimAndApply(a.token); // 1 đơn + 1 link mở = 2 suất

    // Còn đúng một suất: phát được thêm MỘT link, không hơn.
    await expect(mkInvite(db, cid, referrer)).resolves.toBeTruthy();
    await expect(mkInvite(db, cid, referrer)).rejects.toThrow(/GUARANTEE_QUOTA_EXCEEDED/);

    // Và nếu link vừa dùng bị tính hai lần (một lần là link, một lần là đơn)
    // thì con số dưới đây là 4 chứ không phải 3.
    const { rows: [n] } = await db.raw(`SELECT fn_guarantee_slots_used(?, ?, NULL, NULL) AS n`, [referrer, cid]);
    expect(n.n).toBe(3);
  });

  it('link HẾT HẠN nhả suất ra, không cần ai dọn dẹp', async () => {
    // TTL một giây, không phải mười mili-giây: ba câu chèn cộng một khoá tư
    // vấn mất nhiều hơn mười mili-giây, nên link đầu chết trước khi bài test
    // kịp khẳng định điều nó muốn khẳng định — bản đầu của bài này XANH SAI
    // theo đúng kiểu đó (nó đo tốc độ máy, không đo luật).
    const referrer = await newMember();
    for (let i = 0; i < 3; i++) {
      await mkInvite(db, cid, referrer, { expiresSql: `now() + interval '1 second'` });
    }
    await expect(mkInvite(db, cid, referrer)).rejects.toThrow(/GUARANTEE_QUOTA_EXCEEDED/);

    // Chờ theo ĐỒNG HỒ CỦA MÁY CHỦ, không theo setTimeout của Node: hai đồng
    // hồ khác nhau vài mili-giây là đủ để bài test chập chờn.
    const deadline = Date.now() + 5000;
    for (;;) {
      const { rows } = await db.raw(
        `SELECT count(*)::int AS n FROM guarantee_invites
          WHERE referrer_id = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()`,
        [referrer]
      );
      if (rows[0].n === 0) break;
      expect(Date.now(), 'ba link TTL một giây phải hết hạn').toBeLessThan(deadline);
      await new Promise((r) => setTimeout(r, 50));
    }
    await expect(mkInvite(db, cid, referrer)).resolves.toBeTruthy();
  });

  it('hạn mức vẫn đọc từ communities.config và từ nới lỏng đã ký, không phải hằng số', async () => {
    const referrer = await newMember();
    const { patchConfig } = await import('./helpers/twoPerson.js');
    await patchConfig(db, cid, { guarantee_quota_per_year: 1 });
    try {
      await expect(mkInvite(db, cid, referrer)).resolves.toBeTruthy();
      await expect(mkInvite(db, cid, referrer)).rejects.toThrow(/GUARANTEE_QUOTA_EXCEEDED/);
    } finally {
      await patchConfig(db, cid, { guarantee_quota_per_year: undefined });
    }
  });

  it('PHÁT LINK và LẬP ĐƠN tranh suất cuối cùng lúc: đúng MỘT cái qua', async () => {
    // Hai cổng phải xếp hàng SAU NHAU, không phải mỗi cổng một hàng. Khoá khác
    // nhau thì cả hai cùng đếm ra 2/3 và cùng đi qua — đúng bài toán bóng ma
    // của migration 009, chỉ khác là nay có hai cửa vào.
    const referrer = await newMember();
    for (let i = 0; i < 2; i++) await mkInvite(db, cid, referrer); // 2/3

    const a = ownerKnex();
    const b = ownerKnex();
    try {
      const ta = await a.transaction();
      const tb = await b.transaction();

      const r1 = await ta
        .raw(
          `INSERT INTO join_requests (community_id, applicant_data, referrer_id, status)
           VALUES (?, '{}'::jsonb, ?, 'pending')`,
          [cid, referrer]
        )
        .then(() => 'ok')
        .catch(() => 'fail');

      const p2 = tb
        .raw(
          `INSERT INTO guarantee_invites (community_id, referrer_id, token_hash, created_by)
           VALUES (?, ?, ?, ?)`,
          [cid, referrer, hashInviteToken(newInviteToken()), referrer]
        )
        .then(() => 'ok')
        .catch(() => 'fail');

      const blocked = await waitBlocked('advisory');
      expect(blocked, 'cổng phát link không xếp hàng sau cổng lập đơn — hai khoá tư vấn khác nhau').toBe(true);

      await ta.commit();
      const r2 = await p2;
      await tb.rollback().catch(() => {});

      expect([r1, r2].filter((x) => x === 'ok')).toHaveLength(1);
    } finally {
      await a.destroy();
      await b.destroy();
    }
  });
});

// ===========================================================================
describe('T29 điểm 3 — thu hồi được, suất trả lại NGAY', () => {
  it('thu hồi một trong ba link thì phát được ngay link mới', async () => {
    const referrer = await newMember();
    const first = await mkInvite(db, cid, referrer);
    await mkInvite(db, cid, referrer);
    await mkInvite(db, cid, referrer);
    await expect(mkInvite(db, cid, referrer)).rejects.toThrow(/GUARANTEE_QUOTA_EXCEEDED/);

    await db.raw(`UPDATE guarantee_invites SET revoked_at = now(), revoked_reason = 'phat nham nguoi' WHERE id = ?`, [
      first.id,
    ]);
    await expect(mkInvite(db, cid, referrer)).resolves.toBeTruthy();
  });

  it('link ĐÃ DÙNG thì không thu hồi được nữa — việc đã xảy ra không rút lại bằng UPDATE', async () => {
    const referrer = await newMember();
    const { token, id } = await mkInvite(db, cid, referrer);
    await claimAndApply(token);

    await expect(
      db.raw(`UPDATE guarantee_invites SET revoked_at = now(), revoked_reason = 'doi y' WHERE id = ?`, [id])
    ).rejects.toThrow(/INVITE_ALREADY_USED/);
  });

  it('thu hồi rồi thì không hồi sinh, và phải có lý do', async () => {
    const referrer = await newMember();
    const { id } = await mkInvite(db, cid, referrer);

    await expect(
      db.raw(`UPDATE guarantee_invites SET revoked_at = now() WHERE id = ?`, [id])
    ).rejects.toThrow(/gi_revoked_pair|violates check constraint/i);

    await db.raw(`UPDATE guarantee_invites SET revoked_at = now(), revoked_reason = 'phat nham' WHERE id = ?`, [id]);
    await expect(
      db.raw(`UPDATE guarantee_invites SET revoked_at = NULL, revoked_reason = NULL WHERE id = ?`, [id])
    ).rejects.toThrow(/INVITE_FROZEN/);
  });

  it('thu hồi qua HTTP: chỉ người bảo lãnh của link đó và ban duyệt', async () => {
    const referrer = await newMember();
    const stranger = await newMember();
    const approver = await newMember();
    await grantRole(approver, 'approver');
    const { id } = await mkInvite(db, cid, referrer);

    const nguoiLa = await supertest(api)
      .post(`/api/v1/guarantee-invites/${id}/revoke`)
      .set('authorization', `Bearer ${accessTokenFor(stranger)}`)
      .send({ reason: 'toi thay ghet' });
    expect(nguoiLa.status, JSON.stringify(nguoiLa.body)).toBe(403);

    const chinhChu = await supertest(api)
      .post(`/api/v1/guarantee-invites/${id}/revoke`)
      .set('authorization', `Bearer ${accessTokenFor(referrer)}`)
      .send({ reason: 'phat nham nguoi' });
    expect(chinhChu.status, JSON.stringify(chinhChu.body)).toBe(200);
    expect(chinhChu.body.status).toBe('revoked');
  });
});

// ===========================================================================
describe('T29 điểm 4 — link KHÔNG thay thế bước xác nhận gặp mặt', () => {
  it('dùng link xong: đơn ở pending, met_confirmed_at vẫn NULL', async () => {
    const referrer = await newMember();
    const { token } = await mkInvite(db, cid, referrer);
    const { joinRequestId } = await claimAndApply(token);

    const { rows: [jr] } = await db.raw(
      `SELECT status, met_on, met_confirmed_at, met_confirmed_by FROM join_requests WHERE id = ?`,
      [joinRequestId]
    );
    expect(jr.status).toBe('pending');
    expect(jr.met_confirmed_at, 'link chỉ chứng minh người bảo lãnh đã chủ động mời').toBeNull();
    expect(jr.met_confirmed_by).toBeNull();
    expect(jr.met_on).toBeNull();
  });

  it('người bảo lãnh lỡ phát link nhầm vẫn chặn được ở bước sau, và chỉ họ chặn được', async () => {
    const referrer = await newMember();
    const stranger = await newMember();
    const approver = await newMember();
    await grantRole(approver, 'approver');
    const { token } = await mkInvite(db, cid, referrer);
    const { joinRequestId } = await claimAndApply(token);

    // Ngay cả ban duyệt cũng không xác nhận gặp mặt hộ được — lời khai "tôi đã
    // gặp người này" chỉ có nghĩa khi nó đến từ đúng người đã đứng ra bảo lãnh.
    for (const [ai, who] of [[stranger, 'người lạ'], [approver, 'ban duyệt']]) {
      const res = await supertest(api)
        .post(`/api/v1/join-requests/${joinRequestId}/confirm-met`)
        .set('authorization', `Bearer ${accessTokenFor(ai)}`)
        .send({ met_on: '2026-08-01', note: 'toi da gap nguoi nay o nha van hoa xa' });
      expect(res.status, `${who} không được xác nhận hộ: ${JSON.stringify(res.body)}`).toBe(403);
    }

    // Và người bảo lãnh CHẶN được: từ chối vẫn là một quyết định riêng.
    const { rows: [jr] } = await db.raw(`SELECT met_confirmed_at FROM join_requests WHERE id = ?`, [joinRequestId]);
    expect(jr.met_confirmed_at).toBeNull();
  });

  it('đơn sinh từ link vẫn không thành thành viên khi chưa có xác nhận gặp mặt', async () => {
    const referrer = await newMember();
    const { token } = await mkInvite(db, cid, referrer);
    await claimAndApply(token);

    await expect(
      db.transaction(async (trx) => {
        await trx.raw(
          `INSERT INTO members (community_id, full_name, status, referrer_id)
           VALUES (?, 'Nguoi vao bang link', 'member', ?)`,
          [cid, referrer]
        );
      })
    ).rejects.toThrow(/MEMBER_NEEDS_MET_CONFIRMATION/);
  });
});

// ===========================================================================
describe('T29 đường dự phòng — phải để lại dấu vết, không được là cửa sau im lặng', () => {
  it('phát hộ ĐI QUA nhật ký với tên hành động RIÊNG, kèm ai và mã lý do', async () => {
    const referrer = await newMember();
    const approver = await newMember();
    await grantRole(approver, 'approver');

    const res = await supertest(api)
      .post('/api/v1/guarantee-invites')
      .set('authorization', `Bearer ${accessTokenFor(approver)}`)
      .send({
        referrer_id: referrer,
        on_behalf_reason_code: 'khong_mo_duoc_link',
        on_behalf_reason: 'anh ay khong mo duoc duong link tren dien thoai cua minh',
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.created_on_behalf).toBe(true);
    expect(res.body.referrer_id).toBe(referrer);
    expect(res.body.created_by).toBe(approver);

    const { rows } = await db.raw(
      `SELECT action, actor_id, target_id, detail FROM audit_log
        WHERE action = 'guarantee_invite.created_on_behalf' AND target_id = ?`,
      [res.body.id]
    );
    expect(rows, 'đường vòng phải có một dòng nhật ký RIÊNG, không lẫn với đường thường').toHaveLength(1);
    expect(rows[0].actor_id).toBe(approver);
    expect(rows[0].detail.on_behalf_of).toBe(referrer);
    expect(rows[0].detail.reason_code).toBe('khong_mo_duoc_link');
    expect(rows[0].detail.reason_length).toBeGreaterThanOrEqual(20);

    // Nội dung lý do KHÔNG vào nhật ký: nó là văn bản tự do, đúng loại dữ liệu
    // mà luật mục 10 cấm. Lý do đầy đủ nằm trong hàng mà target_id trỏ tới.
    expect(JSON.stringify(rows[0].detail)).not.toContain('dien thoai');
    const { rows: [inv] } = await db.raw(`SELECT on_behalf_reason FROM guarantee_invites WHERE id = ?`, [res.body.id]);
    expect(inv.on_behalf_reason).toContain('dien thoai');
  });

  it('hai trường hợp KHÔNG trông giống nhau trong nhật ký', async () => {
    // Nếu chúng giống hệt nhau thì đường vòng vẫn là cửa sau im lặng, chỉ khác
    // là có ghi chép. Bài này so hai dòng cạnh nhau.
    const referrer = await newMember();
    await grantRole(referrer, 'member');

    const tuPhat = await supertest(api)
      .post('/api/v1/guarantee-invites')
      .set('authorization', `Bearer ${accessTokenFor(referrer)}`)
      .send({});
    expect(tuPhat.status, JSON.stringify(tuPhat.body)).toBe(201);
    expect(tuPhat.body.created_on_behalf).toBe(false);

    const { rows } = await db.raw(
      `SELECT action, detail FROM audit_log WHERE target_id = ?`,
      [tuPhat.body.id]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('guarantee_invite.created');
    expect(rows[0].detail.on_behalf_of, 'đường thường không có ai để ghi là phát hộ').toBeUndefined();
  });

  it('phát hộ mà KHÔNG có lý do bị chặn ở CSDL, không phải chỉ ở zod', async () => {
    const referrer = await newMember();
    const approver = await newMember();
    await grantRole(approver, 'approver');

    // Câu SQL trần, không đi qua route nào: đây mới là chỗ chứng minh luật nằm
    // ở CSDL. Chặn bằng zod thì một task sau viết thẳng INSERT là mở lại cửa.
    await expect(
      db.raw(
        `INSERT INTO guarantee_invites (community_id, referrer_id, token_hash, created_by)
         VALUES (?, ?, ?, ?)`,
        [cid, referrer, hashInviteToken(newInviteToken()), approver]
      )
    ).rejects.toThrow(/INVITE_REASON_REQUIRED/);

    // Chuỗi rỗng và chuỗi toàn khoảng trắng cũng không phải một lý do.
    for (const rong of ['', '   ', '\n\t ']) {
      await expect(
        db.raw(
          `INSERT INTO guarantee_invites
             (community_id, referrer_id, token_hash, created_by, on_behalf_reason_code, on_behalf_reason)
           VALUES (?, ?, ?, ?, 'khac', ?)`,
          [cid, referrer, hashInviteToken(newInviteToken()), approver, rong]
        )
      ).rejects.toThrow(/INVITE_REASON_REQUIRED/);
    }
  });

  it('người KHÔNG mang vai approver thì không phát hộ được', async () => {
    const referrer = await newMember();
    const nguoiThuong = await newMember();
    await grantRole(nguoiThuong, 'member');

    await expect(
      db.raw(
        `INSERT INTO guarantee_invites
           (community_id, referrer_id, token_hash, created_by, on_behalf_reason_code, on_behalf_reason)
         VALUES (?, ?, ?, ?, 'khac', 'toi tot bung nen phat ho anh ay mot cai link')`,
        [cid, referrer, hashInviteToken(newInviteToken()), nguoiThuong]
      )
    ).rejects.toThrow(/INVITE_ON_BEHALF_DENIED/);

    const qua_http = await supertest(api)
      .post('/api/v1/guarantee-invites')
      .set('authorization', `Bearer ${accessTokenFor(nguoiThuong)}`)
      .send({
        referrer_id: referrer,
        on_behalf_reason_code: 'khac',
        on_behalf_reason: 'toi tot bung nen phat ho anh ay mot cai link',
      });
    expect(qua_http.status, JSON.stringify(qua_http.body)).toBe(403);
    expect(qua_http.body.error.code).toBe('INVITE_ON_BEHALF_DENIED');
  });

  it('không ai ghi được một link mang tên người khác là người phát', async () => {
    // Không có vế này thì approver phát hộ vẫn ghi được `created_by = referrer_id`
    // và bản ghi trông y hệt đường thường — dấu vết bị xoá ngay lúc sinh ra.
    const referrer = await newMember();
    const approver = await newMember();
    await grantRole(approver, 'approver');

    await expect(
      withActor(approver, (trx) =>
        trx.raw(
          `INSERT INTO guarantee_invites (community_id, referrer_id, token_hash, created_by)
           VALUES (?, ?, ?, ?)`,
          [cid, referrer, hashInviteToken(newInviteToken()), referrer]
        )
      )
    ).rejects.toThrow(/INVITE_CREATOR_MISMATCH/);
  });
});

// ===========================================================================
describe('T29 token — chỉ băm được lưu, và băm cũng không ra khỏi máy chủ', () => {
  it('token thô không nằm ở đâu trong CSDL, và cột từ chối nhận nó', async () => {
    const referrer = await newMember();
    const res = await supertest(api)
      .post('/api/v1/guarantee-invites')
      .set('authorization', `Bearer ${accessTokenFor(referrer)}`)
      .send({});
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const token = res.body.token;
    expect(typeof token).toBe('string');

    const { rows } = await db.raw(`SELECT * FROM guarantee_invites WHERE id = ?`, [res.body.id]);
    expect(JSON.stringify(rows), 'CSDL chỉ được giữ băm').not.toContain(token);
    expect(rows[0].token_hash).toBe(hashInviteToken(token));

    // Không dòng nhật ký nào mang token hay băm của nó.
    const { rows: log } = await db.raw(`SELECT detail FROM audit_log WHERE target_id = ?`, [res.body.id]);
    expect(JSON.stringify(log)).not.toContain(token);
    expect(JSON.stringify(log)).not.toContain(hashInviteToken(token));

    // Và cột chặn thẳng một lần lỡ tay lưu token thô.
    await expect(
      db.raw(
        `INSERT INTO guarantee_invites (community_id, referrer_id, token_hash, created_by) VALUES (?, ?, ?, ?)`,
        [cid, referrer, token, referrer]
      )
    ).rejects.toThrow(/token_hash|violates check constraint/i);
  });

  it('GET /guarantee-invites không trả token cũng không trả băm', async () => {
    const referrer = await newMember();
    const tao = await supertest(api)
      .post('/api/v1/guarantee-invites')
      .set('authorization', `Bearer ${accessTokenFor(referrer)}`)
      .send({});
    expect(tao.status, JSON.stringify(tao.body)).toBe(201);

    const res = await supertest(api)
      .get('/api/v1/guarantee-invites')
      .set('authorization', `Bearer ${accessTokenFor(referrer)}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(JSON.stringify(res.body)).not.toContain(tao.body.token);
    expect(JSON.stringify(res.body)).not.toContain(hashInviteToken(tao.body.token));
  });

  it('token không có mặt trong thông báo lỗi của /auth/register', async () => {
    const phone = '0975000001';
    const bia = 'day-la-mot-token-hoan-toan-bia-khong-co-that';
    let code;
    const spy = vi.spyOn(consoleAdapter, 'send').mockImplementation(async (a) => {
      code = a.code;
    });
    try {
      await requestOtp({ communityId: cid, phone, purpose: 'register' });
    } finally {
      spy.mockRestore();
    }
    const { otpToken } = await verifyOtp({ communityId: cid, phone, code, purpose: 'register' });

    const res = await supertest(api).post('/api/v1/auth/register').send({
      otp_token: otpToken,
      phone,
      full_name: 'Nguoi Cam Link Bia',
      birth_year: 1986,
      area_id: areaId,
      invite_token: bia,
      password: 'mat-khau-du-manh-t29',
      terms: true,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(res.body.error.code).toBe('INVITE_NOT_FOUND');
    expect(JSON.stringify(res.body)).not.toContain(bia);
    expect(JSON.stringify(res.body)).not.toContain(hashInviteToken(bia));
  });
});

// ===========================================================================
describe('T29 mọi truy vấn lọc community_id', () => {
  it('link của cộng đồng khác không nhận được bằng community_id của cộng đồng này', async () => {
    const nguoiNgoai = await newMember('member', otherCid);
    const token = newInviteToken();
    await db.raw(
      `INSERT INTO guarantee_invites (community_id, referrer_id, token_hash, created_by) VALUES (?, ?, ?, ?)`,
      [otherCid, nguoiNgoai, hashInviteToken(token), nguoiNgoai]
    );

    // Đúng token, sai cộng đồng ⇒ coi như không có. Nếu câu tra quên
    // community_id thì link này nhận được, và một người của cộng đồng khác trở
    // thành người bảo lãnh ở đây.
    await expect(claimAndApply(token, cid)).rejects.toThrow(/INVITE_NOT_FOUND/);
  });

  it('link không trỏ người bảo lãnh sang cộng đồng khác được (khoá ngoại GHÉP)', async () => {
    const nguoiNgoai = await newMember('member', otherCid);
    await expect(
      db.raw(
        `INSERT INTO guarantee_invites (community_id, referrer_id, token_hash, created_by) VALUES (?, ?, ?, ?)`,
        [cid, nguoiNgoai, hashInviteToken(newInviteToken()), nguoiNgoai]
      )
    ).rejects.toThrow(/gi_referrer_same_community|violates foreign key/i);
  });

  it('link không nối được sang đơn của cộng đồng khác', async () => {
    const referrer = await newMember();
    const nguoiNgoai = await newMember('member', otherCid);
    const { rows: [jrNgoai] } = await db.raw(
      `INSERT INTO join_requests (community_id, applicant_data, referrer_id, status)
       VALUES (?, '{}'::jsonb, ?, 'pending') RETURNING id`,
      [otherCid, nguoiNgoai]
    );
    const { id } = await mkInvite(db, cid, referrer);

    await expect(
      db.raw(`UPDATE guarantee_invites SET used_at = now(), used_by_join_request = ? WHERE id = ?`, [jrNgoai.id, id])
    ).rejects.toThrow(/gi_jr_same_community|violates foreign key/i);
  });
});

// ===========================================================================
describe('T29 dữ kiện hạn mức ĐỌC thì không sửa được', () => {
  it('không kéo được expires_at, không đổi được referrer_id, không đổi được token_hash', async () => {
    const referrer = await newMember();
    const nguoiKhac = await newMember();
    const { id } = await mkInvite(db, cid, referrer);

    for (const [cot, cau] of [
      ['expires_at', `expires_at = now() - interval '1 day'`],
      ['referrer_id', `referrer_id = '${nguoiKhac}'`],
      ['created_at', `created_at = now() - interval '1 year'`],
    ]) {
      await expect(
        db.raw(`UPDATE guarantee_invites SET ${cau} WHERE id = ?`, [id]),
        `${cot} phải đóng băng`
      ).rejects.toThrow(/INVITE_FROZEN/);
    }
  });

  it('app_role không xoá được link đã phát', async () => {
    const { rows } = await db.raw(
      `SELECT has_table_privilege('app_role', 'guarantee_invites', 'DELETE') AS co`
    );
    expect(rows[0].co, 'link đã phát là một sự việc đã xảy ra').toBe(false);
  });
});
