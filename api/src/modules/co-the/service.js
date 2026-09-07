import { withActor } from '../../core/tx.js';
import { AppError } from '../../core/errors.js';
import { log as auditLog } from '../../core/audit.js';
import * as rules from '../games/rules.js';
import * as engineClient from '../games/engineClient.js';
import { randomUUID } from 'node:crypto';
import { publishToGame } from '../../core/realtime.js';
import { selectAiMove } from '../games/aiSelect.js';

const NOT_FOUND = () => new AppError('NOT_FOUND', 'Không tìm thấy thế cờ này.', { status: 404 });
export const FORBIDDEN = (msg) => new AppError('FORBIDDEN', msg ?? 'Bạn không có quyền làm việc này.', { status: 403 });
export const INVALID_STATE = (msg) => new AppError('INVALID_STATE', msg, { status: 409 });

// Commit Pikafish đã chốt trong engine/Dockerfile (docs/superpowers/plans/
// 2026-09-07-sanh-co-engine-may-di-ho.md) — ghi kèm để so được lần sau
// (BAN_CHUAN_CO_THE.md §3.3/§4.4). Đổi hằng này nếu sau này build lại
// engine với commit Pikafish khác.
const ENGINE_VERSION = 'pikafish@6127307';
const ANALYZE_MOVETIME_MS = 3000;
const TIM_CACH_PHA_MOVETIME_MS = 5000;
const TIM_CACH_PHA_MULTIPV = 5;

// Đối thủ trong Cờ Thế LUÔN là máy — mức "yếu/vừa/mạnh" tái dùng ĐÚNG cơ
// chế aiSelect (BAN_CHUAN_CO_TUONG.md mục 4) nhưng ĐẢO NGƯỢC mục đích:
// "yếu" cần máy CÓ THỂ đi kém hơn nước tốt nhất để dễ cho người giải, nên
// map sang ngưỡng LỎNG NHẤT của aiSelect ('xuat-sac' — top-3, chênh<=120);
// "mạnh" map sang ngưỡng CHẶT NHẤT ('sieu' — luôn nước tốt nhất).
const OPPONENT_LEVEL_TO_AI_SELECT = { yeu: 'xuat-sac', vua: 'thong-minh', manh: 'sieu' };
const OPPONENT_MOVETIME_MS = 8000;
const OPPONENT_MULTIPV = 3;

// Dùng chung cho mọi task sau (session/phân tích) — load 1 thế, chặn cross-
// tenant bằng community_id. Export để Task 3/4/5/6/7 import thẳng, không
// viết lại truy vấn giống hệt 5 lần.
export async function loadPosition(trx, communityId, id) {
  const { rows: [row] } = await trx.raw(
    `SELECT * FROM co_the_positions WHERE id = ? AND community_id = ?`, [id, communityId]);
  if (!row) throw NOT_FOUND();
  return row;
}

export async function createPosition({ actor, board, sideToMove }) {
  const errors = rules.validatePosition(board);
  if (errors.length) throw new AppError('VALIDATION_FAILED', errors.join(' '), { status: 422, fields: { board: errors } });
  return withActor(actor.id, async (trx) => {
    const { rows: [row] } = await trx.raw(
      `INSERT INTO co_the_positions (community_id, created_by_member_id, board, side_to_move)
       VALUES (?, ?, ?::jsonb, ?) RETURNING *`,
      [actor.communityId, actor.id, JSON.stringify(board), sideToMove]
    );
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'co_the.position_created', targetType: 'co_the_position', targetId: row.id, detail: {} });
    return row;
  });
}

export async function saveToLibrary({ actor, id, label, category }) {
  return withActor(actor.id, async (trx) => {
    await loadPosition(trx, actor.communityId, id);
    const { rows: [row] } = await trx.raw(
      `UPDATE co_the_positions SET saved_to_library = true, label = ?, category = ?
        WHERE id = ? AND community_id = ? RETURNING *`,
      [label, category, id, actor.communityId]
    );
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'co_the.position_saved_to_library', targetType: 'co_the_position', targetId: id, detail: { category } });
    return row;
  });
}

