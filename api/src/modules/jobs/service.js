import { withActor } from '../../core/tx.js';
import { AppError } from '../../core/errors.js';
import { log as auditLog } from '../../core/audit.js';
import { publishToMember } from '../../core/realtime.js';

const NOT_FOUND = () => new AppError('NOT_FOUND', 'Không tìm thấy nhu cầu việc này.', { status: 404 });
const FORBIDDEN = () => new AppError('FORBIDDEN', 'Bạn chỉ được quản lý nhu cầu do chính mình đăng.', { status: 403 });

async function ensureArea(trx, actor, areaId) {
  if (areaId === null || areaId === undefined) return;
  const { rows: [area] } = await trx.raw(
    `SELECT id FROM areas WHERE id = ? AND community_id = ? AND is_active = true`,
    [areaId, actor.communityId]
  );
  if (!area) throw new AppError('VALIDATION_FAILED', 'Khu vực không thuộc cộng đồng hiện tại.', { status: 422 });
}

const JOB_SELECT = `
  SELECT j.id, j.poster_id, j.title, j.description, j.terms, j.area_id,
         j.job_type, j.status, j.close_at, j.created_at, j.updated_at,
         m.full_name AS poster_name, m.job AS poster_job, a.name AS area_name,
         (SELECT count(*)::int FROM connections c WHERE c.job_need_id = j.id) AS application_count
    FROM job_needs j
    JOIN members m ON m.id = j.poster_id AND m.community_id = j.community_id
    LEFT JOIN areas a ON a.id = j.area_id`;

export async function list({ actor, filters, page, limit }) {
  return withActor(actor.id, async (trx) => {
    const where = ['j.community_id = ?', 'j.status = ?'];
    const params = [actor.communityId, filters.status];
    if (filters.mine) { where.push('j.poster_id = ?'); params.push(actor.id); }
    if (filters.jobType) { where.push('j.job_type = ?'); params.push(filters.jobType); }
    if (filters.q) {
      where.push(`(j.title ILIKE ? OR coalesce(j.description, '') ILIKE ?)`);
      params.push(`%${filters.q}%`, `%${filters.q}%`);
    }
    const clause = where.join(' AND ');
    const offset = (page - 1) * limit;
    const { rows } = await trx.raw(
      `${JOB_SELECT} WHERE ${clause} ORDER BY j.created_at DESC, j.id LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const { rows: [{ total }] } = await trx.raw(
      `SELECT count(*)::int AS total FROM job_needs j WHERE ${clause}`, params
    );
    return { data: rows, meta: { page, limit, total } };
  });
}

export async function get({ actor, id }) {
  return withActor(actor.id, async (trx) => {
    const { rows: [job] } = await trx.raw(
      `${JOB_SELECT} WHERE j.id = ? AND j.community_id = ?`, [id, actor.communityId]
    );
    if (!job) throw NOT_FOUND();
    const { rows: applications } = await trx.raw(
      `SELECT c.id, c.worker_id, c.status, c.created_at, c.updated_at,
              m.full_name AS worker_name, m.job AS worker_job, a.name AS worker_area,
              (SELECT e.note FROM connection_events e
                WHERE e.connection_id = c.id AND e.kind = 'applied'
                ORDER BY e.at ASC LIMIT 1) AS note
         FROM connections c
         JOIN members m ON m.id = c.worker_id AND m.community_id = c.community_id
         LEFT JOIN areas a ON a.id = m.area_id
        WHERE c.job_need_id = ? AND c.community_id = ?
          AND (c.worker_id = ? OR c.poster_id = ?)
        ORDER BY c.created_at DESC`,
      [id, actor.communityId, actor.id, actor.id]
    );
    return { ...job, applications };
  });
}

export async function create({ actor, input }) {
  return withActor(actor.id, async (trx) => {
    await ensureArea(trx, actor, input.area_id);
    const { rows: [row] } = await trx.raw(
      `INSERT INTO job_needs
        (community_id, poster_id, title, description, terms, area_id, job_type, status, close_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      [actor.communityId, actor.id, input.title, input.description ?? null,
       input.terms ?? null, input.area_id ?? null, input.job_type ?? 'thoi_vu',
       input.status ?? 'open', input.close_at ?? null]
    );
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'job.created', targetType: 'job_need', targetId: row.id,
      detail: { job_type: row.job_type, status: row.status } });
    return row;
  });
}

async function owned(trx, actor, id, lock = false) {
  const { rows: [row] } = await trx.raw(
    `SELECT * FROM job_needs WHERE id = ? AND community_id = ?${lock ? ' FOR UPDATE' : ''}`,
    [id, actor.communityId]
  );
  if (!row) throw NOT_FOUND();
  if (row.poster_id !== actor.id) throw FORBIDDEN();
  return row;
}

