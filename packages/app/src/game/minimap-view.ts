/**
 * Minimap widget: renders the 1px-per-node terrain image, overlays the
 * camera viewport rectangle (wrap-aware) and turns clicks/drags into camera
 * moves.
 */

import { buildMinimapPixels, type Camera, type TerrainMapData } from '@s2gold/renderer';

/** Maximum on-screen size of the minimap (CSS pixels). */
const MAX_SIZE = 256;

export class MinimapView {
  private readonly base: HTMLCanvasElement;
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
  }

  /** Rebuild the terrain image for a newly loaded map. */
  setMap(map: TerrainMapData, worldW: number, worldH: number): void {
    this.worldW = worldW;
    this.worldH = worldH;
    this.base.width = map.width;
    this.base.height = map.height;
    const ctx = this.base.getContext('2d');
    if (!ctx) return;
    ctx.putImageData(new ImageData(buildMinimapPixels(map), map.width, map.height), 0, 0);

    const scale = Math.max(1, Math.floor(MAX_SIZE / Math.max(map.width, map.height)));
    this.canvas.width = map.width * scale;
    this.canvas.height = map.height * scale;
  }

  /** Redraw terrain + viewport rectangle for the current camera. */
  draw(camera: Camera, viewportW: number, viewportH: number): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const { width: mw, height: mh } = this.canvas;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.base, 0, 0, mw, mh);

    // Viewport rectangle in minimap pixels, drawn at all wrap offsets.
    const rx = (camera.x / this.worldW) * mw;
    const ry = (camera.y / this.worldH) * mh;
    const rw = Math.min(mw, (viewportW / camera.zoom / this.worldW) * mw);
    const rh = Math.min(mh, (viewportH / camera.zoom / this.worldH) * mh);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    for (const ox of [0, -mw]) {
      for (const oy of [0, -mh]) {
        ctx.strokeRect(rx + ox + 0.5, ry + oy + 0.5, rw - 1, rh - 1);
      }
    }
  }

  private moveTo(ev: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const fx = (ev.clientX - rect.left) / rect.width;
    const fy = (ev.clientY - rect.top) / rect.height;
    this.onMove(fx * this.worldW, fy * this.worldH);
  }
}
