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

  // Bàn tự bày ra ngoài cung là bàn Pikafish không lường trước (giả định
  // ngầm của UCI engine là thế hợp lệ) — thoát bất ngờ giữa "Phân tích ngay"
  // thay vì trả điểm, nên phải chặn từ lúc chốt thế chứ không chỉ lúc chơi.
  it('Tướng Đỏ ra khỏi cung -> báo lỗi, không cho chốt', () => {
    const b = emptyBoard();
    b[6][4] = { side: 'r', type: 'general' };
    b[0][4] = { side: 'b', type: 'general' };
    expect(validatePosition(b)).toContain('Tướng bên Đỏ phải nằm trong cung.');
  });

  it('Tướng Đen ra khỏi cung (ngoài cột 3-5) -> báo lỗi', () => {
    const b = emptyBoard();
    b[9][4] = { side: 'r', type: 'general' };
    b[0][2] = { side: 'b', type: 'general' };
    expect(validatePosition(b)).toContain('Tướng bên Đen phải nằm trong cung.');
  });

  it('Sĩ ra khỏi cung -> báo lỗi', () => {
    const b = emptyBoard();
    b[9][4] = { side: 'r', type: 'general' };
    b[0][4] = { side: 'b', type: 'general' };
    b[9][2] = { side: 'r', type: 'advisor' };
    expect(validatePosition(b)).toContain('Sĩ bên Đỏ phải nằm trong cung.');
  });

  it('Tượng qua sông -> báo lỗi', () => {
    const b = emptyBoard();
    b[9][4] = { side: 'r', type: 'general' };
    b[0][4] = { side: 'b', type: 'general' };
    b[3][2] = { side: 'r', type: 'elephant' };
    expect(validatePosition(b)).toContain('Tượng bên Đỏ không được qua sông.');
  });

  it('Tướng ngoài cung thì KHÔNG báo đối mặt nữa (đã có lỗi cung, tránh nhiễu)', () => {
    const b = emptyBoard();
    b[6][4] = { side: 'r', type: 'general' };
    b[0][4] = { side: 'b', type: 'general' };
    expect(validatePosition(b)).not.toContain('Hai Tướng đối mặt trực tiếp — không hợp lệ.');
  });

  // Tái hiện đúng lỗi bắt được từ log thật: Xe Đỏ kề ngay Tướng Đen, không
  // quân nào chắn, đến lượt Đỏ đi -> Pikafish thoát bất ngờ (mã 1), báo
  // "Unsupported position. King can be captured." thay vì tìm nước.
  it('bên chưa đi đã bị chiếu sẵn (Tướng có thể bị bắt ngay) -> báo lỗi, không cho chốt', () => {
    const b = emptyBoard();
    b[9][4] = { side: 'r', type: 'general' };
    b[0][4] = { side: 'b', type: 'general' };
    b[1][4] = { side: 'r', type: 'chariot' };
    expect(validatePosition(b, 'r')).toContain('Tướng bên Đen đang bị chiếu sẵn dù chưa đến lượt đi — không hợp lệ.');
  });

  it('bên SẮP đi đang bị chiếu thì hợp lệ (thế "phải chống đỡ" bình thường)', () => {
    const b = emptyBoard();
    b[9][4] = { side: 'r', type: 'general' };
    b[0][4] = { side: 'b', type: 'general' };
    b[8][4] = { side: 'b', type: 'chariot' };
    expect(validatePosition(b, 'r')).toEqual([]);
  });

  it('không truyền sideToMove -> bỏ qua kiểm chiếu sẵn (chỉ kiểm cấu trúc bàn)', () => {
    const b = emptyBoard();
    b[9][4] = { side: 'r', type: 'general' };
    b[0][4] = { side: 'b', type: 'general' };
    b[1][4] = { side: 'r', type: 'chariot' };
    expect(validatePosition(b)).toEqual([]);
  });
});
