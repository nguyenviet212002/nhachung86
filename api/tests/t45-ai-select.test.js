import { describe, it, expect } from 'vitest';
import { selectAiMove } from '../src/modules/games/aiSelect.js';

const line = (move, score_cp, mate = null) => ({ move, score_cp, mate, depth: 20, pv: [move] });

describe('T45 selectAiMove — ba cấp máy đi hộ (BAN_CHUAN_CO_TUONG.md mục 4)', () => {
  it('Siêu thông minh luôn chọn nước tốt nhất, chênh 0', () => {
    const lines = [line('a', 100), line('b', 90), line('c', 50)];
    expect(selectAiMove(lines, 'sieu', () => 0.99)).toBe('a');
    expect(selectAiMove(lines, 'sieu', () => 0)).toBe('a');
  });

  it('Thông minh chỉ chọn trong 2 nước đầu, chênh tối đa 40 điểm', () => {
    // b trong top-2 và chênh 35 (<=40) -> hợp lệ. c chênh 90 VÀ đứng ngoài
    // top-2 -> loại kép, không được chọn dù rng luôn ra giá trị lớn nhất.
    const lines = [line('a', 100), line('b', 65), line('c', 10)];
    expect(selectAiMove(lines, 'thong-minh', () => 0)).toBe('a');
    expect(selectAiMove(lines, 'thong-minh', () => 0.999)).toBe('b');
  });

  it('Xuất sắc chọn trong 3 nước đầu, chênh tối đa 120 điểm — nước thứ 4 luôn bị loại', () => {
    const lines = [line('a', 100), line('b', 20), line('c', -10), line('d', -1000)];
    for (const rngVal of [0, 0.33, 0.66, 0.99]) {
      expect(selectAiMove(lines, 'xuat-sac', () => rngVal)).not.toBe('d');
    }
  });

  it('chiếu bí quy về thang so được với score_cp — càng ít nước chiếu bí càng tốt hơn mọi cp', () => {
    const lines = [line('cp-cao', 900, null), line('mate-1', null, 1)];
    expect(selectAiMove(lines, 'sieu', () => 0)).toBe('mate-1');
  });

  it('sắp bị chiếu bí luôn xếp cuối, dù nước khác chỉ cp âm nhẹ', () => {
    const lines = [line('cp-am-nhe', -50, null), line('sap-thua', null, -1)];
    expect(selectAiMove(lines, 'sieu', () => 0)).toBe('cp-am-nhe');
  });

  it('danh sách rỗng trả về null', () => {
    expect(selectAiMove([], 'sieu')).toBeNull();
  });

  it('cấp không hợp lệ ném lỗi', () => {
    expect(() => selectAiMove([line('a', 0)], 'khong-ton-tai')).toThrow();
  });
});
