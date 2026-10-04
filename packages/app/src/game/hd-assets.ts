/**
 * Where the 2x HD graphics set lives, read from the asset manifest written by
 * the pipeline (`graphics_hd`, `bobs_hd`, and `indexed_hd` on each terrain
 * texture). Loaders ask here and fall back to the original art for anything
 * the manifest does not list, so a pipeline run with `--no-hd` still works.
 */

import { loadManifest } from '../lib/manifest';

interface HdIndex {
  readonly graphics: ReadonlyMap<string, string>;
  readonly bobs: ReadonlyMap<string, string>;
  readonly terrain: ReadonlyMap<string, string>;
}

let cached: Promise<HdIndex> | null = null;

function archives(category: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const list = (category as { archives?: Record<string, unknown> } | undefined)?.archives;
  if (!list || typeof list !== 'object') return out;
  for (const [name, path] of Object.entries(list)) {
    if (typeof path === 'string') out.set(name, path);
  }
  return out;
}

async function buildIndex(): Promise<HdIndex> {
  const manifest = await loadManifest();
  const cats = manifest?.categories ?? {};
  const terrain = new Map<string, string>();
  const textures = (cats.terrain as { textures?: Record<string, unknown> } | undefined)?.textures;
  for (const [name, entry] of Object.entries(textures ?? {})) {
    const path = (entry as { indexed_hd?: { path?: unknown } } | null)?.indexed_hd?.path;
    if (typeof path === 'string') terrain.set(name, path);
  }
  return { graphics: archives(cats.graphics_hd), bobs: archives(cats.bobs_hd), terrain };
}

function index(): Promise<HdIndex> {
  cached ??= buildIndex();
  return cached;
}

/** Directory of an archive's HD set (e.g. `graphics/rom_z/hd2`), or null. */
export async function hdAtlasDir(kind: 'graphics' | 'bobs', name: string): Promise<string | null> {
  const path = (await index())[kind].get(name);
  return path ? path.replace(/\/atlas\.json$/, '') : null;
}

/** Path of a terrain texture's HD index image, or null. */
export async function hdTerrainPath(tex: string): Promise<string | null> {
  return (await index()).terrain.get(tex) ?? null;
}
