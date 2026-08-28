import { withActor } from '../../core/tx.js';
import { AppError } from '../../core/errors.js';
import { log as auditLog } from '../../core/audit.js';
import { publishToMember } from '../../core/realtime.js';

const NOT_FOUND = () => new AppError('NOT_FOUND', 'Không tìm thấy lời nhờ này.', { status: 404 });
const FORBIDDEN = () => new AppError('FORBIDDEN', 'Bạn chỉ được quản lý lời nhờ do chính mình đăng.', { status: 403 });

async function ensureArea(trx, actor, areaId) {
  if (areaId === null || areaId === undefined) return;
  const { rows: [area] } = await trx.raw(
    `SELECT id FROM areas WHERE id = ? AND community_id = ? AND is_active = true`,
    [areaId, actor.communityId]
  );
  if (!area) throw new AppError('VALIDATION_FAILED', 'Khu vực không thuộc cộng đồng hiện tại.', { status: 422 });
}

async function logEvent(trx, { communityId, aidRequestId, kind, note, actorId }) {
  await trx.raw(
    `INSERT INTO aid_events (community_id, aid_request_id, kind, note, actor_id) VALUES (?, ?, ?, ?, ?)`,
    [communityId, aidRequestId, kind, note ?? null, actorId ?? null]
  );
}

const AID_SELECT = `
  SELECT a.id, a.requester_id, a.on_behalf_of, a.title, a.description, a.category, a.area_id,
         a.urgency, a.status, a.created_at, a.updated_at,
         m.full_name AS requester_name, ar.name AS area_name,
         (SELECT count(*)::int FROM aid_offers o WHERE o.aid_request_id = a.id) AS offer_count,
         (SELECT url FROM aid_request_photos p WHERE p.aid_request_id = a.id
           ORDER BY p.sort_order, p.id LIMIT 1) AS cover_url
    FROM aid_requests a
    JOIN members m ON m.id = a.requester_id AND m.community_id = a.community_id
    LEFT JOIN areas ar ON ar.id = a.area_id`;

