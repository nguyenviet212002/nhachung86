import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetDb } from './helpers/db.js';

// ---------------------------------------------------------------------------
// T13 — KHUÔN "ràng buộc đặt trên bảng A không chạy khi người ta động vào bảng
// B", ở ba chỗ NGOÀI quỹ.
//
// Quỹ đã có bài riêng (t13-signature-removal). Đề bài Task 13 hỏi "còn chỗ thứ
// ba nào cùng khuôn không" — có, và nhiều hơn một:
//
//   1. endorsements  ← endorsement_signatures      (đặc tả có nhắc, ở dạng một câu)
//   2. memory_photos ← memory_photo_people          (đặc tả KHÔNG nhắc)
//   3. pending_actions ← pending_action_signatures  (đặc tả KHÔNG nhắc)
//
// Với cả ba, trigger trên bảng A chỉ chạy khi bảng A bị ghi. Giao dịch sau đó
// chỉ chạm bảng B thì không có gì kêu lên, và trạng thái ở A trở thành một lời
// khẳng định không còn đúng: "bảo chứng của hai người" còn một chữ ký, "ảnh đã
// được mọi người đồng ý" có người vừa rút lại, "hành động hai người ký" mất
// bằng chứng của người thứ hai.
//
// Chỗ số 2 nặng nhất về hậu quả: quyền RÚT LẠI sự đồng ý là quyền mà cả mục 10
// (Nghị định 13) dựa vào. Một cái nút "tôi rút lại" không làm tấm ảnh biến khỏi
// trang là đúng loại nút mà việc thừa kế (a) của task này vừa đi bịt.
// ---------------------------------------------------------------------------

let db, cid, chuThe, kyA, kyB, nguoiTrongAnh, nguoiKhac, endorsement, photo, memoryId;

async function mk(name, roleKey = null) {
  const { rows: [m] } = await db.raw(
    `INSERT INTO members (community_id, full_name, status) VALUES (?,?, 'member') RETURNING id`,
    [cid, name]);
  if (roleKey) {
    await db.raw(
      `INSERT INTO member_roles (member_id, role_id, community_id)
       SELECT ?, r.id, ? FROM roles r WHERE r.key = ?`, [m.id, cid, roleKey]);
  }
  return m.id;
}

beforeAll(async () => {
  db = await resetDb();
  ({ rows: [{ id: cid }] } = await db.raw(
    `INSERT INTO communities (code,name) VALUES ('t13-ab','Hoi') RETURNING id`));
  chuThe = await mk('Nguoi Duoc Bao Chung');
  kyA = await mk('Nguoi Ky A', 'approver');
  kyB = await mk('Nguoi Ky B', 'approver');
  nguoiTrongAnh = await mk('Nguoi Trong Anh');
  nguoiKhac = await mk('Nguoi Khac');

  // Bảo chứng đang hoạt động với đúng 2 chữ ký, ghi trong MỘT giao dịch.
  endorsement = await db.transaction(async (trx) => {
    const { rows: [e] } = await trx.raw(
      `INSERT INTO endorsements (community_id, member_id, body, status)
       VALUES (?,?,?, 'active') RETURNING id`, [cid, chuThe, 'Nguoi lam viec tin cay']);
    for (const s of [kyA, kyB]) {
      await trx.raw(
        `INSERT INTO endorsement_signatures (endorsement_id, signer_id, community_id)
         VALUES (?,?,?)`, [e.id, s, cid]);
    }
    return e.id;
  });

  ({ rows: [{ id: memoryId }] } = await db.raw(
    `INSERT INTO memories (community_id, title, created_by) VALUES (?,?,?) RETURNING id`,
    [cid, 'Buoi le khanh thanh', chuThe]));
  photo = await db.transaction(async (trx) => {
    const { rows: [p] } = await trx.raw(
      `INSERT INTO memory_photos (community_id, memory_id, url) VALUES (?,?,?) RETURNING id`,
      [cid, memoryId, 'https://x/1.jpg']);
    await trx.raw(
      `INSERT INTO memory_photo_people (community_id, photo_id, member_id, consent, decided_at)
       VALUES (?,?,?, 'yes', now())`, [cid, p.id, nguoiTrongAnh]);
    await trx.raw(`UPDATE memory_photos SET status = 'approved' WHERE id = ?`, [p.id]);
    return p.id;
  });
});

afterAll(async () => { await db.destroy(); });

