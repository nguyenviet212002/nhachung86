import { withActor } from '../../core/tx.js';
import { AppError } from '../../core/errors.js';
import { log as auditLog } from '../../core/audit.js';
import { publishToMember } from '../../core/realtime.js';

const NOT_FOUND = () => new AppError('NOT_FOUND', 'Không tìm thấy khoản vay này.', { status: 404 });

function toRow(r) {
  return {
    id: r.id,
    amount: Number(r.amount),
    purpose: r.purpose,
    status: r.status,
    due_on: r.due_on,
    disbursed_on: r.disbursed_on,
    created_at: r.created_at,
    updated_at: r.updated_at,
    borrower_id: r.borrower_id,
    ...(r.borrower_name ? { borrower_name: r.borrower_name } : {}),
  };
}

// Cùng khuôn projects/service.js#create (thông báo 'approver'/'content_ops'
// khi có việc chung chờ duyệt): ở đây báo 'approver'/'tech' — hai vai duy
// nhất được ghi sổ quỹ (fund/routes.js), nên cũng là hai vai quyết định
// khoản vay. Ghi trong CÙNG giao dịch với INSERT loans — khác
// join-requests#notifyJoinRequestDecision (giao dịch riêng), vì đây là
// thông báo cho chính sự kiện vừa tạo, không phải thông báo phụ cho MỘT
// quyết định đã có người khác chốt trước.
async function notifyAdminsNewLoan(trx, { communityId, actorId, loanId }) {
  const { rows } = await trx.raw(
    `INSERT INTO notifications
      (community_id, recipient_id, actor_id, kind, title, body, target_type, target_id)
     SELECT DISTINCT ?::uuid, m.id, ?::uuid, 'loan', 'Có đơn xin vay mới',
            'Một thành viên vừa gửi đơn xin vay quỹ, cần Ban điều hành duyệt.', 'loan', ?::uuid
       FROM members m
       JOIN member_roles mr ON mr.member_id = m.id AND mr.community_id = m.community_id
       JOIN roles r ON r.id = mr.role_id
      WHERE m.community_id = ? AND m.status = 'member' AND m.id <> ?
        AND r.key IN ('approver', 'tech')
     RETURNING *`,
    [communityId, actorId, loanId, communityId, actorId]
  );
  return rows;
}

export async function create({ actor, input }) {
  const result = await withActor(actor.id, async (trx) => {
    const { rows: [row] } = await trx.raw(
      `INSERT INTO loans (community_id, borrower_id, amount, purpose)
       VALUES (?, ?, ?, ?) RETURNING *`,
      [actor.communityId, actor.id, input.amount, input.purpose]
    );
    await auditLog(trx, {
      communityId: actor.communityId,
      actorId: actor.id,
      action: 'loan.requested',
      targetType: 'loan',
      targetId: row.id,
      detail: {},
    });
    const notifications = await notifyAdminsNewLoan(trx, {
      communityId: actor.communityId, actorId: actor.id, loanId: row.id,
    });
    return { row, notifications };
  });
  for (const n of result.notifications) publishToMember(n.recipient_id, 'notification', n);
  return toRow(result.row);
}

// Lịch sử vay của chính người gọi — màn "Quỹ vay" (V.quyvay) hiện trạng thái
// đã duyệt / đang chờ / bị từ chối cho đúng người đó, không phải toàn Hội.
export async function listMine({ actor }) {
  return withActor(actor.id, async (trx) => {
    const { rows } = await trx.raw(
      `SELECT * FROM loans WHERE community_id = ? AND borrower_id = ? ORDER BY created_at DESC`,
      [actor.communityId, actor.id]
    );
    return { data: rows.map(toRow) };
  });
}

