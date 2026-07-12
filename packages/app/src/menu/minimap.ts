/**
 * Lightweight map-preview builder for the setup page.
 *
 * Rather than pull in the WebGL terrain renderer, this fetches a converted map
 * JSON and paints a one-pixel-per-node preview from the `texture1` layer,
 * shaded by the `height` layer for a little relief, with headquarters marked.
 * Colours come from the renderer's per-landscape minimap tables (the same ones
 * the in-game minimap uses), so the preview and the game agree on what every
 * terrain byte means - including winter/wasteland maps.
 */

import { heightBrightness, minimapColor, type LandscapeSet } from '@s2gold/renderer';
import { assetUrl, fetchJson } from '../lib/manifest';

interface MapJson {
  title: string;
  width: number;
  height: number;
  terrain: number;
  hq_x?: number[];
  hq_y?: number[];
  encoding: string;
  layers: Record<string, string>;
}

/** Parsed preview payload the setup page renders. */
export interface MapPreview {
  readonly width: number;
  readonly height: number;
  readonly canvas: HTMLCanvasElement;
}

/** Sentinel for "no player here" in the hq arrays. */
const NO_HQ = 0xffff;

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Fetch a map and paint its preview. Throws on a missing/invalid map so the
 * caller can show an error state.
 */
export async function buildMapPreview(file: string): Promise<MapPreview> {
  const raw = await fetchJson<MapJson>(assetUrl(file));
  if (!raw) throw new Error(`failed to load map ${file}`);
  if (raw.encoding !== 'base64') throw new Error(`unexpected map encoding ${raw.encoding}`);

  const { width, height } = raw;
  const landscape = (raw.terrain === 1 || raw.terrain === 2 ? raw.terrain : 0) as LandscapeSet;
  const texture = decodeBase64(raw.layers.texture1 ?? '');
  const elevation = raw.layers.height ? decodeBase64(raw.layers.height) : null;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');

  const img = ctx.createImageData(width, height);
  const data = img.data;
  for (let i = 0; i < width * height; i++) {
    const color = minimapColor(texture[i] ?? 0, landscape);
    const s = elevation ? heightBrightness(elevation[i] ?? 10) : 1;
    const o = i * 4;
    data[o] = Math.min(255, ((color >> 16) & 0xff) * s);
    data[o + 1] = Math.min(255, ((color >> 8) & 0xff) * s);
    data[o + 2] = Math.min(255, (color & 0xff) * s);
    data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  // Mark headquarters as small white squares with a dark outline.
  const hqX = raw.hq_x ?? [];
  const hqY = raw.hq_y ?? [];
  for (let p = 0; p < hqX.length; p++) {
    const x = hqX[p];
    const y = hqY[p];
    if (x === undefined || y === undefined || x === NO_HQ || y === NO_HQ) continue;
    ctx.fillStyle = 'rgba(0,0,0,0.9)';
    ctx.fillRect(x - 2, y - 2, 5, 5);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 1, y - 1, 3, 3);
  }

  return { width, height, canvas };
}
