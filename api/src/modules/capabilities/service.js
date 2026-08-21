import { withActor } from '../../core/tx.js';
import { AppError } from '../../core/errors.js';
import { log as auditLog } from '../../core/audit.js';

const NOT_FOUND = () => new AppError('NOT_FOUND', 'Không tìm thấy năng lực này.', { status: 404 });
const FORBIDDEN = () => new AppError('FORBIDDEN', 'Bạn chỉ được sửa hoặc xóa năng lực của chính mình.', { status: 403 });

function visiblePriceSql() {
  return `CASE WHEN fn_privacy_state(?, c.member_id, 'price') IN ('self','visible')
               THEN c.price ELSE NULL END AS price`;
}

export async function list({ actor, filters, page, limit }) {
  return withActor(actor.id, async (trx) => {
    const where = ['c.community_id = ?'];
    const params = [actor.communityId];
    if (filters.mine) { where.push('c.member_id = ?'); params.push(actor.id); }
    else { where.push("c.status = 'published'"); }
    if (filters.memberId) { where.push('c.member_id = ?'); params.push(filters.memberId); }
    if (filters.category) { where.push('c.category = ?'); params.push(filters.category); }
    if (filters.q) {
      where.push(`(c.title ILIKE ? OR coalesce(c.description, '') ILIKE ?)`);
      params.push(`%${filters.q}%`, `%${filters.q}%`);
    }
    const clause = where.join(' AND ');
    const offset = (page - 1) * limit;
    const { rows } = await trx.raw(
      `SELECT c.id, c.member_id, c.title, c.description, c.category,
              ${visiblePriceSql()}, c.years_experience, c.status,
              c.created_at, c.updated_at, m.full_name, m.job, m.area_id,
              a.name AS area_name
         FROM capabilities c
         JOIN members m ON m.id = c.member_id AND m.community_id = c.community_id
         LEFT JOIN areas a ON a.id = m.area_id
        WHERE ${clause}
        ORDER BY c.updated_at DESC, c.id
        LIMIT ? OFFSET ?`,
      [actor.id, ...params, limit, offset]
    );
    const { rows: [{ total }] } = await trx.raw(
      `SELECT count(*)::int AS total FROM capabilities c WHERE ${clause}`,
      params
    );
    return { data: rows, meta: { page, limit, total } };
  });
}

export async function get({ actor, id }) {
  return withActor(actor.id, async (trx) => {
    const { rows: [row] } = await trx.raw(
      `SELECT c.id, c.member_id, c.title, c.description, c.category,
              ${visiblePriceSql()}, c.years_experience, c.status,
              c.created_at, c.updated_at, m.full_name, m.job, m.area_id,
              a.name AS area_name
         FROM capabilities c
         JOIN members m ON m.id = c.member_id AND m.community_id = c.community_id
         LEFT JOIN areas a ON a.id = m.area_id
        WHERE c.id = ? AND c.community_id = ?
          AND (c.status = 'published' OR c.member_id = ?)`,
      [actor.id, id, actor.communityId, actor.id]
    );
    if (!row) throw NOT_FOUND();
    return row;
  });
}

export async function create({ actor, input }) {
  return withActor(actor.id, async (trx) => {
    const { rows: [row] } = await trx.raw(
      `INSERT INTO capabilities
        (community_id, member_id, title, description, category, price, years_experience, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      [actor.communityId, actor.id, input.title, input.description ?? null,
       input.category ?? null, input.price ?? null, input.years_experience ?? null,
       input.status ?? 'published']
    );
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'capability.created', targetType: 'capability', targetId: row.id,
      detail: { status: row.status } });
    return row;
  });
}

async function owned(trx, actor, id) {
  const { rows: [row] } = await trx.raw(
    `SELECT * FROM capabilities WHERE id = ? AND community_id = ?`, [id, actor.communityId]
  );
  if (!row) throw NOT_FOUND();
  if (row.member_id !== actor.id) throw FORBIDDEN();
  return row;
}

export async function update({ actor, id, input }) {
  return withActor(actor.id, async (trx) => {
    await owned(trx, actor, id);
    const allowed = ['title', 'description', 'category', 'price', 'years_experience', 'status'];
    const entries = allowed.filter((key) => Object.hasOwn(input, key));
    const has = (key) => Object.hasOwn(input, key);
    const { rows: [row] } = await trx.raw(
      `UPDATE capabilities SET
         title = CASE WHEN ? THEN ? ELSE title END,
         description = CASE WHEN ? THEN ? ELSE description END,
         category = CASE WHEN ? THEN ? ELSE category END,
         price = CASE WHEN ? THEN ? ELSE price END,
         years_experience = CASE WHEN ? THEN ?::int ELSE years_experience END,
         status = CASE WHEN ? THEN ? ELSE status END,
         updated_at = now()
       WHERE id = ? AND community_id = ? RETURNING *`,
      [has('title'), input.title ?? null, has('description'), input.description ?? null,
       has('category'), input.category ?? null, has('price'), input.price ?? null,
       has('years_experience'), input.years_experience ?? null,
       has('status'), input.status ?? null, id, actor.communityId]
    );
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'capability.updated', targetType: 'capability', targetId: id,
      detail: { fields: entries } });
    return row;
  });
}

export async function remove({ actor, id }) {
  return withActor(actor.id, async (trx) => {
    await owned(trx, actor, id);
    await trx.raw(`DELETE FROM capabilities WHERE id = ? AND community_id = ?`, [id, actor.communityId]);
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'capability.deleted', targetType: 'capability', targetId: id, detail: {} });
  });
}