export async function list({ actor, filters, page, limit }) {
  return withActor(actor.id, async (trx) => {
    const where = ['a.community_id = ?'];
    const params = [actor.communityId];
    if (filters.mine) { where.push('a.requester_id = ?'); params.push(actor.id); }
    if (filters.status) { where.push('a.status = ?'); params.push(filters.status); }
    if (filters.urgency) { where.push('a.urgency = ?'); params.push(filters.urgency); }
    if (filters.category) { where.push('a.category = ?'); params.push(filters.category); }
    if (filters.q) {
      where.push(`(a.title ILIKE ? OR coalesce(a.description, '') ILIKE ?)`);
      params.push(`%${filters.q}%`, `%${filters.q}%`);
    }
    const clause = where.join(' AND ');
    const offset = (page - 1) * limit;
    const { rows } = await trx.raw(
      `${AID_SELECT} WHERE ${clause} ORDER BY a.created_at DESC, a.id LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const { rows: [{ total }] } = await trx.raw(
      `SELECT count(*)::int AS total FROM aid_requests a WHERE ${clause}`, params
    );
    return { data: rows, meta: { page, limit, total } };
  });
}

export async function get({ actor, id }) {
  return withActor(actor.id, async (trx) => {
    const { rows: [row] } = await trx.raw(`${AID_SELECT} WHERE a.id = ? AND a.community_id = ?`, [id, actor.communityId]);
    if (!row) throw NOT_FOUND();
    const { rows: offers } = await trx.raw(
      `SELECT o.id, o.member_id, o.note, o.created_at, m.full_name AS member_name, m.job AS member_job
         FROM aid_offers o
         JOIN members m ON m.id = o.member_id AND m.community_id = o.community_id
        WHERE o.aid_request_id = ? AND o.community_id = ?
        ORDER BY o.created_at`, [id, actor.communityId]
    );
    const { rows: events } = await trx.raw(
      `SELECT e.id, e.kind, e.note, e.actor_id, e.at, m.full_name AS actor_name
         FROM aid_events e
         LEFT JOIN members m ON m.id = e.actor_id AND m.community_id = e.community_id
        WHERE e.aid_request_id = ? AND e.community_id = ?
        ORDER BY e.at`, [id, actor.communityId]
    );
    const { rows: photos } = await trx.raw(
      `SELECT id, url, caption, sort_order, created_at
         FROM aid_request_photos
        WHERE aid_request_id = ? AND community_id = ?
        ORDER BY sort_order, id`, [id, actor.communityId]
    );
    return { ...row, offers, events, photos };
  });
}

export async function create({ actor, input }) {
  const result = await withActor(actor.id, async (trx) => {
    await ensureArea(trx, actor, input.area_id);
    const { rows: [row] } = await trx.raw(
      `INSERT INTO aid_requests (community_id, requester_id, on_behalf_of, title, description, category, area_id, urgency, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      [actor.communityId, actor.id, input.on_behalf_of ?? null, input.title, input.description ?? null,
       input.category ?? null, input.area_id ?? null, input.urgency ?? 'normal', input.status ?? 'queued']
    );
    await logEvent(trx, { communityId: actor.communityId, aidRequestId: row.id, kind: 'created', actorId: actor.id });
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'aid.created', targetType: 'aid_request', targetId: row.id, detail: { status: row.status } });
    const { rows: notifications } = await trx.raw(
      `INSERT INTO notifications
        (community_id, recipient_id, actor_id, kind, title, body, target_type, target_id)
       SELECT ?, m.id, ?, 'content', 'Có lời nhờ giúp mới',
              'Một thành viên vừa nhờ Hội giúp một việc.', 'post', ?
         FROM members m
        WHERE m.community_id = ? AND m.status = 'member' AND m.id <> ?
       RETURNING *`,
      [actor.communityId, actor.id, row.id, actor.communityId, actor.id]
    );
    return { row, notifications };
  });
  for (const notification of result.notifications) publishToMember(notification.recipient_id, 'notification', notification);
  return result.row;
}

async function ensureAidPhotoUrl(trx, actor, url) {
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

async function owned(trx, actor, id, lock = false) {
  const { rows: [row] } = await trx.raw(
    `SELECT * FROM aid_requests WHERE id = ? AND community_id = ?${lock ? ' FOR UPDATE' : ''}`,
    [id, actor.communityId]
  );
  if (!row) throw NOT_FOUND();
  if (row.requester_id !== actor.id) throw FORBIDDEN();
  return row;
}

export async function update({ actor, id, input }) {
  return withActor(actor.id, async (trx) => {
    const before = await owned(trx, actor, id);
    if (Object.hasOwn(input, 'area_id')) await ensureArea(trx, actor, input.area_id);
    const has = (key) => Object.hasOwn(input, key);
    const { rows: [row] } = await trx.raw(
      `UPDATE aid_requests SET
         title = CASE WHEN ? THEN ? ELSE title END,
         description = CASE WHEN ? THEN ? ELSE description END,
         on_behalf_of = CASE WHEN ? THEN ? ELSE on_behalf_of END,
         category = CASE WHEN ? THEN ? ELSE category END,
         area_id = CASE WHEN ? THEN ?::uuid ELSE area_id END,
         urgency = CASE WHEN ? THEN ? ELSE urgency END,
         status = CASE WHEN ? THEN ? ELSE status END,
         updated_at = now()
       WHERE id = ? AND community_id = ? RETURNING *`,
      [has('title'), input.title ?? null, has('description'), input.description ?? null,
       has('on_behalf_of'), input.on_behalf_of ?? null, has('category'), input.category ?? null,
       has('area_id'), input.area_id ?? null,
       has('urgency'), input.urgency ?? null, has('status'), input.status ?? null, id, actor.communityId]
    );
    if (has('status') && input.status !== before.status) {
      await logEvent(trx, { communityId: actor.communityId, aidRequestId: id, kind: 'status:' + input.status, actorId: actor.id });
    }
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'aid.updated', targetType: 'aid_request', targetId: id, detail: { fields: Object.keys(input) } });
    return row;
  });
}