export async function listPositions({ actor, origin, category, page, limit }) {
  return withActor(actor.id, async (trx) => {
    const where = ['community_id = ?', 'saved_to_library = true'];
    const params = [actor.communityId];
    if (origin) { where.push('origin = ?'); params.push(origin); }
    if (category) { where.push('category = ?'); params.push(category); }
    const clause = where.join(' AND ');
    const offset = (page - 1) * limit;
    const { rows } = await trx.raw(
      `SELECT id, label, origin, category, side_to_move, verdict, verdict_certainty, created_at
         FROM co_the_positions WHERE ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const { rows: [{ total }] } = await trx.raw(`SELECT count(*)::int AS total FROM co_the_positions WHERE ${clause}`, params);
    return { data: rows, meta: { page, limit, total } };
  });
}

export async function getPosition({ actor, id }) {
  return withActor(actor.id, (trx) => loadPosition(trx, actor.communityId, id));
}

// Đọc điểm theo bảng BAN_CHUAN_CO_THE.md §3.2. `score_cp`/`mate` PHẢI đã ở
// góc nhìn của bên được hỏi (quy ước UCI chuẩn) — hàm này không tự đổi góc
// nhìn, chỉ đọc thẳng.
//
// Quyết định (không suy ra duy nhất từ tài liệu gốc — tài liệu chỉ có 5
// mức mô tả, schema chỉ có 3 giá trị verdict): |score_cp| < 80 -> 'hoa'
// (không có đường thắng/rất có thể thế bịp); mọi mức còn lại (kể cả
// "nhỉnh hơn, chưa đủ thắng") -> 'thang'/'thua' theo dấu — vì chúng đều
// mang ưu thế thật, chỉ khác ĐỘ CHẮC CHẮN đã tách riêng ở `certainty`.
export function readVerdict({ score_cp, mate }) {
  if (mate != null && mate !== 0) return { verdict: mate > 0 ? 'thang' : 'thua', certainty: 'chung-minh' };
  if (Math.abs(score_cp) < 80) return { verdict: 'hoa', certainty: 'uoc-luong' };
  return { verdict: score_cp > 0 ? 'thang' : 'thua', certainty: 'uoc-luong' };
}

export async function analyzePosition({ actor, id }) {
  const position = await withActor(actor.id, (trx) => loadPosition(trx, actor.communityId, id));
  const fen = rules.boardToFen(position.board, position.side_to_move);
  const { score_cp, mate, depth } = await engineClient.bestMove({ fen, movetime: ANALYZE_MOVETIME_MS, multipv: 1 });
  const { verdict, certainty } = readVerdict({ score_cp, mate });
  return withActor(actor.id, async (trx) => {
    const { rows: [row] } = await trx.raw(
      `UPDATE co_the_positions SET verdict = ?, verdict_certainty = ?, verdict_score_cp = ?, verdict_mate = ?,
              verdict_depth = ?, engine_version = ?, engine_movetime_ms = ?, analyzed_at = now()
        WHERE id = ? AND community_id = ? RETURNING *`,
      [verdict, certainty, score_cp, mate, depth, ENGINE_VERSION, ANALYZE_MOVETIME_MS, id, actor.communityId]
    );
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'co_the.position_analyzed', targetType: 'co_the_position', targetId: id, detail: { verdict } });
    return row;
  });
}

// ⚔ Tìm cách phá — GIỚI HẠN THẬT (ghi rõ để không ai tưởng đây là dò toàn
// bộ cây biến): liệt kê các nước ĐẦU trong 1 lần gọi multipv=5 mà chính
// engine đã báo mate>0 (chiếu bí được), cùng đường đi (principal variation)
// engine tự trả — KHÔNG phải một cây tìm kiếm đệ quy đầy đủ.
//
// ⚠️ `so_nuoc: l.mate` GIẢ ĐỊNH quy ước UCI chuẩn (mate = SỐ NƯỚC ĐỦ, không
// phải số bán-nước) — CHƯA tự tay xác nhận với dịch vụ engine thật.
// Implementer PHẢI gọi thử /bestmove thật với 1 thế chiếu-bí-N-nước đã biết
// trước và so mate trả về với N thật trước khi tin công thức này — sửa lại
// (l.pv.length là số bán-nước, luôn có sẵn để đối chiếu) nếu sai.
export async function findRefutationPaths({ actor, id }) {
  const position = await withActor(actor.id, (trx) => loadPosition(trx, actor.communityId, id));
  const fen = rules.boardToFen(position.board, position.side_to_move);
  const { lines } = await engineClient.bestMove({ fen, movetime: TIM_CACH_PHA_MOVETIME_MS, multipv: TIM_CACH_PHA_MULTIPV });
  const duong = (lines ?? [])
    .filter((l) => l.mate != null && l.mate > 0)
    .sort((a, b) => a.mate - b.mate)
    .map((l) => ({ first_move: l.move, so_nuoc: l.mate, duong_di: l.pv }));
  return { co_duong_thang: duong.length > 0, duong };
}

export async function loadSession(trx, communityId, id) {
  const { rows: [row] } = await trx.raw(`SELECT * FROM co_the_sessions WHERE id = ? AND community_id = ?`, [id, communityId]);
  if (!row) throw NOT_FOUND();
  return row;
}

export async function createSession({ actor, positionId, mode, opponentLevel, luyenTheCap }) {
  const position = await withActor(actor.id, (trx) => loadPosition(trx, actor.communityId, positionId));
  if (mode === 'giai' && !opponentLevel) throw new AppError('VALIDATION_FAILED', 'Cần chọn trình độ bên chống.', { status: 422 });
  if (mode === 'luyen-the' && !luyenTheCap) throw new AppError('VALIDATION_FAILED', 'Cần chọn cấp Luyện Thế.', { status: 422 });
  return withActor(actor.id, async (trx) => {
    const { rows: [row] } = await trx.raw(
      `INSERT INTO co_the_sessions (community_id, position_id, solver_member_id, solver_side, mode,
              opponent_level, luyen_the_cap, board, turn)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?) RETURNING *`,
      [actor.communityId, positionId, actor.id, position.side_to_move, mode,
       opponentLevel, luyenTheCap, JSON.stringify(position.board), position.side_to_move]
    );
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'co_the.session_started', targetType: 'co_the_session', targetId: row.id, detail: { mode } });
    return row;
  });
}

// Áp 1 nước + tính lại chiếu bí/hết nước đi/lặp thế/60 nước — TÁI DÙNG y
// hệt logic games/service.js move() (không viết luật lần hai), chỉ đổi
// bảng nguồn (co_the_moves thay game_moves). `board`/`turn`/`id`/
// `community_id` đọc từ `state` truyền vào (không phải luôn là session gốc
// — lần gọi thứ 2 trong move() dưới đây truyền STATE ĐÃ CẬP NHẬT sau nước
// của người giải, không phải session ban đầu).
async function applyOneMove(trx, state, side, from, to) {
  const piece = state.board[from.r]?.[from.c];
  if (!piece || piece.side !== side) throw new AppError('VALIDATION_FAILED', 'Ô xuất phát không có quân của bên này.', { status: 422 });
  const legal = rules.legalMoves(state.board, from.r, from.c);
  if (!legal.some((m) => m.r === to.r && m.c === to.c)) throw new AppError('VALIDATION_FAILED', 'Nước đi không hợp lệ.', { status: 422 });
  const applied = rules.applyMove(state.board, from, to);
  const { rows: pastMoves } = await trx.raw(
    `SELECT side, is_check AS "isCheck", captured_type IS NOT NULL AS captured, board_hash AS "boardHash"
       FROM co_the_moves WHERE session_id = ? ORDER BY seq ASC`, [state.id]);
  const newTurnIfContinuing = rules.opp(side);
  let gameOver = applied.gameOver, winner = applied.winner, reason = applied.reason;
  const newHash = rules.hashBoard(applied.board, gameOver ? state.turn : newTurnIfContinuing);
  const moveHistory = [...pastMoves, { side, isCheck: applied.checkOpp, captured: !!applied.captured, boardHash: newHash }];
  if (!gameOver) {
    const rep = rules.detectRepetition(moveHistory);
    if (rep) { gameOver = true; reason = rep.reason; winner = rep.loser ? rules.opp(rep.loser) : null; }
    else if (rules.detectNoCaptureDraw(moveHistory)) { gameOver = true; reason = 'hoa-60-nuoc'; winner = null; }
  }
  const newTurn = gameOver ? state.turn : newTurnIfContinuing;
  const { rows: [seqRow] } = await trx.raw(`SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM co_the_moves WHERE session_id = ?`, [state.id]);
  await trx.raw(
    `INSERT INTO co_the_moves (community_id, session_id, seq, side, from_r, from_c, to_r, to_c, captured_type, is_check, board_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [state.community_id, state.id, seqRow.seq, side, from.r, from.c, to.r, to.c,
     applied.captured?.type ?? null, applied.checkOpp, newHash]);
  return { board: applied.board, turn: newTurn, gameOver, winner, reason };
}

// Người giải đi 1 nước. Nếu ván chưa xong VÀ mode='giai', máy (Đối thủ) đáp
// lễ NGAY TRONG CÙNG request — khác hẳn `maybeAutoMove` của games (không
// fire-and-forget): Cờ Thế không có đồng hồ/đối thủ người thật cần thông
// báo riêng, và movetime của Đối thủ (8s) là phần chờ NGƯỜI GIẢI đang chủ
// động đợi, không phải chặn oan một request của người khác.
export async function move({ actor, id, from, to }) {
  const result = await withActor(actor.id, async (trx) => {
    const session = await loadSession(trx, actor.communityId, id);
    if (session.status !== 'dang-choi') throw INVALID_STATE('Ván này không còn đang chơi.');
    if (session.mode !== 'giai') throw INVALID_STATE('Ván luyện thế không đi từng nước tay — dùng /luyen-the/chay.');
    if (session.solver_member_id !== actor.id) throw FORBIDDEN('Bạn không phải người giải ván này.');
    if (session.turn !== session.solver_side) throw FORBIDDEN('Chưa tới lượt bạn.');

    let step = await applyOneMove(trx, session, session.solver_side, from, to);
    let cur = { ...session, board: step.board, turn: step.turn };

    if (!step.gameOver) {
      const fen = rules.boardToFen(cur.board, cur.turn);
      const { lines } = await engineClient.bestMove({ fen, movetime: OPPONENT_MOVETIME_MS, multipv: OPPONENT_MULTIPV });
      if (lines?.length) {
        const chosenUci = selectAiMove(lines, OPPONENT_LEVEL_TO_AI_SELECT[session.opponent_level]);
        if (chosenUci) {
          const oppSide = rules.opp(session.solver_side);
          const { from: oFrom, to: oTo } = rules.uciMoveToCells(chosenUci);
          step = await applyOneMove(trx, cur, oppSide, oFrom, oTo);
          cur = { ...cur, board: step.board, turn: step.turn };
        }
      }
    }

    const finished = step.gameOver;
    const outcome = !finished ? null : !step.winner ? 'hoa' : step.winner === session.solver_side ? 'thang' : 'thua';
    const { rows: [row] } = await trx.raw(
      `UPDATE co_the_sessions SET board = ?::jsonb, turn = ?, status = ?, result = ?, end_reason = ?, ended_at = ?
        WHERE id = ? AND status = 'dang-choi' RETURNING *`,
      [JSON.stringify(cur.board), cur.turn, finished ? 'ket-thuc' : 'dang-choi', outcome, finished ? step.reason : null,
       finished ? new Date() : null, id]
    );
    if (!row) throw INVALID_STATE('Ván này không còn đang chơi.');
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'co_the.move', targetType: 'co_the_session', targetId: id,
      detail: { from_r: from.r, from_c: from.c, to_r: to.r, to_c: to.c } });
    return row;
  });
  publishToGame(id, 'move', { board: result.board, turn: result.turn, status: result.status });
  if (result.status === 'ket-thuc') {
    publishToGame(id, 'session_end', { result: result.result, reason: result.end_reason });
    scoreSessionMoves({ communityId: actor.communityId, sessionId: id }).catch((e) => console.error('scoreSessionMoves lỗi:', e));
  }
  return result;
}

