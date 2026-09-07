import { describe, it, expect } from 'vitest';
import { winRate, computeMoveLosses } from '../src/modules/games/analysis.js';

describe('T61 mổ ván — toán thuần (không I/O)', () => {
  it('winRate(0) là 0.5 — thế cân bằng đúng 50%', () => {
    expect(winRate(0)).toBeCloseTo(0.5, 6);
  });
  it('winRate tăng theo effScore và bị chặn trong (0,1)', () => {
    const low = winRate(-1000), mid = winRate(0), high = winRate(1000);
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
    expect(low).toBeGreaterThan(0);
    expect(high).toBeLessThan(1);
  });
  it('winRate đối xứng: winRate(x) + winRate(-x) = 1', () => {
    expect(winRate(250) + winRate(-250)).toBeCloseTo(1, 6);
  });

  it('computeMoveLosses: nước cuối luôn mất mát 0 (không có thế kế tiếp để so)', () => {
    const evals = [{ effScore: 30 }, { effScore: -10 }, { effScore: 50 }];
    const losses = computeMoveLosses(evals);
    expect(losses).toHaveLength(3);
    expect(losses[2]).toBe(0);
  });
  it('computeMoveLosses: nước đi làm điểm bên mình tệ đi (theo góc nhìn mình) ra mất mát dương', () => {
    // Ply 0: trước khi đi, engine chấm +200 (tốt cho bên đi). Ply 1: đến lượt
    // đối phương, engine chấm +150 CHO ĐỐI PHƯƠNG — quy về góc nhìn bên đi ở
    // ply 0 phải đảo dấu thành -150, tức là từ +200 tụt xuống -150: một nước
    // tệ, mất mát phải dương và đáng kể.
    const evals = [{ effScore: 200 }, { effScore: 150 }];
    const losses = computeMoveLosses(evals);
    expect(losses[0]).toBeCloseTo(winRate(200) - winRate(-150), 6);
    expect(losses[0]).toBeGreaterThan(0.3);
  });
  it('computeMoveLosses: nước hoàn hảo (điểm giữ nguyên, đảo góc nhìn đúng) ra mất mát 0', () => {
    // Ply 0 bên đi được +100. Ply 1 (lượt đối phương) engine chấm -100 cho
    // đối phương — quy về góc nhìn ply 0 là +100, giữ nguyên, không mất gì.
    const evals = [{ effScore: 100 }, { effScore: -100 }];
    const losses = computeMoveLosses(evals);
    expect(losses[0]).toBeCloseTo(0, 6);
  });
  it('computeMoveLosses: mảng rỗng ra mảng rỗng, mảng 1 phần tử ra [0]', () => {
    expect(computeMoveLosses([])).toEqual([]);
    expect(computeMoveLosses([{ effScore: 500 }])).toEqual([0]);
  });
});
