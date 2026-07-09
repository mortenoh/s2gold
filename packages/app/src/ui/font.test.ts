import { describe, expect, it } from 'vitest';
import { glyphFor, measureText, metricsFromJson, type FontMetrics } from './font';

/** A tiny fixed-metric font: 'A' 8x14, 'i' 4x14, space 6x14, plus '?'. */
const metrics: FontMetrics = {
  name: 'test',
  dx: 12,
  dy: 14,
  glyphs: {
    32: { x: 0, y: 0, w: 6, h: 14, nx: 0, ny: 0 },
    63: { x: 60, y: 0, w: 7, h: 14, nx: 0, ny: 0 },
    65: { x: 10, y: 0, w: 8, h: 14, nx: 0, ny: 0 },
    105: { x: 20, y: 0, w: 4, h: 14, nx: 0, ny: 0 },
  },
};

describe('measureText', () => {
  it('sums per-glyph widths for a single line', () => {
    // 'Ai' = 8 + 4 = 12 wide, one line high.
    const layout = measureText(metrics, 'Ai');
    expect(layout.width).toBe(12);
    expect(layout.height).toBe(14);
    expect(layout.lines).toBe(1);
  });

  it('measures a single glyph as exactly its width (no trailing spacing)', () => {
    const layout = measureText(metrics, 'A', { letterSpacing: 3 });
    expect(layout.width).toBe(8);
  });

  it('adds letterSpacing between glyphs but not after the last', () => {
    // 'AA' = 8 + 8 + 1 gap = 17.
    expect(measureText(metrics, 'AA', { letterSpacing: 1 }).width).toBe(17);
  });

  it('applies an integer scale to both dimensions', () => {
    const layout = measureText(metrics, 'Ai', { scale: 3 });
    expect(layout.width).toBe(36);
    expect(layout.height).toBe(42);
  });

  it('floors a fractional scale and clamps below 1', () => {
    expect(measureText(metrics, 'A', { scale: 2.9 }).width).toBe(16);
    expect(measureText(metrics, 'A', { scale: 0 }).width).toBe(8);
  });

  it('takes the widest line and stacks height for multi-line text', () => {
    // line 1 'A' = 8, line 2 'Aii' = 8+4+4 = 16 -> widest 16; 2 lines high.
    const layout = measureText(metrics, 'A\nAii');
    expect(layout.width).toBe(16);
    expect(layout.height).toBe(28);
    expect(layout.lines).toBe(2);
  });

  it('adds lineSpacing between lines only', () => {
    const layout = measureText(metrics, 'A\nA', { lineSpacing: 2 });
    expect(layout.height).toBe(14 + 2 + 14);
  });

  it('measures the empty string as zero-width, one line', () => {
    const layout = measureText(metrics, '');
    expect(layout.width).toBe(0);
    expect(layout.lines).toBe(1);
  });

  it('falls back to the "?" glyph for unknown characters', () => {
    // '#' (35) is absent -> '?' width 7.
    expect(measureText(metrics, '#').width).toBe(7);
  });
});

describe('glyphFor', () => {
  it('returns the glyph for a known code', () => {
    expect(glyphFor(metrics, 65)?.w).toBe(8);
  });

  it('falls back to "?" then space for unknown codes', () => {
    expect(glyphFor(metrics, 999)).toBe(metrics.glyphs[63]);
  });
});

describe('metricsFromJson', () => {
  it('keys glyphs numerically and defaults missing bearings to 0', () => {
    const m = metricsFromJson({
      name: 'f',
      dx: 12,
      dy: 14,
      image: 'f.png',
      width: 100,
      height: 14,
      glyphs: { '65': { x: 1, y: 2, w: 8, h: 14, nx: 0, ny: 0 } },
    });
    expect(m.glyphs[65]).toEqual({ x: 1, y: 2, w: 8, h: 14, nx: 0, ny: 0 });
    expect(m.dy).toBe(14);
  });
});
