import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as engineClient from '../src/modules/games/engineClient.js';

describe('T44 engineClient.bestMove', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('gửi đúng fen/movetime/multipv tới /bestmove, trả nguyên JSON khi engine trả 200', async () => {
    const fake = { bestmove: 'h2e2', score_cp: 20, mate: null, depth: 12, pv: ['h2e2'], lines: [] };
    const fenIn = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => fake });

    const result = await engineClient.bestMove({ fen: fenIn, movetime: 8000, multipv: 3 });

    expect(result).toEqual(fake);
    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toContain('/bestmove');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ fen: fenIn, movetime: 8000, multipv: 3 });
  });

  it('engine trả lỗi HTTP thì ném lỗi có kèm mã trạng thái', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'bận' }) });
    await expect(engineClient.bestMove({ fen: 'x', movetime: 1000, multipv: 1 })).rejects.toThrow(/500/);
  });
});
