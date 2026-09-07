import { randomUUID } from 'node:crypto';
import { withActor } from '../../core/tx.js';
import { AppError } from '../../core/errors.js';
import { log as auditLog } from '../../core/audit.js';
import { publishToMember, publishToGame, isWatchingGame } from '../../core/realtime.js';
import { newInviteToken, hashInviteToken } from '../invites/token.js';
import * as rules from './rules.js';

const NOT_FOUND = () => new AppError('NOT_FOUND', 'Không tìm thấy ván cờ này.', { status: 404 });
const FORBIDDEN = (msg) => new AppError('FORBIDDEN', msg ?? 'Bạn không có quyền làm việc này.', { status: 403 });
const INVALID_STATE = (msg) => new AppError('INVALID_STATE', msg, { status: 409 });

const GAME_SELECT = `
  SELECT g.id, g.community_id, g.status, g.board, g.turn, g.winner_member_id, g.end_reason,
         g.created_at, g.started_at, g.finished_at,
         g.red_member_id, r.full_name AS red_name, r.avatar_url AS red_avatar_url,
         g.black_member_id, COALESCE(b.full_name, g.black_guest_name) AS black_name, b.avatar_url AS black_avatar_url,
         g.black_guest_token, g.invite_token_hash,
         g.red_time_ms, g.black_time_ms, g.turn_started_at,
         g.second_joined_at, g.red_ready_at, g.black_ready_at,
         g.draw_offered_by, g.disconnected_side, g.disconnected_at,
         g.red_ai_level, g.black_ai_level
    FROM games g
    JOIN members r ON r.id = g.red_member_id AND r.community_id = g.community_id
    LEFT JOIN members b ON b.id = g.black_member_id AND b.community_id = g.community_id`;

// khách/thành viên đang là bên nào trong VÁN NÀY — 'null === null' không được
// coi là trùng khớp (một khách chưa xác thực và một phòng chưa có khách đều
// có giá trị null, so trực tiếp actor.id===game.black_member_id sẽ SAI ở đây).
function resolveSide(actor, game) {
  if (actor.id && actor.id === game.red_member_id) return 'r';
  if (actor.id && actor.id === game.black_member_id) return 'b';
  if (actor.guestToken && game.black_guest_token && actor.guestToken === game.black_guest_token) return 'b';
  return null;
}

// Không đếm ngược ở server — tính lại thời gian còn lại MỖI LẦN đọc, từ
// turn_started_at. Đứng yên khi ván chưa active, khi đang tạm dừng vì mất kết
// nối (Task 10), hoặc khi chưa ai đi nước nào (turn_started_at null).
function computeRemainingMs(game) {
  const remaining = { red: game.red_time_ms, black: game.black_time_ms };
  if (game.status !== 'active' || !game.turn_started_at || game.disconnected_side) return remaining;
  const elapsed = Date.now() - new Date(game.turn_started_at).getTime();
  const key = game.turn === 'r' ? 'red' : 'black';
  remaining[key] = Math.max(0, remaining[key] - elapsed);
  return remaining;
}

async function loadGame(trx, communityId, id) {
  const { rows: [row] } = await trx.raw(`${GAME_SELECT} WHERE g.id = ? AND g.community_id = ?`, [id, communityId]);
  if (!row) throw NOT_FOUND();
  return evictStaleGuestIfNeeded(trx, row);
}