export async function hint({ actor, id }) {
  const session = await withActor(actor.id, (trx) => loadSession(trx, actor.communityId, id));
  if (session.solver_member_id !== actor.id) throw FORBIDDEN('Bạn không phải người giải ván này.');
  if (session.status !== 'dang-choi') throw INVALID_STATE('Ván này không còn đang chơi.');
  const fen = rules.boardToFen(session.board, session.turn);
  const { bestmove } = await engineClient.bestMove({ fen, movetime: ANALYZE_MOVETIME_MS, multipv: 1 });
  return { move: bestmove, ...rules.uciMoveToCells(bestmove) };
}

export async function giveUp({ actor, id }) {
  const result = await withActor(actor.id, async (trx) => {
    const session = await loadSession(trx, actor.communityId, id);
    if (session.solver_member_id !== actor.id) throw FORBIDDEN('Bạn không phải người giải ván này.');
    if (session.status !== 'dang-choi') throw INVALID_STATE('Ván này không còn đang chơi.');
    const { rows: [row] } = await trx.raw(
      `UPDATE co_the_sessions SET status = 'ket-thuc', result = 'thua', end_reason = 'bo-cuoc', ended_at = now()
        WHERE id = ? AND status = 'dang-choi' RETURNING *`, [id]);
    if (!row) throw INVALID_STATE('Ván này không còn đang chơi.');
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'co_the.give_up', targetType: 'co_the_session', targetId: id, detail: {} });
    return row;
  });
  publishToGame(id, 'session_end', { result: 'thua', reason: 'bo-cuoc' });
  scoreSessionMoves({ communityId: actor.communityId, sessionId: id }).catch((e) => console.error('scoreSessionMoves lỗi:', e));
  return result;
}

