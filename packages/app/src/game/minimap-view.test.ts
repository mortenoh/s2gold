import { describe, expect, it } from 'vitest';
import { viewportRectSegments, type MinimapSegment } from './minimap-view';

const MW = 256;
const MH = 256;

/** Normalise segments so left/right and top/bottom endpoints compare stably. */
function norm(seg: MinimapSegment): MinimapSegment {
  const [x1, x2] = seg.x1 <= seg.x2 ? [seg.x1, seg.x2] : [seg.x2, seg.x1];
  const [y1, y2] = seg.y1 <= seg.y2 ? [seg.y1, seg.y2] : [seg.y2, seg.y1];
  return { x1, y1, x2, y2 };
}

function has(segments: MinimapSegment[], seg: MinimapSegment): boolean {
  const target = norm(seg);
  return segments.some((s) => {
    const n = norm(s);
    return n.x1 === target.x1 && n.y1 === target.y1 && n.x2 === target.x2 && n.y2 === target.y2;
  });
}

/** True if any drawn segment spans (nearly) the whole minimap in one dimension. */
function hasFullSpanLine(segments: MinimapSegment[]): boolean {
  return segments.some((s) => {
    const horizontal = s.y1 === s.y2 && Math.abs(s.x2 - s.x1) >= MW - 1;
    const vertical = s.x1 === s.x2 && Math.abs(s.y2 - s.y1) >= MH - 1;
    return horizontal || vertical;
  });
}

describe('viewportRectSegments', () => {
  it('draws a closed rectangle when fully inside the map', () => {
    const segs = viewportRectSegments(10, 20, 50, 40, MW, MH);
    // Four edges, none crossing a seam.
    expect(segs).toHaveLength(4);
    expect(has(segs, { x1: 10, y1: 20, x2: 60, y2: 20 })).toBe(true); // top
    expect(has(segs, { x1: 10, y1: 60, x2: 60, y2: 60 })).toBe(true); // bottom
    expect(has(segs, { x1: 10, y1: 20, x2: 10, y2: 60 })).toBe(true); // left
    expect(has(segs, { x1: 60, y1: 20, x2: 60, y2: 60 })).toBe(true); // right
    expect(hasFullSpanLine(segs)).toBe(false);
  });

  it('splits horizontal edges when crossing the x seam', () => {
    // Left edge at x=230, right edge wraps to x=24.
    const segs = viewportRectSegments(230, 20, 50, 40, MW, MH);
    // Top and bottom each split into two pieces; left and right stay single.
    expect(segs).toHaveLength(6);
    // Top pieces.
    expect(has(segs, { x1: 230, y1: 20, x2: 256, y2: 20 })).toBe(true);
    expect(has(segs, { x1: 0, y1: 20, x2: 24, y2: 20 })).toBe(true);
    // Wrapped vertical edges.
    expect(has(segs, { x1: 230, y1: 20, x2: 230, y2: 60 })).toBe(true);
    expect(has(segs, { x1: 24, y1: 20, x2: 24, y2: 60 })).toBe(true);
    expect(hasFullSpanLine(segs)).toBe(false);
  });

  it('splits vertical edges when crossing the y seam', () => {
    // Top edge at y=240, bottom edge wraps to y=44 (240+60-256).
    const segs = viewportRectSegments(20, 240, 50, 60, MW, MH);
    expect(segs).toHaveLength(6);
    // Left edge split into two vertical pieces.
    expect(has(segs, { x1: 20, y1: 240, x2: 20, y2: 256 })).toBe(true);
    expect(has(segs, { x1: 20, y1: 0, x2: 20, y2: 44 })).toBe(true);
    // Wrapped horizontal edges.
    expect(has(segs, { x1: 20, y1: 240, x2: 70, y2: 240 })).toBe(true);
    expect(has(segs, { x1: 20, y1: 44, x2: 70, y2: 44 })).toBe(true);
    expect(hasFullSpanLine(segs)).toBe(false);
  });

  it('splits both edges when crossing both seams', () => {
    const segs = viewportRectSegments(230, 240, 50, 60, MW, MH);
    // Each of the four edges splits into two pieces.
    expect(segs).toHaveLength(8);
    // A corner piece of the top edge and of the left edge.
    expect(has(segs, { x1: 230, y1: 240, x2: 256, y2: 240 })).toBe(true);
    expect(has(segs, { x1: 0, y1: 240, x2: 24, y2: 240 })).toBe(true);
    expect(has(segs, { x1: 230, y1: 240, x2: 230, y2: 256 })).toBe(true);
    expect(hasFullSpanLine(segs)).toBe(false);
  });

  it('emits no vertical edges when the view spans the full map width (regression)', () => {
    // Viewport wider than the map, straddling the x seam. Previously this drew a
    // spurious vertical line at the seam plus full-width top/bottom streaks.
    const segs = viewportRectSegments(230, 20, MW, 40, MW, MH);
    // No vertical segment at all.
    expect(segs.every((s) => s.x1 !== s.x2 || s.y1 === s.y2)).toBe(true);
    // Top and bottom span the full width (in two seam-split pieces each).
    const yValues = new Set(segs.map((s) => s.y1));
    expect(yValues).toEqual(new Set([20, 60]));
  });

  it('emits nothing when the view spans the whole map', () => {
    expect(viewportRectSegments(0, 0, MW, MH, MW, MH)).toHaveLength(0);
    expect(viewportRectSegments(100, 100, MW * 2, MH * 2, MW, MH)).toHaveLength(0);
  });
});
