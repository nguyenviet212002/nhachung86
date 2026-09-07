// Engine cờ tướng (Xiangqi) — hàm thuần, không đụng CSDL/DOM. Port CHÍNH XÁC
// từ khối "ENGINE CỜ TƯỚNG" trong web/thiet-ke-moi.html (hàm xqInitBoard,
// xqRawMoves, xqLegalMoves, xqApplyMove, ...) — sửa luật ở một bên thì soát
// lại bên kia có cần sửa theo không (xem spec mục 4).
// Bàn cờ: board[r][c], r=0..9, c=0..8. r=0 là hàng trên cùng (Đen), r=9 là
// hàng dưới cùng (Đỏ). Sông giữa r=4 và r=5.
// Quân: {side:'r'|'b', type:'general'|'advisor'|'elephant'|'horse'|'chariot'|'cannon'|'soldier'}

export function initBoard() {
  const b = Array.from({ length: 10 }, () => Array(9).fill(null));
  const back = ['chariot', 'horse', 'elephant', 'advisor', 'general', 'advisor', 'elephant', 'horse', 'chariot'];
  back.forEach((t, c) => { b[0][c] = { side: 'b', type: t }; b[9][c] = { side: 'r', type: t }; });
  b[2][1] = { side: 'b', type: 'cannon' }; b[2][7] = { side: 'b', type: 'cannon' };
  b[7][1] = { side: 'r', type: 'cannon' }; b[7][7] = { side: 'r', type: 'cannon' };
  [0, 2, 4, 6, 8].forEach((c) => { b[3][c] = { side: 'b', type: 'soldier' }; b[6][c] = { side: 'r', type: 'soldier' }; });
  return b;
}
export function clone(board) { return board.map((row) => row.map((p) => (p ? { ...p } : null))); }
export function onBoard(r, c) { return r >= 0 && r < 10 && c >= 0 && c < 9; }
export function opp(side) { return side === 'r' ? 'b' : 'r'; }

