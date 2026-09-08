import { randomUUID } from 'node:crypto';
import { withActor } from '../../core/tx.js';
import { AppError } from '../../core/errors.js';
import { log as auditLog } from '../../core/audit.js';
import { publishToMember, publishToGame, isWatchingGame } from '../../core/realtime.js';
import { newInviteToken, hashInviteToken } from '../invites/token.js';
import * as rules from './rules.js';
import * as engineClient from './engineClient.js';
import { selectAiMove, effectiveScore } from './aiSelect.js';
import { computeMoveLosses } from './analysis.js';

const NOT_FOUND = () => new AppError('NOT_FOUND', 'Không tìm thấy ván cờ này.', { status: 404 });
const FORBIDDEN = (msg) => new AppError('FORBIDDEN', msg ?? 'Bạn không có quyền làm việc này.', { status: 403 });
const INVALID_STATE = (msg) => new AppError('INVALID_STATE', msg, { status: 409 });

// GAME_SELECT cố tình KHÔNG bao gồm analyzed_at / red_avg_loss / black_avg_loss dù 3
// cột này tồn tại trên bảng games — vì đầu ra của GAME_SELECT chảy qua get() (backing
// GET /games/:id, trả về cho khách qua denylist object spread chỉ bỏ 2 cột nhạy cảm),
// nên mọi cột trong GAME_SELECT tự động visible cho khách. Mục đặc tả yêu cầu 3 cột
// mổ ván này phải giữ kín với khách — getAnalysis() và getMemberProfile() (phía dưới)
// thay vào đó chạy riêng SELECT lấy 3 cột này, không dùng GAME_SELECT/loadGame().
// KHÔNG thêm 3 cột này vào GAME_SELECT.
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
  // game.black_member_id: bên Đen là THÀNH VIÊN thật (đã bấm link mời trong lúc
  // đăng nhập, xem web/index.html cotuongPhongMemberHtml) — luật 30 giây chỉ áp
  // cho KHÁCH không tài khoản (mục 4.3 spec: "khách không bấm sẵn sàng kịp thì bị
  // đưa ra khỏi phòng"), không áp cho thành viên. Thiếu nhánh chặn này từng khiến
  // một thành viên vào phòng xong quá 30 giây chưa bấm Sẵn sàng bị âm thầm xoá
  // black_member_id, coi như chưa từng vào — cùng lỗi vừa sửa ở xqRoomPhase phía
  // client (V['cotuong-van'] hiểu nhầm ván là thách đấu Gen 1 sau khi bị xoá).
  if (game.status !== 'pending' || game.black_member_id || !game.second_joined_at || game.black_ready_at) return game;
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
  maybeAutoMove({ communityId: actor.communityId, gameId: id }).catch((e) => console.error('maybeAutoMove lỗi:', e));
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
              g.black_member_id, COALESCE(b.full_name, g.black_guest_name) AS black_name, b.avatar_url AS black_avatar_url
         FROM games g
         JOIN members r ON r.id = g.red_member_id AND r.community_id = g.community_id
         LEFT JOIN members b ON b.id = g.black_member_id AND b.community_id = g.community_id
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
  if (result.gameOver) analyzeGame({ communityId: actor.communityId, gameId: id }).catch((e) => console.error('analyzeGame lỗi:', e));
  if (result.notification) publishToMember(result.opponentId, 'notification', result.notification);
  if (!result.gameOver) maybeAutoMove({ communityId: actor.communityId, gameId: id }).catch((e) => console.error('maybeAutoMove lỗi:', e));
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
    // Lệch có chủ đích khỏi hành vi gốc của resign() (hàm có từ trước Task 10,
    // phát hiện khi Task 11 leaveRoom() gọi resign() lần đầu cho một ván PHÒNG
    // có đối thủ là KHÁCH): khi bên thắng là khách, winnerId là NULL (khách
    // không có member id) — nhưng notifications.recipient_id là NOT NULL nên
    // INSERT thẳng như bản gốc vỡ ràng buộc, trả 500 (xác nhận bằng service
    // thật, xem task-11-report.md). resign() được viết từ lúc ván chỉ có
    // thành viên-với-thành viên (winnerId luôn có giá trị), chưa từng được gọi
    // cho một ván có khách qua route /resign lẫn có test nào phủ tới trước
    // Task 11. Sửa theo đúng khuôn "chỉ tạo thông báo khi có thành viên thật để
    // nhận" đã dùng ở move()/offerDraw() ngay trong file này — không tạo/không
    // gửi notification khi không có ai (thành viên thật) để nhận.
    let notification = null;
    if (winnerId) {
      const { rows: [n] } = await trx.raw(
        `INSERT INTO notifications (community_id, recipient_id, actor_id, kind, title, body, target_type, target_id)
         VALUES (?, ?, ?, 'game_turn', 'Đối thủ đã xin thua', 'Bạn đã thắng ván cờ này.', 'game', ?) RETURNING *`,
        [actor.communityId, winnerId, actor.id, id]
      );
      notification = n;
    }
    return { winnerId, winnerSide: rules.opp(mySide), notification };
  });
  publishToGame(id, 'game_end', { winner: result.winnerSide, reason: 'resign' });
  analyzeGame({ communityId: actor.communityId, gameId: id }).catch((e) => console.error('analyzeGame lỗi:', e));
  if (result.notification) publishToMember(result.winnerId, 'notification', result.notification);
  return { id, status: 'finished' };
}

