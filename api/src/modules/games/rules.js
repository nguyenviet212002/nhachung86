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
