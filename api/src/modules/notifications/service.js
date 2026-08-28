import { withActor } from '../../core/tx.js';
import { log as auditLog } from '../../core/audit.js';
import { AppError } from '../../core/errors.js';
import { publishToMember } from '../../core/realtime.js';

function requireMember(row, message = 'Thành viên không hợp lệ.') {
  if (!row) throw new AppError('NOT_FOUND', message, { status: 404 });
}

export async function list({ actor, page, limit, unreadOnly }) {
  const offset = (page - 1) * limit;
  return withActor(actor.id, async (trx) => {
    const where = unreadOnly ? 'AND n.read_at IS NULL' : '';
    const { rows } = await trx.raw(
      `SELECT n.id, n.kind, n.title, n.body, n.target_type, n.target_id,
              n.read_at, n.created_at, n.actor_id, m.full_name AS actor_name
         FROM notifications n LEFT JOIN members m ON m.id = n.actor_id
        WHERE n.community_id = ? AND n.recipient_id = ? ${where}
        ORDER BY n.created_at DESC LIMIT ? OFFSET ?`,
      [actor.communityId, actor.id, limit, offset]
    );
    const { rows: count } = await trx.raw(
      `SELECT count(*)::int AS total FROM notifications n
        WHERE n.community_id = ? AND n.recipient_id = ? ${where}`,
      [actor.communityId, actor.id]
    );
    return { data: rows, meta: { page, limit, total: count[0].total } };
  });
}

export async function unreadCount({ actor }) {
  return withActor(actor.id, async (trx) => {
    const { rows: [row] } = await trx.raw(
      `SELECT count(*)::int AS count FROM notifications
        WHERE community_id = ? AND recipient_id = ? AND read_at IS NULL`,
      [actor.communityId, actor.id]
    );
    return { count: row.count };
  });
}

export async function markRead({ actor, id }) {
  return withActor(actor.id, async (trx) => {
    const { rows: [row] } = await trx.raw(
      `UPDATE notifications SET read_at = coalesce(read_at, now())
        WHERE id = ? AND community_id = ? AND recipient_id = ?
        RETURNING id, read_at`,
      [id, actor.communityId, actor.id]
    );
    requireMember(row);
    return row;
  });
}

export async function markAllRead({ actor }) {
  return withActor(actor.id, async (trx) => {
    const { rows } = await trx.raw(
      `UPDATE notifications SET read_at = now()
        WHERE community_id = ? AND recipient_id = ? AND read_at IS NULL
        RETURNING id`,
      [actor.communityId, actor.id]
    );
    return { count: rows.length };
  });
}

async function assertRecipient(trx, actor, recipientId) {
  const { rows: [row] } = await trx.raw(
    `SELECT id, full_name, avatar_url FROM members WHERE id = ? AND community_id = ? AND status = 'member'`,
    [recipientId, actor.communityId]
  );
  requireMember(row);
  if (recipientId === actor.id) throw new AppError('VALIDATION_FAILED', 'Không thể gửi cho chính mình.', { status: 422 });
  return row;
}

export async function createNotification({ actor, input }) {
  const result = await withActor(actor.id, async (trx) => {
    await assertRecipient(trx, actor, input.recipientId);
    const { rows: [row] } = await trx.raw(
      `INSERT INTO notifications
        (community_id, recipient_id, actor_id, kind, title, body, target_type, target_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      [actor.communityId, input.recipientId, actor.id, input.kind, input.title, input.body,
       input.targetType ?? null, input.targetId ?? null]
    );
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'notification.created', targetType: 'notification', targetId: row.id,
      detail: { kind: input.kind, target_type: input.targetType ?? 'none' } });
    return row;
  });
  publishToMember(result.recipient_id, 'notification', result);
  return result;
}

export async function sendMessage({ actor, recipientId, body }) {
  const result = await withActor(actor.id, async (trx) => {
    const recipient = await assertRecipient(trx, actor, recipientId);
    const { rows: [sender] } = await trx.raw(
      `SELECT id, full_name, avatar_url FROM members WHERE id = ? AND community_id = ?`,
      [actor.id, actor.communityId]
    );
    const { rows: [message] } = await trx.raw(
      `INSERT INTO direct_messages (community_id, sender_id, recipient_id, body)
       VALUES (?, ?, ?, ?) RETURNING id, community_id, sender_id, recipient_id, body, created_at, read_at`,
      [actor.communityId, actor.id, recipientId, body]
    );
    const { rows: [notification] } = await trx.raw(
      `INSERT INTO notifications
        (community_id, recipient_id, actor_id, kind, title, body, target_type, target_id)
       VALUES (?, ?, ?, 'message', ?, ?, 'message', ?) RETURNING *`,
      [actor.communityId, recipientId, actor.id, `Tin nhắn từ thành viên`, body, message.id]
    );
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'message.sent', targetType: 'message', targetId: message.id,
      detail: { recipient: recipientId } });
    return {
      message: {
        ...message,
        sender_name: sender.full_name,
        sender_avatar_url: sender.avatar_url,
        recipient_name: recipient.full_name,
        recipient_avatar_url: recipient.avatar_url,
      },
      notification,
      recipient,
    };
  });
  publishToMember(result.recipient.id, 'message', result.message);
  publishToMember(result.recipient.id, 'notification', result.notification);
  return result.message;
}

export async function listMessages({ actor, withMemberId, page, limit }) {
  return withActor(actor.id, async (trx) => {
    const offset = (page - 1) * limit;
    if (!withMemberId) {
      const { rows } = await trx.raw(
        `SELECT dm.id, dm.sender_id, dm.recipient_id, dm.body, dm.created_at, dm.read_at,
                s.full_name AS sender_name, s.avatar_url AS sender_avatar_url,
                r.full_name AS recipient_name, r.avatar_url AS recipient_avatar_url
           FROM direct_messages dm
           JOIN members s ON s.id = dm.sender_id AND s.community_id = dm.community_id
           JOIN members r ON r.id = dm.recipient_id AND r.community_id = dm.community_id
          WHERE dm.community_id = ? AND (dm.sender_id = ? OR dm.recipient_id = ?)
          ORDER BY dm.created_at DESC LIMIT ? OFFSET ?`,
        [actor.communityId, actor.id, actor.id, limit, offset]
      );
      return { data: rows.reverse(), meta: { page, limit } };
    }
    await assertRecipient(trx, actor, withMemberId);
    const { rows } = await trx.raw(
      `SELECT dm.id, dm.sender_id, dm.recipient_id, dm.body, dm.created_at, dm.read_at,
              s.full_name AS sender_name, s.avatar_url AS sender_avatar_url,
              r.full_name AS recipient_name, r.avatar_url AS recipient_avatar_url
         FROM direct_messages dm
         JOIN members s ON s.id = dm.sender_id AND s.community_id = dm.community_id
         JOIN members r ON r.id = dm.recipient_id AND r.community_id = dm.community_id
        WHERE dm.community_id = ?
          AND ((dm.sender_id = ? AND dm.recipient_id = ?) OR (dm.sender_id = ? AND dm.recipient_id = ?))
        ORDER BY dm.created_at DESC LIMIT ? OFFSET ?`,
      [actor.communityId, actor.id, withMemberId, withMemberId, actor.id, limit, offset]
    );
    await trx.raw(
      `UPDATE direct_messages SET read_at = coalesce(read_at, now())
        WHERE community_id = ? AND sender_id = ? AND recipient_id = ? AND read_at IS NULL`,
      [actor.communityId, withMemberId, actor.id]
    );
    return { data: rows.reverse(), meta: { page, limit } };
  });
}