// Luật 30 giây (mục 4.3 spec): khách không bấm sẵn sàng kịp thì bị đưa ra khỏi
// phòng — kiểm KIỂU LAZY ngay trong lần đọc/ghi tiếp theo, không cần job nền
// riêng. Chủ phòng không bị đuổi ("chủ phòng tuyệt đối") nên red_ready_at giữ
// nguyên — người đã bấm đúng phần mình không phải bấm lại khi khách sau đó bị
// dọn (mục IV.3 SANH_CO_GIAO_VIEC_DAY_DU.md: "người đã bấm ở lại"). GAME_SELECT
// có alias riêng cho từng cột (vd. black_name khác tên cột thật black_guest_name)
// nên không dùng RETURNING trực tiếp sau UPDATE được — đọc lại bằng chính
// GAME_SELECT thay vì cố khớp danh sách cột bằng tay.
//
// date_trunc('milliseconds', ...) ở vế so khớp: cột second_joined_at là
// timestamptz (độ chính xác micro-giây trong Postgres), nhưng driver `pg`
// phân giải nó thành Date của JavaScript khi đọc vào `game.second_joined_at`
// — Date chỉ có độ chính xác mili-giây nên phần micro-giây bị cắt mất. So
// thẳng `second_joined_at = ?` bằng giá trị JS Date đã cắt đó với giá trị
// gốc còn nguyên micro-giây trong CSDL sẽ KHÔNG BAO GIỜ khớp (xác nhận bằng
// test T42: UPDATE khớp 0 dòng, hàm âm thầm trả lại `game` cũ, khách không
// hề bị dọn dù đã quá 30 giây). Cắt cả hai vế về cùng độ chính xác mili-giây
// trước khi so thì khớp đúng — cùng bẫy đã ghi ở core/audit.js (`log` phần
// bình luận "Lệch có chủ đích khỏi brief").
async function evictStaleGuestIfNeeded(trx, game) {
  if (game.status !== 'pending' || !game.second_joined_at || game.black_ready_at) return game;
  const elapsedMs = Date.now() - new Date(game.second_joined_at).getTime();
  if (elapsedMs <= 30_000) return game;
  await trx.raw(
    `UPDATE games SET black_member_id = NULL, black_guest_name = NULL, black_guest_token = NULL, second_joined_at = NULL
      WHERE id = ? AND status = 'pending' AND date_trunc('milliseconds', second_joined_at) = ?`,
    [game.id, game.second_joined_at]
  );
  const { rows: [fresh] } = await trx.raw(`${GAME_SELECT} WHERE g.id = ?`, [game.id]);
  return fresh ?? game;
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
      `UPDATE games SET status = 'active', board = ?::jsonb, turn = 'r', started_at = now(), turn_started_at = now()
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
  publishToGame(id, 'game_end', { winner: null, reason: 'declined' });
  return { id, status: 'finished' };
}

// Hàng đợi ghép trận nhanh: người đầu tiên bấm "Ghép trận nhanh" mà chưa ai
// đang chờ thì được xếp vào đây (một chỗ mỗi cộng đồng); người thứ hai bấm
// trong lúc đó được ghép thẳng với người đang chờ, tạo một ván 'active' luôn
// (cả hai đã tự nguyện vào hàng đợi nên không cần bước 'pending' chờ nhận
// lời như challenge() thường). Bộ nhớ trong process, không cần bền vững —
// hết 5 giây không ghép được thì client tự gọi leaveQuickMatch() dọn chỗ.
const quickMatchQueue = new Map(); // communityId -> actorId

export async function quickMatch({ actor }) {
  const waitingActorId = quickMatchQueue.get(actor.communityId);
  if (waitingActorId && waitingActorId !== actor.id) {
    quickMatchQueue.delete(actor.communityId);
    const gameId = await withActor(actor.id, async (trx) => {
      const { rows: [opponent] } = await trx.raw(
        `SELECT id FROM members WHERE id = ? AND community_id = ? AND status = 'member'`,
        [waitingActorId, actor.communityId]
      );
      if (!opponent) return null; // người đang chờ đã rời Hội ngay trong lúc chờ — hàng đợi coi như trống
      const board = rules.initBoard();
      const { rows: [row] } = await trx.raw(
        `INSERT INTO games (community_id, red_member_id, black_member_id, status, turn, board, started_at, turn_started_at)
         VALUES (?, ?, ?, 'active', 'r', ?::jsonb, now(), now()) RETURNING id`,
        [actor.communityId, waitingActorId, actor.id, JSON.stringify(board)]
      );
      await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
        action: 'chess_game.quick_matched', targetType: 'game', targetId: row.id, detail: {} });
      return row.id;
    });
    if (gameId) {
      publishToMember(waitingActorId, 'quick_match', { id: gameId });
      return { matched: true, id: gameId };
    }
    // rơi xuống: người đang chờ không còn hợp lệ, xử lý actor hiện tại như người đầu tiên xếp hàng
  }
  quickMatchQueue.set(actor.communityId, actor.id);
  return { matched: false };
}

export async function leaveQuickMatch({ actor }) {
  if (quickMatchQueue.get(actor.communityId) === actor.id) {
    quickMatchQueue.delete(actor.communityId);
  }
  return { ok: true };
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
      `SELECT seq, side, from_r, from_c, to_r, to_c, captured_type, is_check, created_at
         FROM game_moves WHERE game_id = ? ORDER BY seq ASC`,
      [id]
    );
    const remaining = computeRemainingMs(game);
    const { black_guest_token, invite_token_hash, ...publicGame } = game;
    return { ...publicGame, moves, red_time_remaining_ms: remaining.red, black_time_remaining_ms: remaining.black };
  });
}

// Chỉ kiểm tồn tại + đúng cộng đồng, không cần trả bàn cờ/biên bản — dùng cho
// route SSE (GET /:id/stream), nơi phải xác nhận TRƯỚC khi mở kết nối chứ
// không phải sau (đã gửi header rồi thì không next(e) được nữa).
export async function assertVisible({ actor, id }) {
  return withActor(actor.id, async (trx) => {
    const game = await loadGame(trx, actor.communityId, id);
    return { side: resolveSide(actor, game) };
  });
}

export async function move({ actor, id, from, to }) {
  const result = await withActor(actor.id, async (trx) => {
    const game = await loadGame(trx, actor.communityId, id);
    if (game.status !== 'active') throw INVALID_STATE('Ván cờ này không còn đang chơi.');
    const mySide = resolveSide(actor, game);
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
    let gameOver = applied.gameOver, winner = applied.winner, reason = applied.reason;

    const { rows: pastMoves } = await trx.raw(
      `SELECT side, is_check AS "isCheck", captured_type IS NOT NULL AS captured, board_hash AS "boardHash"
         FROM game_moves WHERE game_id = ? ORDER BY seq ASC`,
      [id]
    );
    const newTurnIfContinuing = rules.opp(mySide);
    const newHash = rules.hashBoard(applied.board, gameOver ? game.turn : newTurnIfContinuing);
    const moveHistory = [...pastMoves, { side: mySide, isCheck: applied.checkOpp, captured: !!applied.captured, boardHash: newHash }];

    if (!gameOver) {
      const rep = rules.detectRepetition(moveHistory);
      if (rep) {
        gameOver = true; reason = rep.reason;
        winner = rep.loser ? rules.opp(rep.loser) : null;
      } else if (rules.detectNoCaptureDraw(moveHistory)) {
        gameOver = true; reason = 'hoa-60-nuoc'; winner = null;
      }
    }

    const newTurn = gameOver ? game.turn : newTurnIfContinuing;
    const winnerId = !gameOver ? null : winner === 'r' ? game.red_member_id : winner === 'b' ? game.black_member_id : null;

    const elapsedMs = game.turn_started_at ? Math.max(0, Date.now() - new Date(game.turn_started_at).getTime()) : 0;
    const preMoveTimeMs = mySide === 'r' ? game.red_time_ms : game.black_time_ms;
    const postMoveTimeMs = Math.max(0, preMoveTimeMs - elapsedMs);
    const movedTimeCol = mySide === 'r' ? 'red_time_ms' : 'black_time_ms';

    const { rows: [row] } = await trx.raw(
      `UPDATE games SET board = ?::jsonb, turn = ?, status = ?, winner_member_id = ?, end_reason = ?,
              finished_at = CASE WHEN ? THEN now() ELSE finished_at END,
              ?? = ?, turn_started_at = CASE WHEN ? THEN NULL ELSE now() END
        WHERE id = ? AND status = 'active' AND turn = ? RETURNING *`,
      [JSON.stringify(applied.board), newTurn, gameOver ? 'finished' : 'active',
       winnerId, gameOver ? reason : null, gameOver,
       movedTimeCol, postMoveTimeMs, gameOver,
       id, mySide]
    );
    if (!row) throw INVALID_STATE('Ván cờ này không còn đang chơi.');
    const { rows: [seqRow] } = await trx.raw(`SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM game_moves WHERE game_id = ?`, [id]);
    await trx.raw(
      `INSERT INTO game_moves (community_id, game_id, seq, side, from_r, from_c, to_r, to_c, captured_type, is_check, board_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [actor.communityId, id, seqRow.seq, mySide, from.r, from.c, to.r, to.c,
       applied.captured?.type ?? null, applied.checkOpp, newHash]
    );
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'chess_game.move', targetType: 'game', targetId: id,
      detail: { side: mySide, from_r: from.r, from_c: from.c, to_r: to.r, to_c: to.c } });

    const opponentId = mySide === 'r' ? game.black_member_id : game.red_member_id;
    let notification = null;
    if (opponentId && !isWatchingGame(id, opponentId)) {
      const title = gameOver ? 'Ván cờ đã kết thúc' : 'Đến lượt bạn đi';
      const body = gameOver
        ? (winner === mySide ? 'Bạn đã thắng.' : winner ? 'Đối thủ đã thắng.' : 'Ván cờ kết thúc hoà.')
        : 'Đối thủ vừa đi một nước, tới lượt bạn.';
      const { rows: [n] } = await trx.raw(
        `INSERT INTO notifications (community_id, recipient_id, actor_id, kind, title, body, target_type, target_id)
         VALUES (?, ?, ?, 'game_turn', ?, ?, 'game', ?) RETURNING *`,
        [actor.communityId, opponentId, actor.id, title, body, id]
      );
      notification = n;
    }
    return { board: applied.board, turn: newTurn, gameOver, winner, reason, captured: applied.captured, opponentId, notification };
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
    const mySide = resolveSide(actor, game);
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
    return { winnerId, winnerSide: rules.opp(mySide), notification };
  });
  publishToGame(id, 'game_end', { winner: result.winnerSide, reason: 'resign' });
  publishToMember(result.winnerId, 'notification', result.notification);
  return { id, status: 'finished' };
}

