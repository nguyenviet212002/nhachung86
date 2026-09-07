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

describe('T40 hashBoard', () => {
  it('cùng thế cờ + cùng lượt cho cùng 1 khoá', () => {
    const b1 = rules.initBoard();
    const b2 = rules.initBoard();
    expect(rules.hashBoard(b1, 'r')).toBe(rules.hashBoard(b2, 'r'));
  });

  it('khác lượt đi thì khoá khác nhau dù cùng thế cờ', () => {
    const b = rules.initBoard();
    expect(rules.hashBoard(b, 'r')).not.toBe(rules.hashBoard(b, 'b'));
  });

  it('đổi vị trí 1 quân thì khoá đổi theo', () => {
    const b1 = rules.initBoard();
    const b2 = rules.clone(b1);
    b2[6][0] = null;
    b2[5][0] = { side: 'r', type: 'soldier' };
    expect(rules.hashBoard(b1, 'r')).not.toBe(rules.hashBoard(b2, 'r'));
  });
});

describe('T40 detectRepetition / detectNoCaptureDraw', () => {
  const m = (side, isCheck, boardHash, captured = false) => ({ side, isCheck, captured, boardHash });

  it('boardHash mới nhất mới xuất hiện 2 lần thì chưa tính là lặp', () => {
    const h = [m('r', false, 'A'), m('b', false, 'B'), m('r', false, 'A')];
    expect(rules.detectRepetition(h)).toBe(null);
  });

  it('lặp lần 3, không bên nào chiếu liên tục trong chu kỳ → hoà', () => {
    const h = [
      m('r', false, 'start'),
      m('b', false, 'B1'),
      m('r', false, 'C1'),
      m('b', false, 'start'),
      m('r', false, 'C1'),
      m('b', false, 'start'),
    ];
    expect(rules.detectRepetition(h)).toEqual({ reason: 'hoa-3-lan', loser: null });
  });

  it('lặp lần 3, đúng 1 bên chiếu ở mọi nước của mình trong chu kỳ → bên đó thua (trường chiếu)', () => {
    const h = [
      m('r', false, 'start'),
      m('b', false, 'B1'),
      m('r', true, 'C1'),
      m('b', false, 'start'),
      m('r', true, 'C1'),
      m('b', false, 'start'),
    ];
    expect(rules.detectRepetition(h)).toEqual({ reason: 'truong-chieu', loser: 'r' });
  });

  it('60 nước không ăn quân (120 bán nước) thì hoà', () => {
    const h = Array.from({ length: 120 }, (_, i) => m(i % 2 === 0 ? 'r' : 'b', false, 'x' + i));
    expect(rules.detectNoCaptureDraw(h)).toBe(true);
  });

  it('chưa đủ 120 bán nước thì chưa hoà', () => {
    const h = Array.from({ length: 119 }, (_, i) => m(i % 2 === 0 ? 'r' : 'b', false, 'x' + i));
    expect(rules.detectNoCaptureDraw(h)).toBe(false);
  });

  it('có 1 nước ăn quân trong 120 nước gần nhất thì đếm lại từ đó, chưa hoà', () => {
    const h = Array.from({ length: 130 }, (_, i) => m(i % 2 === 0 ? 'r' : 'b', false, 'x' + i, i === 20));
    expect(rules.detectNoCaptureDraw(h)).toBe(false);
  });
});
