/**
 * Map + terrain asset loading for the game page.
 *
 * Maps are converted WLD/SWD files: a JSON header plus 14 base64-encoded raw
 * layers (one byte per node, row-major width * height). See
 * src/s2gold/formats/wld.py for the schema. The renderer needs 4 of the 14
 * layers; the rest are decoded lazily by later phases.
 */

import type { LandscapeSet, TerrainMapData } from '@s2gold/renderer';
import { assetUrl, fetchJson } from '../lib/manifest';

/** Entry in maps/index.json. */
export interface MapIndexEntry {
  file: string;
  name: string;
  title: string;
  width: number;
  height: number;
  players: number;
  terrain: number;
  terrain_name: string;
}

/** Parsed map JSON (subset of fields the game page consumes). */
export interface LoadedMap {
  readonly name: string;
  readonly title: string;
  readonly terrain: LandscapeSet;
  readonly hqX: readonly number[];
  readonly hqY: readonly number[];
  readonly data: TerrainMapData;
  /** Object classification plane (row-major width*height). */
  readonly objectType: Uint8Array;
  /** Object variant/state plane (row-major width*height). */
  readonly objectIndex: Uint8Array;
}

interface MapJson {
  title: string;
  width: number;
  height: number;
  terrain: number;
  hq_x: number[];
  hq_y: number[];
  encoding: string;
  layers: Record<string, string>;
}

/** Terrain set -> tileset PNG under /assets/terrain/. */
const TERRAIN_TEXTURES: Record<number, string> = {
  0: 'terrain/tex5.png',
  1: 'terrain/tex6.png',
  2: 'terrain/tex7.png',
};

/** Decode a base64 string into bytes. */
export function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Load maps/index.json; null when assets are absent. */
export async function loadMapIndex(): Promise<MapIndexEntry[] | null> {
  const raw = await fetchJson<{ maps?: MapIndexEntry[] }>(assetUrl('maps/index.json'));
  if (!raw || !Array.isArray(raw.maps) || raw.maps.length === 0) return null;
  return raw.maps;
}

/** Fetch and decode one converted map. */
export async function loadMap(entry: MapIndexEntry): Promise<LoadedMap> {
  const raw = await fetchJson<MapJson>(assetUrl(entry.file));
  if (!raw) throw new Error(`failed to load map ${entry.file}`);
  if (raw.encoding !== 'base64') throw new Error(`unexpected layer encoding: ${raw.encoding}`);

  const layer = (name: string): Uint8Array => {
    const b64 = raw.layers[name];
    if (b64 === undefined) throw new Error(`map ${entry.name} is missing layer ${name}`);
    return decodeBase64(b64);
  };

  const terrain = (raw.terrain >= 0 && raw.terrain <= 2 ? raw.terrain : 0) as LandscapeSet;
  return {
    name: entry.name,
    title: raw.title,
    terrain,
    hqX: raw.hq_x ?? [],
    hqY: raw.hq_y ?? [],
    objectType: layer('object_type'),
    objectIndex: layer('object_index'),
    data: {
      width: raw.width,
      height: raw.height,
      landscape: terrain,
      heightLayer: layer('height'),
      texture1: layer('texture1'),
      texture2: layer('texture2'),
      shading: layer('shading'),
    },
  };
}

/** Load the terrain tileset image for a landscape set. */
export async function loadTerrainImage(terrain: LandscapeSet): Promise<HTMLImageElement> {
  const rel = TERRAIN_TEXTURES[terrain] ?? TERRAIN_TEXTURES[0];
  const img = new Image();
  img.src = assetUrl(rel ?? 'terrain/tex5.png');
  await img.decode();
  return img;
}

/** Pick the entry for ?map= (by name or file substring), else miss200, else first. */
export function pickMap(index: MapIndexEntry[], query: string | null): MapIndexEntry {
  if (query) {
    const wanted = index.find((m) => m.name === query || m.file.includes(query));
    if (wanted) return wanted;
  }
  const campaign = index.find((m) => m.file.includes('miss200'));
  const first = index[0];
  if (!first) throw new Error('map index is empty');
  return campaign ?? first;
}