// Vòng soát xét cuối cùng của cả nhánh (Important): trước bản vá này, nhánh
// "chưa vào trận" (status !== 'active') luôn XOÁ CẢ VÁN bất kể người rời là
// chủ phòng (mySide='r') hay khách (mySide='b') — một khách vào phòng (dù
// chưa hề bấm sẵn sàng) gọi /leave là xoá sạch phòng của CHỦ PHÒNG, link mời
// mất theo, lặp lại được vô hạn lần chừng nào link còn lưu hành: một cách bắt
// nạt chủ phòng thật sự. Trái nguyên tắc "chủ phòng tuyệt đối" (mục 4.3 spec)
// mà evictStaleGuestIfNeeded() ở trên đã áp dụng — khách bị dọn (kể cả do LỖI
// của chính khách, trễ 30 giây) cũng chỉ mất đúng CHỖ CỦA KHÁCH, không đụng
// tới phòng của chủ; một khách TỰ NGUYỆN rời càng không có lý do bị xử nhẹ tay
// hơn (tức phòng bị xoá) so với một khách bị đuổi vì lỗi của chính mình.
//
// Sửa: khách rời phòng (mySide='b') khi phòng còn 'pending' chỉ dọn đúng các
// cột slot của khách — cùng bộ cột evictStaleGuestIfNeeded() đã dọn
// (black_member_id, black_guest_name, black_guest_token, second_joined_at),
// cộng thêm black_ready_at (evictStaleGuestIfNeeded() không cần dọn cột này vì
// hàm đó chỉ chạy TRƯỚC khi ai bấm sẵn sàng — xem điều kiện !game.black_ready_at
// ngay đầu hàm; ở đây khách có thể đã bấm sẵn sàng rồi mới đổi ý rời) — KHÔNG
// xoá ván. red_ready_at của chủ phòng không đụng tới nên không mất — đúng tinh
// thần "người đã bấm ở lại" đã ghi ở evictStaleGuestIfNeeded(). Chủ phòng rời
// (mySide='r') giữ nguyên hành vi cũ: xoá cả ván, vì phòng của chính họ không
// còn gì đáng giữ lại khi chưa vào trận.
export async function leaveRoom({ actor, id }) {
  const game = await withActor(actor.id, (trx) => loadGame(trx, actor.communityId, id));
  const mySide = resolveSide(actor, game);
  if (!mySide) throw FORBIDDEN('Bạn không phải người chơi trong ván này.');
  if (game.status === 'active') return resign({ actor, id });
  if (mySide === 'b') {
    await withActor(actor.id, async (trx) => {
      const { rows: [row] } = await trx.raw(
        `UPDATE games SET black_member_id = NULL, black_guest_name = NULL, black_guest_token = NULL,
                second_joined_at = NULL, black_ready_at = NULL
          WHERE id = ? AND status = 'pending' RETURNING id`,
        [id]
      );
      if (!row) throw INVALID_STATE('Ván cờ này không còn ở bước chuẩn bị.');
      await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
        action: 'chess_game.guest_left', targetType: 'game', targetId: id, detail: {} });
    });
    return { id, status: 'left' };
  }
  await withActor(actor.id, async (trx) => {
    await trx.raw(`DELETE FROM game_moves WHERE game_id = ?`, [id]);
    const { rows: [deleted] } = await trx.raw(
      `DELETE FROM games WHERE id = ? AND status = 'pending' RETURNING id`, [id]
    );
    if (!deleted) throw INVALID_STATE('Ván cờ này không còn ở bước chuẩn bị.');
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'chess_game.room_closed', targetType: 'game', targetId: id, detail: {} });
  });
  return { id, status: 'deleted' };
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

