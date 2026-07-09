import { describe, expect, it } from 'vitest';
import { buildStaticObjects, objectAtlasForLandscape } from './map-objects';

/** Build 1-node planes for a single (type, index) pair. */
function single(
  type: number,
  index: number,
): {
  type: Uint8Array;
  index: Uint8Array;
} {
  return { type: new Uint8Array([type]), index: new Uint8Array([index]) };
}

describe('objectAtlasForLandscape', () => {
  it('maps each landscape to its object atlas', () => {
    expect(objectAtlasForLandscape(0)).toBe('mapbobs');
    expect(objectAtlasForLandscape(1)).toBe('mapbobs0');
    expect(objectAtlasForLandscape(2)).toBe('mapbobs1');
  });
});

describe('buildStaticObjects trees', () => {
  it('decodes tree species 0 (type 0xC4, band 0x30) to sprite base 200', () => {
    const { type, index } = single(0xc4, 0x33);
    const { objects, counts } = buildStaticObjects(1, 1, type, index, 0);
    expect(counts.trees).toBe(1);
    const tree = objects[0];
    expect(tree?.spriteIndex).toBe(200);
    expect(tree?.shadowIndex).toBe(350);
    expect(tree?.animation).toEqual({ baseIndex: 200, frameCount: 8, phase: 0 });
  });

  it('decodes tree species 3 (type 0xC4, band 0xF0) to sprite base 245', () => {
    const { type, index } = single(0xc4, 0xf1);
    const { objects } = buildStaticObjects(1, 1, type, index, 0);
    expect(objects[0]?.spriteIndex).toBe(200 + 3 * 15);
  });

  it('decodes tree species 7 (type 0xC5, band 0xF0) to sprite base 305', () => {
    const { type, index } = single(0xc5, 0xf7);
    const { objects } = buildStaticObjects(1, 1, type, index, 0);
    expect(objects[0]?.spriteIndex).toBe(200 + 7 * 15);
  });

  it('decodes tree species 8 (type 0xC6, band 0x30) to sprite base 320', () => {
    const { type, index } = single(0xc6, 0x30);
    const { objects } = buildStaticObjects(1, 1, type, index, 0);
    expect(objects[0]?.spriteIndex).toBe(200 + 8 * 15);
  });

  it('skips a tree with an out-of-range index', () => {
    const { type, index } = single(0xc4, 0x00);
    const { counts } = buildStaticObjects(1, 1, type, index, 0);
    expect(counts.trees).toBe(0);
    expect(counts.skipped).toBe(1);
  });
});

describe('buildStaticObjects granite', () => {
  it('decodes granite type 1 sizes to 516..521', () => {
    for (let s = 1; s <= 6; s++) {
      const { type, index } = single(0xcc, s);
      const { objects, counts } = buildStaticObjects(1, 1, type, index, 0);
      expect(counts.granite).toBe(1);
      expect(objects[0]?.spriteIndex).toBe(516 + (s - 1));
    }
  });

  it('decodes granite type 2 sizes to 522..527', () => {
    const { type, index } = single(0xcd, 6);
    const { objects } = buildStaticObjects(1, 1, type, index, 0);
    expect(objects[0]?.spriteIndex).toBe(516 + 6 + 5);
  });
});

describe('buildStaticObjects decorations and misc', () => {
  it('decodes low decoration indices to 500 + index', () => {
    const { type, index } = single(0xc8, 0x0b);
    const { objects, counts } = buildStaticObjects(1, 1, type, index, 0);
    expect(counts.decorations).toBe(1);
    expect(objects[0]?.spriteIndex).toBe(500 + 0x0b);
    expect(objects[0]?.animation).toBeUndefined();
  });

  it('skips high decoration indices (other archives)', () => {
    const { type, index } = single(0xc8, 0x25);
    const { counts } = buildStaticObjects(1, 1, type, index, 0);
    expect(counts.decorations).toBe(0);
    expect(counts.skipped).toBe(1);
  });

  it('produces no sprite for HQ markers (0x80) or empty nodes', () => {
    const type = new Uint8Array([0x80, 0x00]);
    const index = new Uint8Array([0x00, 0x00]);
    const { objects, counts } = buildStaticObjects(2, 1, type, index, 0);
    expect(objects).toHaveLength(0);
    expect(counts.trees + counts.granite + counts.decorations).toBe(0);
  });
});
