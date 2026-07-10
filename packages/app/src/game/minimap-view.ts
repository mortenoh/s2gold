/**
 * Minimap widget: renders the 1px-per-node terrain image, overlays the
 * camera viewport rectangle (wrap-aware) and turns clicks/drags into camera
 * moves.
 */

import { buildMinimapPixels, type Camera, type TerrainMapData } from '@s2gold/renderer';

/** Maximum on-screen size of the minimap (CSS pixels). */
const MAX_SIZE = 256;

/** A single line of the viewport outline, in minimap pixels. */
export interface MinimapSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Wrap a value into [0, period). */
function wrapInto(value: number, period: number): number {
  return ((value % period) + period) % period;
}

/** Sub-intervals of [start, start + len) that fit within [0, period). */
function seamSpans(start: number, len: number, period: number): Array<[number, number]> {
  const end = start + len;
  if (end <= period) return [[start, end]];
  return [
    [start, period],
    [0, end - period],
  ];
}

/**
 * Line segments (minimap pixels) outlining the camera viewport on the torus
 * minimap. The top-left (rx, ry) is normalised into [0,mw)×[0,mh) and the
 * width/height are clamped to the minimap size. Each edge is split where it
 * crosses the wrap seam, so a viewport straddling the map edge draws as two
 * short pieces rather than a streak spanning the whole minimap. A dimension the
 * view fully spans emits no perpendicular edges — otherwise the left/right (or
 * top/bottom) edges collapse onto the seam as a spurious full-length line.
 */
export function viewportRectSegments(
  rx: number,
  ry: number,
  rw: number,
  rh: number,
  mw: number,
  mh: number,
): MinimapSegment[] {
  const segments: MinimapSegment[] = [];
  if (mw <= 0 || mh <= 0) return segments;

  const w = Math.min(Math.max(rw, 0), mw);
  const h = Math.min(Math.max(rh, 0), mh);
  const x = wrapInto(rx, mw);
  const y = wrapInto(ry, mh);
  const fullW = w >= mw;
  const fullH = h >= mh;

  // Top/bottom edges exist unless the view spans the full map height.
  if (!fullH) {
    const yTop = y;
    const yBot = wrapInto(y + h, mh);
    for (const [a, b] of seamSpans(x, w, mw)) {
      segments.push({ x1: a, y1: yTop, x2: b, y2: yTop });
      segments.push({ x1: a, y1: yBot, x2: b, y2: yBot });
    }
  }

  // Left/right edges exist unless the view spans the full map width.
  if (!fullW) {
    const xLeft = x;
    const xRight = wrapInto(x + w, mw);
    for (const [a, b] of seamSpans(y, h, mh)) {
      segments.push({ x1: xLeft, y1: a, x2: xLeft, y2: b });
      segments.push({ x1: xRight, y1: a, x2: xRight, y2: b });
    }
  }

  return segments;
}

export class MinimapView {
  private readonly base: HTMLCanvasElement;
  /** Owner-tint overlay (one pixel per node; transparent where unowned). */
  private readonly owners: HTMLCanvasElement;
  private worldW = 1;
  private worldH = 1;
  private dragging = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onMove: (worldX: number, worldY: number) => void,
  ) {
    canvas.addEventListener('pointerdown', (ev) => {
      this.dragging = true;
      canvas.setPointerCapture(ev.pointerId);
      this.moveTo(ev);
    });
    canvas.addEventListener('pointermove', (ev) => {
      if (this.dragging) this.moveTo(ev);
    });
    canvas.addEventListener('pointerup', (ev) => {
      this.dragging = false;
      canvas.releasePointerCapture(ev.pointerId);
    });
    this.base = document.createElement('canvas');
    this.owners = document.createElement('canvas');
  }

  /** Rebuild the terrain image for a newly loaded map. */
  setMap(map: TerrainMapData, worldW: number, worldH: number): void {
    this.worldW = worldW;
    this.worldH = worldH;
    this.base.width = map.width;
    this.base.height = map.height;
    this.owners.width = map.width;
    this.owners.height = map.height;
    const ctx = this.base.getContext('2d');
    if (!ctx) return;
    ctx.putImageData(new ImageData(buildMinimapPixels(map), map.width, map.height), 0, 0);
    this.owners.getContext('2d')?.clearRect(0, 0, map.width, map.height);

    const scale = Math.max(1, Math.floor(MAX_SIZE / Math.max(map.width, map.height)));
    this.canvas.width = map.width * scale;
    this.canvas.height = map.height * scale;
  }

  /**
   * Rebuild the ownership tint from the engine owner layer (one byte per node:
   * 0 = neutral, else player+1). Owned nodes get a translucent player colour so
   * territory reads on the minimap. Call when territory changes.
   */
  setOwners(owner: readonly number[], playerColors: readonly number[]): void {
    const w = this.owners.width;
    const h = this.owners.height;
    if (w === 0 || h === 0) return;
    const ctx = this.owners.getContext('2d');
    if (!ctx) return;
    const px = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const byte = owner[i] ?? 0;
      if (byte === 0) continue;
      const rgb = playerColors[(byte - 1) % playerColors.length] ?? 0xffffff;
      const o = i * 4;
      px[o] = (rgb >> 16) & 0xff;
      px[o + 1] = (rgb >> 8) & 0xff;
      px[o + 2] = rgb & 0xff;
      px[o + 3] = 150; // translucent so terrain still reads underneath
    }
    ctx.putImageData(new ImageData(px, w, h), 0, 0);
  }

  /** Redraw terrain + viewport rectangle for the current camera. */
  draw(camera: Camera, viewportW: number, viewportH: number): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const { width: mw, height: mh } = this.canvas;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.base, 0, 0, mw, mh);
    ctx.drawImage(this.owners, 0, 0, mw, mh);

    // Viewport outline in minimap pixels, split at the torus wrap seam.
    const rx = (camera.x / this.worldW) * mw;
    const ry = (camera.y / this.worldH) * mh;
    const rw = (viewportW / camera.zoom / this.worldW) * mw;
    const rh = (viewportH / camera.zoom / this.worldH) * mh;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const seg of viewportRectSegments(rx, ry, rw, rh, mw, mh)) {
      ctx.moveTo(seg.x1 + 0.5, seg.y1 + 0.5);
      ctx.lineTo(seg.x2 + 0.5, seg.y2 + 0.5);
    }
    ctx.stroke();
  }

  private moveTo(ev: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const fx = (ev.clientX - rect.left) / rect.width;
    const fy = (ev.clientY - rect.top) / rect.height;
    this.onMove(fx * this.worldW, fy * this.worldH);
  }
}
