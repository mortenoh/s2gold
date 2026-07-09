/**
 * Single source of truth for tunable simulation constants.
 *
 * IMPORTANT: Most timings, costs and inventory counts below are PLACEHOLDERS.
 * A parallel effort is extracting the original Settlers II Gold values into
 * docs/gameplay-notes/CONSTANTS.md (from s25client gameData BuildingConsts /
 * JobConsts / GoodConsts as clean facts). When those land, update the values in
 * THIS FILE ONLY. Every placeholder is flagged with a `TODO(CONSTANTS)` marker.
 *
 * Factual (non-placeholder) values are sourced from the WLD/SWD map format and
 * the settlers2.net objects documentation and are marked `FACT`.
 */

// --- Ware types -----------------------------------------------------------
export const WARE = {
  trunk: 'trunk', // felled tree log (woodcutter output, sawmill input)
  plank: 'plank', // board (sawmill output; construction material)
  stone: 'stone', // quarried stone (construction material)
} as const;
export type WareType = (typeof WARE)[keyof typeof WARE];
export const WARE_TYPES: readonly WareType[] = [WARE.trunk, WARE.plank, WARE.stone];

// --- Job types ------------------------------------------------------------
export const JOB = {
  carrier: 'carrier',
  builder: 'builder',
  woodcutter: 'woodcutter',
  forester: 'forester',
  sawmiller: 'sawmiller', // carpenter working the sawmill
  stonemason: 'stonemason',
} as const;
export type JobType = (typeof JOB)[keyof typeof JOB];
export const JOB_TYPES: readonly JobType[] = [
  JOB.carrier,
  JOB.builder,
  JOB.woodcutter,
  JOB.forester,
  JOB.sawmiller,
  JOB.stonemason,
];

// --- Building types -------------------------------------------------------
export const BUILDING = {
  headquarters: 'headquarters',
  woodcutter: 'woodcutter',
  forester: 'forester',
  sawmill: 'sawmill',
  quarry: 'quarry',
} as const;
export type BuildingType = (typeof BUILDING)[keyof typeof BUILDING];

/** Ware a completed building produces onto its flag (null = none). */
export const BUILDING_OUTPUT: Readonly<Record<BuildingType, WareType | null>> = {
  headquarters: null,
  woodcutter: WARE.trunk,
  forester: null,
  sawmill: WARE.plank,
  quarry: WARE.stone,
};

/** Worker job that occupies a completed building of each producing type. */
export const BUILDING_WORKER: Readonly<Record<BuildingType, JobType | null>> = {
  headquarters: null,
  woodcutter: JOB.woodcutter,
  forester: JOB.forester,
  sawmill: JOB.sawmiller,
  quarry: JOB.stonemason,
};

/**
 * Construction cost per building in (boards, stones).
 * TODO(CONSTANTS): replace with exact BuildingConsts values. Small huts in S2
 * cost boards only; medium buildings add stones. Values here are plausible.
 */
export const BUILD_COST: Readonly<Record<BuildingType, { boards: number; stones: number }>> = {
  headquarters: { boards: 0, stones: 0 },
  woodcutter: { boards: 2, stones: 0 }, // TODO(CONSTANTS)
  forester: { boards: 2, stones: 0 }, // TODO(CONSTANTS)
  quarry: { boards: 2, stones: 0 }, // TODO(CONSTANTS)
  sawmill: { boards: 2, stones: 2 }, // TODO(CONSTANTS)
};

// --- Timings (in game frames / ticks) -------------------------------------
// TODO(CONSTANTS): all timings below are placeholders for pacing tests.
export const TICKS = {
  /** Ticks of "builder work" needed per delivered material unit. */
  buildStepPerMaterial: 10, // TODO(CONSTANTS)
  /** Minimum ticks a construction takes even with all material present. */
  buildMinTicks: 20, // TODO(CONSTANTS)
  /** Woodcutter: ticks spent chopping once at a tree. */
  woodcutterChop: 40, // TODO(CONSTANTS)
  /** Forester: ticks spent planting once at a spot. */
  foresterPlant: 30, // TODO(CONSTANTS)
  /** Ticks for a planted sapling to mature into a harvestable tree. */
  treeGrow: 400, // TODO(CONSTANTS)
  /** Sawmill: ticks to convert one trunk into planks. */
  sawmillWork: 30, // TODO(CONSTANTS)
  /** Quarry/stonemason: ticks to chip one stone from granite. */
  quarryWork: 40, // TODO(CONSTANTS)
  /** Ticks a settler takes to traverse one lattice edge when walking. */
  walkPerEdge: 8, // TODO(CONSTANTS)
  /** Ticks a carrier takes to traverse one road edge. */
  carrierPerEdge: 6, // TODO(CONSTANTS)
} as const;

