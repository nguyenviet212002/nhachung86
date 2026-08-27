import { withActor } from '../../core/tx.js';
import { AppError } from '../../core/errors.js';
import { log as auditLog } from '../../core/audit.js';
import { publishToMember, publishToJob } from '../../core/realtime.js';

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
         j.profession, j.people_needed, j.start_note, j.start_at, j.requirements, j.warnings,
         j.contact_owner, j.contact_policy, j.visibility, j.show_phone, j.allow_introductions,
         j.share_to_facebook, j.job_type, j.status, j.close_at, j.created_at, j.updated_at,
         m.full_name AS poster_name, m.job AS poster_job, m.avatar_url AS poster_avatar_url, a.name AS area_name,
         (SELECT count(*)::int FROM connections c WHERE c.job_need_id = j.id) AS application_count,
         (SELECT count(*)::int FROM connections c WHERE c.job_need_id = j.id AND c.status IN ('agreed','working','done')) AS received_count,
         (SELECT count(*)::int FROM connections c WHERE c.job_need_id = j.id AND c.status = 'done') AS completed_count,
         (SELECT count(*)::int FROM introductions i WHERE i.job_need_id = j.id) AS introduction_count,
         COALESCE((SELECT json_agg(json_build_object('id', f.id, 'caption', ji.caption, 'sort_order', ji.sort_order)
                    ORDER BY ji.sort_order, ji.created_at)
                    FROM job_need_images ji JOIN files f ON f.id = ji.file_id
                   WHERE ji.job_need_id = j.id AND f.deleted_at IS NULL), '[]'::json) AS images
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

export async function assertVisible({ actor, id }) {
  return withActor(actor.id, async (trx) => {
    const { rows: [job] } = await trx.raw(
      `SELECT id FROM job_needs WHERE id = ? AND community_id = ?`, [id, actor.communityId]
    );
    if (!job) throw NOT_FOUND();
    return job;
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
              m.full_name AS worker_name, m.job AS worker_job, m.avatar_url AS worker_avatar_url, a.name AS worker_area,
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
    const { rows: introductions } = await trx.raw(
      `SELECT i.id, i.job_need_id, i.introducer_id, i.candidate_id, i.poster_id, i.note,
              i.consent_introducer, i.consent_candidate, i.consent_poster,
              i.channel_opened_at, i.created_at, i.updated_at,
              intro.full_name AS introducer_name, intro.avatar_url AS introducer_avatar_url,
              cand.full_name AS candidate_name, cand.avatar_url AS candidate_avatar_url,
              p.full_name AS poster_name, p.avatar_url AS poster_avatar_url,
              c.id AS connection_id, c.status AS connection_status
         FROM introductions i
         JOIN members intro ON intro.id = i.introducer_id AND intro.community_id = i.community_id
         JOIN members cand ON cand.id = i.candidate_id AND cand.community_id = i.community_id
         JOIN members p ON p.id = i.poster_id AND p.community_id = i.community_id
         LEFT JOIN connections c ON c.introduction_id = i.id AND c.community_id = i.community_id
        WHERE i.job_need_id = ? AND i.community_id = ?
          AND (i.introducer_id = ? OR i.candidate_id = ? OR i.poster_id = ?)
        ORDER BY i.created_at DESC`,
      [id, actor.communityId, actor.id, actor.id, actor.id]
    );
    const { rows: events } = await trx.raw(
      `SELECT e.id, e.connection_id, e.kind, e.note, e.actor_id, e.at,
              m.full_name AS actor_name, c.worker_id, c.poster_id
         FROM connection_events e
         JOIN connections c ON c.id = e.connection_id AND c.community_id = e.community_id
         LEFT JOIN members m ON m.id = e.actor_id AND m.community_id = e.community_id
        WHERE c.job_need_id = ? AND c.community_id = ?
          AND (c.worker_id = ? OR c.poster_id = ?)
        ORDER BY e.at ASC, e.id ASC`,
      [id, actor.communityId, actor.id, actor.id]
    );
    return { ...job, applications, introductions, events };
  });
}