export async function update({ actor, id, input }) {
  return withActor(actor.id, async (trx) => {
    await owned(trx, actor, id, true);
    if (Object.hasOwn(input, 'area_id')) await ensureArea(trx, actor, input.area_id);
    const keys = ['title', 'description', 'terms', 'area_id', 'job_type', 'status', 'close_at'];
    const changed = keys.filter((key) => Object.hasOwn(input, key));
    const has = (key) => Object.hasOwn(input, key);
    const { rows: [row] } = await trx.raw(
      `UPDATE job_needs SET
         title = CASE WHEN ? THEN ? ELSE title END,
         description = CASE WHEN ? THEN ? ELSE description END,
         terms = CASE WHEN ? THEN ? ELSE terms END,
         area_id = CASE WHEN ? THEN ?::uuid ELSE area_id END,
         job_type = CASE WHEN ? THEN ? ELSE job_type END,
         status = CASE WHEN ? THEN ? ELSE status END,
         close_at = CASE WHEN ? THEN ?::timestamptz ELSE close_at END,
         updated_at = now()
       WHERE id = ? AND community_id = ? RETURNING *`,
      [has('title'), input.title ?? null, has('description'), input.description ?? null,
       has('terms'), input.terms ?? null, has('area_id'), input.area_id ?? null,
       has('job_type'), input.job_type ?? null, has('status'), input.status ?? null,
       has('close_at'), input.close_at ?? null, id, actor.communityId]
    );
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'job.updated', targetType: 'job_need', targetId: id, detail: { fields: changed } });
    return row;
  });
}

export async function remove({ actor, id }) {
  return withActor(actor.id, async (trx) => {
    await owned(trx, actor, id, true);
    const { rows: [{ count }] } = await trx.raw(
      `SELECT count(*)::int AS count FROM connections WHERE job_need_id = ?`, [id]
    );
    if (count > 0) throw new AppError('JOB_HAS_APPLICATIONS', 'Tin đã có người ứng tuyển; hãy đóng hoặc hủy tin thay vì xóa.', { status: 409 });
    await trx.raw(`DELETE FROM job_needs WHERE id = ? AND community_id = ?`, [id, actor.communityId]);
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'job.deleted', targetType: 'job_need', targetId: id, detail: {} });
  });
}

export async function apply({ actor, id, note }) {
  const result = await withActor(actor.id, async (trx) => {
    const { rows: [job] } = await trx.raw(
      `SELECT * FROM job_needs WHERE id = ? AND community_id = ? FOR UPDATE`, [id, actor.communityId]
    );
    if (!job) throw NOT_FOUND();
    if (job.status !== 'open') throw new AppError('INVALID_STATE', 'Nhu cầu này không còn nhận ứng tuyển.', { status: 422 });
    if (job.poster_id === actor.id) throw new AppError('VALIDATION_FAILED', 'Bạn không thể ứng tuyển nhu cầu của chính mình.', { status: 422 });
    let connection;
    try {
      const { rows: [row] } = await trx.raw(
        `INSERT INTO connections (community_id, job_need_id, poster_id, worker_id, status)
         VALUES (?, ?, ?, ?, 'contacted') RETURNING *`,
        [actor.communityId, id, job.poster_id, actor.id]
      );
      connection = row;
    } catch (err) {
      if (err.code === '23505') throw new AppError('ALREADY_APPLIED', 'Bạn đã ứng tuyển nhu cầu này.', { status: 409 });
      throw err;
    }
    await trx.raw(
      `INSERT INTO connection_events (community_id, connection_id, kind, note, actor_id)
       VALUES (?, ?, 'applied', ?, ?)`, [actor.communityId, connection.id, note, actor.id]
    );
    const { rows: [notification] } = await trx.raw(
      `INSERT INTO notifications
        (community_id, recipient_id, actor_id, kind, title, body, target_type, target_id)
       VALUES (?, ?, ?, 'content', 'Có thành viên ứng tuyển', 'Một thành viên vừa ứng tuyển nhu cầu việc của bạn.', 'post', ?)
       RETURNING *`, [actor.communityId, job.poster_id, actor.id, id]
    );
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'job.applied', targetType: 'connection', targetId: connection.id,
      detail: { job_need_id: id, poster_id: job.poster_id } });
    return { connection, notification, posterId: job.poster_id };
  });
  publishToMember(result.posterId, 'notification', result.notification);
  return result.connection;
}

