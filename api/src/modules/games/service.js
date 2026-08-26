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

export async function list({ actor, status, mine, page, limit }) {
  return withActor(actor.id, async (trx) => {
    const statuses = (status ?? 'active').split(',').map((s) => s.trim()).filter(Boolean);
    const where = ['g.community_id = ?', 'g.status = ANY(?)'];
    const params = [actor.communityId, statuses];
    if (mine) { where.push('(g.red_member_id = ? OR g.black_member_id = ?)'); params.push(actor.id, actor.id); }
    const clause = where.join(' AND ');
    const offset = (page - 1) * limit;
    const { rows } = await trx.raw(
      `SELECT g.id, g.status, g.turn, g.created_at, g.started_at,
              g.red_member_id, r.full_name AS red_name, r.avatar_url AS red_avatar_url,
              g.black_member_id, b.full_name AS black_name, b.avatar_url AS black_avatar_url
         FROM games g
         JOIN members r ON r.id = g.red_member_id AND r.community_id = g.community_id
         JOIN members b ON b.id = g.black_member_id AND b.community_id = g.community_id
        WHERE ${clause} ORDER BY g.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const { rows: [{ total }] } = await trx.raw(`SELECT count(*)::int AS total FROM games g WHERE ${clause}`, params);
    return { data: rows, meta: { page, limit, total } };
  });
}

export async function get({ actor, id }) {
  return withActor(actor.id, async (trx) => {
    const game = await loadGame(trx, actor.communityId, id);
    const { rows: moves } = await trx.raw(
      `SELECT seq, side, from_r, from_c, to_r, to_c, captured_type, created_at
         FROM game_moves WHERE game_id = ? ORDER BY seq ASC`,
      [id]
    );
    return { ...game, moves };
  });
}

// Chỉ kiểm tồn tại + đúng cộng đồng, không cần trả bàn cờ/biên bản — dùng cho
// route SSE (GET /:id/stream), nơi phải xác nhận TRƯỚC khi mở kết nối chứ
// không phải sau (đã gửi header rồi thì không next(e) được nữa).
export async function assertVisible({ actor, id }) {
  return withActor(actor.id, (trx) => loadGame(trx, actor.communityId, id));
}

export async function move({ actor, id, from, to }) {
  const result = await withActor(actor.id, async (trx) => {
    const game = await loadGame(trx, actor.communityId, id);
    if (game.status !== 'active') throw INVALID_STATE('Ván cờ này không còn đang chơi.');
    const mySide = actor.id === game.red_member_id ? 'r' : actor.id === game.black_member_id ? 'b' : null;
    if (!mySide) throw FORBIDDEN('Bạn không phải người chơi trong ván này.');
    if (mySide !== game.turn) throw FORBIDDEN('Chưa tới lượt bạn.');
    const piece = game.board[from.r]?.[from.c];
    if (!piece || piece.side !== mySide) {
      throw new AppError('VALIDATION_FAILED', 'Ô xuất phát không có quân của bạn.', { status: 422 });
    }
    const legal = rules.legalMoves(game.board, from.r, from.c);
    if (!legal.some((m) => m.r === to.r && m.c === to.c)) {
      throw new AppError('VALIDATION_FAILED', 'Nước đi không hợp lệ.', { status: 422 });
    }
    const applied = rules.applyMove(game.board, from, to);
    const newTurn = applied.gameOver ? game.turn : rules.opp(mySide);
    const winnerId = applied.gameOver ? (applied.winner === 'r' ? game.red_member_id : game.black_member_id) : null;
    const { rows: [row] } = await trx.raw(
      `UPDATE games SET board = ?::jsonb, turn = ?, status = ?, winner_member_id = ?, end_reason = ?,
              finished_at = CASE WHEN ? THEN now() ELSE finished_at END
        WHERE id = ? AND status = 'active' AND turn = ? RETURNING *`,
      [JSON.stringify(applied.board), newTurn, applied.gameOver ? 'finished' : 'active',
       winnerId, applied.gameOver ? applied.reason : null, applied.gameOver, id, mySide]
    );
    if (!row) throw INVALID_STATE('Ván cờ này không còn đang chơi.');
    const { rows: [seqRow] } = await trx.raw(`SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM game_moves WHERE game_id = ?`, [id]);
    await trx.raw(
      `INSERT INTO game_moves (community_id, game_id, seq, side, from_r, from_c, to_r, to_c, captured_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [actor.communityId, id, seqRow.seq, mySide, from.r, from.c, to.r, to.c, applied.captured?.type ?? null]
    );
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'chess_game.move', targetType: 'game', targetId: id,
      detail: { side: mySide, from_r: from.r, from_c: from.c, to_r: to.r, to_c: to.c } });

    const opponentId = mySide === 'r' ? game.black_member_id : game.red_member_id;
    let notification = null;
    if (!isWatchingGame(id, opponentId)) {
      const title = applied.gameOver ? 'Ván cờ đã kết thúc' : 'Đến lượt bạn đi';
      const body = applied.gameOver
        ? (applied.winner === mySide ? 'Bạn đã thắng.' : 'Đối thủ đã thắng.')
        : 'Đối thủ vừa đi một nước, tới lượt bạn.';
      const { rows: [n] } = await trx.raw(
        `INSERT INTO notifications (community_id, recipient_id, actor_id, kind, title, body, target_type, target_id)
         VALUES (?, ?, ?, 'game_turn', ?, ?, 'game', ?) RETURNING *`,
        [actor.communityId, opponentId, actor.id, title, body, id]
      );
      notification = n;
    }
    return { board: applied.board, turn: newTurn, gameOver: applied.gameOver, winner: applied.winner,
      reason: applied.reason, captured: applied.captured, opponentId, notification };
  });

  publishToGame(id, 'move', { board: result.board, turn: result.turn, last_move: { from, to },
    captured: result.captured ? result.captured.type : null });
  if (result.gameOver) publishToGame(id, 'game_end', { winner: result.winner, reason: result.reason });
  if (result.notification) publishToMember(result.opponentId, 'notification', result.notification);
  return { board: result.board, turn: result.turn, status: result.gameOver ? 'finished' : 'active' };
}