// actor (tuỳ chọn, xem optionalAuth ở routes.js): thành viên ĐÃ đăng nhập bấm
// link mời thì vào phòng bằng đúng tài khoản của họ (black_member_id) — trước
// đây route này luôn coi mọi người bấm link là khách, kể cả thành viên thật,
// nên bên đó mất hẳn topbar/sidebar/hồ sơ của màn thành viên (V['cotuong-van'])
// mà rơi vào màn khách rút gọn (guestGameHtml). guestName bắt buộc CHỈ khi
// không có actor.
export async function joinRoom({ rawToken, guestName, actor }) {
  const tokenHash = hashInviteToken(rawToken);
  const result = await withActor(actor?.id ?? null, async (trx) => {
    const { rows: [game] } = await trx.raw(
      `SELECT id, community_id, status, black_member_id, black_guest_name, red_member_id
         FROM games WHERE invite_token_hash = ?`,
      [tokenHash]
    );
    if (!game) throw NOT_FOUND();
    // Khác cộng đồng thì coi như không tồn tại (không rò việc phòng có thật) —
    // cùng lý do NOT_FOUND thay vì FORBIDDEN ở các nơi khác lọc theo community_id.
    if (actor && actor.communityId !== game.community_id) throw NOT_FOUND();
    if (actor && actor.id === game.red_member_id) throw INVALID_STATE('Bạn là chủ phòng này rồi.');
    if (game.status !== 'pending' || game.black_member_id || game.black_guest_name) {
      throw INVALID_STATE('Phòng này đã có khách hoặc đã bắt đầu.');
    }
    if (actor) {
      const { rows: [row] } = await trx.raw(
        `UPDATE games SET black_member_id = ?, second_joined_at = now()
          WHERE id = ? AND status = 'pending' AND black_member_id IS NULL AND black_guest_name IS NULL
          RETURNING id`,
        [actor.id, game.id]
      );
      if (!row) throw INVALID_STATE('Phòng này đã có khách hoặc đã bắt đầu.');
      await auditLog(trx, { communityId: game.community_id, actorId: actor.id,
        action: 'chess_game.member_joined', targetType: 'game', targetId: game.id, detail: {} });
      return { gameId: game.id, guestToken: null };
    }
    if (!guestName) throw new AppError('VALIDATION_FAILED', 'Cần nhập tên.', { status: 422 });
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
  if (result.becameActive) {
    publishToGame(id, 'game_start', { turn: 'r' });
    maybeAutoMove({ communityId: actor.communityId, gameId: id }).catch((e) => console.error('maybeAutoMove lỗi:', e));
  }
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
  analyzeGame({ communityId: actor.communityId, gameId: id }).catch((e) => console.error('analyzeGame lỗi:', e));
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
    // Vòng soát xét cuối cùng của cả nhánh (Important): thiếu CAS trên phần
    // trạng thái vừa ĐỌC và dùng để QUYẾT ĐỊNH claim này — khác mọi hàm ghi
    // trạng thái khác trong file (move() khoá thêm AND turn = ?, acceptDraw()
    // khoá thêm AND draw_offered_by = ?, claimDisconnectTimeout() khoá thêm
    // AND disconnected_side = ?). timedOutSide/winnerSide ở trên được suy ra
    // từ turn + turn_started_at đọc lúc đầu hàm; nếu bên "hết giờ" vừa đi được
    // một nước hợp lệ (move() không hề biết tới claimTimeout đang diễn ra,
    // đổi cả turn lẫn turn_started_at) NGAY TRƯỚC KHI UPDATE này chạy, bản
    // thiếu khoá vẫn khớp WHERE (status vẫn 'active') và kết thúc ván trên dữ
    // liệu đã cũ — xử thua oan một người vừa thật sự đi nước kịp giờ. Khoá
    // thêm AND turn = ? (giá trị đã đọc, KHÔNG PHẢI turn_started_at — cột đó
    // là timestamptz độ chính xác micro-giây, driver `pg` đọc về JS Date chỉ
    // còn mili-giây nên so bằng nhau không bao giờ khớp, đúng bẫy đã xác nhận
    // ở Task 8/evictStaleGuestIfNeeded() phía trên) chặn đúng khe hở này: turn
    // đổi thì WHERE không khớp dòng nào nữa, claim thất bại thay vì thắng oan.
    const { rows: [row] } = await trx.raw(
      `UPDATE games SET status = 'finished', end_reason = 'het-gio', winner_member_id = ?, finished_at = now()
        WHERE id = ? AND status = 'active' AND turn = ? RETURNING id`,
      [winnerId, id, game.turn]
    );
    if (!row) throw INVALID_STATE('Ván cờ này không còn đang chơi.');
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'chess_game.timeout', targetType: 'game', targetId: id, detail: { side: timedOutSide } });
    return { winnerSide };
  });
  publishToGame(id, 'game_end', { winner: result.winnerSide, reason: 'het-gio' });
  analyzeGame({ communityId: actor.communityId, gameId: id }).catch((e) => console.error('analyzeGame lỗi:', e));
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