export async function create({ actor, input }) {
  const result = await withActor(actor.id, async (trx) => {
    await ensureArea(trx, actor, input.area_id);
    const { rows: [row] } = await trx.raw(
      `INSERT INTO job_needs
        (community_id, poster_id, title, description, terms, area_id, profession, people_needed,
         start_note, start_at, requirements, warnings, contact_owner, contact_policy, visibility, show_phone,
         allow_introductions, share_to_facebook, job_type, status, close_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      [actor.communityId, actor.id, input.title, input.description ?? null,
       input.terms ?? null, input.area_id ?? null, input.profession ?? null, input.people_needed ?? null,
       input.start_note ?? null, input.start_at ?? null, input.requirements ?? null, input.warnings ?? null, input.contact_owner ?? null,
       input.contact_policy ?? 'approval', input.visibility ?? 'community', input.show_phone ?? true, input.allow_introductions ?? true,
       input.share_to_facebook ?? false, input.job_type ?? 'thoi_vu', input.status ?? 'open', input.close_at ?? null]
    );
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'job.created', targetType: 'job_need', targetId: row.id,
      detail: { job_type: row.job_type, status: row.status } });
    const { rows: notifications } = await trx.raw(
      `INSERT INTO notifications
        (community_id, recipient_id, actor_id, kind, title, body, target_type, target_id)
       SELECT ?, m.id, ?, 'content', 'Có nhu cầu việc mới',
              'Một thành viên vừa đăng nhu cầu tuyển người hoặc hợp tác.', 'post', ?
         FROM members m
        WHERE m.community_id = ? AND m.status = 'member' AND m.id <> ?
       RETURNING *`,
      [actor.communityId, actor.id, row.id, actor.communityId, actor.id]
    );
    return { row, notifications };
  });
  for (const notification of result.notifications) {
    publishToMember(notification.recipient_id, 'notification', notification);
  }
  return result.row;
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
    const keys = ['title', 'description', 'terms', 'area_id', 'profession', 'people_needed', 'start_note', 'start_at',
      'requirements', 'warnings', 'contact_owner', 'contact_policy', 'visibility', 'show_phone', 'allow_introductions',
      'share_to_facebook', 'job_type', 'status', 'close_at'];
    const changed = keys.filter((key) => Object.hasOwn(input, key));
    const has = (key) => Object.hasOwn(input, key);
    const { rows: [row] } = await trx.raw(
      `UPDATE job_needs SET
         title = CASE WHEN ? THEN ? ELSE title END,
         description = CASE WHEN ? THEN ? ELSE description END,
         terms = CASE WHEN ? THEN ? ELSE terms END,
         area_id = CASE WHEN ? THEN ?::uuid ELSE area_id END,
         profession = CASE WHEN ? THEN ? ELSE profession END,
         people_needed = CASE WHEN ? THEN ?::int ELSE people_needed END,
         start_note = CASE WHEN ? THEN ? ELSE start_note END,
         start_at = CASE WHEN ? THEN ?::timestamptz ELSE start_at END,
         requirements = CASE WHEN ? THEN ? ELSE requirements END,
         warnings = CASE WHEN ? THEN ? ELSE warnings END,
         contact_owner = CASE WHEN ? THEN ? ELSE contact_owner END,
         contact_policy = CASE WHEN ? THEN ? ELSE contact_policy END,
         visibility = CASE WHEN ? THEN ? ELSE visibility END,
         show_phone = CASE WHEN ? THEN ?::boolean ELSE show_phone END,
         allow_introductions = CASE WHEN ? THEN ?::boolean ELSE allow_introductions END,
         share_to_facebook = CASE WHEN ? THEN ?::boolean ELSE share_to_facebook END,
         job_type = CASE WHEN ? THEN ? ELSE job_type END,
         status = CASE WHEN ? THEN ? ELSE status END,
         close_at = CASE WHEN ? THEN ?::timestamptz ELSE close_at END,
         updated_at = now()
       WHERE id = ? AND community_id = ? RETURNING *`,
      [has('title'), input.title ?? null, has('description'), input.description ?? null,
       has('terms'), input.terms ?? null, has('area_id'), input.area_id ?? null,
       has('profession'), input.profession ?? null, has('people_needed'), input.people_needed ?? null,
       has('start_note'), input.start_note ?? null, has('start_at'), input.start_at ?? null,
       has('requirements'), input.requirements ?? null,
       has('warnings'), input.warnings ?? null, has('contact_owner'), input.contact_owner ?? null,
       has('contact_policy'), input.contact_policy ?? null,
       has('visibility'), input.visibility ?? null, has('show_phone'), input.show_phone ?? null,
       has('allow_introductions'), input.allow_introductions ?? null, has('share_to_facebook'), input.share_to_facebook ?? null,
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

export async function attachImage({ actor, id, input }) {
  return withActor(actor.id, async (trx) => {
    await owned(trx, actor, id, true);
    const { rows: [file] } = await trx.raw(
      `SELECT id FROM files
        WHERE id = ? AND owner_id = ? AND community_id = ?
          AND attached_type IS NULL AND deleted_at IS NULL`,
      [input.file_id, actor.id, actor.communityId]
    );
    if (!file) throw new AppError('NOT_FOUND', 'Không tìm thấy ảnh vừa tải lên.', { status: 404 });
    const { rows: [row] } = await trx.raw(
      `INSERT INTO job_need_images (community_id, job_need_id, file_id, sort_order, caption)
       VALUES (?, ?, ?, ?, ?) RETURNING id, file_id, sort_order, caption`,
      [actor.communityId, id, input.file_id, input.sort_order ?? 0, input.caption ?? null]
    );
    return row;
  });
}

export async function removeImage({ actor, id, fileId }) {
  return withActor(actor.id, async (trx) => {
    await owned(trx, actor, id, true);
    const { rows: [row] } = await trx.raw(
      `DELETE FROM job_need_images WHERE job_need_id = ? AND file_id = ? AND community_id = ? RETURNING id`,
      [id, fileId, actor.communityId]
    );
    if (!row) throw NOT_FOUND();
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
  publishToJob(id, 'job_updated', { id });
  return result.connection;
}

export async function listIntroductions({ actor, id }) {
  return withActor(actor.id, async (trx) => {
    const { rows: [job] } = await trx.raw(
      `SELECT id, poster_id, allow_introductions FROM job_needs WHERE id = ? AND community_id = ?`,
      [id, actor.communityId]
    );
    if (!job) throw NOT_FOUND();
    const { rows } = await trx.raw(
      `SELECT i.id, i.job_need_id, i.introducer_id, i.candidate_id, i.poster_id, i.note,
              i.consent_introducer, i.consent_candidate, i.consent_poster,
              i.channel_opened_at, i.created_at, i.updated_at,
              intro.full_name AS introducer_name, intro.avatar_url AS introducer_avatar_url,
              cand.full_name AS candidate_name, cand.avatar_url AS candidate_avatar_url,
              p.full_name AS poster_name, p.avatar_url AS poster_avatar_url,
              c.id AS connection_id, c.status AS connection_status
         FROM introductions i
         JOIN members intro ON intro.id = i.introducer_id AND intro.community_id = i.community_id
         JOIN members cand ON cand.id = i.candidate_id AND cand.community_id = i.community_id
         JOIN members p ON p.id = i.poster_id AND p.community_id = i.community_id
         LEFT JOIN connections c ON c.introduction_id = i.id AND c.community_id = i.community_id
        WHERE i.job_need_id = ? AND i.community_id = ?
          AND (i.introducer_id = ? OR i.candidate_id = ? OR i.poster_id = ?)
        ORDER BY i.created_at DESC`,
      [id, actor.communityId, actor.id, actor.id, actor.id]
    );
    return { data: rows, meta: { total: rows.length } };
  });
}

export async function createIntroduction({ actor, id, candidateId, note }) {
  const result = await withActor(actor.id, async (trx) => {
    const { rows: [job] } = await trx.raw(
      `SELECT id, poster_id, allow_introductions, status FROM job_needs WHERE id = ? AND community_id = ? FOR UPDATE`,
      [id, actor.communityId]
    );
    if (!job) throw NOT_FOUND();
    if (job.status !== 'open') throw new AppError('INVALID_STATE', 'Nhu cầu này đã đóng, không thể giới thiệu thêm người.', { status: 422 });
    if (job.allow_introductions === false) throw new AppError('INTRODUCTIONS_DISABLED', 'Người đăng không cho phép giới thiệu người vào nhu cầu này.', { status: 422 });
    if (candidateId === actor.id || candidateId === job.poster_id) throw new AppError('VALIDATION_FAILED', 'Người được giới thiệu phải khác người giới thiệu và người đăng nhu cầu.', { status: 422 });
    const { rows: [candidate] } = await trx.raw(
      `SELECT id, full_name FROM members WHERE id = ? AND community_id = ? AND status = 'member'`,
      [candidateId, actor.communityId]
    );
    if (!candidate) throw new AppError('NOT_FOUND', 'Không tìm thấy thành viên được giới thiệu trong cộng đồng.', { status: 404 });
    const { rows: [existing] } = await trx.raw(
      `SELECT id FROM introductions WHERE job_need_id = ? AND candidate_id = ? AND community_id = ?`,
      [id, candidateId, actor.communityId]
    );
    if (existing) throw new AppError('ALREADY_INTRODUCED', 'Người này đã được giới thiệu vào nhu cầu.', { status: 409 });
    const { rows: [intro] } = await trx.raw(
      `INSERT INTO introductions
        (community_id, job_need_id, introducer_id, candidate_id, poster_id, note, consent_introducer)
       VALUES (?, ?, ?, ?, ?, ?, true) RETURNING *`,
      [actor.communityId, id, actor.id, candidateId, job.poster_id, note]
    );
    const { rows: [actorRow] } = await trx.raw(`SELECT full_name FROM members WHERE id = ?`, [actor.id]);
    const recipients = [job.poster_id, candidateId].filter((memberId) => memberId !== actor.id);
    const notifications = [];
    for (const recipientId of recipients) {
      const title = recipientId === candidateId ? 'Bạn được giới thiệu vào một nhu cầu việc' : 'Có người giới thiệu ứng viên cho nhu cầu của bạn';
      const body = recipientId === candidateId
        ? `${actorRow.full_name} đã giới thiệu bạn vào một nhu cầu việc làm.`
        : `${actorRow.full_name} vừa giới thiệu ${candidate.full_name} vào nhu cầu của bạn.`;
      const { rows: [notification] } = await trx.raw(
        `INSERT INTO notifications
          (community_id, recipient_id, actor_id, kind, title, body, target_type, target_id)
         VALUES (?, ?, ?, 'content', ?, ?, 'post', ?) RETURNING *`,
        [actor.communityId, recipientId, actor.id, title, body, id]
      );
      notifications.push(notification);
    }
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'job.introduction.created', targetType: 'introduction', targetId: intro.id,
      detail: { job_need_id: id, candidate_id: candidateId, poster_id: job.poster_id } });
    return { intro, notifications };
  });
  for (const notification of result.notifications) publishToMember(notification.recipient_id, 'notification', notification);
  publishToJob(id, 'job_updated', { id });
  return result.intro;
}

export async function updateIntroductionConsent({ actor, id, introductionId, consent }) {
  const result = await withActor(actor.id, async (trx) => {
    const { rows: [intro] } = await trx.raw(
      `SELECT * FROM introductions WHERE id = ? AND job_need_id = ? AND community_id = ? FOR UPDATE`,
      [introductionId, id, actor.communityId]
    );
    if (!intro) throw new AppError('NOT_FOUND', 'Không tìm thấy lời giới thiệu này.', { status: 404 });
    let column;
    if (intro.introducer_id === actor.id) column = 'consent_introducer';
    else if (intro.candidate_id === actor.id) column = 'consent_candidate';
    else if (intro.poster_id === actor.id) column = 'consent_poster';
    else throw FORBIDDEN();
    if (!consent && intro.channel_opened_at) throw new AppError('INVALID_STATE', 'Kênh liên hệ đã mở, không thể rút lại chữ ký.', { status: 422 });
    const nextConsents = {
      consent_introducer: column === 'consent_introducer' ? consent : intro.consent_introducer,
      consent_candidate: column === 'consent_candidate' ? consent : intro.consent_candidate,
      consent_poster: column === 'consent_poster' ? consent : intro.consent_poster,
    };
    const allConsented = nextConsents.consent_introducer && nextConsents.consent_candidate && nextConsents.consent_poster;
    const { rows: [updated] } = await trx.raw(
      `UPDATE introductions SET ${column} = ?,
         channel_opened_at = CASE WHEN ? THEN coalesce(channel_opened_at, now()) ELSE channel_opened_at END,
         updated_at = now()
       WHERE id = ? AND community_id = ? RETURNING *`,
      [consent, allConsented, introductionId, actor.communityId]
    );
    let connection = null;
    if (allConsented) {
      const { rows: [existing] } = await trx.raw(
        `SELECT * FROM connections WHERE job_need_id = ? AND worker_id = ? AND community_id = ?`,
        [id, updated.candidate_id, actor.communityId]
      );
      if (existing) connection = existing;
      else {
        const { rows: [created] } = await trx.raw(
          `INSERT INTO connections (community_id, job_need_id, introduction_id, poster_id, worker_id, status)
           VALUES (?, ?, ?, ?, ?, 'contacted') RETURNING *`,
          [actor.communityId, id, introductionId, updated.poster_id, updated.candidate_id]
        );
        connection = created;
        await trx.raw(
          `INSERT INTO connection_events (community_id, connection_id, kind, note, actor_id)
           VALUES (?, ?, 'introduced', ?, ?)`,
          [actor.communityId, connection.id, updated.note, actor.id]
        );
      }
    }
    const recipients = [updated.introducer_id, updated.candidate_id, updated.poster_id].filter((memberId) => memberId !== actor.id);
    const notifications = [];
    for (const recipientId of [...new Set(recipients)]) {
      const { rows: [notification] } = await trx.raw(
        `INSERT INTO notifications
          (community_id, recipient_id, actor_id, kind, title, body, target_type, target_id)
         VALUES (?, ?, ?, 'content', ?, ?, 'post', ?) RETURNING *`,
        [actor.communityId, recipientId, actor.id,
         allConsented ? 'Kênh giới thiệu đã mở' : 'Có người xác nhận lời giới thiệu',
         allConsented ? 'Ba bên đã đồng ý; kết nối việc làm đã được tạo để theo dõi.' : 'Một bên vừa xác nhận lời giới thiệu trong nhu cầu việc làm.', id]
      );
      notifications.push(notification);
    }
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'job.introduction.consent_updated', targetType: 'introduction', targetId: introductionId,
      detail: { job_need_id: id, consent, role: column, channel_opened: allConsented } });
    return { updated, connection, notifications };
  });
  for (const notification of result.notifications) publishToMember(notification.recipient_id, 'notification', notification);
  publishToJob(id, 'job_updated', { id });
  return { ...result.updated, connection_id: result.connection?.id ?? null, connection_status: result.connection?.status ?? null };
}

export async function updateApplication({ actor, id, connectionId, status, note }) {
  const result = await withActor(actor.id, async (trx) => {
    const { rows: [connection] } = await trx.raw(
      `SELECT c.*, j.poster_id AS job_poster_id
         FROM connections c
         JOIN job_needs j ON j.id = c.job_need_id AND j.community_id = c.community_id
        WHERE c.id = ? AND c.job_need_id = ? AND c.community_id = ?
        FOR UPDATE`,
      [connectionId, id, actor.communityId]
    );
    if (!connection) throw new AppError('NOT_FOUND', 'Khong tim thay ket noi viec lam.', { status: 404 });

    const isPoster = connection.poster_id === actor.id && connection.job_poster_id === actor.id;
    const isWorker = connection.worker_id === actor.id;
    if (!isPoster && !isWorker) {
      throw new AppError('FORBIDDEN', 'Chi nguoi dang nhu cau hoac nguoi nhan viec moi duoc cap nhat ket noi nay.', { status: 403 });
    }

    const transitions = isPoster
      ? { contacted: ['agreed', 'failed'], agreed: ['working', 'failed'], working: ['done', 'failed'] }
      : { agreed: ['working', 'failed'], working: ['done', 'failed'] };
    const allowed = transitions[connection.status] || [];
    if (!allowed.includes(status)) {
      const role = isPoster ? 'poster' : 'worker';
      throw new AppError('INVALID_STATE', `Khong the chuyen tu "${connection.status}" sang "${status}" voi vai tro ${role}.`, {
        status: 422,
        details: { from: connection.status, to: status, role },
      });
    }
    const { rows: [row] } = await trx.raw(
      `UPDATE connections SET status = ?, updated_at = now()
        WHERE id = ? AND job_need_id = ? AND community_id = ? RETURNING *`,
      [status, connectionId, id, actor.communityId]
    );
    if (!row) throw new AppError('NOT_FOUND', 'Không tìm thấy lượt ứng tuyển này.', { status: 404 });
    await trx.raw(
      `INSERT INTO connection_events (community_id, connection_id, kind, note, actor_id)
       VALUES (?, ?, 'status_changed', ?, ?)`, [actor.communityId, connectionId, `Trạng thái: ${connection.status} -> ${status}${note ? ` · ${note}` : ''}`, actor.id]
    );
    const title = status === 'done' ? 'Cong viec da duoc bao hoan thanh'
      : status === 'failed' ? 'Ket noi viec lam da dong'
        : 'Trang thai cong viec da cap nhat';
    const body = isPoster
      ? `Nguoi dang nhu cau da chuyen trang thai tu ${connection.status} sang ${status}.`
      : `Nguoi nhan viec da chuyen trang thai tu ${connection.status} sang ${status}.`;
    const { rows: [notification] } = await trx.raw(
      `INSERT INTO notifications
        (community_id, recipient_id, actor_id, kind, title, body, target_type, target_id)
       VALUES (?, ?, ?, 'content', 'Ứng tuyển đã được cập nhật', 'Người đăng tin vừa cập nhật trạng thái ứng tuyển của bạn.', 'post', ?)
       RETURNING *`, [actor.communityId, isPoster ? row.worker_id : row.poster_id, actor.id, id]
    );
    await trx.raw(`UPDATE notifications SET title = ?, body = ? WHERE id = ?`, [title, body, notification.id]);
    notification.title = title;
    notification.body = body;
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'job.application_updated', targetType: 'connection', targetId: connectionId,
      detail: { job_need_id: id, from_status: connection.status, status, actor_role: isPoster ? 'poster' : 'worker' } });
    return { row, notification };
  });
  publishToMember(result.notification.recipient_id, 'notification', result.notification);
  publishToJob(id, 'job_updated', { id });
  return result.row;
}

export async function withdraw({ actor, id }) {
  await withActor(actor.id, async (trx) => {
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
  publishToJob(id, 'job_updated', { id });
}

export async function listReady({ actor, status, page, limit }) {
  return withActor(actor.id, async (trx) => {
    const where = ['r.community_id = ?']; const params = [actor.communityId];
    if (status) { where.push('r.status = ?'); params.push(status); }
    const clause = where.join(' AND '); const offset = (page - 1) * limit;
    const { rows } = await trx.raw(
      `SELECT r.*, m.full_name, m.job, m.avatar_url, a.name AS area_name
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
              j.title, p.full_name AS poster_name, p.avatar_url AS poster_avatar_url,
              w.full_name AS worker_name, w.avatar_url AS worker_avatar_url,
              c.introduction_id
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