export async function createRoom({ actor }) {
  const rawToken = newInviteToken();
  const tokenHash = hashInviteToken(rawToken);
  const id = await withActor(actor.id, async (trx) => {
    const { rows: [row] } = await trx.raw(
      `INSERT INTO games (community_id, red_member_id, black_member_id, status, turn, invite_token_hash)
       VALUES (?, ?, NULL, 'pending', 'r', ?) RETURNING id`,
      [actor.communityId, actor.id, tokenHash]
    );
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'chess_game.room_opened', targetType: 'game', targetId: row.id, detail: {} });
    return row.id;
  });
  return { id, invite_token: rawToken };
}

export async function joinRoom({ rawToken, guestName }) {
  const tokenHash = hashInviteToken(rawToken);
  const result = await withActor(null, async (trx) => {
    const { rows: [game] } = await trx.raw(
      `SELECT id, community_id, status, black_member_id, black_guest_name
         FROM games WHERE invite_token_hash = ?`,
      [tokenHash]
    );
    if (!game) throw NOT_FOUND();
    if (game.status !== 'pending' || game.black_member_id || game.black_guest_name) {
      throw INVALID_STATE('Phòng này đã có khách hoặc đã bắt đầu.');
    }
    const guestToken = randomUUID();
    const { rows: [row] } = await trx.raw(
      `UPDATE games SET black_guest_name = ?, black_guest_token = ?, second_joined_at = now()
        WHERE id = ? AND status = 'pending' AND black_member_id IS NULL AND black_guest_name IS NULL
        RETURNING id`,
      [guestName, guestToken, game.id]
    );
    if (!row) throw INVALID_STATE('Phòng này đã có khách hoặc đã bắt đầu.');
    await auditLog(trx, { communityId: game.community_id, actorId: null,
      action: 'chess_game.guest_joined', targetType: 'game', targetId: game.id, detail: {} });
    return { gameId: game.id, guestToken };
  });
  return { id: result.gameId, guest_token: result.guestToken };
}

