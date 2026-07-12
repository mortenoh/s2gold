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

// --- Terrain edges (border blending) ----------------------------------------
//
// Where two lattice triangles of different edge priority meet, the higher-
// priority terrain paints its 64x16 edge strip across the boundary. Strip
// positions and the per-terrain (edge slot, priority) tables are facts from
// the RttR world descriptions (greenland/wasteland/winterworld.lua); slots
// index the five strip rows at x=192, y=176+16*slot, identical in TEX5/6/7.

/** Atlas rectangle of an edge strip slot (0..4). */
export function edgeStripRect(slot: number): AtlasRect {
  return [192, 176 + slot * 16, 64, 16];
}

/** [edge slot | null, edge priority] per terrain id, greenland. */
const GREENLAND_EDGES: Readonly<Record<number, readonly [number | null, number]>> = {
  0x00: [2, 15], // savannah -> desert edge
  0x01: [1, 55], // mountain 1
  0x02: [0, 75], // snow
  0x03: [3, 10], // swamp -> meadow edge
  0x04: [2, 65], // desert
  0x05: [4, 5], // water
  0x06: [4, 80], // shallow/buildable water
  0x07: [2, 65],
  0x08: [3, 30], // meadow 1
  0x09: [3, 25],
  0x0a: [3, 20],
  0x0b: [1, 50], // mountain 2
  0x0c: [1, 45],
  0x0d: [1, 40],
  0x0e: [2, 60], // steppe
  0x0f: [3, 35], // flowers
  0x10: [null, 0], // lava
  0x12: [1, 70], // mountain meadow
  0x13: [4, 80], // reef water
  0x14: [null, 0],
  0x15: [null, 0],
  0x16: [null, 0],
  0x22: [1, 50], // flat mountain
};

/** [edge slot | null, edge priority] per terrain id, wasteland. Slots: 0 stone, 1 moor, 2 wasteland, 3 mountain. */
const WASTELAND_EDGES: Readonly<Record<number, readonly [number | null, number]>> = {
  0x00: [3, 40],
  0x01: [3, 30],
  0x02: [null, 20],
  0x03: [0, 80], // lava-many-stones -> stone edge
  0x04: [2, 50],
  0x05: [1, 70], // moor
  0x06: [1, 70],
  0x07: [2, 50],
  0x08: [3, 40], // pasture
  0x09: [3, 40],
  0x0a: [3, 40],
  0x0b: [3, 30],
  0x0c: [3, 30],
  0x0d: [3, 30],
  0x0e: [2, 60],
  0x0f: [3, 40],
  0x10: [null, 10],
  0x11: [null, 10],
  0x12: [0, 90], // alpine pasture -> stone edge
  0x13: [1, 70],
  0x14: [null, 10],
  0x15: [null, 10],
  0x16: [null, 10],
  0x22: [3, 30],
};

/** [edge slot | null, edge priority] per terrain id, winter. Slots: 0 snow, 1 mountain, 2 ice, 3 tundra, 4 water. */
const WINTER_EDGES: Readonly<Record<number, readonly [number | null, number]>> = {
  0x00: [3, 18], // taiga
  0x01: [1, 48],
  0x02: [4, 73], // ice floe
  0x03: [4, 83], // ice floes
  0x04: [2, 43], // ice
  0x05: [4, 78], // water
  0x06: [4, 78],
  0x07: [2, 43],
  0x08: [3, 23], // tundra
  0x09: [3, 28],
  0x0a: [3, 33],
  0x0b: [1, 63],
  0x0c: [1, 58],
  0x0d: [1, 53],
  0x0e: [3, 8],
  0x0f: [3, 13],
  0x10: [null, 0],
  0x12: [0, 68], // snow
  0x13: [4, 78],
  0x14: [null, 0],
  0x15: [null, 0],
  0x16: [null, 0],
  0x22: [1, 38],
};

const EDGES_BY_LANDSCAPE = [GREENLAND_EDGES, WASTELAND_EDGES, WINTER_EDGES] as const;

/** Edge strip slot + priority for a texture byte in a landscape. */
export function edgeInfoForTexture(
  textureByte: number,
  landscape: LandscapeSet,
): { slot: number | null; priority: number } {
  const entry = EDGES_BY_LANDSCAPE[landscape][textureByte & TERRAIN_ID_MASK];
  if (!entry) return { slot: null, priority: 0 };
  return { slot: entry[0], priority: entry[1] };
}

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
