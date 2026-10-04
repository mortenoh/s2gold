/**
 * Camera over the torus map: a top-left position in world pixels plus a
 * continuous zoom. Positions always stay wrapped into one torus period so pan
 * can run forever in any direction.
 *
 * `zoom` is the user-facing value: screen *points* (CSS pixels) per world
 * pixel, so zoom 1 shows the original art at its original size on any screen.
 * `dpr` is the display's device-pixel ratio; `scale` = zoom x dpr is what the
 * renderers and every device-pixel conversion use. All screen coordinates the
 * camera methods take are device pixels (the canvas backing store).
 */

import { mapPixelHeight, mapPixelWidth } from './geometry';

/** Kept for API compatibility; zoom is now continuous within [ZOOM_MIN, ZOOM_MAX]. */
export type ZoomLevel = number;

/** Zoom bounds and the multiplicative step used per mouse-wheel notch. */
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 4;
export const ZOOM_STEP = 1.2;

/** Camera state consumed by the renderer each frame. */
export class Camera {
  /** Top-left of the viewport in world pixels (wrapped into the map period). */
  x = 0;
  y = 0;
  /** Screen points (CSS pixels) per world pixel. */
  zoom: ZoomLevel = 1;
  /** Device pixels per screen point (window.devicePixelRatio). */
  dpr = 1;

  /** Device pixels per world pixel: what the renderers draw with. */
  get scale(): number {
    return this.zoom * this.dpr;
  }

  private readonly worldW: number;
  private readonly worldH: number;

  constructor(mapWidth: number, mapHeight: number) {
    this.worldW = mapPixelWidth(mapWidth);
    this.worldH = mapPixelHeight(mapHeight);
  }

  /** World-pixel size of one map tile (torus period). */
  get worldSize(): { w: number; h: number } {
    return { w: this.worldW, h: this.worldH };
  }

  /** Pan by a device-pixel delta (divided by scale) and re-wrap. */
  panScreen(dx: number, dy: number): void {
    this.panWorld(dx / this.scale, dy / this.scale);
  }

  /** Pan by a world-pixel delta and re-wrap. */
  panWorld(dx: number, dy: number): void {
    this.x = wrap(this.x + dx, this.worldW);
    this.y = wrap(this.y + dy, this.worldH);
  }

  /** Center the viewport (given in device px) on a world position. */
  centerOn(worldX: number, worldY: number, viewportW: number, viewportH: number): void {
    this.x = wrap(worldX - viewportW / this.scale / 2, this.worldW);
    this.y = wrap(worldY - viewportH / this.scale / 2, this.worldH);
  }

  /**
   * Adopt a new device-pixel ratio (window moved to another display, browser
   * zoom), keeping the world point at the view center fixed. `viewportW/H` are
   * the device-pixel sizes the center was computed with BEFORE the change.
   */
  setDpr(
    dpr: number,
    viewportW: number,
    viewportH: number,
    nextW = viewportW,
    nextH = viewportH,
  ): void {
    const next = dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
    if (next === this.dpr) return;
    const cx = this.x + viewportW / this.scale / 2;
    const cy = this.y + viewportH / this.scale / 2;
    this.dpr = next;
    this.centerOn(cx, cy, nextW, nextH);
  }

  /** Toggle between 1x and 2x, keeping the view center (button / key path). */
  toggleZoom(viewportW: number, viewportH: number): void {
    const cx = this.x + viewportW / this.scale / 2;
    const cy = this.y + viewportH / this.scale / 2;
    this.zoom = this.zoom < 2 ? 2 : 1;
    this.centerOn(cx, cy, viewportW, viewportH);
  }

  /**
   * Set an absolute zoom, keeping the world point under the given device-pixel
   * screen position fixed (mouse-wheel zoom anchor). The zoom is clamped to
   * [ZOOM_MIN, ZOOM_MAX].
   */
  zoomAt(zoom: number, screenX: number, screenY: number): void {
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
    if (next === this.zoom) return;
    const wx = this.x + screenX / this.scale;
    const wy = this.y + screenY / this.scale;
    this.zoom = next;
    this.x = wrap(wx - screenX / this.scale, this.worldW);
    this.y = wrap(wy - screenY / this.scale, this.worldH);
  }

  /** Step the zoom by one wheel notch (positive = zoom in) anchored at a screen point. */
  zoomStep(direction: 1 | -1, screenX: number, screenY: number): void {
    this.zoomAt(this.zoom * (direction > 0 ? ZOOM_STEP : 1 / ZOOM_STEP), screenX, screenY);
  }
}

/** Wrap a value into [0, period). */
export function wrap(value: number, period: number): number {
  return ((value % period) + period) % period;
}
