import { describe, expect, it } from 'vitest';
import { PLAYER_COLORS, unpackColor } from './scene';

describe('unpackColor', () => {
  it('splits a packed 0xRRGGBB into normalised channels', () => {
    expect(unpackColor(0xffffff)).toEqual([1, 1, 1]);
    expect(unpackColor(0x000000)).toEqual([0, 0, 0]);
    const [r, g, b] = unpackColor(0x2848d8);
    expect(r).toBeCloseTo(0x28 / 255);
    expect(g).toBeCloseTo(0x48 / 255);
    expect(b).toBeCloseTo(0xd8 / 255);
  });
});

describe('PLAYER_COLORS', () => {
  it('defines at least the four documented default hues', () => {
    expect(PLAYER_COLORS.length).toBeGreaterThanOrEqual(4);
    // First four are blue, yellow, red, purple per the pal5 player band.
    expect(PLAYER_COLORS.slice(0, 4)).toEqual([0x2848d8, 0xe8c820, 0xc81818, 0xa018a0]);
  });
});
