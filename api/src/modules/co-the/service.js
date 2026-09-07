import { withActor } from '../../core/tx.js';
import { AppError } from '../../core/errors.js';
import { log as auditLog } from '../../core/audit.js';
import * as rules from '../games/rules.js';

const NOT_FOUND = () => new AppError('NOT_FOUND', 'Không tìm thấy thế cờ này.', { status: 404 });
export const FORBIDDEN = (msg) => new AppError('FORBIDDEN', msg ?? 'Bạn không có quyền làm việc này.', { status: 403 });
export const INVALID_STATE = (msg) => new AppError('INVALID_STATE', msg, { status: 409 });

// Dùng chung cho mọi task sau (session/phân tích) — load 1 thế, chặn cross-
// tenant bằng community_id. Export để Task 3/4/5/6/7 import thẳng, không
// viết lại truy vấn giống hệt 5 lần.
export async function loadPosition(trx, communityId, id) {
  const { rows: [row] } = await trx.raw(
    `SELECT * FROM co_the_positions WHERE id = ? AND community_id = ?`, [id, communityId]);
  if (!row) throw NOT_FOUND();
  return row;
}

export async function createPosition({ actor, board, sideToMove }) {
  const errors = rules.validatePosition(board);
  if (errors.length) throw new AppError('VALIDATION_FAILED', errors.join(' '), { status: 422, fields: { board: errors } });
  return withActor(actor.id, async (trx) => {
    const { rows: [row] } = await trx.raw(
      `INSERT INTO co_the_positions (community_id, created_by_member_id, board, side_to_move)
       VALUES (?, ?, ?::jsonb, ?) RETURNING *`,
      [actor.communityId, actor.id, JSON.stringify(board), sideToMove]
    );
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'co_the.position_created', targetType: 'co_the_position', targetId: row.id, detail: {} });
    return row;
  });
}

export async function saveToLibrary({ actor, id, label, category }) {
  return withActor(actor.id, async (trx) => {
    await loadPosition(trx, actor.communityId, id);
    const { rows: [row] } = await trx.raw(
      `UPDATE co_the_positions SET saved_to_library = true, label = ?, category = ?
        WHERE id = ? AND community_id = ? RETURNING *`,
      [label, category, id, actor.communityId]
    );
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'co_the.position_saved_to_library', targetType: 'co_the_position', targetId: id, detail: { category } });
    return row;
  });
}

export async function listPositions({ actor, origin, category, page, limit }) {
  return withActor(actor.id, async (trx) => {
    const where = ['community_id = ?', 'saved_to_library = true'];
    const params = [actor.communityId];
    if (origin) { where.push('origin = ?'); params.push(origin); }
    if (category) { where.push('category = ?'); params.push(category); }
    const clause = where.join(' AND ');
    const offset = (page - 1) * limit;
    const { rows } = await trx.raw(
      `SELECT id, label, origin, category, side_to_move, verdict, verdict_certainty, created_at
         FROM co_the_positions WHERE ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const { rows: [{ total }] } = await trx.raw(`SELECT count(*)::int AS total FROM co_the_positions WHERE ${clause}`, params);
    return { data: rows, meta: { page, limit, total } };
  });
}

export async function getPosition({ actor, id }) {
  return withActor(actor.id, (trx) => loadPosition(trx, actor.communityId, id));
}