export async function updateApplication({ actor, id, connectionId, status, note }) {
  const result = await withActor(actor.id, async (trx) => {
    await owned(trx, actor, id, true);
    const { rows: [row] } = await trx.raw(
      `UPDATE connections SET status = ?, updated_at = now()
        WHERE id = ? AND job_need_id = ? AND community_id = ? RETURNING *`,
      [status, connectionId, id, actor.communityId]
    );
    if (!row) throw new AppError('NOT_FOUND', 'Không tìm thấy lượt ứng tuyển này.', { status: 404 });
    await trx.raw(
      `INSERT INTO connection_events (community_id, connection_id, kind, note, actor_id)
       VALUES (?, ?, 'status_changed', ?, ?)`, [actor.communityId, connectionId, note ?? null, actor.id]
    );
    const { rows: [notification] } = await trx.raw(
      `INSERT INTO notifications
        (community_id, recipient_id, actor_id, kind, title, body, target_type, target_id)
       VALUES (?, ?, ?, 'content', 'Ứng tuyển đã được cập nhật', 'Người đăng tin vừa cập nhật trạng thái ứng tuyển của bạn.', 'post', ?)
       RETURNING *`, [actor.communityId, row.worker_id, actor.id, id]
    );
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'job.application_updated', targetType: 'connection', targetId: connectionId,
      detail: { job_need_id: id, status } });
    return { row, notification };
  });
  publishToMember(result.row.worker_id, 'notification', result.notification);
  return result.row;
}

export async function withdraw({ actor, id }) {
  return withActor(actor.id, async (trx) => {
    const { rows: [row] } = await trx.raw(
      `DELETE FROM connections
        WHERE job_need_id = ? AND worker_id = ? AND community_id = ? AND status = 'contacted'
        RETURNING id`, [id, actor.id, actor.communityId]
    );
    if (!row) throw new AppError('INVALID_STATE', 'Không có lượt ứng tuyển đang chờ để rút.', { status: 422 });
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'job.application_withdrawn', targetType: 'connection', targetId: row.id,
      detail: { job_need_id: id } });
  });
}

export async function listReady({ actor, status, page, limit }) {
  return withActor(actor.id, async (trx) => {
    const where = ['r.community_id = ?']; const params = [actor.communityId];
    if (status) { where.push('r.status = ?'); params.push(status); }
    const clause = where.join(' AND '); const offset = (page - 1) * limit;
    const { rows } = await trx.raw(
      `SELECT r.*, m.full_name, m.job, a.name AS area_name
         FROM ready_profiles r JOIN members m ON m.id = r.member_id
         LEFT JOIN areas a ON a.id = r.area_id
        WHERE ${clause} ORDER BY r.updated_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const { rows: [{ total }] } = await trx.raw(
      `SELECT count(*)::int AS total FROM ready_profiles r WHERE ${clause}`, params
    );
    return { data: rows, meta: { page, limit, total } };
  });
}

export async function getMyReady({ actor }) {
  return withActor(actor.id, async (trx) => {
    const { rows: [row] } = await trx.raw(
      `SELECT * FROM ready_profiles WHERE member_id = ? AND community_id = ?`, [actor.id, actor.communityId]
    );
    return row ?? null;
  });
}

export async function upsertReady({ actor, input }) {
  return withActor(actor.id, async (trx) => {
    await ensureArea(trx, actor, input.area_id);
    const { rows: [row] } = await trx.raw(
      `INSERT INTO ready_profiles
        (member_id, community_id, headline, availability, area_id, note, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (member_id) DO UPDATE SET headline = EXCLUDED.headline,
         availability = EXCLUDED.availability, area_id = EXCLUDED.area_id,
         note = EXCLUDED.note, status = EXCLUDED.status, updated_at = now()
       RETURNING *`,
      [actor.id, actor.communityId, input.headline, input.availability ?? null,
       input.area_id ?? null, input.note ?? null, input.status]
    );
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'ready_profile.saved', targetType: 'member', targetId: actor.id,
      detail: { status: row.status } });
    return row;
  });
}

export async function removeReady({ actor }) {
  return withActor(actor.id, async (trx) => {
    await trx.raw(`DELETE FROM ready_profiles WHERE member_id = ? AND community_id = ?`, [actor.id, actor.communityId]);
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'ready_profile.deleted', targetType: 'member', targetId: actor.id, detail: {} });
  });
}

export async function listConnections({ actor, page, limit }) {
  return withActor(actor.id, async (trx) => {
    const offset = (page - 1) * limit;
    const { rows } = await trx.raw(
      `SELECT c.id, c.job_need_id, c.poster_id, c.worker_id, c.status, c.created_at, c.updated_at,
              j.title, p.full_name AS poster_name, w.full_name AS worker_name
         FROM connections c
         LEFT JOIN job_needs j ON j.id = c.job_need_id
         JOIN members p ON p.id = c.poster_id JOIN members w ON w.id = c.worker_id
        WHERE c.community_id = ? AND (c.poster_id = ? OR c.worker_id = ?)
        ORDER BY c.updated_at DESC LIMIT ? OFFSET ?`,
      [actor.communityId, actor.id, actor.id, limit, offset]
    );
    return { data: rows, meta: { page, limit } };
  });
}