// Hàng đợi cho Ban điều hành (approver/tech, canh ở routes.js) — kèm tên
// người vay vì đây là màn quyết định, khác listMine chỉ cho chính chủ.
export async function list({ actor, status, page, limit }) {
  return withActor(actor.id, async (trx) => {
    const offset = (page - 1) * limit;
    const { rows } = await trx.raw(
      `SELECT l.*, m.full_name AS borrower_name
         FROM loans l JOIN members m ON m.id = l.borrower_id AND m.community_id = l.community_id
        WHERE l.community_id = ? AND (?::text IS NULL OR l.status = ?::text)
        ORDER BY l.created_at DESC LIMIT ? OFFSET ?`,
      [actor.communityId, status ?? null, status ?? null, limit, offset]
    );
    const { rows: [{ total }] } = await trx.raw(
      `SELECT count(*)::int AS total FROM loans WHERE community_id = ? AND (?::text IS NULL OR status = ?::text)`,
      [actor.communityId, status ?? null, status ?? null]
    );
    await auditLog(trx, {
      communityId: actor.communityId,
      actorId: actor.id,
      action: 'loan.list',
      detail: { count: rows.length, status: status ?? 'all', page },
    });
    return { data: rows.map(toRow), meta: { page, limit, total } };
  });
}

async function decide({ actor, id, nextStatus, note }) {
  const result = await withActor(actor.id, async (trx) => {
    // FOR UPDATE: cùng lý do join-requests#approve — hai approver bấm gần
    // như đồng thời thì người thứ hai đợi, đọc lại status đã đổi, dừng ở
    // cổng bên dưới thay vì quyết định chồng lên nhau.
    const { rows: [loan] } = await trx.raw(
      `SELECT * FROM loans WHERE id = ? AND community_id = ? FOR UPDATE`,
      [id, actor.communityId]
    );
    if (!loan) throw NOT_FOUND();
    if (loan.status !== 'requested') {
      return { ok: false };
    }

    const { rows: [updated] } = await trx.raw(
      `UPDATE loans SET status = ?, updated_at = now() WHERE id = ? AND community_id = ? RETURNING *`,
      [nextStatus, id, actor.communityId]
    );

    await auditLog(trx, {
      communityId: actor.communityId,
      actorId: actor.id,
      action: nextStatus === 'approved' ? 'loan.approved' : 'loan.rejected',
      targetType: 'loan',
      targetId: id,
      detail: {},
    });

    // loans (migration 021) không có cột ghi chú của người duyệt — note (nếu
    // có) chỉ sống trong nội dung thông báo gửi người vay, không phải bằng
    // chứng lâu dài. Đủ cho MVP "gửi cho admin + xem trạng thái"; một cột
    // riêng để giữ lý do từ chối lâu dài thuộc phạm vi luồng vay đầy đủ.
    const title = nextStatus === 'approved' ? 'Đơn xin vay đã được duyệt' : 'Đơn xin vay đã bị từ chối';
    const baseBody = nextStatus === 'approved'
      ? 'Ban điều hành đã duyệt khoản vay của bạn.'
      : 'Ban điều hành đã từ chối khoản vay của bạn.';
    const body = note ? `${baseBody} ${note}` : baseBody;
    const { rows: [notification] } = await trx.raw(
      `INSERT INTO notifications
        (community_id, recipient_id, actor_id, kind, title, body, target_type, target_id)
       VALUES (?, ?, ?, 'loan', ?, ?, 'loan', ?) RETURNING *`,
      [actor.communityId, loan.borrower_id, actor.id, title, body, id]
    );

    return { ok: true, row: updated, notification };
  });

  if (!result.ok) {
    throw new AppError('INVALID_STATE', 'Đơn vay này đã được quyết định rồi.', { status: 409 });
  }
  publishToMember(result.notification.recipient_id, 'notification', result.notification);
  return toRow(result.row);
}

export const approve = ({ actor, id, note }) => decide({ actor, id, nextStatus: 'approved', note });
export const reject = ({ actor, id, note }) => decide({ actor, id, nextStatus: 'rejected', note });