describe('T13 bảng A/B #1 — bảo chứng đúng hai chữ ký', () => {
  it('gỡ một chữ ký ⇒ COMMIT hỏng, và chữ ký vẫn còn', async () => {
    await expect(db.transaction(async (trx) => {
      await trx.raw(
        `DELETE FROM endorsement_signatures WHERE endorsement_id = ? AND signer_id = ?`,
        [endorsement, kyB]);
    })).rejects.toThrow(/ENDORSEMENT_NEEDS_TWO_DISTINCT/);

    const { rows: [{ n }] } = await db.raw(
      `SELECT count(*)::int AS n FROM endorsement_signatures WHERE endorsement_id = ?`,
      [endorsement]);
    expect(n).toBe(2);
  });

  it('thêm chữ ký thứ BA cũng hỏng — "đúng 2" chứ không phải "ít nhất 2"', async () => {
    const kyC = await mk('Nguoi Ky C', 'approver');
    await expect(db.transaction(async (trx) => {
      await trx.raw(
        `INSERT INTO endorsement_signatures (endorsement_id, signer_id, community_id) VALUES (?,?,?)`,
        [endorsement, kyC, cid]);
    })).rejects.toThrow(/ENDORSEMENT_NEEDS_TWO_DISTINCT/);
  });

  it('người được bảo chứng không tự ký cho mình', async () => {
    await expect(db.transaction(async (trx) => {
      await trx.raw(
        `INSERT INTO endorsement_signatures (endorsement_id, signer_id, community_id) VALUES (?,?,?)`,
        [endorsement, chuThe, cid]);
    })).rejects.toThrow(/ENDORSEMENT_SELF_SIGN/);
  });

  it('bảo chứng mới với 1 chữ ký không thành active được', async () => {
    await expect(db.transaction(async (trx) => {
      const { rows: [e] } = await trx.raw(
        `INSERT INTO endorsements (community_id, member_id, body, status)
         VALUES (?,?,?, 'active') RETURNING id`, [cid, nguoiKhac, 'x']);
      await trx.raw(
        `INSERT INTO endorsement_signatures (endorsement_id, signer_id, community_id) VALUES (?,?,?)`,
        [e.id, kyA, cid]);
    })).rejects.toThrow(/ENDORSEMENT_NEEDS_TWO_DISTINCT/);
  });

  it('bản nháp thì không cần chữ ký nào — ngưỡng có thật', async () => {
    const { rows: [e] } = await db.raw(
      `INSERT INTO endorsements (community_id, member_id, body) VALUES (?,?,?) RETURNING id`,
      [cid, nguoiKhac, 'ban nhap']);
    expect(e.id).toBeTruthy();
  });
});

describe('T13 bảng A/B #2 — rút lại sự đồng ý PHẢI có hiệu lực', () => {
  it('người trong ảnh đổi ý sang "no" ⇒ ảnh đã duyệt không đứng nữa', async () => {
    await expect(db.transaction(async (trx) => {
      await trx.raw(
        `UPDATE memory_photo_people SET consent = 'no', decided_at = now()
          WHERE photo_id = ? AND member_id = ?`, [photo, nguoiTrongAnh]);
    })).rejects.toThrow(/PHOTO_CONSENT_INCOMPLETE/);
  });

  it('gắn thêm một người CHƯA trả lời vào ảnh đã duyệt cũng bị chặn', async () => {
    await expect(db.transaction(async (trx) => {
      await trx.raw(
        `INSERT INTO memory_photo_people (community_id, photo_id, member_id) VALUES (?,?,?)`,
        [cid, photo, nguoiKhac]);
    })).rejects.toThrow(/PHOTO_CONSENT_INCOMPLETE/);
  });

  it('duyệt một ảnh mà có người chưa trả lời ⇒ bị chặn ngay ở bảng ảnh', async () => {
    await expect(db.transaction(async (trx) => {
      const { rows: [p] } = await trx.raw(
        `INSERT INTO memory_photos (community_id, memory_id, url) VALUES (?,?,?) RETURNING id`,
        [cid, memoryId, 'https://x/2.jpg']);
      await trx.raw(
        `INSERT INTO memory_photo_people (community_id, photo_id, member_id) VALUES (?,?,?)`,
        [cid, p.id, nguoiKhac]);        // consent mặc định 'no_reply'
      await trx.raw(`UPDATE memory_photos SET status = 'approved' WHERE id = ?`, [p.id]);
    })).rejects.toThrow(/PHOTO_CONSENT_INCOMPLETE/);
  });

  it('im lặng KHÔNG phải đồng ý — "no_reply" chặn y như "no"', async () => {
    await expect(db.transaction(async (trx) => {
      await trx.raw(
        `UPDATE memory_photo_people SET consent = 'no_reply'
          WHERE photo_id = ? AND member_id = ?`, [photo, nguoiTrongAnh]);
    })).rejects.toThrow(/PHOTO_CONSENT_INCOMPLETE/);
  });

  it('đổi ý trên ảnh CHƯA duyệt thì tự do — luật chỉ chạm đúng chỗ nó cần', async () => {
    const { rows: [p] } = await db.raw(
      `INSERT INTO memory_photos (community_id, memory_id, url) VALUES (?,?,?) RETURNING id`,
      [cid, memoryId, 'https://x/3.jpg']);
    await db.raw(
      `INSERT INTO memory_photo_people (community_id, photo_id, member_id) VALUES (?,?,?)`,
      [cid, p.id, nguoiKhac]);
    await db.raw(
      `UPDATE memory_photo_people SET consent = 'no' WHERE photo_id = ?`, [p.id]);
    const { rows: [r] } = await db.raw(
      `SELECT consent FROM memory_photo_people WHERE photo_id = ?`, [p.id]);
    expect(r.consent).toBe('no');
  });
});

