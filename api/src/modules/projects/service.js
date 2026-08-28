import { withActor } from '../../core/tx.js';
import { AppError } from '../../core/errors.js';
import { log as auditLog } from '../../core/audit.js';
import { publishToMember } from '../../core/realtime.js';

const NOT_FOUND = () => new AppError('NOT_FOUND', 'Khong tim thay viec chung nay.', { status: 404 });
const FORBIDDEN = () => new AppError('FORBIDDEN', 'Ban khong co quyen quan ly viec chung.', { status: 403 });
const APPROVED_STATUSES = ['open', 'running', 'done'];

function canReadProjectQueue(actor) {
  return actor.roles?.includes('approver') || actor.roles?.includes('content_ops');
}
function canManageProjects(actor) {
  return actor.roles?.includes('approver');
}

async function ensureArea(trx, actor, areaId) {
  if (areaId === null || areaId === undefined) return;
  const { rows: [area] } = await trx.raw(
    `SELECT id FROM areas WHERE id = ? AND community_id = ? AND is_active = true`,
    [areaId, actor.communityId]
  );
  if (!area) throw new AppError('VALIDATION_FAILED', 'Khu vuc khong thuoc cong dong hien tai.', { status: 422 });
}

async function ensureProjectImage(trx, actor, imageUrl) {
  if (imageUrl === null || imageUrl === undefined || !String(imageUrl).startsWith('/files/')) return;
  const fileId = String(imageUrl).slice('/files/'.length);
  const params = [fileId, actor.communityId];
  const ownerClause = canManageProjects(actor) ? '' : 'AND owner_id = ?';
  if (!canManageProjects(actor)) params.push(actor.id);
  const { rows: [file] } = await trx.raw(
    `SELECT id FROM files
      WHERE id = ? AND community_id = ? AND deleted_at IS NULL ${ownerClause}`,
    params
  );
  if (!file) {
    throw new AppError('VALIDATION_FAILED', 'Anh viec chung khong ton tai hoac khong thuoc quyen cua ban.', { status: 422 });
  }
}

const PROJECT_SELECT = `
  SELECT a.id, a.title, a.description, a.area_id, ar.name AS area_name,
         a.category, a.location, a.image_url, a.starts_at, a.ends_at,
         a.capacity, a.status, a.created_by, a.created_at, a.updated_at,
         m.full_name AS creator_name, m.avatar_url AS creator_avatar_url,
         (SELECT count(*)::int FROM activity_participants ap
           WHERE ap.activity_id = a.id AND ap.community_id = a.community_id) AS participant_count`;

const PROJECT_FROM = `
    FROM activities a
    JOIN members m ON m.id = a.created_by AND m.community_id = a.community_id
    LEFT JOIN areas ar ON ar.id = a.area_id AND ar.community_id = a.community_id`;

function whereClause(filters, actor) {
  const where = ['a.community_id = ?'];
  const params = [actor.communityId];
  const queueReader = canReadProjectQueue(actor);
  if (filters.status) {
    where.push('a.status = ?');
    params.push(filters.status);
    if (filters.status === 'planned' && !queueReader) {
      where.push('a.created_by = ?');
      params.push(actor.id);
    }
  } else if (!filters.mine) {
    where.push(`a.status IN (?, ?, ?)`);
    params.push(...APPROVED_STATUSES);
  }
  if (filters.mine) {
    where.push(`EXISTS (
      SELECT 1 FROM activity_participants mine
       WHERE mine.activity_id = a.id AND mine.community_id = a.community_id AND mine.member_id = ?
    )`);
    params.push(actor.id);
  }
  if (filters.q) {
    where.push(`(a.title ILIKE ? OR coalesce(a.description, '') ILIKE ? OR coalesce(a.location, '') ILIKE ?)`);
    params.push(`%${filters.q}%`, `%${filters.q}%`, `%${filters.q}%`);
  }
  return { clause: where.join(' AND '), params };
}

export async function list({ actor, filters, page, limit }) {
  return withActor(actor.id, async (trx) => {
    const { clause, params } = whereClause(filters, actor);
    const offset = (page - 1) * limit;
    const { rows } = await trx.raw(
      `${PROJECT_SELECT},
              EXISTS (SELECT 1 FROM activity_participants me
                       WHERE me.activity_id = a.id AND me.community_id = a.community_id AND me.member_id = ?) AS joined
         ${PROJECT_FROM}
        WHERE ${clause}
        ORDER BY coalesce(a.starts_at, a.created_at) DESC, a.id
        LIMIT ? OFFSET ?`,
      [actor.id, ...params, limit, offset]
    );
    const { rows: [{ total }] } = await trx.raw(
      `SELECT count(*)::int AS total ${PROJECT_FROM} WHERE ${clause}`,
      params
    );
    return { data: rows, meta: { page, limit, total } };
  });
}