export async function getSession({ actor, id }) {
  return withActor(actor.id, async (trx) => {
    const session = await loadSession(trx, actor.communityId, id);
    if (session.solver_member_id !== actor.id) throw FORBIDDEN('Bạn không phải người giải ván này.');
    const { rows: moves } = await trx.raw(
      `SELECT seq, side, from_r, from_c, to_r, to_c, captured_type, is_check, created_at
         FROM co_the_moves WHERE session_id = ? ORDER BY seq ASC`, [id]);
    return { ...session, moves };
  });
}

// Chấm điểm từng nước NGƯỜI GIẢI đã đi, chạy NỀN sau khi ván kết thúc —
// TÁI DÙNG đúng khuôn `maybeAutoMove` của games/service.js: gọi bằng
// `.catch(...)` ở nơi gọi, không await. Nhiều lần gọi engine (một lần mỗi
// nước TRỪ nước đầu) nên KHÔNG được chặn response của move() cuối cùng —
// làm nền là bắt buộc, không phải lựa chọn phong cách.
//
// `co_the_moves` của MỖI nước NGƯỜI GIẢI đi lưu điểm của thế cờ NGAY TRƯỚC
// nước đó (không phải sau) — luôn ở góc nhìn người giải, nên so trực tiếp
// với `position.verdict_score_cp` (cùng góc nhìn) không cần đổi dấu ở đâu
// cả. Nước đầu tiên của người giải TRÙNG với chính thế gốc — không gọi
// engine lại, chỉ copy `position.verdict_score_cp`/`verdict_mate`.
async function scoreSessionMoves({ communityId, sessionId }) {
  const { position, fullMoves } = await withActor(null, async (trx) => {
    const session = await loadSession(trx, communityId, sessionId);
    const position = await loadPosition(trx, communityId, session.position_id);
    const { rows: fullMoves } = await trx.raw(
      `SELECT id, seq, side, from_r, from_c, to_r, to_c FROM co_the_moves WHERE session_id = ? ORDER BY seq ASC`,
      [sessionId]
    );
    return { position, fullMoves };
  });
  if (position.verdict_certainty !== 'chung-minh') return; // chỉ chấm được thế đã CHỨNG MINH

  let board = position.board;
  let solverMoveIndex = 0;
  for (const mv of fullMoves) {
    if (mv.side === position.side_to_move) {
      solverMoveIndex++;
      let score_cp, mate;
      if (solverMoveIndex === 1) {
        score_cp = position.verdict_score_cp;
        mate = position.verdict_mate;
      } else {
        const fen = rules.boardToFen(board, position.side_to_move);
        try {
          const r = await engineClient.bestMove({ fen, movetime: ANALYZE_MOVETIME_MS, multipv: 1 });
          score_cp = r.score_cp; mate = r.mate;
        } catch (e) {
          console.error('mổ ván lỗi tại nước', mv.seq, e);
          score_cp = null; mate = null;
        }
      }
      await withActor(null, (trx) => trx.raw(`UPDATE co_the_moves SET score_cp = ?, mate = ? WHERE id = ?`, [score_cp, mate, mv.id]));
    }
    board = rules.applyMove(board, { r: mv.from_r, c: mv.from_c }, { r: mv.to_r, c: mv.to_c }).board;
  }
}

