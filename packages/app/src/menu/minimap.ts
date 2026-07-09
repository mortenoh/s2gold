/**
 * Lightweight map-preview builder for the setup page.
 *
 * Rather than pull in the WebGL terrain renderer, this fetches a converted map
 * JSON and paints a one-pixel-per-node preview from the `texture1` layer (node
 * terrain type), shaded by the `height`/`shading` layer for a little relief,
 * with headquarters marked. The colour table is an approximation keyed by the
 * terrain type (low 6 bits of the texture byte) — enough to make water, meadow,
 * mountains and desert legible at a glance. This intentionally re-derives the
 * base64 layer decoding rather than importing the game's map-loader.
 */

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

/** [r,g,b] by terrain type (texture byte & 0x3f). Unknown -> meadow green. */
const TERRAIN_COLORS: Record<number, readonly [number, number, number]> = {
  0x00: [222, 232, 240], // snow
  0x01: [210, 188, 120], // desert
  0x02: [74, 90, 42], // swamp
  0x03: [120, 176, 84], // flower meadow
  0x04: [138, 122, 99], // mountain 1
  0x05: [95, 160, 60], // meadow 1
  0x06: [86, 150, 54], // meadow 2
  0x07: [79, 143, 50], // meadow 3
  0x08: [125, 138, 90], // mountain meadow
  0x09: [122, 107, 85], // mountain 2
  0x0a: [111, 98, 80], // mountain 3
  0x0b: [183, 162, 77], // steppe
  0x0c: [130, 144, 95], // mountain meadow 2
  0x0d: [47, 95, 168], // water (deep)
  0x0e: [58, 111, 184], // water
  0x0f: [192, 67, 26], // lava
  0x10: [106, 92, 72], // mineable mountain
  0x12: [63, 121, 192], // buildable water / harbour
  0x14: [200, 80, 40], // lava 2
  0x16: [203, 185, 128], // coast / beach
};

const FALLBACK: readonly [number, number, number] = [90, 150, 58];

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
  const texture = decodeBase64(raw.layers.texture1 ?? '');
  const shadeSrc = raw.layers.shading ?? raw.layers.height;
  const shade = shadeSrc ? decodeBase64(shadeSrc) : null;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');

  const img = ctx.createImageData(width, height);
  const data = img.data;
  for (let i = 0; i < width * height; i++) {
    const type = (texture[i] ?? 0) & 0x3f;
    const [r, g, b] = TERRAIN_COLORS[type] ?? FALLBACK;
    // Map the shade byte (~0x80 neutral) into a 0.7..1.15 multiplier.
    const s = shade ? 0.7 + (shade[i] ?? 128) / 512 : 1;
    const o = i * 4;
    data[o] = Math.min(255, r * s);
    data[o + 1] = Math.min(255, g * s);
    data[o + 2] = Math.min(255, b * s);
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