export async function remove({ actor, id }) {
  return withActor(actor.id, async (trx) => {
    await owned(trx, actor, id);
    await trx.raw(`DELETE FROM aid_requests WHERE id = ? AND community_id = ?`, [id, actor.communityId]);
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'aid.deleted', targetType: 'aid_request', targetId: id, detail: {} });
  });
}

export async function offerHelp({ actor, id, note }) {
  const result = await withActor(actor.id, async (trx) => {
    const { rows: [aid] } = await trx.raw(
      `SELECT * FROM aid_requests WHERE id = ? AND community_id = ? FOR UPDATE`, [id, actor.communityId]
    );
    if (!aid) throw NOT_FOUND();
    if (['done', 'closed', 'cancelled'].includes(aid.status)) {
      throw new AppError('INVALID_STATE', 'Lời nhờ này không còn nhận người giúp.', { status: 422 });
    }
    if (aid.requester_id === actor.id) throw new AppError('VALIDATION_FAILED', 'Bạn không thể tự nhận giúp lời nhờ của chính mình.', { status: 422 });
    let offer;
    try {
      const { rows: [row] } = await trx.raw(
        `INSERT INTO aid_offers (community_id, aid_request_id, member_id, note) VALUES (?, ?, ?, ?) RETURNING *`,
        [actor.communityId, id, actor.id, note ?? null]
      );
      offer = row;
    } catch (e) {
      if (e.code === '23505') throw new AppError('ALREADY_APPLIED', 'Bạn đã đề nghị giúp lời nhờ này rồi.', { status: 409 });
      throw e;
    }
    await trx.raw(`UPDATE aid_requests SET status = 'matched', updated_at = now() WHERE id = ? AND community_id = ? AND status = 'queued'`, [id, actor.communityId]);
    await logEvent(trx, { communityId: actor.communityId, aidRequestId: id, kind: 'offered', actorId: actor.id, note });
    const { rows: [notification] } = await trx.raw(
      `INSERT INTO notifications
        (community_id, recipient_id, actor_id, kind, title, body, target_type, target_id)
       VALUES (?, ?, ?, 'content', 'Có người muốn giúp', 'Một thành viên vừa đề nghị giúp lời nhờ của bạn.', 'post', ?)
       RETURNING *`, [actor.communityId, aid.requester_id, actor.id, id]
    );
    return { offer, notification };
  });
  publishToMember(result.notification.recipient_id, 'notification', result.notification);
  return result.offer;
}

export async function addPhoto({ actor, id, input }) {
  return withActor(actor.id, async (trx) => {
    await owned(trx, actor, id);
    await ensureAidPhotoUrl(trx, actor, input.url);
    const { rows: [row] } = await trx.raw(
      `INSERT INTO aid_request_photos (community_id, aid_request_id, url, caption, sort_order)
       VALUES (?, ?, ?, ?, ?) RETURNING id, url, caption, sort_order, created_at`,
      [actor.communityId, id, input.url, input.caption ?? null, input.sort_order ?? 0]
    );
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'aid.photo_added', targetType: 'aid_request', targetId: id, detail: { photoId: row.id } });
    return row;
  });
}

export async function removePhoto({ actor, id, photoId }) {
  return withActor(actor.id, async (trx) => {
    await owned(trx, actor, id);
    const { rows: [row] } = await trx.raw(
      `DELETE FROM aid_request_photos WHERE id = ? AND aid_request_id = ? AND community_id = ? RETURNING id`,
      [photoId, id, actor.communityId]
    );
    if (!row) throw NOT_FOUND();
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'aid.photo_removed', targetType: 'aid_request', targetId: id, detail: { photoId } });
  });
}