export async function getMoVan({ actor, id }) {
  return withActor(actor.id, async (trx) => {
    const session = await loadSession(trx, actor.communityId, id);
    if (session.solver_member_id !== actor.id) throw FORBIDDEN('Bạn không phải người giải ván này.');
    if (session.status !== 'ket-thuc') throw INVALID_STATE('Ván chưa kết thúc.');
    const position = await loadPosition(trx, actor.communityId, session.position_id);
    if (position.verdict_certainty !== 'chung-minh') {
      return { available: false, reason: 'Thế này chưa có kết quả CHỨNG MINH nên không chấm giữ/mất thắng được.' };
    }
    const { rows: solverMoves } = await trx.raw(
      `SELECT seq, from_r, from_c, to_r, to_c, score_cp, mate FROM co_the_moves
        WHERE session_id = ? AND side = ? ORDER BY seq ASC`, [id, position.side_to_move]
    );
    if (solverMoves.length && solverMoves.some((m) => m.score_cp == null && m.mate == null)) {
      return { available: false, reason: 'Đang chấm điểm từng nước, thử lại sau ít phút.' };
    }
    const tenVerdict = { thang: 'thắng', hoa: 'hoà', thua: 'thua' };
    const danhGia = solverMoves.map((m) => {
      const { verdict } = readVerdict({ score_cp: m.score_cp, mate: m.mate });
      const giuThe = verdict === position.verdict;
      return {
        seq: m.seq, from: { r: m.from_r, c: m.from_c }, to: { r: m.to_r, c: m.to_c },
        score_cp: m.score_cp, mate: m.mate, giu_the: giuThe,
        dien_giai: giuThe
          ? `Vẫn giữ thế ${tenVerdict[position.verdict]}.`
          : `Đánh mất thế ${tenVerdict[position.verdict]} đã chứng minh — thế đổi sang ${tenVerdict[verdict]}.`,
      };
    });
    return { available: true, moves: danhGia };
  });
}

