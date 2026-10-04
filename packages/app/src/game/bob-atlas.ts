/**
 * Loader for BOB settler-animation atlases (`bobs/<name>/atlas.json`).
 *
 * Unlike a flat graphics atlas, a BOB atlas ships two composition tables that
 * tell the renderer which sprites to stack for one animation cell (see
 * src/s2gold/convert/bobs.py and docs):
 *
 *   body_table[fat][direction][step]  -> body sprite key   (walking figure)
 *   links[job][step][fat][direction]  -> overlay native id (carried ware/tool)
 *
 * Add `overlay_base` to a links value to get the overlay's shared sprite key.
 * Directions are the S2 BOB order {W, NW, NE, E, SE, SW} = index 0..5.
 */

import type { AtlasPage, AtlasSprite, SpriteAtlasMeta } from '@s2gold/renderer';
import { assetUrl, fetchJson } from '../lib/manifest';
import { hdAtlasDir } from './hd-assets';
import { loadMaskPages } from './sprite-atlas';

/** Raw bobs/<name>/atlas.json shape as emitted by the pipeline. */
interface BobAtlasJson {
  name: string;
  atlases: string[];
  pmasks?: string[];
  sprites: Record<string, AtlasSprite>;
  body_table: number[][][];
  links: number[][][][];
  body_base: number;
  overlay_base: number;
  /** Atlas pixels per world pixel (2 for the HD set; absent means 1). */
  scale?: number;
}

/** Parsed BOB atlas: renderer metadata plus its composition tables. */
export interface BobAtlas {
  /** Archive key the sprite renderer indexes this atlas by. */
  readonly archive: string;
  readonly meta: SpriteAtlasMeta;
  readonly pages: readonly AtlasPage[];
  /** Player-colour mask pages (index-aligned with `pages`; null when absent). */
  readonly pmaskPages: readonly (AtlasPage | null)[];
  /** `[fat][direction][step]` -> body sprite key. */
  readonly bodyTable: number[][][];
  /** `[job][step][fat][direction]` -> overlay native index. */
  readonly links: number[][][][];
  /** Offset added to a links value to resolve the overlay's sprite key. */
  readonly overlayBase: number;
}

function parseMeta(archive: string, raw: BobAtlasJson): SpriteAtlasMeta {
  const sprites = new Map<number, AtlasSprite>();
  for (const [key, value] of Object.entries(raw.sprites)) {
    const idx = Number(key);
    if (Number.isFinite(idx)) sprites.set(idx, value);
  }
  const scale = typeof raw.scale === 'number' && raw.scale > 0 ? raw.scale : 1;
  return { archive, atlases: raw.atlases, sprites, pmasks: [], scale };
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

/**
 * Fetch and decode a BOB atlas by name (e.g. `carrier`). The atlas is
 * registered under `archive` (defaults to the bob name) so callers reference
 * its sprites from that archive. With `scale` 2 the HD set is used when the
 * pipeline built one. Returns null when the atlas is not installed.
 */
export async function loadBobAtlas(
  name: string,
  archive = name,
  scale = 1,
): Promise<BobAtlas | null> {
  const hdDir = scale > 1 ? await hdAtlasDir('bobs', name) : null;
  if (hdDir) {
    const hd = await loadBobAtlasFrom(hdDir, archive);
    if (hd) return hd;
  }
  return loadBobAtlasFrom(`bobs/${name}`, archive);
}

async function loadBobAtlasFrom(dir: string, archive: string): Promise<BobAtlas | null> {
  const raw = await fetchJson<BobAtlasJson>(assetUrl(`${dir}/atlas.json`));
  if (!raw || !raw.sprites || !Array.isArray(raw.atlases) || !Array.isArray(raw.body_table)) {
    return null;
  }
  const meta = parseMeta(archive, raw);
  const pages = await Promise.all(raw.atlases.map((file) => loadImage(assetUrl(`${dir}/${file}`))));
  const pmaskPages = await loadMaskPages(dir, raw.pmasks, raw.atlases.length);
  return {
    archive,
    meta,
    pages,
    pmaskPages,
    bodyTable: raw.body_table,
    links: raw.links,
    overlayBase: raw.overlay_base,
  };
}