async function readOne(trx, actor, id) {
  const { rows: [project] } = await trx.raw(
    `${PROJECT_SELECT},
              EXISTS (SELECT 1 FROM activity_participants me
                       WHERE me.activity_id = a.id AND me.community_id = a.community_id AND me.member_id = ?) AS joined
         ${PROJECT_FROM}
        WHERE a.id = ? AND a.community_id = ?`,
    [actor.id, id, actor.communityId]
  );
  if (!project) throw NOT_FOUND();
  if (project.status === 'planned' && project.created_by !== actor.id && !canReadProjectQueue(actor)) {
    throw NOT_FOUND();
  }
  const { rows: participants } = await trx.raw(
    `SELECT ap.member_id, ap.role, ap.joined_at, m.full_name, m.job, m.avatar_url,
              ar.name AS area_name
         FROM activity_participants ap
         JOIN members m ON m.id = ap.member_id AND m.community_id = ap.community_id
         LEFT JOIN areas ar ON ar.id = m.area_id AND ar.community_id = m.community_id
        WHERE ap.activity_id = ? AND ap.community_id = ?
        ORDER BY ap.role = 'organizer' DESC, ap.joined_at ASC, ap.member_id`,
    [id, actor.communityId]
  );
  return { ...project, participants };
}

export async function get({ actor, id }) {
  return withActor(actor.id, async (trx) => {
    return readOne(trx, actor, id);
  });
}

