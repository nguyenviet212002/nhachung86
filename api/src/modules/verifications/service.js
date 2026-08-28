import { withActor } from '../../core/tx.js';
import { AppError } from '../../core/errors.js';
import { log as auditLog } from '../../core/audit.js';
import { publishToMember } from '../../core/realtime.js';

const NOT_FOUND = () => new AppError('NOT_FOUND', 'Không tìm thấy yêu cầu xác minh này.', { status: 404 });

const VERIFICATION_SELECT = `
  SELECT v.id, v.member_id, v.kind, v.status, v.verified_by, v.verified_at, v.note,
         v.created_at, v.updated_at, m.full_name AS member_name
    FROM verifications v
    JOIN members m ON m.id = v.member_id AND m.community_id = v.community_id`;

// Người nộp là chính chủ (member_id = actor.id) — đây là lời TỰ khai "tôi
// muốn được xác minh mục này", không phải ai gán hộ ai. UNIQUE (member_id,
// kind) của bảng thật buộc upsert thay vì INSERT trần: bị từ chối rồi vẫn
// nộp lại được (quay về 'pending', xoá dấu vết duyệt cũ); đang 'pending' hay
// đã 'verified' thì từ chối ngay, không tạo hàng thứ hai.
export async function create({ actor, input }) {
  return withActor(actor.id, async (trx) => {
    const { rows: [existing] } = await trx.raw(
      `SELECT status FROM verifications WHERE member_id = ? AND community_id = ? AND kind = ?`,
      [actor.id, actor.communityId, input.kind]
    );
    if (existing && existing.status !== 'rejected') {
      throw new AppError(
        'VALIDATION_FAILED',
        existing.status === 'pending'
          ? 'Bạn đã có yêu cầu xác minh mục này đang chờ xử lý.'
          : 'Mục này đã được xác minh rồi.',
        { status: 422 }
      );
    }
    const { rows: [row] } = await trx.raw(
      `INSERT INTO verifications (community_id, member_id, kind, status, note)
       VALUES (?, ?, ?, 'pending', ?)
       ON CONFLICT (member_id, kind) DO UPDATE
         SET status = 'pending', note = EXCLUDED.note, verified_by = NULL, verified_at = NULL, updated_at = now()
       RETURNING *`,
      [actor.communityId, actor.id, input.kind, input.note ?? null]
    );
    await auditLog(trx, {
      communityId: actor.communityId, actorId: actor.id,
      action: 'verification.requested', targetType: 'verification', targetId: row.id,
      detail: { kind: input.kind },
    });
    return row;
  });
}

export async function listMine({ actor }) {
  return withActor(actor.id, async (trx) => {
    const { rows } = await trx.raw(
      `SELECT id, kind, status, note, verified_at, created_at FROM verifications
        WHERE member_id = ? AND community_id = ? ORDER BY created_at DESC`,
      [actor.id, actor.communityId]
    );
    return { data: rows };
  });
}

// Chỉ approver/content_ops gọi được (chặn ở routes.js qua requireRole) — hàng
// đợi xử lý, giống complaints.list, nên không lọc theo member_id.
export async function list({ actor, status, page, limit }) {
  return withActor(actor.id, async (trx) => {
    const offset = (page - 1) * limit;
    const { rows } = await trx.raw(
      `${VERIFICATION_SELECT}
        WHERE v.community_id = ? AND (?::text IS NULL OR v.status = ?)
        ORDER BY (v.status = 'pending') DESC, v.created_at DESC LIMIT ? OFFSET ?`,
      [actor.communityId, status ?? null, status ?? null, limit, offset]
    );
    const { rows: [count] } = await trx.raw(
      `SELECT count(*)::int AS total FROM verifications v WHERE v.community_id = ? AND (?::text IS NULL OR v.status = ?)`,
      [actor.communityId, status ?? null, status ?? null]
    );
    return { data: rows, meta: { page, limit, total: count.total } };
  });
}

export async function decide({ actor, id, status, note }) {
  const result = await withActor(actor.id, async (trx) => {
    // `member_id <> actor.id` cùng chiều với ràng buộc verif_not_self của
    // CSDL (không ai tự xác minh cho chính mình) — lọc ở đây để một người tự
    // gọi API cho hồ sơ của chính họ nhận NOT_FOUND thay vì đâm vào lỗi
    // ràng buộc CSDL.
    const { rows: [row] } = await trx.raw(
      `UPDATE verifications SET status = ?, verified_by = ?, verified_at = now(),
              note = coalesce(?, note), updated_at = now()
        WHERE id = ? AND community_id = ? AND status = 'pending' AND member_id <> ?
        RETURNING *`,
      [status, actor.id, note ?? null, id, actor.communityId, actor.id]
    );
    if (!row) throw NOT_FOUND();

    await auditLog(trx, {
      communityId: actor.communityId, actorId: actor.id,
      action: 'verification.decided', targetType: 'verification', targetId: id,
      detail: { status, kind: row.kind },
    });

    const { rows: [n] } = await trx.raw(
      `INSERT INTO notifications
        (community_id, recipient_id, actor_id, kind, title, body, target_type, target_id)
       VALUES (?, ?, ?, 'verification', ?, ?, 'verification', ?)
       RETURNING *`, [
        actor.communityId, row.member_id, actor.id,
        status === 'verified' ? 'Yêu cầu xác minh của bạn đã được duyệt' : 'Yêu cầu xác minh của bạn đã bị từ chối',
        status === 'verified'
          ? 'Ban điều hành đã xác minh mục bạn yêu cầu.'
          : 'Ban điều hành đã xem và từ chối yêu cầu xác minh của bạn.',
        row.id,
      ]
    );
    return { row, notification: n };
  });
  publishToMember(result.row.member_id, 'notification', result.notification);
  return result.row;
}