// Lệch có chủ đích khỏi brief (phát hiện + xác nhận bằng dữ liệu thật ở Task
// 10, xem "§3.2" trong task-10-report.md): CASE gốc của brief
// (`turn_started_at = CASE WHEN turn = ? THEN now() ELSE turn_started_at END`)
// chỉ dời turn_started_at khi bên VỪA KẾT NỐI LẠI cũng đang là bên cầm lượt.
// Khi bên KHÔNG mất kết nối đang cầm lượt suốt thời gian đối thủ mất kết nối
// (không đi nước nào nên turn không đổi), CASE đó không bao giờ khớp —
// turn_started_at đứng nguyên từ trước khi mất kết nối, và computeRemainingMs()
// / move() (elapsed = now() - turn_started_at, không hề biết tới
// disconnected_side) sẽ tính oan TOÀN BỘ thời gian mất kết nối vào đồng hồ
// của bên đang kết nối ngay khi cờ disconnected_side vừa được xoá — nhẹ thì
// lệch hiển thị, nặng thì bên vừa mất kết nối kết nối lại xong báo /timeout
// thắng luôn, dù bên kia chưa hề đi nước nào và màn hình vẫn đứng yên tới tận
// khoảnh khắc đó (tái hiện được bằng service thật, xem báo cáo).
//
// Sửa: DỜI turn_started_at tới TRƯỚC đúng bằng khoảng thời gian mất kết nối
// (`turn_started_at + (now() - disconnected_at)`), không điều kiện theo bên
// nào đang cầm lượt. elapsed = now() - turn_started_at ở mọi lần đọc sau này
// sẽ tự động trừ đúng khoảng mất kết nối ra khỏi kết quả — dù sau đó là bên
// nào cầm lượt. Không dùng cách "luôn đặt lại = now()" (đơn giản hơn nhưng
// tha oan): khi bên vừa kết nối lại CŨNG đang cầm lượt, cách đó xoá luôn cả
// thời gian họ đã nghĩ THẬT trước khi mất kết nối, không chỉ khoảng mất kết
// nối — công thức dời ở đây giữ đúng phần đã nghĩ thật đó, chỉ trừ đúng phần
// mất kết nối. An toàn với NULL: disconnected_side và disconnected_at luôn
// được set/xoá cùng nhau (markDisconnected/clearDisconnected), nên WHERE
// disconnected_side = ? khớp thì disconnected_at chắc chắn không NULL; mọi
// hàng status='active' luôn có turn_started_at không NULL (mọi chỗ đặt
// status='active' — acceptChallenge, quickMatch, ready(), move() khi ván chưa
// xong — đều set turn_started_at cùng lúc; chỗ duy nhất đặt nó về NULL trong
// move() cũng đặt status='finished' cùng lúc nên WHERE status='active' loại
// hàng đó ra trước).
//
// Lệch có chủ đích khỏi brief, vòng 2 (xem "§9" trong task-10-report.md):
// công thức dời ở trên tự ngầm định turn_started_at <= disconnected_at (lượt
// hiện tại bắt đầu TRƯỚC khi đối thủ mất kết nối) — đúng khi không ai đi
// thêm nước nào trong lúc mất kết nối, nhưng move() (không sửa ở Task 10,
// không hề biết tới disconnected_side) vẫn cho bên ĐANG KẾT NỐI đi nước bình
// thường trong lúc đối thủ mất kết nối, và mỗi nước dời turn_started_at tới
// now() của chính lúc đi — có thể MUỘN HƠN disconnected_at. Khi đó công thức
// dời ở trên vọt QUÁ hiện tại (turn_started_at mới nằm ở tương lai), khiến
// elapsed = now() - turn_started_at ÂM ở computeRemainingMs()/move() lần đọc
// kế tiếp — Math.max(0, remaining - elapsed_âm) LÀM PHỒNG remaining VƯỢT QUÁ
// cả ngân sách ban đầu (tái hiện thật: black_time_remaining_ms = 659987, vượt
// 600000). Không outcome-flipping như lỗ hổng vòng 1 (remaining phồng lên thì
// CÀNG XA ngưỡng claimTimeout's remaining<=0, không thể tạo thắng giả) nhưng
// vẫn là một giá trị hiển thị/tính toán sai sự thật, đạt được bằng một hành
// vi hoàn toàn bình thường (bên đang kết nối đi một nước trong lúc đối thủ
// mất kết nối), không cần cố tình canh giờ.
//
// Sửa: kẹp giá trị dời lại không bao giờ vượt quá now() bằng LEAST(). Trường
// hợp không có nước đi xen giữa (turn_started_at <= disconnected_at, đúng như
// công thức dời ở trên đã ngầm định) thì giá trị dời vốn đã <= now() nên
// LEAST không đổi gì — y hệt hành vi đã xác nhận ở vòng 1. Trường hợp có nước
// đi xen giữa (turn_started_at > disconnected_at) thì LEAST kẹp về đúng
// now() — cho bên vừa nhận lượt (luôn CHÍNH LÀ bên vừa kết nối lại: nước đi
// duy nhất có thể xen vào là của bên ĐANG kết nối, và nước đó luôn trao lượt
// sang đúng bên đang mất kết nối) một khởi đầu mới tinh từ lúc kết nối lại —
// hợp lý vì họ không thể nào đã "nghĩ" cho một lượt vừa được trao trong lúc
// còn đang mất kết nối, và không mở lỗ hổng mới vì chỉ có lợi cho đúng bên
// vừa kết nối lại, không phải bên gây ra nước đi khiến lượt bị vọt.
export async function clearDisconnected({ communityId, gameId, side }) {
  const wasCleared = await withActor(null, async (trx) => {
    const { rows: [row] } = await trx.raw(
      `UPDATE games SET disconnected_side = NULL, disconnected_at = NULL,
              turn_started_at = LEAST(now(), turn_started_at + (now() - disconnected_at))
        WHERE id = ? AND community_id = ? AND status = 'active' AND disconnected_side = ?
        RETURNING id`,
      [gameId, communityId, side]
    );
    return !!row;
  });
  if (wasCleared) publishToGame(gameId, 'reconnected', { side });
}

