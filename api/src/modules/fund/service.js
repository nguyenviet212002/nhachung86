import { withActor } from '../../core/tx.js';
import { AppError } from '../../core/errors.js';
import { log as auditLog } from '../../core/audit.js';

const NOT_FOUND = () => new AppError('NOT_FOUND', 'Không tìm thấy bút toán này.', { status: 404 });

// Bút toán từ ngưỡng trở lên mà thiếu đủ 2 chữ ký sẽ RAISE
// 'FUND_TWO_APPROVERS_REQUIRED' ngay lúc COMMIT (trg_fund_two_approvers,
// migration 020) — KHÔNG bắt lỗi ở đây, để nó trôi lên errorHandler và được
// core/errors.js ánh xạ thành thông báo tử tế sẵn có, đúng cách mọi lỗi CSDL
// khác trong dự án được xử lý (xem auth/service.js#inviteFailure).
export async function create({ actor, input }) {
  return withActor(actor.id, async (trx) => {
    const { rows: [row] } = await trx.raw(
      `INSERT INTO fund_entries (community_id, amount, purpose, occurred_on, activity_id, created_by)
       VALUES (?, ?, ?, coalesce(?::date, current_date), ?, ?)
       RETURNING *`,
      [actor.communityId, input.amount, input.purpose, input.occurred_on ?? null, input.activity_id ?? null, actor.id]
    );
    await auditLog(trx, {
      communityId: actor.communityId, actorId: actor.id,
      action: 'fund_entry.created', targetType: 'fund_entry', targetId: row.id,
      detail: { kind: Number(row.amount) >= 0 ? 'thu' : 'chi' },
    });
    return row;
  });
}

// Đọc là việc của cả Hội (sổ quỹ minh bạch, đúng dòng chữ đã hiện sẵn ở giao
// diện) — không requireRole ở routes.js cho GET.
export async function list({ actor, page, limit }) {
  return withActor(actor.id, async (trx) => {
    const offset = (page - 1) * limit;
    const { rows } = await trx.raw(
      `SELECT e.*, m.full_name AS created_by_name,
              (SELECT count(DISTINCT a.approver_id)::int FROM fund_entry_approvals a WHERE a.entry_id = e.id) AS signature_count
         FROM fund_entries e
         JOIN members m ON m.id = e.created_by AND m.community_id = e.community_id
        WHERE e.community_id = ?
        ORDER BY e.occurred_on DESC, e.created_at DESC LIMIT ? OFFSET ?`,
      [actor.communityId, limit, offset]
    );
    const { rows: [count] } = await trx.raw(
      `SELECT count(*)::int AS total FROM fund_entries WHERE community_id = ?`, [actor.communityId]
    );
    // "Thu/chi tháng này" đọc theo occurred_on (ngày phát sinh), không phải
    // created_at (ngày ghi sổ) — một bút toán ghi bù cho tháng trước không
    // nên đội số của tháng này lên.
    const { rows: [sums] } = await trx.raw(
      `SELECT coalesce(sum(amount), 0)::numeric AS balance,
              coalesce(sum(amount) FILTER (WHERE amount > 0 AND occurred_on >= date_trunc('month', current_date)), 0)::numeric AS income,
              coalesce(sum(-amount) FILTER (WHERE amount < 0 AND occurred_on >= date_trunc('month', current_date)), 0)::numeric AS expense
         FROM fund_entries WHERE community_id = ?`,
      [actor.communityId]
    );
    return { data: rows, meta: { page, limit, total: count.total }, summary: sums };
  });
}

export async function lock({ actor, id }) {
  return withActor(actor.id, async (trx) => {
    const { rows: [row] } = await trx.raw(
      `UPDATE fund_entries SET locked = true, updated_at = now()
        WHERE id = ? AND community_id = ? AND locked = false
        RETURNING *`,
      [id, actor.communityId]
    );
    if (!row) throw NOT_FOUND();
    await auditLog(trx, {
      communityId: actor.communityId, actorId: actor.id,
      action: 'fund_entry.locked', targetType: 'fund_entry', targetId: id, detail: {},
    });
    return row;
  });
}
