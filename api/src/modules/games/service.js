import { withActor } from '../../core/tx.js';
import { AppError } from '../../core/errors.js';
import { log as auditLog } from '../../core/audit.js';
import { publishToMember, publishToGame, isWatchingGame } from '../../core/realtime.js';
import * as rules from './rules.js';

const NOT_FOUND = () => new AppError('NOT_FOUND', 'Không tìm thấy ván cờ này.', { status: 404 });
const FORBIDDEN = (msg) => new AppError('FORBIDDEN', msg ?? 'Bạn không có quyền làm việc này.', { status: 403 });
const INVALID_STATE = (msg) => new AppError('INVALID_STATE', msg, { status: 409 });

const GAME_SELECT = `
  SELECT g.id, g.status, g.board, g.turn, g.winner_member_id, g.end_reason,
         g.created_at, g.started_at, g.finished_at,
         g.red_member_id, r.full_name AS red_name, r.avatar_url AS red_avatar_url,
         g.black_member_id, b.full_name AS black_name, b.avatar_url AS black_avatar_url
    FROM games g
    JOIN members r ON r.id = g.red_member_id AND r.community_id = g.community_id
    JOIN members b ON b.id = g.black_member_id AND b.community_id = g.community_id`;

async function loadGame(trx, communityId, id) {
  const { rows: [row] } = await trx.raw(`${GAME_SELECT} WHERE g.id = ? AND g.community_id = ?`, [id, communityId]);
  if (!row) throw NOT_FOUND();
  return row;
}

export async function challenge({ actor, opponentMemberId }) {
  const result = await withActor(actor.id, async (trx) => {
    if (opponentMemberId === actor.id) {
      throw new AppError('VALIDATION_FAILED', 'Không thể tự thách đấu chính mình.', { status: 422 });
    }
    const { rows: [opponent] } = await trx.raw(
      `SELECT id FROM members WHERE id = ? AND community_id = ? AND status = 'member'`,
      [opponentMemberId, actor.communityId]
    );
    if (!opponent) throw NOT_FOUND();
    const { rows: existing } = await trx.raw(
      `SELECT id FROM games WHERE community_id = ? AND status IN ('pending','active')
         AND ((red_member_id = ? AND black_member_id = ?) OR (red_member_id = ? AND black_member_id = ?))`,
      [actor.communityId, actor.id, opponentMemberId, opponentMemberId, actor.id]
    );
    if (existing.length) throw new AppError('DUPLICATE', 'Đã có một ván đang chờ hoặc đang chơi giữa hai người.', { status: 409 });
    const { rows: [row] } = await trx.raw(
      `INSERT INTO games (community_id, red_member_id, black_member_id, status, turn)
       VALUES (?, ?, ?, 'pending', 'r') RETURNING id`,
      [actor.communityId, actor.id, opponentMemberId]
    );
    const { rows: [notification] } = await trx.raw(
      `INSERT INTO notifications (community_id, recipient_id, actor_id, kind, title, body, target_type, target_id)
       VALUES (?, ?, ?, 'game_challenge', 'Lời thách đấu cờ tướng', 'Bạn được rủ một ván cờ tướng.', 'game', ?) RETURNING *`,
      [actor.communityId, opponentMemberId, actor.id, row.id]
    );
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'chess_game.challenged', targetType: 'game', targetId: row.id, detail: {} });
    return { id: row.id, notification };
  });
  publishToMember(opponentMemberId, 'notification', result.notification);
  return { id: result.id };
}

export async function acceptChallenge({ actor, id }) {
  const result = await withActor(actor.id, async (trx) => {
    const game = await loadGame(trx, actor.communityId, id);
    if (game.status !== 'pending') throw INVALID_STATE('Lời thách đấu này không còn chờ trả lời.');
    if (game.black_member_id !== actor.id) throw FORBIDDEN('Chỉ người được mời mới nhận lời được.');
    const board = rules.initBoard();
    const { rows: [row] } = await trx.raw(
      `UPDATE games SET status = 'active', board = ?::jsonb, turn = 'r', started_at = now()
        WHERE id = ? AND status = 'pending' RETURNING *`,
      [JSON.stringify(board), id]
    );
    if (!row) throw INVALID_STATE('Lời thách đấu này không còn chờ trả lời.');
    const { rows: [notification] } = await trx.raw(
      `INSERT INTO notifications (community_id, recipient_id, actor_id, kind, title, body, target_type, target_id)
       VALUES (?, ?, ?, 'game_challenge', 'Lời thách đấu đã được nhận', 'Đối thủ đã nhận lời — đến lượt Đỏ đi trước.', 'game', ?) RETURNING *`,
      [actor.communityId, game.red_member_id, actor.id, id]
    );
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'chess_game.accepted', targetType: 'game', targetId: id, detail: {} });
    return { board, redMemberId: game.red_member_id, notification };
  });
  publishToGame(id, 'game_start', { board: result.board, turn: 'r' });
  publishToMember(result.redMemberId, 'notification', result.notification);
  return { id, status: 'active' };
}

export async function declineChallenge({ actor, id }) {
  const result = await withActor(actor.id, async (trx) => {
    const game = await loadGame(trx, actor.communityId, id);
    if (game.status !== 'pending') throw INVALID_STATE('Lời thách đấu này không còn chờ trả lời.');
    if (game.black_member_id !== actor.id) throw FORBIDDEN('Chỉ người được mời mới từ chối được.');
    const { rows: [row] } = await trx.raw(
      `UPDATE games SET status = 'finished', end_reason = 'declined', finished_at = now()
        WHERE id = ? AND status = 'pending' RETURNING *`,
      [id]
    );
    if (!row) throw INVALID_STATE('Lời thách đấu này không còn chờ trả lời.');
    const { rows: [notification] } = await trx.raw(
      `INSERT INTO notifications (community_id, recipient_id, actor_id, kind, title, body, target_type, target_id)
       VALUES (?, ?, ?, 'game_challenge', 'Lời thách đấu đã bị từ chối', 'Đối thủ đã từ chối lời thách đấu.', 'game', ?) RETURNING *`,
      [actor.communityId, game.red_member_id, actor.id, id]
    );
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'chess_game.declined', targetType: 'game', targetId: id, detail: {} });
    return { redMemberId: game.red_member_id, notification };
  });
  publishToMember(result.redMemberId, 'notification', result.notification);
  return { id, status: 'finished' };
}

// isWatchingGame/loadGame/GAME_SELECT được Task 5 tái dùng — không xoá dù
// chưa thấy import ở nơi khác trong task này.
export { loadGame, GAME_SELECT };

// TẠM — Task 5 thay thế bằng bản đầy đủ (list/get thật đọc DB).
export async function list() { throw new AppError('NOT_FOUND', 'Chưa cài đặt.', { status: 501 }); }
export async function get() { throw new AppError('NOT_FOUND', 'Chưa cài đặt.', { status: 501 }); }
