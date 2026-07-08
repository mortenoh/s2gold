/**
 * Settlers II terrain constants: the triangular-lattice metrics, the terrain-id
 * to texture-atlas rectangle table, and the per-landscape minimap colors.
 *
 * All numbers here are uncopyrightable facts extracted from the original game
 * data and cross-checked against two independent, clean references (no code was
 * copied):
 *
 *  - Lattice metrics (TR_W, TR_H, HEIGHT_FACTOR) and neighbour offsets:
 *    Return-to-the-Roots `libs/s25main/gameData/MapConsts.h` and
 *    `libs/s25main/world/MapGeometry.cpp` (fact extraction only).
 *  - Terrain-id -> atlas rectangle (`pos`): the modern RttR terrain descriptions
 *    `data/RTTR/gamedata/world/{greenland,wasteland,winterworld}.lua`. The `pos`
 *    rectangles are identical across all three landscape sets (only the pixels
 *    inside TEX5/TEX6/TEX7 differ), so a single table serves every map.
 *  - Minimap colors: RttR legacy `TerrainData::GetColor` (0xAARRGGBB constants).
 *  - Triangle vertex/UV layout: RttR `TerrainDesc::Get{RSU,USD}Triangle` +
 *    `TerrainRenderer::UpdateTriangle{Pos,Terrain}` (Overlapped texture type).
 *
 * See docs/PLAN.md workstream C. The gouraud palette-LUT lighting path is a
 * later phase; P1 approximates lighting with the per-node shading byte.
 */

/** Horizontal pixel distance between adjacent nodes in a row. */
export const TR_W = 56;
/** Vertical pixel distance between rows. */
export const TR_H = 28;
/** Pixels a node is raised on screen per unit of the height layer. */
export const HEIGHT_FACTOR = 5;

/** Size (px) of the square terrain texture atlas (TEX5/TEX6/TEX7). */
export const ATLAS_SIZE = 256;

/** Low-6-bits mask that isolates the terrain id from the texture byte. */
export const TERRAIN_ID_MASK = 0x3f;

/** A rectangle in the texture atlas: [x, y, width, height] in pixels. */
export type AtlasRect = readonly [number, number, number, number];

/**
 * How the two triangles of a node sample their atlas rectangle.
 *
 * - `overlapped`: RSU tip at middle-top with base at the bottom edge; USD tip
 *   at middle-bottom with base at the top edge (both share the full rect).
 * - `stacked`: both triangles keep their base on the horizontal middle line.
 * - `rotated`: the rect holds a diamond (water/lava); triangles sample the
 *   halves between the middle line and the vertical tips.
 */
export type TexType = 'overlapped' | 'stacked' | 'rotated';

/** Terrain ids whose atlas rect is a diamond (water and flowing lava). */
const ROTATED_IDS = new Set([0x05, 0x06, 0x10, 0x11, 0x13]);
/** Terrain ids for the small lava variants stored as stacked squares. */
const STACKED_IDS = new Set([0x14, 0x15, 0x16]);

/** Return how a terrain id samples its atlas rectangle. */
export function texTypeForTexture(textureByte: number): TexType {
  const id = textureByte & TERRAIN_ID_MASK;
  if (ROTATED_IDS.has(id)) return 'rotated';
  if (STACKED_IDS.has(id)) return 'stacked';
  return 'overlapped';
}

/**
 * Terrain id (low 6 bits of a texture1/texture2 byte) -> atlas rectangle.
 *
 * Ids not present here (e.g. 0x11 outside wasteland, 0x17-0x21, 0x23+) are rare
 * editor/unused values; the renderer falls back to {@link FALLBACK_RECT}.
 */
export const TERRAIN_RECTS: Readonly<Record<number, AtlasRect>> = {
  0x00: [0, 96, 32, 31], // savannah / dry steppe / taiga
  0x01: [0, 48, 32, 31], // mountain 1
  0x02: [0, 0, 32, 31], // snow / lava-few-stone / ice floe
  0x03: [96, 0, 32, 31], // swamp / lava-many-stone / ice floes
  0x04: [48, 0, 32, 31], // desert 1 / wasteland 1 / ice 1
  0x05: [193, 49, 53, 54], // water
  0x06: [193, 49, 53, 54], // shallow / buildable water
  0x07: [48, 0, 32, 31], // desert 2 / wasteland 2 / ice 2
  0x08: [48, 96, 32, 31], // meadow 1 / pasture 1 / tundra 1
  0x09: [96, 96, 32, 31], // meadow 2
  0x0a: [144, 96, 32, 31], // meadow 3
  0x0b: [48, 48, 32, 31], // mountain 2
  0x0c: [96, 48, 32, 31], // mountain 3
  0x0d: [144, 48, 32, 31], // mountain 4
  0x0e: [0, 144, 32, 31], // steppe
  0x0f: [144, 0, 32, 31], // meadow with flowers
  0x10: [193, 105, 53, 54], // lava
  0x11: [193, 105, 53, 54], // lava (wasteland variant)
  0x12: [48, 144, 32, 31], // mountain meadow / snow (winter)
  0x13: [193, 49, 53, 54], // reef water
  0x14: [66, 222, 31, 33], // lava 2
  0x15: [99, 222, 31, 33], // lava 3
  0x16: [132, 222, 31, 33], // lava 4
  0x22: [48, 48, 32, 31], // flat (buildable) mountain
};

