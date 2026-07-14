/**
 * Terrain-id classification for buildability and walkability.
 *
 * Terrain ids are the low 6 bits of a texture1/texture2 byte (mask 0x3f, per
 * the renderer's TERRAIN_ID_MASK). A texture-id *slot* holds a different material
 * in each landscape set, so the buildable/impassable tables are per-landscape and
 * selected with {@link rulesForLandscape} from the map's landscape id (matching
 * the renderer's LandscapeSet: 0 greenland, 1 wasteland, 2 winter).
 *
 * The classifications are researched facts cross-checked against the RttR terrain
 * descriptions (data/RTTR/gamedata/world/{greenland,wasteland,winterworld}.lua)
 * and the per-landscape id semantics already encoded in the renderer's minimap
 * colour tables (packages/renderer/src/terrain-data.ts). The meadow/steppe/
 * savannah family (0x00, 0x08-0x0a, 0x0e, 0x0f) plus mountain-meadow (0x12) is
 * buildable ground in every landscape; landscapes differ mainly in which slots
 * are impassable hazards:
 *
 *  - greenland: swamp (0x03) and snow (0x02) join the shared water/lava set.
 *  - winter: the desert slots become ICE (0x04, 0x07) — unwalkable.
 *  - wasteland: the desert slots (0x04, 0x07) stay walkable sand.
 *
 * Mountain-meadow (0x12, "alpine pasture" in wasteland, a green snow-meadow in
 * winter) is green, walkable, buildable ground in all three sets — the original
 * build-quality layer marks it flag/hut/castle (never mine), so it is grouped
 * with the meadow family, not the mountains.
 *
 * Greenland's 0x06 slot ("buildable water") is likewise buildable ground: it
 * renders like shallow water but the original build layer marks it flag/house/
 * castle (never mine) and it carries subsurface well-water (never fish), so it
 * joins the meadow family and is kept out of the navigable-water set. It only
 * occurs in greenland maps.
 */

/** Low-6-bit mask isolating the terrain id from a texture byte (FACT). */
export const TERRAIN_ID_MASK = 0x3f;

/** Extract the terrain id from a raw texture byte. */
export function terrainId(textureByte: number): number {
  return textureByte & TERRAIN_ID_MASK;
}

/**
 * Meadow/grass family — buildable ground for normal buildings. Shared by all
 * three landscapes: these slots hold meadow (greenland), tundra/taiga (winter)
 * and pasture/dry-steppe (wasteland), all of which are walkable, buildable ground.
 */
export const BUILDABLE_IDS: ReadonlySet<number> = new Set([
  0x08, // meadow 1 / tundra 1 / pasture 1
  0x09, // meadow 2 / tundra 2 / pasture 2
  0x0a, // meadow 3 / tundra 3 / pasture 3
  0x0f, // meadow with flowers / winter meadow / dry steppe
  0x0e, // steppe
  0x00, // savannah / taiga / dry steppe
  0x12, // mountain meadow / alpine pasture — green, walkable, buildable ground
  0x06, // greenland "buildable water" — solid ground that renders like shallow
  //      water. The original build layer marks it flag/house/castle (49% castle
  //      across the shipped greenland maps, never mine), and it carries subsurface
  //      well-water (never fish), so it is buildable land, not sailable water.
  //      Greenland-only in the shipped maps; winter/wasteland carry no 0x06 node,
  //      so this is inert there (validated against the maps' own build layer).
]);

/** Mountain family — walkable and mineable, but only mines may be built. */
export const MOUNTAIN_IDS: ReadonlySet<number> = new Set([0x01, 0x0b, 0x0c, 0x0d, 0x22]);

/**
 * Impassable terrain ids (greenland): water, reef, swamp and lava. Snow (0x02)
 * belongs to winter but is included for safety. Parameterizable via
 * {@link TerrainRules}.
 */
export const DEFAULT_IMPASSABLE: ReadonlySet<number> = new Set([
  0x02, // snow (winter) — impassable
  0x03, // swamp (greenland)
  0x05, // water
  // 0x06 (greenland "buildable water") is deliberately absent: it is walkable,
  // buildable land, not a hazard (see BUILDABLE_IDS).
  0x10, // lava
  0x11, // lava (variant)
  0x13, // reef water
  0x14, // lava 2
  0x15, // lava 3
  0x16, // lava 4
]);

/**
 * Impassable terrain ids (winter): the shared greenland hazards plus the frozen
 * slots. In winter the desert slots become ICE (0x04, 0x07) and the greenland
 * mountain-meadow slot becomes deep SNOW (0x12); all are unwalkable, matching the
 * ice floes (0x02, 0x03) already carried by the shared set.
 */
export const WINTER_IMPASSABLE: ReadonlySet<number> = new Set([
  ...DEFAULT_IMPASSABLE,
  0x04, // ice 1
  0x07, // ice 2
]);

/**
 * Impassable terrain ids (wasteland): the shared greenland hazards plus the dark
 * MOOR that occupies the mountain-meadow slot (0x12). Wasteland lava rides the
 * shared flowing-lava ids (0x10, 0x11, 0x14-0x16); the desert slots (0x04, 0x07)
 * stay walkable sand, so they are deliberately absent here.
 */
export const WASTELAND_IMPASSABLE: ReadonlySet<number> = new Set([...DEFAULT_IMPASSABLE]);

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

/** Rules for the winter landscape set (ice + snow are unwalkable). */
export const WINTER_RULES: TerrainRules = {
  buildable: BUILDABLE_IDS,
  impassable: WINTER_IMPASSABLE,
};

/** Rules for the wasteland landscape set (lava + moor are unwalkable). */
export const WASTELAND_RULES: TerrainRules = {
  buildable: BUILDABLE_IDS,
  impassable: WASTELAND_IMPASSABLE,
};

/**
 * Terrain rules for a map's landscape id, matching the renderer's LandscapeSet
 * numbering (0 greenland, 1 wasteland, 2 winter). Unknown ids fall back to
 * greenland so older/partial maps still load.
 */
export function rulesForLandscape(landscape: number): TerrainRules {
  switch (landscape) {
    case 1:
      return WASTELAND_RULES;
    case 2:
      return WINTER_RULES;
    default:
      return GREENLAND_RULES;
  }
}

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
 * Navigable water terrain ids: open water (0x05) only. Reef (0x13) and lava are
 * impassable to ships and stay out of the set. Greenland's 0x06 slot renders like
 * shallow water but is buildable land in the original (see BUILDABLE_IDS), so it
 * is deliberately excluded — ships must not sail it and it must not make adjacent
 * land count as coast. Ships path over nodes whose surrounding texture is
 * navigable water; harbors are land nodes adjacent to it.
 */
export const NAVIGABLE_WATER_IDS: ReadonlySet<number> = new Set([
  0x05, // water
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