describe('T13 bảng A/B #3 — hành động hai người ký không mất chữ ký', () => {
  let action;

  beforeAll(async () => {
    action = await db.transaction(async (trx) => {
      const { rows: [a] } = await trx.raw(
        `INSERT INTO pending_actions
           (community_id, action_key, payload, payload_hash, created_by, status, executed_at)
         VALUES (?, 'data.delete', '{}'::jsonb, 'hash1', ?, 'executed', now()) RETURNING id`,
        [cid, kyA]);
      for (const s of [kyA, kyB]) {
        await trx.raw(
          `INSERT INTO pending_action_signatures
             (pending_action_id, signer_id, community_id, payload_hash_at_sign)
           VALUES (?,?,?, 'hash1')`, [a.id, s, cid]);
      }
      return a.id;
    });
  });

  it('gỡ chữ ký của một hành động đã thi hành ⇒ COMMIT hỏng', async () => {
    await expect(db.transaction(async (trx) => {
      await trx.raw(
        `DELETE FROM pending_action_signatures WHERE pending_action_id = ? AND signer_id = ?`,
        [action, kyB]);
    })).rejects.toThrow(/TWO_SIGNATURES_REQUIRED/);
  });

  it('người ký phải mang đúng vai mà action_key đòi (mục 7.5)', async () => {
    await expect(db.transaction(async (trx) => {
      await trx.raw(
        `INSERT INTO pending_action_signatures
           (pending_action_id, signer_id, community_id, payload_hash_at_sign)
         VALUES (?,?,?, 'hash1')`, [action, nguoiKhac, cid]);
    })).rejects.toThrow(/SIGNER_ROLE_REQUIRED/);
  });

  it('người ký không được là ĐỐI TƯỢNG của hành động (mục 7.2)', async () => {
    await expect(db.transaction(async (trx) => {
      const { rows: [a] } = await trx.raw(
        `INSERT INTO pending_actions
           (community_id, action_key, target_type, target_id, payload, payload_hash, created_by)
         VALUES (?, 'member.terminate', 'member', ?, '{}'::jsonb, 'h', ?) RETURNING id`,
        [cid, kyB, kyA]);
      await trx.raw(
        `INSERT INTO pending_action_signatures
           (pending_action_id, signer_id, community_id, payload_hash_at_sign)
         VALUES (?,?,?, 'h')`, [a.id, kyB, cid]);
    })).rejects.toThrow(/SIGNER_IS_TARGET/);
  });

  it('thi hành mà thiếu chữ ký người tạo ⇒ hỏng (người tạo LÀ người ký thứ nhất)', async () => {
    const kyC = await mk('Nguoi Ky C2', 'approver');
    const kyD = await mk('Nguoi Ky D2', 'approver');
    await expect(db.transaction(async (trx) => {
      const { rows: [a] } = await trx.raw(
        `INSERT INTO pending_actions
           (community_id, action_key, payload, payload_hash, created_by, status, executed_at)
         VALUES (?, 'data.delete', '{}'::jsonb, 'h', ?, 'executed', now()) RETURNING id`,
        [cid, kyA]);
      for (const s of [kyC, kyD]) {
        await trx.raw(
          `INSERT INTO pending_action_signatures
             (pending_action_id, signer_id, community_id, payload_hash_at_sign)
           VALUES (?,?,?, 'h')`, [a.id, s, cid]);
      }
    })).rejects.toThrow(/CREATOR_SIGNATURE_MISSING/);
  });
});
