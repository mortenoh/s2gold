/**
 * Terrain-id classification for buildability and walkability.
 *
 * Terrain ids are the low 6 bits of a texture1/texture2 byte (mask 0x3f, per
 * the renderer's TERRAIN_ID_MASK). The semantic groupings below follow the
 * GREENLAND landscape set (the P2 target map MISS200 is greenland); wasteland
 * and winter reuse the same id slots for different materials, so those sets need
 * their own tables later.
 *
 * TODO(CONSTANTS): add wasteland/winter classification once needed (P3+). The
 * impassable set is parameterizable so callers can override per landscape.
 */

/** Low-6-bit mask isolating the terrain id from a texture byte (FACT). */
export const TERRAIN_ID_MASK = 0x3f;

/** Extract the terrain id from a raw texture byte. */
export function terrainId(textureByte: number): number {
  return textureByte & TERRAIN_ID_MASK;
}

/** Meadow/grass family — buildable ground for normal buildings (greenland). */
export const BUILDABLE_IDS: ReadonlySet<number> = new Set([
  0x08, // meadow 1
  0x09, // meadow 2
  0x0a, // meadow 3
  0x0f, // meadow with flowers
  0x0e, // steppe
  0x00, // savannah
]);

/** Mountain family — walkable and mineable, but only mines may be built. */
export const MOUNTAIN_IDS: ReadonlySet<number> = new Set([
  0x01, 0x0b, 0x0c, 0x0d, 0x12, 0x22,
]);

/**
 * Impassable terrain ids (greenland): water, reef, swamp and lava. Snow (0x02)
 * belongs to winter but is included for safety. Parameterizable via
 * {@link TerrainRules}.
 */
export const DEFAULT_IMPASSABLE: ReadonlySet<number> = new Set([
  0x02, // snow (winter) — impassable
  0x03, // swamp (greenland)
  0x05, // water
  0x06, // shallow/buildable water — treated impassable for walking
  0x10, // lava
  0x11, // lava (variant)
  0x13, // reef water
  0x14, // lava 2
  0x15, // lava 3
  0x16, // lava 4
]);

/** Configurable terrain semantics used by geometry-aware systems. */
export interface TerrainRules {
  readonly buildable: ReadonlySet<number>;
  readonly impassable: ReadonlySet<number>;
}

/** Default rules for the greenland landscape set. */
export const GREENLAND_RULES: TerrainRules = {
  buildable: BUILDABLE_IDS,
  impassable: DEFAULT_IMPASSABLE,
};

/** True when a texture byte is buildable ground under the given rules. */
export function isBuildableTexture(textureByte: number, rules: TerrainRules): boolean {
  return rules.buildable.has(terrainId(textureByte));
}

/** True when a texture byte is passable for a walking settler. */
export function isWalkableTexture(textureByte: number, rules: TerrainRules): boolean {
  return !rules.impassable.has(terrainId(textureByte));
}

/** True when a texture byte is mountain family (mineable; only mines build here). */
export function isMountainTexture(textureByte: number): boolean {
  return MOUNTAIN_IDS.has(terrainId(textureByte));
}

// --- Water / seafaring classification (P7) --------------------------------

/**
 * Navigable water terrain ids (greenland): open water (0x05) and shallow water
 * (0x06). Reef (0x13) and lava are impassable to ships and stay out of the set.
 * Ships path over nodes whose surrounding texture is navigable water; harbors
 * are land nodes adjacent to it.
 */
export const NAVIGABLE_WATER_IDS: ReadonlySet<number> = new Set([
  0x05, // water
  0x06, // shallow water
]);

/**
 * High-bit flag some WLD texture bytes carry to mark an explicit harbor spot
 * (bit 0x40, above the 6-bit terrain id). When present the map author placed a
 * harbor point there; when absent we fall back to a coast heuristic. This bit is
 * outside {@link TERRAIN_ID_MASK}, so it never affects terrain-id classification.
 */
export const HARBOR_TEXTURE_FLAG = 0x40;

/** True when a texture byte is navigable water (open or shallow). */
export function isWaterTexture(textureByte: number): boolean {
  return NAVIGABLE_WATER_IDS.has(terrainId(textureByte));
}

/** True when a texture byte carries the explicit harbor-spot flag (bit 0x40). */
export function hasHarborFlag(textureByte: number): boolean {
  return (textureByte & HARBOR_TEXTURE_FLAG) !== 0;
}