// Lệch có chủ đích khỏi brief, vòng 3 (xem "§10" trong task-10-report.md):
// disconnected_side/disconnected_at chỉ do markDisconnected/clearDisconnected
// đụng tới — move() (không sửa ở Task 10) không hề biết tới hai cột này, nên
// nếu chính bên bị đánh dấu mất kết nối vẫn còn một kênh khác gọi API bình
// thường được (SSE rớt nhưng request/response HTTP vẫn sống — hoàn toàn có
// thật trên mạng chập chờn), họ đi nước hoàn toàn hợp lệ mà cờ disconnected_side
// vẫn đứng nguyên, cũ dần. Không kiểm điều này thì sau 60 giây kể từ mốc cũ đó,
// đối thủ báo /disconnect-timeout THẮNG THẬT dù bên kia vẫn đang chơi bình
// thường suốt — xử thua oan, tái hiện được bằng service thật (xem báo cáo).
//
// Sửa: trước khi tin disconnected_side, kiểm xem CHÍNH bên đó có nước đi nào
// mới hơn disconnected_at không (lọc side = disconnected_side — một nước của
// bên ĐANG kết nối không nói lên gì về việc đối thủ họ có thật sự còn mất kết
// nối hay không, nên không được tính). Có thì cờ đã cũ — tự dọn (best-effort,
// không cần RETURNING/kiểm, cùng kiểu markDisconnected) rồi từ chối, không xử
// thua. created_at > ? là so KHÔNG BẰNG NHAU nên không dính bẫy lệch độ chính
// xác mili-giây/micro-giây của Task 8 (bẫy đó chỉ vỡ phép so BẰNG NHAU).
//
// Lệch tiếp, có chủ đích, khỏi chính mã sửa vòng 3 (phát hiện lúc tự kiểm —
// xem "§10.3" trong task-10-report.md): bản đầu ném INVALID_STATE NGAY SAU
// UPDATE tự dọn ở trên, CÙNG một trx với withActor(). withActor() = 1 lời gọi
// knex.transaction() DUY NHẤT bọc quanh toàn bộ callback — callback ném lỗi
// thì knex tự ROLLBACK CẢ giao dịch, xoá luôn UPDATE tự dọn vừa chạy (đúng bẫy
// đã ghi ở core/audit.js phần logDenied: "ngoại lệ huỷ cả giao dịch"). Kết quả
// đo được: /disconnect-timeout vẫn trả 409 đúng (exception vẫn thoát ra ngoài
// bình thường) NHƯNG disconnected_side đọc lại vẫn còn 'r' — cờ cũ không hề
// được dọn, y hệt trước khi sửa. Sửa: KHÔNG throw trong trx nữa — trả về cờ
// hiệu {stale:true} để withActor() tự COMMIT giao dịch (đã có UPDATE tự dọn),
// rồi throw NGOÀI withActor(), sau khi giao dịch đã chốt xong — không còn gì
// để rollback nữa.
export async function claimDisconnectTimeout({ actor, id }) {
  const result = await withActor(actor.id, async (trx) => {
    const game = await loadGame(trx, actor.communityId, id);
    const mySide = resolveSide(actor, game);
    if (!mySide) throw FORBIDDEN('Bạn không phải người chơi trong ván này.');
    if (game.status !== 'active') throw INVALID_STATE('Ván cờ này không còn đang chơi.');
    if (!game.disconnected_side) throw INVALID_STATE('Không có ai đang mất kết nối.');
    const { rows: [movedSince] } = await trx.raw(
      `SELECT 1 FROM game_moves WHERE game_id = ? AND side = ? AND created_at > ? LIMIT 1`,
      [id, game.disconnected_side, game.disconnected_at]
    );
    if (movedSince) {
      await trx.raw(
        `UPDATE games SET disconnected_side = NULL, disconnected_at = NULL WHERE id = ? AND status = 'active' AND disconnected_side = ?`,
        [id, game.disconnected_side]
      );
      return { stale: true };
    }
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
  if (result.stale) throw INVALID_STATE('Bên bị coi là mất kết nối đã có nước đi mới — không còn mất kết nối thật.');
  publishToGame(id, 'game_end', { winner: result.winnerSide, reason: 'mat-ket-noi' });
  analyzeGame({ communityId: actor.communityId, gameId: id }).catch((e) => console.error('analyzeGame lỗi:', e));
  return { id, status: 'finished' };
}

// Mổ ván (mục 2.5 spec) — CHỈ hai người chơi thật của chính ván này, không
// bao giờ khách, không bao giờ người ngoài dù đã đăng nhập (route đã chặn
// guest bằng requireAuth thay vì requireAuthOrGuestToken; hàm này CÒN chặn
// thêm người-thứ-ba-đã-đăng-nhập bằng resolveSide — hai lớp, không chỉ một).
export async function getAnalysis({ actor, id }) {
  return withActor(actor.id, async (trx) => {
    const game = await loadGame(trx, actor.communityId, id);
    const mySide = resolveSide(actor, game);
    if (!mySide) throw FORBIDDEN('Chỉ hai người chơi trong ván này mới xem được mổ ván.');
    if (game.status !== 'finished') throw INVALID_STATE('Ván cờ này chưa kết thúc.');
    // GAME_SELECT (loadGame) không có analyzed_at/red_avg_loss/black_avg_loss —
    // đọc riêng từ bảng games thay vì tin game.* có sẵn các cột này.
    const { rows: [summary] } = await trx.raw(
      `SELECT analyzed_at, red_avg_loss, black_avg_loss FROM games WHERE id = ?`,
      [id]
    );
    const { rows: moves } = await trx.raw(
      `SELECT seq, side, eval_before_cp, eval_before_mate, win_loss FROM game_moves WHERE game_id = ? ORDER BY seq ASC`,
      [id]
    );
    return { analyzed_at: summary.analyzed_at, moves, red_avg_loss: summary.red_avg_loss, black_avg_loss: summary.black_avg_loss };
  });
}

// Hồ sơ đối thủ (mục 2.5 spec) — thống kê TOÀN BỘ ván đã mổ của memberId trên
// nền tảng, KHÔNG PHẢI riêng đối đầu giữa hai người (RULING trong spec §2.5:
// đọc tự nhiên như một hồ sơ chung). Chỉ đếm ván đã analyzed_at IS NOT NULL —
// một ván vừa kết thúc mà chưa mổ xong không được tính là "đã chơi" ở đây.
export async function getMemberProfile({ actor, memberId }) {
  return withActor(actor.id, async (trx) => {
    const { rows: [row] } = await trx.raw(
      `SELECT
         count(*) AS games_count,
         count(*) FILTER (WHERE winner_member_id = ?) AS wins,
         avg(CASE WHEN red_member_id = ? THEN red_avg_loss ELSE black_avg_loss END) AS avg_loss
       FROM games
       WHERE community_id = ? AND (red_member_id = ? OR black_member_id = ?) AND analyzed_at IS NOT NULL`,
      [memberId, memberId, actor.communityId, memberId, memberId]
    );
    return {
      games_count: Number(row.games_count),
      wins: Number(row.wins),
      avg_loss: row.avg_loss === null ? null : Number(row.avg_loss),
    };
  });
}

// Xếp hạng (mục 4 spec topbar hợp nhất) — tỉ lệ thắng trên các ván đã kết
// thúc VÀ đã mổ (analyzed_at IS NOT NULL, cùng điều kiện getMemberProfile),
// ngưỡng tối thiểu 5 ván để vào bảng (dưới ngưỡng, tỉ lệ thắng dễ gây hiểu
// lầm — 100% sau đúng 1 ván thắng may). Khách (không black_member_id) bị
// loại khỏi vế UNION thứ hai — khách không có hồ sơ, không xếp hạng được,
// cùng nguyên tắc getAnalysis/getMemberProfile.
export async function getLeaderboard({ actor }) {
  return withActor(actor.id, async (trx) => {
    const { rows } = await trx.raw(
      `SELECT m.id AS member_id, m.full_name, m.avatar_url,
              count(*) AS games_count,
              count(*) FILTER (WHERE x.won) AS wins,
              avg(x.avg_loss) AS avg_loss
         FROM (
           SELECT g.red_member_id AS member_id, (g.winner_member_id = g.red_member_id) AS won, g.red_avg_loss AS avg_loss
             FROM games g WHERE g.community_id = ? AND g.status = 'finished' AND g.analyzed_at IS NOT NULL
           UNION ALL
           SELECT g.black_member_id, (g.winner_member_id = g.black_member_id), g.black_avg_loss
             FROM games g WHERE g.community_id = ? AND g.status = 'finished' AND g.analyzed_at IS NOT NULL
               AND g.black_member_id IS NOT NULL
         ) x
         JOIN members m ON m.id = x.member_id
        GROUP BY m.id, m.full_name, m.avatar_url
       HAVING count(*) >= 5
       ORDER BY (count(*) FILTER (WHERE x.won))::float / count(*) DESC, count(*) DESC
       LIMIT 50`,
      [actor.communityId, actor.communityId]
    );
    return {
      data: rows.map((r) => ({
        member_id: r.member_id,
        full_name: r.full_name,
        avatar_url: r.avatar_url,
        games_count: Number(r.games_count),
        wins: Number(r.wins),
        win_rate: Math.round((Number(r.wins) / Number(r.games_count)) * 1000) / 10,
        avg_loss: r.avg_loss === null ? null : Number(r.avg_loss),
      })),
    };
  });
}

export async function setAiLevel({ actor, id, level }) {
  await withActor(actor.id, async (trx) => {
    const game = await loadGame(trx, actor.communityId, id);
    const mySide = resolveSide(actor, game);
    if (!mySide) throw FORBIDDEN('Bạn không phải người chơi trong ván này.');
    if (game.status === 'finished') throw INVALID_STATE('Ván cờ này đã kết thúc.');
    const col = mySide === 'r' ? 'red_ai_level' : 'black_ai_level';
    await trx.raw(`UPDATE games SET ?? = ? WHERE id = ?`, [col, level, id]);
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'chess_game.ai_level_set', targetType: 'game', targetId: id, detail: { side: mySide, level } });
  });
  // Vừa bật máy đúng lúc đang là lượt của chính bên đó (vd. giữa ván, tự bật
  // máy đi hộ thay mình) — không có nước đi nào sắp xảy ra để làm điểm kích
  // hoạt, nên phải tự kích hoạt ở đây. Không await — xem Global Constraints.
  maybeAutoMove({ communityId: actor.communityId, gameId: id }).catch((e) => console.error('maybeAutoMove lỗi:', e));
  return { ok: true, level };
}

