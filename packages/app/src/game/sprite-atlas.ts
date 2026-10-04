/**
 * Load a graphics atlas (the `atlas.json` + `atlas_N.png` pair produced by the
 * pipeline) into the shapes the sprite renderer consumes.
 */

import type { AtlasPage, AtlasSprite, SpriteAtlasMeta } from '@s2gold/renderer';
import { assetUrl, fetchJson } from '../lib/manifest';
import { hdAtlasDir } from './hd-assets';

/** Raw atlas.json shape as emitted by the pipeline. */
interface AtlasJson {
  archive: string;
  atlases: string[];
  sprites: Record<string, AtlasSprite>;
  /** Player-colour mask page filenames (index-aligned with `atlases`). */
  pmasks?: string[];
  /** Atlas pixels per world pixel (2 for the HD set; absent means 1). */
  scale?: number;
}

/** Parsed atlas metadata plus its decoded page images. */
export interface LoadedAtlas {
  readonly meta: SpriteAtlasMeta;
  readonly pages: readonly AtlasPage[];
  /** Player-colour mask pages (index-aligned with `pages`; null when absent). */
  readonly pmaskPages: readonly (AtlasPage | null)[];
}

function parseMeta(raw: AtlasJson): SpriteAtlasMeta {
  const sprites = new Map<number, AtlasSprite>();
  for (const [key, value] of Object.entries(raw.sprites)) {
    const idx = Number(key);
    if (!Number.isFinite(idx)) continue;
    sprites.set(idx, value);
  }
  return {
    archive: raw.archive,
    atlases: raw.atlases,
    sprites,
    // Mask *pages* are loaded separately (see loadMaskPages); the per-sprite
    // `pmask` flag drives tinting, so this vestigial index list stays empty.
    pmasks: [],
    scale: typeof raw.scale === 'number' && raw.scale > 0 ? raw.scale : 1,
  };
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

/**
 * Fetch and decode an atlas by archive name from
 * `/assets/graphics/<archive>/`. With `scale` 2 the archive's HD set is used
 * when the pipeline built one, else the original art. Returns null when the
 * atlas is not installed.
 */
export async function loadAtlas(archive: string, scale = 1): Promise<LoadedAtlas | null> {
  const hdDir = scale > 1 ? await hdAtlasDir('graphics', archive) : null;
  if (hdDir) {
    const hd = await loadAtlasFrom(hdDir);
    if (hd) return hd;
  }
  return loadAtlasFrom(`graphics/${archive}`);
}

async function loadAtlasFrom(dir: string): Promise<LoadedAtlas | null> {
  const raw = await fetchJson<AtlasJson>(assetUrl(`${dir}/atlas.json`));
  if (!raw || !raw.sprites || !Array.isArray(raw.atlases)) return null;
  const meta = parseMeta(raw);
  const pages = await Promise.all(raw.atlases.map((name) => loadImage(assetUrl(`${dir}/${name}`))));
  const pmaskPages = await loadMaskPages(dir, raw.pmasks, raw.atlases.length);
  return { meta, pages, pmaskPages };
}

/**
 * Load the pmask page images for an archive (index-aligned with the atlas
 * pages; null where a mask is absent). Missing masks degrade gracefully to no
 * recolour rather than failing the whole atlas load.
 */
export async function loadMaskPages(
  dir: string,
  masks: readonly string[] | undefined,
  pageCount: number,
): Promise<(AtlasPage | null)[]> {
  const out: (AtlasPage | null)[] = new Array<AtlasPage | null>(pageCount).fill(null);
  if (!masks) return out;
  await Promise.all(
    masks.slice(0, pageCount).map(async (file, i) => {
      try {
        out[i] = await loadImage(assetUrl(`${dir}/${file}`));
      } catch {
        out[i] = null;
      }
    }),
  );
  return out;
}
