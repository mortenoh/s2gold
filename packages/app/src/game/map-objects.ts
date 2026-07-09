/**
 * Translate a map's object layers into renderer {@link StaticObject}s.
 *
 * The WLD map stores two object planes per node (one byte each): `object_type`
 * classifies the object and `object_index` selects the variant/state. The
 * decoding below is the clean-room fact table extracted from Return-to-the-Roots
 * `world/MapLoader.cpp::PlaceObjects` and the MAPBOBS sprite indices from
 * `Loader.cpp` (uncopyrightable numeric constants, no code copied):
 *
 *   object_type            meaning                        MAPBOBS sprite base
 *   ----------------------------------------------------------------------------
 *   0x80                   player HQ start position        (handled by camera)
 *   0xC4                   trees, species 0-3             200 + species*15
 *   0xC5                   trees, species 4-7             200 + species*15
 *   0xC6                   tree,  species 8               200 + species*15
 *   0xC8 / 0xC9            decoration (nature clutter)    500 + index (subset)
 *   0xCC                   granite type 1, 6 sizes        516 + 0*6 + size
 *   0xCD                   granite type 2, 6 sizes        516 + 1*6 + size
 *
 * For a species the grown tree is 8 waving frames at `200 + species*15 + 0..7`
 * with shadows at `350 + species*15 + 0..7`; object_index encodes the species
 * band (0x30/0x70/0xB0/0xF0) and its low nibble is the map-frozen wave frame,
 * which we ignore in favour of the live global animation.
 *
 * Granite: object_index 0x01..0x06 -> size 0..5 at `516 + type*6 + size`,
 * shadows at `616 + type*6 + size`.
 *
 * Decoration (0xC8): only object_index <= 0x0F is emitted -> `500 + index`,
 * the landscape clutter (small stones, mushrooms, bushes, cacti) that lives in
 * the same map_?_z archive as this atlas. Higher indices reference the shared
 * map.lst / mission bob archives that are not part of this atlas and are skipped
 * (see the report's coverage notes).
 */

import type { StaticObject } from '@s2gold/renderer';
import type { LandscapeSet } from '@s2gold/renderer';

const TREE_SPRITE_BASE = 200;
const TREE_SHADOW_BASE = 350;
const TREE_STRIDE = 15;
const TREE_FRAMES = 8;
const GRANITE_SPRITE_BASE = 516;
const GRANITE_SHADOW_BASE = 616;
const GRANITE_STRIDE = 6;
const DECO_SPRITE_BASE = 500;
const DECO_MAX_INDEX = 0x0f;

/** MAPBOBS-family atlas per landscape (trees/granite are shared across all). */
const ATLAS_BY_LANDSCAPE: Record<LandscapeSet, string> = {
  0: 'mapbobs', // greenland (mapbobs.lst + map_0_z.lst)
  1: 'mapbobs0', // wasteland
  2: 'mapbobs1', // winter
};

/** Return the graphics archive that holds a landscape's map objects. */
export function objectAtlasForLandscape(landscape: LandscapeSet): string {
  return ATLAS_BY_LANDSCAPE[landscape] ?? 'mapbobs';
}

/** Per-category tallies of the objects produced (for debug + tests). */
export interface ObjectCounts {
  trees: number;
  granite: number;
  decorations: number;
  skipped: number;
}

/** The translated objects plus category tallies. */
export interface BuiltObjects {
  readonly objects: readonly StaticObject[];
  readonly counts: ObjectCounts;
}

/** Map an object_index tree band (0x30/0x70/0xB0/0xF0) to a 0..3 species offset. */
function treeBand(index: number): number | null {
  if (index >= 0x30 && index <= 0x3d) return 0;
  if (index >= 0x70 && index <= 0x7d) return 1;
  if (index >= 0xb0 && index <= 0xbd) return 2;
  if (index >= 0xf0 && index <= 0xfd) return 3;
  return null;
}

/** A gentle per-node phase so neighbouring trees wave out of step. */
function wavePhase(x: number, y: number, species: number): number {
  return (x * 13 + y * 7 + species * 5) % TREE_FRAMES;
}

function pushTree(
  out: StaticObject[],
  archive: string,
  x: number,
  y: number,
  species: number,
): void {
  const base = TREE_SPRITE_BASE + species * TREE_STRIDE;
  out.push({
    node: { x, y },
    archive,
    spriteIndex: base,
    shadowIndex: TREE_SHADOW_BASE + species * TREE_STRIDE,
    animation: { baseIndex: base, frameCount: TREE_FRAMES, phase: wavePhase(x, y, species) },
  });
}

/**
 * Build the static object list for a map from its object layers.
 *
 * @param width Map width in nodes.
 * @param height Map height in nodes.
 * @param objectType `object_type` plane (row-major width*height).
 * @param objectIndex `object_index` plane (row-major width*height).
 * @param landscape Landscape set, selecting the object atlas.
 */
export function buildStaticObjects(
  width: number,
  height: number,
  objectType: ArrayLike<number>,
  objectIndex: ArrayLike<number>,
  landscape: LandscapeSet,
): BuiltObjects {
  const archive = objectAtlasForLandscape(landscape);
  const objects: StaticObject[] = [];
  const counts: ObjectCounts = { trees: 0, granite: 0, decorations: 0, skipped: 0 };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const type = objectType[i] ?? 0;
      if (type === 0) continue;
      const index = objectIndex[i] ?? 0;

      switch (type) {
        case 0xc4:
        case 0xc5:
        case 0xc6: {
          const band = treeBand(index);
          if (band === null) {
            counts.skipped++;
            break;
          }
          const speciesBase = type === 0xc4 ? 0 : type === 0xc5 ? 4 : 8;
          const species = speciesBase + band;
          // 0xC6 only defines species 8 (band must be 0).
          if (species > 8) {
            counts.skipped++;
            break;
          }
          pushTree(objects, archive, x, y, species);
          counts.trees++;
          break;
        }
        case 0xcc:
        case 0xcd: {
          if (index < 0x01 || index > 0x06) {
            counts.skipped++;
            break;
          }
          const graniteType = type === 0xcc ? 0 : 1;
          const size = index - 1;
          const sprite = GRANITE_SPRITE_BASE + graniteType * GRANITE_STRIDE + size;
          objects.push({
            node: { x, y },
            archive,
            spriteIndex: sprite,
            shadowIndex: GRANITE_SHADOW_BASE + graniteType * GRANITE_STRIDE + size,
          });
          counts.granite++;
          break;
        }
        case 0xc8:
        case 0xc9: {
          if (index > DECO_MAX_INDEX) {
            // Higher indices reference map.lst / mission bobs (other archives).
            counts.skipped++;
            break;
          }
          objects.push({ node: { x, y }, archive, spriteIndex: DECO_SPRITE_BASE + index });
          counts.decorations++;
          break;
        }
        case 0x80:
          // Player HQ start marker: positioned via hq_x/hq_y, not a sprite.
          break;
        default:
          counts.skipped++;
          break;
      }
    }
  }

  return { objects, counts };
}
