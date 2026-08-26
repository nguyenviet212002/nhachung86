import { describe, it, expect } from 'vitest';
import { subscribeGame, publishToGame, isWatchingGame } from '../src/core/realtime.js';

describe('T41 realtime — phòng theo ván cờ', () => {
  it('publishToGame gửi đúng payload tới mọi kết nối trong phòng, không gửi phòng khác', () => {
    const chunksA = [], chunksB = [];
    const resA = { write: (c) => chunksA.push(c) };
    const resB = { write: (c) => chunksB.push(c) };
    const unsubA = subscribeGame('game-1', 'member-a', resA);
    const unsubB = subscribeGame('game-2', 'member-b', resB);

    publishToGame('game-1', 'move', { turn: 'b' });

    expect(chunksA.join('')).toContain('event: move');
    expect(chunksA.join('')).toContain('"turn":"b"');
    expect(chunksB.join('')).toBe(''); // phòng khác không nhận

    unsubA(); unsubB();
  });

  it('isWatchingGame biết đúng ai đang mở kết nối tới phòng nào', () => {
    const res = { write: () => {} };
    expect(isWatchingGame('game-3', 'member-c')).toBe(false);
    const unsub = subscribeGame('game-3', 'member-c', res);
    expect(isWatchingGame('game-3', 'member-c')).toBe(true);
    expect(isWatchingGame('game-3', 'member-x')).toBe(false);
    unsub();
    expect(isWatchingGame('game-3', 'member-c')).toBe(false);
  });
});