export async function resign({ actor, id }) {
  const result = await withActor(actor.id, async (trx) => {
    const game = await loadGame(trx, actor.communityId, id);
    if (game.status !== 'active') throw INVALID_STATE('Ván cờ này không còn đang chơi.');
    const mySide = actor.id === game.red_member_id ? 'r' : actor.id === game.black_member_id ? 'b' : null;
    if (!mySide) throw FORBIDDEN('Bạn không phải người chơi trong ván này.');
    const winnerId = mySide === 'r' ? game.black_member_id : game.red_member_id;
    const { rows: [row] } = await trx.raw(
      `UPDATE games SET status = 'finished', end_reason = 'resign', winner_member_id = ?, finished_at = now()
        WHERE id = ? AND status = 'active' RETURNING *`,
      [winnerId, id]
    );
    if (!row) throw INVALID_STATE('Ván cờ này không còn đang chơi.');
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'chess_game.resign', targetType: 'game', targetId: id, detail: { side: mySide } });
    const { rows: [notification] } = await trx.raw(
      `INSERT INTO notifications (community_id, recipient_id, actor_id, kind, title, body, target_type, target_id)
       VALUES (?, ?, ?, 'game_turn', 'Đối thủ đã xin thua', 'Bạn đã thắng ván cờ này.', 'game', ?) RETURNING *`,
      [actor.communityId, winnerId, actor.id, id]
    );
    return { winnerId, notification };
  });
  publishToGame(id, 'game_end', { winner: result.winnerId, reason: 'resign' });
  publishToMember(result.winnerId, 'notification', result.notification);
  return { id, status: 'finished' };
}