/* nước đi "thô" của 1 quân — chưa lọc theo luật chiếu tướng/lộ mặt tướng */
export function rawMoves(board, r, c) {
  const p = board[r][c];
  if (!p) return [];
  const side = p.side, oppSide = opp(side), out = [];
  const add = (nr, nc) => { if (!onBoard(nr, nc)) return; const t = board[nr][nc]; if (!t || t.side === oppSide) out.push({ r: nr, c: nc }); };
  const palaceRows = side === 'r' ? [7, 8, 9] : [0, 1, 2];
  const inPalace = (rr, cc) => palaceRows.includes(rr) && cc >= 3 && cc <= 5;
  const ownSideRows = side === 'r' ? [5, 6, 7, 8, 9] : [0, 1, 2, 3, 4];

  if (p.type === 'general') {
    [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(([dr, dc]) => { const nr = r + dr, nc = c + dc; if (inPalace(nr, nc)) add(nr, nc); });
  } else if (p.type === 'advisor') {
    [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([dr, dc]) => { const nr = r + dr, nc = c + dc; if (inPalace(nr, nc)) add(nr, nc); });
  } else if (p.type === 'elephant') {
    [[-2, -2], [-2, 2], [2, -2], [2, 2]].forEach(([dr, dc]) => {
      const nr = r + dr, nc = c + dc, er = r + dr / 2, ec = c + dc / 2;
      if (onBoard(nr, nc) && ownSideRows.includes(nr) && !board[er][ec]) add(nr, nc);
    });
  } else if (p.type === 'horse') {
    [[-1, 0, -2, -1], [-1, 0, -2, 1], [1, 0, 2, -1], [1, 0, 2, 1], [0, -1, -1, -2], [0, 1, -1, 2], [0, -1, 1, -2], [0, 1, 1, 2]]
      .forEach(([legR, legC, dr, dc]) => { if (onBoard(r + legR, c + legC) && !board[r + legR][c + legC]) add(r + dr, c + dc); });
  } else if (p.type === 'chariot') {
    [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(([dr, dc]) => {
      let nr = r + dr, nc = c + dc;
      while (onBoard(nr, nc)) {
        const t = board[nr][nc];
        if (!t) { out.push({ r: nr, c: nc }); } else { if (t.side === oppSide) out.push({ r: nr, c: nc }); break; }
        nr += dr; nc += dc;
      }
    });
  } else if (p.type === 'cannon') {
    [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(([dr, dc]) => {
      let nr = r + dr, nc = c + dc, screen = false;
      while (onBoard(nr, nc)) {
        const t = board[nr][nc];
        if (!screen) { if (!t) out.push({ r: nr, c: nc }); else screen = true; }
        else if (t) { if (t.side === oppSide) out.push({ r: nr, c: nc }); break; }
        nr += dr; nc += dc;
      }
    });
  } else if (p.type === 'soldier') {
    const fwd = side === 'r' ? -1 : 1;
    const crossed = side === 'r' ? r <= 4 : r >= 5;
    add(r + fwd, c);
    if (crossed) { add(r, c - 1); add(r, c + 1); }
  }
  return out;
}

export function findGeneral(board, side) {
  for (let r = 0; r < 10; r++) for (let c = 0; c < 9; c++) { const p = board[r][c]; if (p && p.side === side && p.type === 'general') return { r, c }; }
  return null;
}
export function squareAttacked(board, r, c, bySide) {
  for (let rr = 0; rr < 10; rr++) for (let cc = 0; cc < 9; cc++) {
    const p = board[rr][cc];
    if (p && p.side === bySide && rawMoves(board, rr, cc).some((m) => m.r === r && m.c === c)) return true;
  }
  return false;
}
export function flyingGeneral(board) {
  const gr = findGeneral(board, 'r'), gb = findGeneral(board, 'b');
  if (!gr || !gb || gr.c !== gb.c) return false;
  const c = gr.c;
  for (let r = Math.min(gr.r, gb.r) + 1; r < Math.max(gr.r, gb.r); r++) if (board[r][c]) return false;
  return true;
}
export function inCheck(board, side) {
  const g = findGeneral(board, side);
  if (!g) return true;
  return squareAttacked(board, g.r, g.c, opp(side));
}
/* nước đi HỢP LỆ của 1 quân — đã lọc: không được để tướng mình bị chiếu, không lộ mặt tướng */
export function legalMoves(board, r, c) {
  const p = board[r][c]; if (!p) return [];
  return rawMoves(board, r, c).filter((m) => {
    const nb = clone(board);
    nb[m.r][m.c] = nb[r][c]; nb[r][c] = null;
    if (flyingGeneral(nb)) return false;
    if (inCheck(nb, p.side)) return false;
    return true;
  });
}
export function sideHasMoves(board, side) {
  for (let r = 0; r < 10; r++) for (let c = 0; c < 9; c++) {
    const p = board[r][c];
    if (p && p.side === side && legalMoves(board, r, c).length) return true;
  }
  return false;
}
/* áp 1 nước đi, trả về {board, captured, checkOpp, gameOver, winner, reason} */
export function applyMove(board, from, to) {
  const nb = clone(board);
  const mover = nb[from.r][from.c];
  const captured = nb[to.r][to.c];
  nb[to.r][to.c] = mover; nb[from.r][from.c] = null;
  const oppSide = opp(mover.side);
  const checkOpp = inCheck(nb, oppSide);
  const oppHasMoves = sideHasMoves(nb, oppSide);
  let gameOver = false, winner = null, reason = null;
  if (captured && captured.type === 'general') { gameOver = true; winner = mover.side; reason = 'bat-tuong'; }
  else if (!oppHasMoves) { gameOver = true; winner = mover.side; reason = checkOpp ? 'chieu-bi' : 'het-nuoc-di'; }
  return { board: nb, captured, checkOpp, gameOver, winner, reason };
}

const PIECE_CODE = { general: 'ge', advisor: 'ad', elephant: 'el', horse: 'ho', chariot: 'ch', cannon: 'ca', soldier: 'so' };
// Khoá chuẩn hoá 1 thế cờ + lượt đi, dùng đếm số lần lặp thế (mục 3 spec
// Kernel/Engine). KHÔNG phải băm mật mã — chuỗi so bằng trực tiếp được, tránh
// hẳn rủi ro đụng độ băm thay vì phải chọn thuật toán "đủ tốt".
export function hashBoard(board, turn) {
  let out = '';
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const p = board[r][c];
      out += p ? p.side + PIECE_CODE[p.type] : '...';
    }
  }
  return out + '#' + turn;
}

// Ba luật Kernel còn thiếu (mục 3 spec Kernel/Engine). Cả hai hàm THUẦN — nhận
// lịch sử nước đã áp (đã gồm nước vừa xong ở cuối mảng), không tự đọc CSDL.

// Đếm boardHash mới nhất đã xuất hiện bao nhiêu lần. Lần thứ 3 → xét chu kỳ
// lặp (dải nước giữa 2 lần xuất hiện gần nhất) để phân biệt hoà thường và
// trường chiếu: một bên chiếu ở MỌI nước của chính bên đó suốt chu kỳ thì bên
// đó thua, không phải hoà. Cả hai bên cùng chiếu liên tục (hiếm, spec gốc
// không nói rõ) — xử hoà làm mặc định an toàn.
export function detectRepetition(moveHistory) {
  const n = moveHistory.length;
  if (n === 0) return null;
  const latestHash = moveHistory[n - 1].boardHash;
  const occurrenceIdx = [];
  for (let i = 0; i < n; i++) if (moveHistory[i].boardHash === latestHash) occurrenceIdx.push(i);
  if (occurrenceIdx.length < 3) return null;

  const cycleStart = occurrenceIdx[occurrenceIdx.length - 2] + 1;
  const cycleEnd = occurrenceIdx[occurrenceIdx.length - 1];
  const cycleMoves = moveHistory.slice(cycleStart, cycleEnd + 1);

  const checksEveryOwnMove = (side) => {
    const own = cycleMoves.filter((mv) => mv.side === side);
    return own.length > 0 && own.every((mv) => mv.isCheck);
  };
  const redPerpetual = checksEveryOwnMove('r');
  const blackPerpetual = checksEveryOwnMove('b');
  if (redPerpetual && !blackPerpetual) return { reason: 'truong-chieu', loser: 'r' };
  if (blackPerpetual && !redPerpetual) return { reason: 'truong-chieu', loser: 'b' };
  return { reason: 'hoa-3-lan', loser: null };
}

// GIOI_HAN_60 = 120 bán nước không ăn quân (đúng số đo trong spec Kernel/Engine).
export const GIOI_HAN_60 = 120;
export function detectNoCaptureDraw(moveHistory) {
  let streak = 0;
  for (let i = moveHistory.length - 1; i >= 0; i--) {
    if (moveHistory[i].captured) break;
    streak++;
  }
  return streak >= GIOI_HAN_60;
}

// Đổi bàn cờ nội bộ + lượt đi sang FEN cho dịch vụ engine (Pikafish qua UCI,
// mục 6 spec Kernel/Engine). Quy ước ĐÃ XÁC NHẬN trực tiếp từ mã nguồn
// Pikafish (uci.cpp UCIEngine::square, position.cpp Position::set): chữ quân
// hoa=Đỏ/thường=Đen theo bảng " RACPNBK racpnbk"; FEN liệt kê hàng TRÊN CÙNG
// (Đen, board[0]) trước, hàng DƯỚI CÙNG (Đỏ, board[9]) sau; lượt 'w'=Đỏ,
// 'b'=Đen. KHÔNG suy diễn quy ước này từ cờ vua hay từ FEN cờ tướng "phổ biến"
// khác — Pikafish tự định nghĩa quy ước riêng, đọc mã của chính nó, đừng đoán.
const PIECE_TO_FEN = {
  general: 'k', advisor: 'a', elephant: 'b', horse: 'n',
  chariot: 'r', cannon: 'c', soldier: 'p',
};
export function boardToFen(board, turn) {
  const rows = [];
  for (let r = 0; r < 10; r++) {
    let row = '', empty = 0;
    for (let c = 0; c < 9; c++) {
      const p = board[r][c];
      if (!p) { empty++; continue; }
      if (empty) { row += empty; empty = 0; }
      const ch = PIECE_TO_FEN[p.type];
      row += p.side === 'r' ? ch.toUpperCase() : ch;
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return `${rows.join('/')} ${turn === 'r' ? 'w' : 'b'} - - 0 1`;
}

// Ngược lại: một nước UCI dạng "h2e2" (ô đi + ô đến, mỗi ô = chữ cột 'a'-'i'
// + MỘT chữ số hàng '0'-'9', KHÔNG phải 2 chữ số) sang {from:{r,c},to:{r,c}}.
// square(s) = 'a'+file, '0'+rank; rank chạy 9 (hàng trên, Đen) xuống 0 (hàng
// dưới, Đỏ) — nghịch đảo trực tiếp của boardToFen ở trên: r = 9 - rank.
function squareToCell(sq) {
  const c = sq.charCodeAt(0) - 97; // 'a' -> 0
  const r = 9 - Number(sq[1]);
  return { r, c };
}
export function uciMoveToCells(uciMove) {
  return { from: squareToCell(uciMove.slice(0, 2)), to: squareToCell(uciMove.slice(2, 4)) };
}

// Kiểm hợp lệ một thế cờ trước khi cho chốt/vào trận (dùng cho module
// co-the — BAN_CHUAN_CO_THE.md §5: fail-closed, thiếu quân thì chặn).
// Trả mảng lỗi tiếng Việt CÓ DẤU đầy đủ (rỗng = hợp lệ) — trả HẾT lỗi tìm
// được cùng lúc, không dừng ở lỗi đầu, để người soạn sửa một lần.
export function validatePosition(board) {
  const errors = [];
  if (!findGeneral(board, 'r')) errors.push('Thiếu Tướng bên Đỏ.');
  if (!findGeneral(board, 'b')) errors.push('Thiếu Tướng bên Đen.');
  if (flyingGeneral(board)) errors.push('Hai Tướng đối mặt trực tiếp — không hợp lệ.');
  return errors;
}