/** Rectangle used for terrain ids without an explicit mapping. */
export const FALLBACK_RECT: AtlasRect = [0, 96, 32, 31];

/** Landscape set: 0 = greenland, 1 = wasteland, 2 = winter. */
export type LandscapeSet = 0 | 1 | 2;

/**
 * Terrain id -> packed 0xRRGGBB minimap color, per landscape set. Derived from
 * RttR `TerrainData::GetColor`. Ids sharing a base terrain reuse its color.
 */
const GREENLAND_COLORS: Readonly<Record<number, number>> = {
  0x00: 0x649014, // savannah
  0x01: 0x9c8058, // mountain
  0x02: 0xffffff, // snow
  0x03: 0x649014, // swamp
  0x04: 0xc09c7c, // desert
  0x05: 0x1038a4, // water
  0x06: 0x1038a4,
  0x07: 0xc09c7c, // desert 2
  0x08: 0x48780c, // meadow 1
  0x09: 0x649014, // meadow 2
  0x0a: 0x407008, // meadow 3
  0x0b: 0x9c8058,
  0x0c: 0x9c8058,
  0x0d: 0x8c7048,
  0x0e: 0x88b028, // steppe
  0x0f: 0x48780c, // flowers
  0x10: 0xc02020, // lava
  0x11: 0xc02020,
  0x12: 0x9c8058, // mountain meadow
  0x13: 0x1038a4,
  0x14: 0xc02020,
  0x15: 0xc02020,
  0x16: 0xc02020,
  0x22: 0x9c8058,
};

const WASTELAND_COLORS: Readonly<Record<number, number>> = {
  0x00: 0x444850,
  0x01: 0x706c54,
  0x02: 0x860000, // lava-few-stone
  0x03: 0x001820,
  0x04: 0x9c7c64,
  0x05: 0x454520, // moor
  0x06: 0x454520,
  0x07: 0x9c7c64,
  0x08: 0x5c5840,
  0x09: 0x646048,
  0x0a: 0x646048,
  0x0b: 0x706454,
  0x0c: 0x684c24,
  0x0d: 0x684c24,
  0x0e: 0x88b028,
  0x0f: 0x444850,
  0x10: 0xc32020,
  0x11: 0xc32020,
  0x12: 0x001820,
  0x13: 0x454520,
  0x14: 0xc32020,
  0x15: 0xc32020,
  0x16: 0xc32020,
  0x22: 0x706454,
};

const WINTER_COLORS: Readonly<Record<number, number>> = {
  0x00: 0xa0accc, // taiga
  0x01: 0x54586c,
  0x02: 0x00286c, // ice floe
  0x03: 0x00286c,
  0x04: 0x0070b0, // ice
  0x05: 0x1038a4, // water
  0x06: 0x1038a4,
  0x07: 0x0070b0,
  0x08: 0xb0a494, // tundra 1
  0x09: 0x88a874,
  0x0a: 0xa0accc,
  0x0b: 0x60607c,
  0x0c: 0x686c8c,
  0x0d: 0x686c8c,
  0x0e: 0x88b15e,
  0x0f: 0x7c84ac,
  0x10: 0xc02020,
  0x11: 0xc02020,
  0x12: 0x94a0c0, // snow
  0x13: 0x1038a4,
  0x14: 0xc02020,
  0x15: 0xc02020,
  0x16: 0xc02020,
  0x22: 0x60607c,
};

const LANDSCAPE_COLORS: readonly Readonly<Record<number, number>>[] = [
  GREENLAND_COLORS,
  WASTELAND_COLORS,
  WINTER_COLORS,
];

const FALLBACK_COLOR = 0x808080;

/** Return the atlas rectangle for a raw texture byte (flags masked off). */
export function rectForTexture(textureByte: number): AtlasRect {
  return TERRAIN_RECTS[textureByte & TERRAIN_ID_MASK] ?? FALLBACK_RECT;
}

/** Return the packed 0xRRGGBB minimap color for a texture byte + landscape. */
export function minimapColor(textureByte: number, landscape: LandscapeSet): number {
  const table = LANDSCAPE_COLORS[landscape] ?? GREENLAND_COLORS;
  return table[textureByte & TERRAIN_ID_MASK] ?? FALLBACK_COLOR;
}
