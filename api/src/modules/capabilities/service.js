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
    if (filters.areaId) { where.push('m.area_id = ?'); params.push(filters.areaId); }
    if (filters.q) {
      where.push(`(c.title ILIKE ? OR coalesce(c.description, '') ILIKE ?)`);
      params.push(`%${filters.q}%`, `%${filters.q}%`);
    }
    const clause = where.join(' AND ');
    const offset = (page - 1) * limit;
    const { rows } = await trx.raw(
      `SELECT c.id, c.member_id, c.title, c.description, c.category,
              ${visiblePriceSql()}, c.years_experience, c.service_area, c.scope,
              c.availability, c.conditions, c.status,
              c.created_at, c.updated_at, m.full_name, m.job, m.avatar_url, m.area_id,
              a.name AS area_name,
              (SELECT url FROM capability_photos cp WHERE cp.capability_id = c.id
                ORDER BY cp.sort_order, cp.id LIMIT 1) AS cover_url
         FROM capabilities c
         JOIN members m ON m.id = c.member_id AND m.community_id = c.community_id
         LEFT JOIN areas a ON a.id = m.area_id
        WHERE ${clause}
        ORDER BY c.updated_at DESC, c.id
        LIMIT ? OFFSET ?`,
      [actor.id, ...params, limit, offset]
    );
    const { rows: [{ total }] } = await trx.raw(
      `SELECT count(*)::int AS total
         FROM capabilities c
         JOIN members m ON m.id = c.member_id AND m.community_id = c.community_id
        WHERE ${clause}`,
      params
    );
    return { data: rows, meta: { page, limit, total } };
  });
}

export async function get({ actor, id }) {
  return withActor(actor.id, async (trx) => {
    const { rows: [row] } = await trx.raw(
      `SELECT c.id, c.member_id, c.title, c.description, c.category,
              ${visiblePriceSql()}, c.years_experience, c.service_area, c.scope,
              c.availability, c.conditions, c.status,
              c.created_at, c.updated_at, m.full_name, m.job, m.avatar_url, m.area_id,
              a.name AS area_name
         FROM capabilities c
         JOIN members m ON m.id = c.member_id AND m.community_id = c.community_id
         LEFT JOIN areas a ON a.id = m.area_id
        WHERE c.id = ? AND c.community_id = ?
          AND (c.status = 'published' OR c.member_id = ?)`,
      [actor.id, id, actor.communityId, actor.id]
    );
    if (!row) throw NOT_FOUND();
    const { rows: evidence } = await trx.raw(
      `SELECT ce.id, ce.work_record_id, ce.note, wr.title AS work_title,
              wr.done_on AS work_done_on
         FROM capability_evidence ce
         JOIN work_records wr
           ON wr.id = ce.work_record_id AND wr.community_id = ce.community_id
        WHERE ce.capability_id = ? AND ce.community_id = ?
        ORDER BY wr.done_on DESC NULLS LAST, ce.id`, [id, actor.communityId]
    );
    const { rows: photos } = await trx.raw(
      `SELECT id, url, caption, sort_order, created_at
         FROM capability_photos
        WHERE capability_id = ? AND community_id = ?
        ORDER BY sort_order, id`, [id, actor.communityId]
    );
    return { ...row, evidence, photos };
  });
}

export async function create({ actor, input }) {
  return withActor(actor.id, async (trx) => {
    const { rows: [row] } = await trx.raw(
      `INSERT INTO capabilities
        (community_id, member_id, title, description, category, price, years_experience,
         service_area, scope, availability, conditions, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      [actor.communityId, actor.id, input.title, input.description ?? null,
       input.category ?? null, input.price ?? null, input.years_experience ?? null,
       input.service_area ?? null, input.scope ?? null, input.availability ?? null,
       input.conditions ?? null,
       input.status ?? 'published']
    );
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'capability.created', targetType: 'capability', targetId: row.id,
      detail: { status: row.status } });
    return row;
  });
}

async function ensureCapabilityPhotoUrl(trx, actor, url) {
  if (!String(url).startsWith('/files/')) {
    throw new AppError('VALIDATION_FAILED', 'Ảnh không hợp lệ — hãy tải ảnh lên trước.', { status: 422 });
  }
  const fileId = String(url).slice('/files/'.length);
  const { rows: [file] } = await trx.raw(
    `SELECT id FROM files WHERE id = ? AND owner_id = ? AND community_id = ? AND deleted_at IS NULL`,
    [fileId, actor.id, actor.communityId]
  );
  if (!file) throw new AppError('VALIDATION_FAILED', 'Ảnh không tồn tại hoặc không thuộc quyền của bạn.', { status: 422 });
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
    const allowed = ['title', 'description', 'category', 'price', 'years_experience',
      'service_area', 'scope', 'availability', 'conditions', 'status'];
    const entries = allowed.filter((key) => Object.hasOwn(input, key));
    const has = (key) => Object.hasOwn(input, key);
    const { rows: [row] } = await trx.raw(
      `UPDATE capabilities SET
         title = CASE WHEN ? THEN ? ELSE title END,
         description = CASE WHEN ? THEN ? ELSE description END,
         category = CASE WHEN ? THEN ? ELSE category END,
         price = CASE WHEN ? THEN ? ELSE price END,
         years_experience = CASE WHEN ? THEN ?::int ELSE years_experience END,
         service_area = CASE WHEN ? THEN ? ELSE service_area END,
         scope = CASE WHEN ? THEN ? ELSE scope END,
         availability = CASE WHEN ? THEN ? ELSE availability END,
         conditions = CASE WHEN ? THEN ? ELSE conditions END,
         status = CASE WHEN ? THEN ? ELSE status END,
         updated_at = now()
       WHERE id = ? AND community_id = ? RETURNING *`,
       [has('title'), input.title ?? null, has('description'), input.description ?? null,
       has('category'), input.category ?? null, has('price'), input.price ?? null,
       has('years_experience'), input.years_experience ?? null,
       has('service_area'), input.service_area ?? null,
       has('scope'), input.scope ?? null,
       has('availability'), input.availability ?? null,
       has('conditions'), input.conditions ?? null,
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

export async function addPhoto({ actor, id, input }) {
  return withActor(actor.id, async (trx) => {
    await owned(trx, actor, id);
    await ensureCapabilityPhotoUrl(trx, actor, input.url);
    const { rows: [row] } = await trx.raw(
      `INSERT INTO capability_photos (community_id, capability_id, url, caption, sort_order)
       VALUES (?, ?, ?, ?, ?) RETURNING id, url, caption, sort_order, created_at`,
      [actor.communityId, id, input.url, input.caption ?? null, input.sort_order ?? 0]
    );
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'capability.photo_added', targetType: 'capability', targetId: id, detail: { photoId: row.id } });
    return row;
  });
}

export async function removePhoto({ actor, id, photoId }) {
  return withActor(actor.id, async (trx) => {
    await owned(trx, actor, id);
    const { rows: [row] } = await trx.raw(
      `DELETE FROM capability_photos WHERE id = ? AND capability_id = ? AND community_id = ? RETURNING id`,
      [photoId, id, actor.communityId]
    );
    if (!row) throw NOT_FOUND();
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'capability.photo_removed', targetType: 'capability', targetId: id, detail: { photoId } });
  });
}
