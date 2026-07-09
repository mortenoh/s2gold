/**
 * Load a graphics atlas (the `atlas.json` + `atlas_N.png` pair produced by the
 * pipeline) into the shapes the sprite renderer consumes.
 */

import type { AtlasPage, AtlasSprite, SpriteAtlasMeta } from '@s2gold/renderer';
import { assetUrl, fetchJson } from '../lib/manifest';

/** Raw atlas.json shape as emitted by the pipeline. */
interface AtlasJson {
  archive: string;
  atlases: string[];
  sprites: Record<string, AtlasSprite>;
  /** Player-colour mask page filenames (index-aligned with `atlases`). */
  pmasks?: string[];
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
 * `/assets/graphics/<archive>/`. Returns null when the atlas is not installed.
 */
export async function loadAtlas(archive: string): Promise<LoadedAtlas | null> {
  const raw = await fetchJson<AtlasJson>(assetUrl(`graphics/${archive}/atlas.json`));
  if (!raw || !raw.sprites || !Array.isArray(raw.atlases)) return null;
  const meta = parseMeta(raw);
  const pages = await Promise.all(
    raw.atlases.map((name) => loadImage(assetUrl(`graphics/${archive}/${name}`))),
  );
  const pmaskPages = await loadMaskPages(`graphics/${archive}`, raw.pmasks, raw.atlases.length);
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