export async function ready({ actor, id }) {
  const result = await withActor(actor.id, async (trx) => {
    const game = await loadGame(trx, actor.communityId, id);
    const mySide = resolveSide(actor, game);
    if (!mySide) throw FORBIDDEN('Bạn không phải người chơi trong ván này.');
    if (game.status !== 'pending') throw INVALID_STATE('Ván này không còn ở bước chuẩn bị.');
    // game.black_guest_name (cột thô) không có trong GAME_SELECT — chỉ có alias
    // black_name (COALESCE(b.full_name, g.black_guest_name)) — nên đọc field đó
    // thay vì cột thô để phát hiện đúng "đã có khách/thành viên vào làm Đen".
    if (!game.black_member_id && !game.black_name) throw INVALID_STATE('Chưa có đối thủ vào phòng.');
    const col = mySide === 'r' ? 'red_ready_at' : 'black_ready_at';
    const { rows: [row] } = await trx.raw(
      `UPDATE games SET ?? = now() WHERE id = ? AND status = 'pending' AND ?? IS NULL
        RETURNING red_ready_at, black_ready_at`,
      [col, id, col]
    );
    if (!row) throw INVALID_STATE('Bạn đã bấm sẵn sàng rồi.');
    let becameActive = false;
    if (row.red_ready_at && row.black_ready_at) {
      const board = rules.initBoard();
      await trx.raw(
        `UPDATE games SET status = 'active', board = ?::jsonb, turn = 'r', started_at = now(), turn_started_at = now()
          WHERE id = ? AND status = 'pending'`,
        [JSON.stringify(board), id]
      );
      becameActive = true;
    }
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'chess_game.ready', targetType: 'game', targetId: id, detail: { side: mySide } });
    return { becameActive };
  });
  if (result.becameActive) publishToGame(id, 'game_start', { turn: 'r' });
  return { ready: true, active: result.becameActive };
}

