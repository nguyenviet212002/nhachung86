import { describe, it, expect } from 'vitest';
import { validatePosition } from '../src/modules/games/rules.js';

function emptyBoard() { return Array.from({ length: 10 }, () => Array(9).fill(null)); }

describe('T47 validatePosition', () => {
  it('đủ 2 Tướng, không đối mặt -> hợp lệ, mảng rỗng', () => {
    const b = emptyBoard();
    b[9][4] = { side: 'r', type: 'general' };
    b[0][3] = { side: 'b', type: 'general' };
    expect(validatePosition(b)).toEqual([]);
  });

  it('thiếu Tướng Đỏ -> báo đúng câu có dấu', () => {
    const b = emptyBoard();
    b[0][4] = { side: 'b', type: 'general' };
    expect(validatePosition(b)).toContain('Thiếu Tướng bên Đỏ.');
  });

  it('thiếu Tướng Đen -> báo đúng câu có dấu', () => {
    const b = emptyBoard();
    b[9][4] = { side: 'r', type: 'general' };
    expect(validatePosition(b)).toContain('Thiếu Tướng bên Đen.');
  });

  it('thiếu cả hai Tướng -> báo cả hai lỗi cùng lúc', () => {
    expect(validatePosition(emptyBoard())).toHaveLength(2);
  });

  it('hai Tướng cùng cột, không quân nào chắn -> báo đối mặt', () => {
    const b = emptyBoard();
    b[9][4] = { side: 'r', type: 'general' };
    b[0][4] = { side: 'b', type: 'general' };
    expect(validatePosition(b)).toContain('Hai Tướng đối mặt trực tiếp — không hợp lệ.');
  });

  it('hai Tướng cùng cột NHƯNG có quân chắn giữa -> không báo đối mặt', () => {
    const b = emptyBoard();
    b[9][4] = { side: 'r', type: 'general' };
    b[0][4] = { side: 'b', type: 'general' };
    b[5][4] = { side: 'r', type: 'chariot' };
    expect(validatePosition(b)).toEqual([]);
  });
});