// Tự động đi hộ khi tới lượt bên đang bật "máy đi hộ" (mục 6 spec Kernel/
// Engine). Gọi ở CUỐI move()/ready()/acceptChallenge() — bất cứ chỗ nào có
// thể trao lượt cho một bên đã bật máy — và bên trong chính setAiLevel() cho
// trường hợp bật đúng lúc đã là lượt mình. An toàn gọi thừa: nếu game không
// 'active' hoặc bên đang cầm lượt chưa bật máy thì no-op ngay, không gọi engine.
//
// KHÔNG await ở nơi gọi (movetime mặc định 8000ms — xem Global Constraints).
// Áp nước qua ĐÚNG service.move() đang có, không viết lại luồng áp nước —
// nghĩa là mọi kiểm tra/luật/thông báo/SSE của move() cũng chạy y hệt một
// nước người thật đi, kể cả việc move() tự gọi lại maybeAutoMove() ở cuối cho
// LƯỢT KẾ TIẾP — đây là cách hai bên cùng bật máy tự đấu với nhau (không cấm,
// xem Global Constraints/ghi chú thiết kế).
export async function maybeAutoMove({ communityId, gameId }) {
  const game = await withActor(null, (trx) => loadGame(trx, communityId, gameId));
  if (game.status !== 'active') return;
  const side = game.turn;
  const level = side === 'r' ? game.red_ai_level : game.black_ai_level;
  if (!level) return;

  const fen = rules.boardToFen(game.board, game.turn);
  const { lines } = await engineClient.bestMove({ fen, movetime: 8000, multipv: 3 });
  if (!lines || !lines.length) return;
  const chosenUci = selectAiMove(lines, level);
  if (!chosenUci) return;
  const { from, to } = rules.uciMoveToCells(chosenUci);

  const actor = side === 'r'
    ? { id: game.red_member_id, communityId, guestToken: null }
    : { id: game.black_member_id ?? null, communityId, guestToken: game.black_member_id ? null : game.black_guest_token };

  await move({ actor, id: gameId, from, to });
}