export async function offerDraw({ actor, id }) {
  const result = await withActor(actor.id, async (trx) => {
    const game = await loadGame(trx, actor.communityId, id);
    const mySide = resolveSide(actor, game);
    if (!mySide) throw FORBIDDEN('Bạn không phải người chơi trong ván này.');
    if (game.status !== 'active') throw INVALID_STATE('Ván cờ này không còn đang chơi.');
    const { rows: [row] } = await trx.raw(
      `UPDATE games SET draw_offered_by = ? WHERE id = ? AND status = 'active' AND draw_offered_by IS NULL RETURNING id`,
      [mySide, id]
    );
    if (!row) throw INVALID_STATE('Đã có lời cầu hoà đang chờ.');
    const opponentSide = rules.opp(mySide);
    const opponentId = opponentSide === 'r' ? game.red_member_id : game.black_member_id;
    let notification = null;
    if (opponentId && !isWatchingGame(id, opponentId)) {
      const { rows: [n] } = await trx.raw(
        `INSERT INTO notifications (community_id, recipient_id, actor_id, kind, title, body, target_type, target_id)
         VALUES (?, ?, ?, 'game_turn', 'Đối thủ cầu hoà', 'Đối thủ vừa đề nghị hoà ván cờ.', 'game', ?) RETURNING *`,
        [actor.communityId, opponentId, actor.id, id]
      );
      notification = n;
    }
    return { mySide, opponentId, notification };
  });
  publishToGame(id, 'draw_offered', { by: result.mySide });
  if (result.notification) publishToMember(result.opponentId, 'notification', result.notification);
  return { offered: true };
}

export async function acceptDraw({ actor, id }) {
  await withActor(actor.id, async (trx) => {
    const game = await loadGame(trx, actor.communityId, id);
    const mySide = resolveSide(actor, game);
    if (!mySide) throw FORBIDDEN('Bạn không phải người chơi trong ván này.');
    if (!game.draw_offered_by || game.draw_offered_by === mySide) {
      throw INVALID_STATE('Không có lời cầu hoà nào để nhận.');
    }
    const { rows: [row] } = await trx.raw(
      `UPDATE games SET status = 'finished', end_reason = 'hoa-thoa-thuan', finished_at = now()
        WHERE id = ? AND status = 'active' AND draw_offered_by = ? RETURNING id`,
      [id, game.draw_offered_by]
    );
    if (!row) throw INVALID_STATE('Ván cờ này không còn đang chơi.');
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'chess_game.draw_accepted', targetType: 'game', targetId: id, detail: {} });
  });
  publishToGame(id, 'game_end', { winner: null, reason: 'hoa-thoa-thuan' });
  return { id, status: 'finished' };
}

export async function declineDraw({ actor, id }) {
  await withActor(actor.id, async (trx) => {
    const game = await loadGame(trx, actor.communityId, id);
    const mySide = resolveSide(actor, game);
    if (!mySide) throw FORBIDDEN('Bạn không phải người chơi trong ván này.');
    if (!game.draw_offered_by || game.draw_offered_by === mySide) {
      throw INVALID_STATE('Không có lời cầu hoà nào để từ chối.');
    }
    await trx.raw(`UPDATE games SET draw_offered_by = NULL WHERE id = ? AND status = 'active'`, [id]);
  });
  publishToGame(id, 'draw_declined', {});
  return { declined: true };
}

