import { describe, expect, it } from 'vitest';
import { WORLD_REGIONS, computeCentroids, isKeyColor, regionForColor } from './world-globe';

describe('regionForColor', () => {
  it('maps each verified mask colour to its documented continent/mission', () => {
    for (const region of WORLD_REGIONS) {
      const [r, g, b] = region.color;
      expect(regionForColor(r, g, b)?.chapterId).toBe(region.chapterId);
    }
  });

  it('treats black (ocean) as no region', () => {
    expect(regionForColor(0, 0, 0)).toBeUndefined();
  });

  it('rejects colours far from every continent (anti-aliased edges)', () => {
    // Halfway between yellow Europe and black is still not a clean hit.
    expect(regionForColor(128, 128, 0)).toBeUndefined();
  });

  it('tolerates a small colour drift onto the nearest continent', () => {
    const [r, g, b] = WORLD_REGIONS[0]!.color; // Europe (255,255,0)
    expect(regionForColor(r - 4, g - 4, b + 4)?.chapterId).toBe(101);
  });

  it('maps the reference-capture highlighted region (Europe) to mission 101', () => {
    expect(regionForColor(255, 255, 0)?.continent).toBe('Europe');
    expect(regionForColor(255, 255, 0)?.chapterId).toBe(101);
  });
});

describe('isKeyColor', () => {
  it('keys the (247,0,0) transparency colour and near variants', () => {
    expect(isKeyColor(247, 0, 0)).toBe(true);
    expect(isKeyColor(255, 5, 5)).toBe(true);
  });

  it('keeps reddish/brown land pixels', () => {
    // The mask analysis found no red halo; land maxes out around these values.
    expect(isKeyColor(147, 87, 31)).toBe(false);
    expect(isKeyColor(159, 75, 0)).toBe(false);
  });
});

describe('computeCentroids', () => {
  it('returns the pixel centroid of each mapped region present in the buffer', () => {
    // A 4x2 image: left column Europe (yellow), right column ocean (black).
    const w = 4;
    const h = 2;
    const data = new Uint8ClampedArray(w * h * 4);
    const yellow = WORLD_REGIONS[0]!.color; // Europe -> 101
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        data[i + 3] = 255;
        if (x < 2) {
          data[i] = yellow[0];
          data[i + 1] = yellow[1];
          data[i + 2] = yellow[2];
        }
      }
    }
    const centroids = computeCentroids(data, w, h);
    const europe = centroids.get(101);
    expect(europe).toBeDefined();
    expect(europe!.count).toBe(4); // two columns x two rows
    expect(europe!.x).toBe(1); // (0+1+0+1)/4 -> 0.5 rounded is 1 with Math.round(0.5)
    expect(europe!.y).toBe(1); // (0+0+1+1)/4 -> 0.5 -> 1
    // Ocean-only regions never appear.
    expect(centroids.has(102)).toBe(false);
  });
});
