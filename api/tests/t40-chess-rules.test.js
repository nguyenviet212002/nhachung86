import { describe, it, expect } from 'vitest';
import * as rules from '../src/modules/games/rules.js';

function emptyBoard() { return Array.from({ length: 10 }, () => Array(9).fill(null)); }

describe('T40 chess rules engine', () => {
  it('bàn cờ khởi tạo đủ 32 quân, đúng vị trí tướng hai bên', () => {
    const b = rules.initBoard();
    expect(b[9][4]).toEqual({ side: 'r', type: 'general' });
    expect(b[0][4]).toEqual({ side: 'b', type: 'general' });
    expect(b[6][0]).toEqual({ side: 'r', type: 'soldier' });
    expect(b.flat().filter(Boolean).length).toBe(32);
  });

  it('mã bị cản chân thì không đi được qua hướng đó', () => {
    const b = rules.initBoard();
    b[8][1] = { side: 'r', type: 'soldier' }; // chặn chân của mã đỏ ở (9,1)
    const moves = rules.legalMoves(b, 9, 1);
    expect(moves.some((m) => m.r === 7 && m.c === 0)).toBe(false);
    expect(moves.some((m) => m.r === 7 && m.c === 2)).toBe(false);
  });

  it('tượng không bao giờ qua được sông (hàng 4/5)', () => {
    const b = rules.initBoard();
    const moves = rules.legalMoves(b, 9, 2); // tượng đỏ
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((m) => m.r >= 5)).toBe(true);
  });

  it('pháo cần đúng một ngòi mới ăn được, không ăn được chính ngòi', () => {
    const b = emptyBoard();
    b[9][4] = { side: 'r', type: 'general' };
    b[0][4] = { side: 'b', type: 'general' };
    b[5][4] = { side: 'r', type: 'cannon' };
    b[3][4] = { side: 'b', type: 'soldier' }; // ngòi
    b[1][4] = { side: 'b', type: 'soldier' }; // mục tiêu, sau ngòi
    const moves = rules.legalMoves(b, 5, 4);
    expect(moves.some((m) => m.r === 1 && m.c === 4)).toBe(true);
    expect(moves.some((m) => m.r === 3 && m.c === 4)).toBe(false);
  });

  it('cấm đi để lộ mặt tướng (hai tướng đối mặt trực tiếp)', () => {
    const b = emptyBoard();
    b[9][4] = { side: 'r', type: 'general' };
    b[0][4] = { side: 'b', type: 'general' };
    b[5][4] = { side: 'r', type: 'chariot' }; // đang chắn giữa 2 tướng, cùng cột 4
    const moves = rules.legalMoves(b, 5, 4);
    expect(moves.length).toBeGreaterThan(0);
    // Bất kỳ nước nào rời khỏi cột 4 đều lộ mặt tướng — chỉ nước đi dọc
    // (giữ nguyên cột 4) mới hợp lệ.
    expect(moves.every((m) => m.c === 4)).toBe(true);
  });

  it('bắt được tướng thì applyMove trả gameOver=true, reason=bat-tuong', () => {
    const b = emptyBoard();
    b[9][4] = { side: 'r', type: 'general' };
    b[0][4] = { side: 'b', type: 'general' };
    b[1][4] = { side: 'r', type: 'chariot' };
    const res = rules.applyMove(b, { r: 1, c: 4 }, { r: 0, c: 4 });
    expect(res.gameOver).toBe(true);
    expect(res.winner).toBe('r');
    expect(res.reason).toBe('bat-tuong');
  });

  it('applyMove không sửa board gốc (trả bàn cờ mới)', () => {
    const b = rules.initBoard();
    const before = JSON.stringify(b);
    rules.applyMove(b, { r: 6, c: 0 }, { r: 5, c: 0 });
    expect(JSON.stringify(b)).toBe(before);
  });
});