const LUYEN_THE_N_VAN = 8;
const LUYEN_THE_MOVETIME_MS = 3000;
const LUYEN_THE_MAX_PLIES = 200; // sàn an toàn — không để 1 ván mô phỏng chạy vô hạn

export async function runLuyenThe({ actor, id }) {
  const session = await withActor(actor.id, (trx) => loadSession(trx, actor.communityId, id));
  if (session.solver_member_id !== actor.id) throw FORBIDDEN('Bạn không phải người giải ván này.');
  if (session.mode !== 'luyen-the') throw INVALID_STATE('Ván này không phải chế độ Luyện Thế.');
  if (session.status !== 'dang-choi') throw INVALID_STATE('Ván này đã kết thúc.');
  runLuyenTheBackground({ communityId: actor.communityId, session }).catch((e) => console.error('luyện thế lỗi:', e));
  return { started: true };
}

async function simulateOneGame(session) {
  let board = session.board, turn = session.turn, moves = [], history = [];
  let gameOver = false, winner = null;
  while (!gameOver && moves.length < LUYEN_THE_MAX_PLIES) {
    const fen = rules.boardToFen(board, turn);
    const { lines } = await engineClient.bestMove({ fen, movetime: LUYEN_THE_MOVETIME_MS, multipv: 3 });
    if (!lines?.length) break;
    const level = turn === session.solver_side ? 'sieu' : 'xuat-sac';
    const chosenUci = selectAiMove(lines, level, Math.random);
    if (!chosenUci) break;
    const { from, to } = rules.uciMoveToCells(chosenUci);
    const applied = rules.applyMove(board, from, to);
    const newHash = rules.hashBoard(applied.board, applied.gameOver ? turn : rules.opp(turn));
    history.push({ side: turn, isCheck: applied.checkOpp, captured: !!applied.captured, boardHash: newHash });
    moves.push({ side: turn, uci: chosenUci });
    board = applied.board; gameOver = applied.gameOver; winner = applied.winner;
    if (!gameOver) {
      const rep = rules.detectRepetition(history);
      if (rep) { gameOver = true; winner = rep.loser ? rules.opp(rep.loser) : null; }
      else if (rules.detectNoCaptureDraw(history)) { gameOver = true; winner = null; }
    }
    turn = gameOver ? turn : rules.opp(turn);
  }
  const result = !winner ? 'hoa' : winner === session.solver_side ? 'thang' : 'thua';
  return { moves, result };
}

