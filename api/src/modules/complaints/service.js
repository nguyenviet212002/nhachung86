import { withActor } from '../../core/tx.js';
import { AppError } from '../../core/errors.js';
import { log as auditLog } from '../../core/audit.js';
import { publishToMember } from '../../core/realtime.js';

const NOT_FOUND = () => new AppError('NOT_FOUND', 'Không tìm thấy khiếu nại này.', { status: 404 });

const COMPLAINT_SELECT = `
  SELECT c.id, c.reporter_id, c.subject_member_id, c.subject_type, c.subject_id, c.body,
         c.status, c.created_at, c.updated_at,
         m.full_name AS reporter_name, sm.full_name AS subject_member_name
    FROM complaints c
    JOIN members m ON m.id = c.reporter_id AND m.community_id = c.community_id
    LEFT JOIN members sm ON sm.id = c.subject_member_id AND sm.community_id = c.community_id`;

async function logEvent(trx, { communityId, complaintId, kind, note, actorId }) {
  await trx.raw(
    `INSERT INTO complaint_events (community_id, complaint_id, kind, note, actor_id) VALUES (?, ?, ?, ?, ?)`,
    [communityId, complaintId, kind, note ?? null, actorId ?? null]
  );
}

// subject_id không có khoá ngoại tới một bảng cụ thể (job/aid/activity/
// capability trỏ tới bốn bảng khác nhau) — xác nhận nó thuộc ĐÚNG cộng đồng
// người báo cáo bằng một câu tra theo đúng loại, thay vì tin lời khai của
// client. Thiếu hàng ⇒ VALIDATION_FAILED, không phải NOT_FOUND: đối tượng có
// thể tồn tại ở cộng đồng khác, và ta không xác nhận điều đó ra ngoài.
async function assertSubject(trx, communityId, subjectType, subjectId) {
  if (!subjectType) return;
  const TABLE = { job: 'job_needs', aid: 'aid_requests', activity: 'activities', capability: 'capabilities' };
  const { rows: [row] } = await trx.raw(
    `SELECT id FROM ${TABLE[subjectType]} WHERE id = ? AND community_id = ?`,
    [subjectId, communityId]
  );
  if (!row) throw new AppError('VALIDATION_FAILED', 'Không tìm thấy đối tượng bị khiếu nại.', { status: 422 });
}

export async function create({ actor, input }) {
  return withActor(actor.id, async (trx) => {
    if (input.subject_member_id === actor.id) {
      throw new AppError('VALIDATION_FAILED', 'Không thể tự báo cáo chính mình.', { status: 422 });
    }
    await assertSubject(trx, actor.communityId, input.subject_type ?? null, input.subject_id ?? null);
    const { rows: [row] } = await trx.raw(
      `INSERT INTO complaints (community_id, reporter_id, subject_member_id, subject_type, subject_id, body)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
      [actor.communityId, actor.id, input.subject_member_id ?? null, input.subject_type ?? null, input.subject_id ?? null, input.body]
    );
    await logEvent(trx, { communityId: actor.communityId, complaintId: row.id, kind: 'created', actorId: actor.id });
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'complaint.created', targetType: 'complaint', targetId: row.id,
      detail: { subject_type: input.subject_type ?? (input.subject_member_id ? 'member' : 'none') } });
    return row;
  });
}

// Chỉ approver/content_ops gọi được (chặn ở routes.js qua requireRole) — đây
// là hàng đợi xử lý, không phải "khiếu nại của tôi", nên không lọc reporter_id.
export async function list({ actor, status, page, limit }) {
  return withActor(actor.id, async (trx) => {
    const offset = (page - 1) * limit;
    const { rows } = await trx.raw(
      `${COMPLAINT_SELECT}
        WHERE c.community_id = ? AND (?::text IS NULL OR c.status = ?)
        ORDER BY (c.status IN ('open','reviewing')) DESC, c.created_at DESC LIMIT ? OFFSET ?`,
      [actor.communityId, status ?? null, status ?? null, limit, offset]
    );
    const { rows: [count] } = await trx.raw(
      `SELECT count(*)::int AS total FROM complaints c WHERE c.community_id = ? AND (?::text IS NULL OR c.status = ?)`,
      [actor.communityId, status ?? null, status ?? null]
    );
    return { data: rows, meta: { page, limit, total: count.total } };
  });
}

export async function decide({ actor, id, status, note }) {
  const result = await withActor(actor.id, async (trx) => {
    const { rows: [row] } = await trx.raw(
      `UPDATE complaints SET status = ?, updated_at = now()
        WHERE id = ? AND community_id = ? AND status IN ('open','reviewing')
        RETURNING *`,
      [status, id, actor.communityId]
    );
    if (!row) throw NOT_FOUND();
    await logEvent(trx, { communityId: actor.communityId, complaintId: id, kind: `status:${status}`, note, actorId: actor.id });

    let notification = null;
    // 'reviewing' là bước trung gian ("đang xem") — chỉ báo cho người report
    // khi khiếu nại thật sự khép lại, không báo cho mỗi lần đổi trạng thái.
    if (status === 'resolved' || status === 'dismissed') {
      const { rows: [n] } = await trx.raw(
        `INSERT INTO notifications
          (community_id, recipient_id, actor_id, kind, title, body, target_type, target_id)
         VALUES (?, ?, ?, 'complaint', ?, ?, 'complaint', ?)
         RETURNING *`, [
          actor.communityId, row.reporter_id, actor.id,
          status === 'resolved' ? 'Khiếu nại của bạn đã được xử lý' : 'Khiếu nại của bạn đã được xem xét',
          status === 'resolved'
            ? 'Ban điều hành đã xử lý khiếu nại bạn gửi.'
            : 'Ban điều hành đã xem xét và đóng khiếu nại bạn gửi.',
          row.id,
        ]
      );
      notification = n;
    }
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'complaint.decided', targetType: 'complaint', targetId: id,
      detail: { status } });
    return { row, notification };
  });
  if (result.notification) publishToMember(result.row.reporter_id, 'notification', result.notification);
  return result.row;
}
