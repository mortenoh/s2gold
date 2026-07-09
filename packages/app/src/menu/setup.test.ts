import { describe, expect, it } from 'vitest';
import { opponentSlots } from './setup';

describe('opponentSlots', () => {
  it('offers only slots with a real HQ (0xffff means no start position)', () => {
    // maps_miss200 ("I - Off we go"): players=7 but only slot 0 has an HQ.
    const hqX = [33, 65535, 65535, 65535, 65535, 65535, 65535];
    expect(opponentSlots(hqX)).toEqual([]);
  });

  it('lists every non-human slot that has an HQ', () => {
    expect(opponentSlots([10, 20, 30])).toEqual([1, 2]);
    expect(opponentSlots([10, 65535, 30])).toEqual([2]);
  });

  it('never includes slot 0 (the human) even when it has an HQ', () => {
    expect(opponentSlots([10]).includes(0)).toBe(false);
  });

  it('degrades to no opponents when hq_x is missing or malformed', () => {
    expect(opponentSlots(undefined)).toEqual([]);
    expect(opponentSlots([])).toEqual([]);
  });
});
