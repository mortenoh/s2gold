/**
 * Minimap image builder: one pixel per map node, colored by the node's RSU
 * terrain and modulated by elevation so relief reads at a glance.
 */

import type { TerrainMapData } from './map-data';
import { minimapColor } from './terrain-data';

/** Neutral elevation around which the height modulation is centered. */
const NEUTRAL_HEIGHT = 10;

/** Brightness factor for an elevation value (clamped to a sane range). */
export function heightBrightness(elevation: number): number {
  const factor = 1 + (elevation - NEUTRAL_HEIGHT) * 0.025;
  return Math.min(1.5, Math.max(0.45, factor));
}

/**
 * Build RGBA pixel data (width * height * 4 bytes, row-major) for a map's
 * minimap. Draw it via `putImageData` on a canvas sized width x height.
 */
export function buildMinimapPixels(map: TerrainMapData): Uint8ClampedArray<ArrayBuffer> {
  const { width, height, landscape } = map;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const color = minimapColor(map.texture1[i] ?? 0, landscape);
    const b = heightBrightness(map.heightLayer[i] ?? NEUTRAL_HEIGHT);
    const o = i * 4;
    out[o] = Math.min(255, ((color >> 16) & 0xff) * b);
    out[o + 1] = Math.min(255, ((color >> 8) & 0xff) * b);
    out[o + 2] = Math.min(255, (color & 0xff) * b);
    out[o + 3] = 255;
  }
  return out;
}