async function runLuyenTheBackground({ communityId, session }) {
  const results = [];
  for (let i = 0; i < LUYEN_THE_N_VAN; i++) results.push(await simulateOneGame(session));

  const grouped = new Map();
  for (const g of results) {
    const first = g.moves.find((m) => m.side === session.solver_side);
    if (!first) continue;
    const cur = grouped.get(first.uci) ?? { count: 0, wins: 0, totalLen: 0 };
    cur.count++; if (g.result === 'thang') cur.wins++; cur.totalLen += g.moves.length;
    grouped.set(first.uci, cur);
  }
  const candidates = [...grouped.entries()].map(([first_move, s]) => ({
    first_move, ti_le_thanh_cong: s.wins / s.count, so_nuoc_trung_binh: s.totalLen / s.count, so_van: s.count,
  }));
  const thanhCong100 = candidates.filter((c) => c.ti_le_thanh_cong === 1);
  const ha = [...(thanhCong100.length ? thanhCong100 : candidates)]
    .sort((a, b) => a.so_nuoc_trung_binh - b.so_nuoc_trung_binh)[0] ?? null;
  const cao = [...candidates].sort((a, b) => b.ti_le_thanh_cong - a.ti_le_thanh_cong || a.so_nuoc_trung_binh - b.so_nuoc_trung_binh)[0] ?? null;
  const trung = candidates
    .filter((c) => c !== ha && c !== cao)
    .sort((a, b) => (b.ti_le_thanh_cong / b.so_nuoc_trung_binh) - (a.ti_le_thanh_cong / a.so_nuoc_trung_binh))[0]
    ?? cao ?? ha;

  await withActor(null, (trx) => trx.raw(
    `UPDATE co_the_sessions SET status = 'ket-thuc', end_reason = 'luyen-the-xong', ended_at = now()
      WHERE id = ? AND status = 'dang-choi'`,
    [session.id]
  ));
  publishToGame(session.id, 'luyen_the_done', { ha, trung, cao, tong_so_van: results.length });
}