/** Planks produced per trunk consumed by a sawmill. */
export const SAWMILL_PLANKS_PER_TRUNK = 1; // TODO(CONSTANTS)

/** Maximum trunks a sawmill will hold queued as input. */
export const SAWMILL_INPUT_CAP = 6; // TODO(CONSTANTS)

// --- Radii (in lattice steps) ---------------------------------------------
// TODO(CONSTANTS): work radii are placeholders.
export const RADIUS = {
  woodcutter: 6, // TODO(CONSTANTS)
  forester: 6, // TODO(CONSTANTS)
  quarry: 6, // TODO(CONSTANTS)
} as const;

// --- Flag / road rules ----------------------------------------------------
/** Minimum lattice distance required between two flags. FACT: S2 spacing >= 2. */
export const FLAG_MIN_DISTANCE = 2;
/** Maximum wares that may queue at a single flag. FACT: S2 flag holds 8. */
export const FLAG_WARE_CAPACITY = 8;

// --- HQ starting inventory ------------------------------------------------
/**
 * TODO(CONSTANTS): starting stock is a generous placeholder so several P2
 * buildings can be constructed before production catches up.
 */
export const HQ_START_WARES: Readonly<Record<WareType, number>> = {
  trunk: 0,
  plank: 30, // TODO(CONSTANTS)
  stone: 30, // TODO(CONSTANTS)
};
export const HQ_START_WORKERS: Readonly<Record<JobType, number>> = {
  carrier: 20, // TODO(CONSTANTS)
  builder: 6, // TODO(CONSTANTS)
  woodcutter: 4, // TODO(CONSTANTS)
  forester: 4, // TODO(CONSTANTS)
  sawmiller: 4, // TODO(CONSTANTS)
  stonemason: 4, // TODO(CONSTANTS)
};

// --- Map object encoding (FACT: settlers2.net objects doc + on-disk data) --
/**
 * object_type values for map objects. Verified against DATA/MAPS/MISS200.WLD:
 * the HQ marker (0x80) sits exactly on the map hq_x/hq_y, tree types cluster on
 * 0xC4..0xC6 and granite on 0xCC/0xCD.
 */
export const OBJ_TYPE = {
  none: 0x00,
  hqMarker: 0x80, // FACT: headquarters start position marker
  treeMin: 0xc4, // FACT: 0xC4..0xC6 are tree species/growth groups
  treeMax: 0xc6,
  decorativeMin: 0xc7, // 0xC7..0xCB: non-mineable decorative objects
  decorativeMax: 0xcb,
  graniteMin: 0xcc, // FACT: 0xCC/0xCD are granite (mineable stone) piles
  graniteMax: 0xcd,
} as const;

/** True when an object_type byte denotes a (harvestable) tree. */
export function isTreeType(objType: number): boolean {
  return objType >= OBJ_TYPE.treeMin && objType <= OBJ_TYPE.treeMax;
}
/** True when an object_type byte denotes a mineable granite pile. */
export function isGraniteType(objType: number): boolean {
  return objType >= OBJ_TYPE.graniteMin && objType <= OBJ_TYPE.graniteMax;
}

/**
 * Stones remaining in a granite pile, from its object_index.
 * FACT (approx): S2 granite object_index (1..6) counts remaining sub-stacks.
 * TODO(CONSTANTS): exact stones-per-stack multiplier once documented.
 */
export function graniteStock(objIndex: number): number {
  return Math.max(0, objIndex);
}

/**
 * object_type used for a sapling planted by a forester (engine-internal, kept
 * OUTSIDE the tree range so a woodcutter will not harvest it until it matures
 * into a real tree type; the renderer can special-case it later).
 */
export const OBJ_TYPE_SAPLING = 0xc3;
/** object_index marking an engine-planted, not-yet-mature sapling. */
export const OBJ_INDEX_SAPLING = 0x01;
/** object_index used for an engine-grown mature tree. */
export const OBJ_INDEX_MATURE = 0x30;