// Mổ ván ACPL sau khi kết thúc (mục 2.3 spec Máy đi hộ/Mổ ván). Fire-and-
// forget — KHÔNG được throw ra ngoài, KHÔNG được chặn response của bất kỳ
// hàm nào gọi nó (resign/acceptDraw/claimTimeout/claimDisconnectTimeout/
// move()) — mọi lỗi tự bắt, tự log, analyzed_at ở lại NULL, không có gì vỡ.
// movetime=400 multipv=1: đây là phân tích NỀN không ai chờ trực tiếp, khác
// hẳn movetime=8000 của máy đi hộ SỐNG (mục 4 spec) — đủ nhanh để một ván 60
// nước phân tích xong trong khoảng nửa phút, đủ sâu để không random nhiễu quá
// mức. Đừng gộp chung hằng số với máy đi hộ.
const ANALYSIS_MOVETIME_MS = 400;
export async function analyzeGame({ communityId, gameId }) {
  try {
    const { rows: moves } = await withActor(null, (trx) => trx.raw(
      `SELECT seq, side, from_r, from_c, to_r, to_c FROM game_moves WHERE game_id = ? AND community_id = ? ORDER BY seq ASC`,
      [gameId, communityId]
    ));
    if (!moves.length) {
      await withActor(null, (trx) => trx.raw(
        `UPDATE games SET analyzed_at = now() WHERE id = ? AND community_id = ?`, [gameId, communityId]
      ));
      return;
    }
    let board = rules.initBoard();
    let turn = 'r';
    const evals = [];
    for (const m of moves) {
      const fen = rules.boardToFen(board, turn);
      const line = await engineClient.bestMove({ fen, movetime: ANALYSIS_MOVETIME_MS, multipv: 1 });
      evals.push({ score_cp: line.score_cp, mate: line.mate, effScore: effectiveScore(line) });
      const applied = rules.applyMove(board, { r: m.from_r, c: m.from_c }, { r: m.to_r, c: m.to_c });
      board = applied.board;
      turn = rules.opp(turn);
    }
    const losses = computeMoveLosses(evals);
    await withActor(null, async (trx) => {
      for (let i = 0; i < moves.length; i++) {
        await trx.raw(
          `UPDATE game_moves SET eval_before_cp = ?, eval_before_mate = ?, win_loss = ? WHERE game_id = ? AND seq = ? AND community_id = ?`,
          [evals[i].score_cp, evals[i].mate, losses[i], gameId, moves[i].seq, communityId]
        );
      }
      const redLosses = losses.filter((_, i) => moves[i].side === 'r');
      const blackLosses = losses.filter((_, i) => moves[i].side === 'b');
      const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
      await trx.raw(
        `UPDATE games SET red_avg_loss = ?, black_avg_loss = ?, analyzed_at = now() WHERE id = ? AND community_id = ?`,
        [avg(redLosses), avg(blackLosses), gameId, communityId]
      );
    });
  } catch (e) {
    console.error('analyzeGame lỗi:', e);
  }
}