export async function listMySessions({ actor, page, limit }) {
  return withActor(actor.id, async (trx) => {
    const offset = (page - 1) * limit;
    const { rows } = await trx.raw(
      `SELECT s.id, s.position_id, s.mode, s.status, s.result, s.end_reason, s.created_at, s.ended_at,
              p.label, p.category
         FROM co_the_sessions s JOIN co_the_positions p ON p.id = s.position_id
        WHERE s.community_id = ? AND s.solver_member_id = ?
        ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
      [actor.communityId, actor.id, limit, offset]
    );
    const { rows: [{ total }] } = await trx.raw(
      `SELECT count(*)::int AS total FROM co_the_sessions WHERE community_id = ? AND solver_member_id = ?`,
      [actor.communityId, actor.id]
    );
    return { data: rows, meta: { page, limit, total } };
  });
}

export async function createInvite({ actor, id }) {
  return withActor(actor.id, async (trx) => {
    const session = await loadSession(trx, actor.communityId, id);
    if (session.solver_member_id !== actor.id) throw FORBIDDEN('Bạn không phải người giải ván này.');
    if (session.invite_token) return { invite_token: session.invite_token };
    const token = randomUUID();
    await trx.raw(`UPDATE co_the_sessions SET invite_token = ? WHERE id = ?`, [token, id]);
    return { invite_token: token };
  });
}

export async function guestJoin({ rawToken }) {
  return withActor(null, async (trx) => {
    const { rows: [session] } = await trx.raw(`SELECT id FROM co_the_sessions WHERE invite_token = ?`, [rawToken]);
    if (!session) throw NOT_FOUND();
    const guestToken = randomUUID();
    await trx.raw(`UPDATE co_the_sessions SET guest_token = ? WHERE id = ?`, [guestToken, session.id]);
    return { session_id: session.id, guest_token: guestToken };
  });
}

// Dữ liệu RÚT GỌN cho khách — CHỈ bàn cờ/lượt/trạng thái/nhật ký (spec mục
// 5: 6 khối riêng tư — Phân tích/Đối thủ/trình độ/Tìm cách phá/Đường
// giải/Diễn giải — KHÔNG BAO GIỜ có trong response này).
export async function getGuestView({ rawToken, guestToken }) {
  return withActor(null, async (trx) => {
    const { rows: [session] } = await trx.raw(
      `SELECT id, board, turn, status, result, guest_token FROM co_the_sessions WHERE invite_token = ?`, [rawToken]
    );
    if (!session || !guestToken || session.guest_token !== guestToken) {
      throw new AppError('UNAUTHENTICATED', 'Cần vào đúng bằng link mời.', { status: 401 });
    }
    const { rows: moves } = await trx.raw(
      `SELECT seq, side, from_r, from_c, to_r, to_c, captured_type FROM co_the_moves WHERE session_id = ? ORDER BY seq ASC`,
      [session.id]
    );
    const { guest_token, ...safeSession } = session;
    return { ...safeSession, moves };
  });
}

// Dùng ở route /stream — trả session_id (không lộ gì khác) sau khi xác
// thực guest_token đúng, để route mở SSE subscribe đúng kênh.
export async function assertGuestVisible({ rawToken, guestToken }) {
  const { rows: [session] } = await withActor(null, (trx) =>
    trx.raw(`SELECT id, guest_token FROM co_the_sessions WHERE invite_token = ?`, [rawToken]));
  if (!session || !guestToken || session.guest_token !== guestToken) {
    throw new AppError('UNAUTHENTICATED', 'Cần vào đúng bằng link mời.', { status: 401 });
  }
  return { sessionId: session.id };
}
