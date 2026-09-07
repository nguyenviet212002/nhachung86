import { withActor } from '../../core/tx.js';
import { AppError } from '../../core/errors.js';
import { log as auditLog } from '../../core/audit.js';
import * as rules from '../games/rules.js';
import * as engineClient from '../games/engineClient.js';

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
