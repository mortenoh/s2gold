import { describe, expect, it } from 'vitest';
import { cloneRng, nextRange, nextUint, seedRng } from './rng';

describe('PCG32 rng', () => {
  it('is deterministic for a fixed seed', () => {
    const a = seedRng(42);
    const b = seedRng(42);
    const seqA = Array.from({ length: 20 }, () => nextUint(a));
    const seqB = Array.from({ length: 20 }, () => nextUint(b));
    expect(seqA).toEqual(seqB);
  });

  it('differs across seeds', () => {
    const a = seedRng(1);
    const b = seedRng(2);
    expect(nextUint(a)).not.toBe(nextUint(b));
  });

  it('produces 32-bit unsigned integers', () => {
    const s = seedRng(7);
    for (let i = 0; i < 100; i++) {
      const v = nextUint(s);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('serializes state faithfully (resume continues the stream)', () => {
    const s = seedRng(123);
    for (let i = 0; i < 5; i++) nextUint(s);
    const snapshot = cloneRng(s);
    const cont = Array.from({ length: 10 }, () => nextUint(s));
    const resumed = Array.from({ length: 10 }, () => nextUint(snapshot));
    expect(resumed).toEqual(cont);
  });

  it('bounds nextRange to [0, bound)', () => {
    const s = seedRng(9);
    for (let i = 0; i < 500; i++) {
      const v = nextRange(s, 6);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
    }
  });
});