export async function create({ actor, input }) {
  const result = await withActor(actor.id, async (trx) => {
    await ensureArea(trx, actor, input.area_id);
    await ensureProjectImage(trx, actor, input.image_url);
    const manager = canManageProjects(actor);
    const status = manager ? (input.status ?? 'open') : 'planned';
    const { rows: [row] } = await trx.raw(
      `INSERT INTO activities
        (community_id, title, description, area_id, category, location, image_url,
         starts_at, ends_at, capacity, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      [actor.communityId, input.title, input.description, input.area_id ?? null,
       input.category ?? null, input.location ?? null, input.image_url ?? null,
       input.starts_at, input.ends_at ?? null, input.capacity, status, actor.id]
    );
    await trx.raw(
      `INSERT INTO activity_participants (community_id, activity_id, member_id, role)
       VALUES (?, ?, ?, 'organizer')
       ON CONFLICT (activity_id, member_id) DO NOTHING`,
      [actor.communityId, row.id, actor.id]
    );
    await auditLog(trx, {
      communityId: actor.communityId,
      actorId: actor.id,
      action: 'project.created',
      targetType: 'activity',
      targetId: row.id,
      detail: { status: row.status, capacity: row.capacity },
    });
    const { rows: notifications } = status === 'planned'
      ? await trx.raw(
        `INSERT INTO notifications
          (community_id, recipient_id, actor_id, kind, title, body, target_type, target_id)
         SELECT DISTINCT ?::uuid, m.id, ?::uuid, 'activity', 'Co viec chung cho duyet',
                'Mot thanh vien vua gui viec chung, can admin duyet truoc khi hien cong khai.', 'activity', ?::uuid
           FROM members m
           JOIN member_roles mr ON mr.member_id = m.id AND mr.community_id = m.community_id
           JOIN roles r ON r.id = mr.role_id
          WHERE m.community_id = ? AND m.status = 'member' AND m.id <> ?
            AND r.key IN ('approver', 'content_ops')
         RETURNING *`,
        [actor.communityId, actor.id, row.id, actor.communityId, actor.id]
      )
      : await notifyApprovedProject(trx, actor, row.id);
    return { row: await readOne(trx, actor, row.id), notifications };
  });
  for (const notification of result.notifications) {
    publishToMember(notification.recipient_id, 'notification', notification);
  }
  return result.row;
}

async function notifyApprovedProject(trx, actor, projectId) {
  return trx.raw(
    `INSERT INTO notifications
      (community_id, recipient_id, actor_id, kind, title, body, target_type, target_id)
     SELECT ?::uuid, m.id, ?::uuid, 'activity', 'Co viec chung moi',
            'Mot viec chung vua duoc mo, moi thanh vien co the xem va tham gia.', 'activity', ?::uuid
       FROM members m
      WHERE m.community_id = ? AND m.status = 'member' AND m.id <> ?
     RETURNING *`,
    [actor.communityId, actor.id, projectId, actor.communityId, actor.id]
  );
}

export async function update({ actor, id, input }) {
  if (!canManageProjects(actor)) throw FORBIDDEN();
  const result = await withActor(actor.id, async (trx) => {
    if (input.area_id !== undefined) await ensureArea(trx, actor, input.area_id);
    if (input.image_url !== undefined) await ensureProjectImage(trx, actor, input.image_url);
    const { rows: [before] } = await trx.raw(
      `SELECT id, status FROM activities WHERE id = ? AND community_id = ? FOR UPDATE`,
      [id, actor.communityId]
    );
    if (!before) throw NOT_FOUND();
    const allowed = ['title', 'description', 'area_id', 'category', 'location', 'image_url', 'starts_at', 'ends_at', 'capacity', 'status'];
    const fields = [];
    const values = [];
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(input, key)) {
        fields.push(`${key} = ?`);
        values.push(input[key] ?? null);
      }
    }
    const { rows: [updated] } = await trx.raw(
      `UPDATE activities
          SET ${fields.join(', ')}, updated_at = now()
        WHERE id = ? AND community_id = ?
        RETURNING *`,
      [...values, id, actor.communityId]
    );
    await auditLog(trx, {
      communityId: actor.communityId,
      actorId: actor.id,
      action: 'project.updated',
      targetType: 'activity',
      targetId: id,
      detail: { status: updated.status, approved: before.status !== 'open' && updated.status === 'open' },
    });
    const { rows: notifications } = before.status !== 'open' && updated.status === 'open'
      ? await notifyApprovedProject(trx, actor, id)
      : { rows: [] };
    return { row: await readOne(trx, actor, id), notifications };
  });
  for (const notification of result.notifications) {
    publishToMember(notification.recipient_id, 'notification', notification);
  }
  return result.row;
}

export async function remove({ actor, id }) {
  if (!canManageProjects(actor)) throw FORBIDDEN();
  await withActor(actor.id, async (trx) => {
    const { rows: [deleted] } = await trx.raw(
      `DELETE FROM activities WHERE id = ? AND community_id = ? RETURNING id, status`,
      [id, actor.communityId]
    );
    if (!deleted) throw NOT_FOUND();
    await auditLog(trx, {
      communityId: actor.communityId,
      actorId: actor.id,
      action: 'project.deleted',
      targetType: 'activity',
      targetId: id,
      detail: { status: deleted.status },
    });
  });
}

export async function join({ actor, id }) {
  const result = await withActor(actor.id, async (trx) => {
    const { rows: [project] } = await trx.raw(
      `SELECT id, created_by, status, capacity,
              (SELECT count(*)::int FROM activity_participants ap
                WHERE ap.activity_id = activities.id AND ap.community_id = activities.community_id) AS participant_count
         FROM activities
        WHERE id = ? AND community_id = ?
        FOR UPDATE`,
      [id, actor.communityId]
    );
    if (!project) throw NOT_FOUND();
    const { rows: [existing] } = await trx.raw(
      `SELECT * FROM activity_participants
        WHERE activity_id = ? AND community_id = ? AND member_id = ?`,
      [id, actor.communityId, actor.id]
    );
    if (existing) return { row: await readOne(trx, actor, id), notification: null };
    if (!['open', 'running'].includes(project.status)) {
      throw new AppError('PROJECT_CLOSED', 'Viec chung nay khong con nhan nguoi tham gia.', { status: 409 });
    }
    if (project.participant_count >= project.capacity) {
      throw new AppError('PROJECT_FULL', 'Viec chung nay da du nguoi tham gia.', { status: 409 });
    }
    const { rows: [participant] } = await trx.raw(
      `INSERT INTO activity_participants (community_id, activity_id, member_id, role)
       VALUES (?, ?, ?, 'participant')
       ON CONFLICT (activity_id, member_id) DO UPDATE SET joined_at = activity_participants.joined_at
       RETURNING *`,
      [actor.communityId, id, actor.id]
    );
    await auditLog(trx, {
      communityId: actor.communityId,
      actorId: actor.id,
      action: 'project.joined',
      targetType: 'activity',
      targetId: id,
      detail: { role: participant.role },
    });
    let notification = null;
    if (project.created_by !== actor.id) {
      const { rows: [createdNotification] } = await trx.raw(
        `INSERT INTO notifications
          (community_id, recipient_id, actor_id, kind, title, body, target_type, target_id)
         VALUES (?, ?, ?, 'activity', 'Co thanh vien tham gia viec chung',
                 'Mot thanh vien vua bam tham gia viec chung cua ban.', 'activity', ?)
         RETURNING *`,
        [actor.communityId, project.created_by, actor.id, id]
      );
      notification = createdNotification;
    }
    return { row: await readOne(trx, actor, id), notification };
  });
  if (result.notification) publishToMember(result.notification.recipient_id, 'notification', result.notification);
  return result.row;
}