export async function claimTimeout({ actor, id }) {
  const result = await withActor(actor.id, async (trx) => {
    const game = await loadGame(trx, actor.communityId, id);
    const mySide = resolveSide(actor, game);
    if (!mySide) throw FORBIDDEN('Bạn không phải người chơi trong ván này.');
    if (game.status !== 'active') throw INVALID_STATE('Ván cờ này không còn đang chơi.');
    if (game.disconnected_side) throw INVALID_STATE('Đồng hồ đang tạm dừng do mất kết nối.');
    const remaining = computeRemainingMs(game);
    const timedOutSide = remaining.red <= 0 ? 'r' : remaining.black <= 0 ? 'b' : null;
    if (!timedOutSide) throw INVALID_STATE('Chưa bên nào thật sự hết giờ.');
    const winnerSide = rules.opp(timedOutSide);
    const winnerId = winnerSide === 'r' ? game.red_member_id : game.black_member_id;
    const { rows: [row] } = await trx.raw(
      `UPDATE games SET status = 'finished', end_reason = 'het-gio', winner_member_id = ?, finished_at = now()
        WHERE id = ? AND status = 'active' RETURNING id`,
      [winnerId, id]
    );
    if (!row) throw INVALID_STATE('Ván cờ này không còn đang chơi.');
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'chess_game.timeout', targetType: 'game', targetId: id, detail: { side: timedOutSide } });
    return { winnerSide };
  });
  publishToGame(id, 'game_end', { winner: result.winnerSide, reason: 'het-gio' });
  return { id, status: 'finished' };
}

export async function markDisconnected({ communityId, gameId, side }) {
  await withActor(null, async (trx) => {
    await trx.raw(
      `UPDATE games SET disconnected_side = ?, disconnected_at = now()
        WHERE id = ? AND community_id = ? AND status = 'active' AND disconnected_side IS NULL`,
      [side, gameId, communityId]
    );
  });
  publishToGame(gameId, 'disconnected', { side });
}

export async function clearDisconnected({ communityId, gameId, side }) {
  const wasCleared = await withActor(null, async (trx) => {
    const { rows: [row] } = await trx.raw(
      `UPDATE games SET disconnected_side = NULL, disconnected_at = NULL,
              turn_started_at = CASE WHEN turn = ? THEN now() ELSE turn_started_at END
        WHERE id = ? AND community_id = ? AND status = 'active' AND disconnected_side = ?
        RETURNING id`,
      [side, gameId, communityId, side]
    );
    return !!row;
  });
  if (wasCleared) publishToGame(gameId, 'reconnected', { side });
}

export async function claimDisconnectTimeout({ actor, id }) {
  const result = await withActor(actor.id, async (trx) => {
    const game = await loadGame(trx, actor.communityId, id);
    const mySide = resolveSide(actor, game);
    if (!mySide) throw FORBIDDEN('Bạn không phải người chơi trong ván này.');
    if (game.status !== 'active') throw INVALID_STATE('Ván cờ này không còn đang chơi.');
    if (!game.disconnected_side) throw INVALID_STATE('Không có ai đang mất kết nối.');
    const elapsedMs = Date.now() - new Date(game.disconnected_at).getTime();
    if (elapsedMs < 60_000) throw INVALID_STATE('Chưa đủ 1 phút mất kết nối.');
    const loserSide = game.disconnected_side;
    const winnerSide = rules.opp(loserSide);
    const winnerId = winnerSide === 'r' ? game.red_member_id : game.black_member_id;
    const { rows: [row] } = await trx.raw(
      `UPDATE games SET status = 'finished', end_reason = 'mat-ket-noi', winner_member_id = ?, finished_at = now()
        WHERE id = ? AND status = 'active' AND disconnected_side = ? RETURNING id`,
      [winnerId, id, loserSide]
    );
    if (!row) throw INVALID_STATE('Ván cờ này không còn đang chơi.');
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'chess_game.disconnect_timeout', targetType: 'game', targetId: id, detail: { side: loserSide } });
    return { winnerSide };
  });
  publishToGame(id, 'game_end', { winner: result.winnerSide, reason: 'mat-ket-noi' });
  return { id, status: 'finished' };
}
