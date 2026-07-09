/**
 * Single source of truth for tunable simulation constants.
 *
 * The gameplay values below are the researched originals extracted into
 * docs/gameplay-notes/CONSTANTS.md, TICKS.md and OBJECTS.md (clean-room facts
 * from the Return-to-the-Roots s25client gameData tables — BuildingConsts,
 * JobConsts, GoodConsts — cross-checked with settlers2.net). Each group cites the
 * CONSTANTS.md / TICKS.md section it comes from.
 *
 * Tick convention (CONSTANTS.md header, TICKS.md §2): 1 game frame (GF) = one
 * engine tick = 50 ms at Normal speed, so every GF duration below maps 1:1 to
 * ticks with no conversion.
 *
 * A few values are not fixed by a single source constant (construction step
 * pacing, flag spacing); those are engine-model approximations and are marked
 * `ENGINE` with a note. Map-file / object encodings verified on-disk are `FACT`.
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
 * Source: CONSTANTS.md §2 building table (BUILDING_COSTS = {boards, stones}).
 * Enum ids: woodcutter=17, forester=20, quarry=19, sawmill=33. HQ=0 (no cost).
 * The record is keyed by our engine building names; extend it with the same
 * {boards, stones} pairs from §2 as more building types are added (e.g. the huts
 * fishery/hunter/well are 2/0, the houses mill/bakery/slaughterhouse 2/2, the
 * castles farm/pig-farm 3/3, storehouse 4/3).
 */
export const BUILD_COST: Readonly<Record<BuildingType, { boards: number; stones: number }>> = {
  headquarters: { boards: 0, stones: 0 }, // §2 id 0
  woodcutter: { boards: 2, stones: 0 }, // §2 id 17 (Hut)
  forester: { boards: 2, stones: 0 }, // §2 id 20 (Hut)
  quarry: { boards: 2, stones: 0 }, // §2 id 19 (Hut)
  sawmill: { boards: 2, stones: 2 }, // §2 id 33 (House)
};

// --- Timings (in game frames / ticks; 1 GF = 1 tick) ----------------------
// Sources: worker work_length values from CONSTANTS.md §3 (JOB_CONSTS) and the
// per-chain notes in §5; tree growth from §5 / TICKS.md §4; walking speed from
// §3 (figures) and §4 (carriers).
export const TICKS = {
  /**
   * Ticks of "builder work" added per delivered board/stone once the builder is
   * on site. ENGINE: RttR drives a building site through incremental build
   * events rather than a single per-material constant, and CONSTANTS.md does not
   * expose a clean tick-per-material figure (Builder job §3 is work=0/wait=0).
   * This is an engine-model approximation; buildMinTicks below anchors the floor.
   */
  buildStepPerMaterial: 40, // ENGINE (no single source constant)
  /**
   * Minimum ticks a construction takes even with all material already on site.
   * Anchored to the Planer's site-flattening pass (CONSTANTS.md §3 Planer
   * work_length = 130 GF), which precedes the builder in the original.
   */
  buildMinTicks: 130, // §3 Planer work_length (site prep floor)
  /** Woodcutter: felling time at the tree. CONSTANTS.md §3/§5 Woodcutter work_length. */
  woodcutterChop: 148, // §3 Woodcutter work=148
  /** Forester: planting time at the spot. CONSTANTS.md §3/§5 Forester work_length. */
  foresterPlant: 66, // §3 Forester work=66
  /**
   * Ticks for a planted sapling to mature into a fellable tree. A tree grows
   * through 3 stages, each = wait 835 GF + grow 15 GF (CONSTANTS.md §5,
   * TICKS.md §4): 3 x (835 + 15) = 2550 GF.
   */
  treeGrow: 2550, // §5 3 x (WAIT_LENGTH 835 + GROWING_LENGTH 15)
  /** Sawmill/carpenter: one trunk -> one board. CONSTANTS.md §3/§5 Carpenter work_length. */
  sawmillWork: 479, // §3 Carpenter work=479
  /** Quarry/stonemason: chip one stone from granite. CONSTANTS.md §3/§5 Stonemason work_length. */
  quarryWork: 129, // §3 Stonemason work=129
  /**
   * Ticks a free-walking settler (worker/builder) takes to cross one lattice
   * edge. CONSTANTS.md §3: every figure walks 1 node per 20 GF on flat ground.
   * Slope multipliers (uphill x1.5/x2/x3; downhill stays 20) from the §3 slope
   * table are not yet modelled — the engine currently uses the flat-ground base
   * for all edges; add a per-edge multiplier here when altitude is wired in.
   */
  walkPerEdge: 20, // §3 flat-ground walk = 20 GF/node
  /**
   * Ticks a carrier takes to cross one road edge. CONSTANTS.md §4: a carrier
   * moves at the same 20 GF/node as any figure (donkeys/boat carriers do not
   * travel faster — they only add throughput). Same flat-ground base as
   * walkPerEdge; the engine models the carrier physically walking each edge of
   * the road segment it serves.
   */
  carrierPerEdge: 20, // §4 carrier walk = 20 GF/node
} as const;

/** Planks produced per trunk consumed by a sawmill. CONSTANTS.md §5: 1 board/cycle. */
export const SAWMILL_PLANKS_PER_TRUNK = 1; // §5 (1 output per completed cycle)

/**
 * Maximum trunks a sawmill will hold queued as input. CONSTANTS.md §2:
 * numSpacesPerWare default = 6 (sawmill id 33 stocks 6 of its input ware).
 */
export const SAWMILL_INPUT_CAP = 6; // §2 spaces (numSpacesPerWare)

// --- Work radii (in lattice steps) ----------------------------------------
// Source: CONSTANTS.md §2 "Work radius (nodes) for outdoor workers".
export const RADIUS = {
  woodcutter: 6, // §2 Woodcutter radius
  forester: 6, // §2 Forester radius
  quarry: 8, // §2 Stonemason (quarry) radius
} as const;

// --- Flag / road rules ----------------------------------------------------
/**
 * Minimum lattice distance required between two flags. ENGINE approximation of
 * S2 flag spacing (CONSTANTS.md §4: RttR delimits road segments by flags rather
 * than by a single spacing constant; ARCHITECTURE.md fixes our rule at >= 2).
 */
export const FLAG_MIN_DISTANCE = 2;
/** Maximum wares that may queue at a single flag. CONSTANTS.md §4: noFlag holds 8. */
export const FLAG_WARE_CAPACITY = 8;

// --- HQ starting inventory (standard free game = "Normal" preset) ---------
/**
 * Source: CONSTANTS.md §6 HQ starting inventory, Normal column
 * (buildings/nobHQ.cpp getStartInventory). The engine's P2 economy only tracks
 * the three construction/production wares, mapped from the §6 ware rows:
 *   trunk <- Wood (24), plank <- Boards (44), stone <- Stones (68).
 * All other Normal-preset wares (tools, food, iron/coal, etc.) exist in §6 but
 * are outside P2 scope; add them here as their ware types are introduced.
 */
export const HQ_START_WARES: Readonly<Record<WareType, number>> = {
  trunk: 24, // §6 Wood (Normal)
  plank: 44, // §6 Boards (Normal)
  stone: 68, // §6 Stones (Normal)
};
/**
 * Source: CONSTANTS.md §6 settlers/jobs, Normal column. The engine's "carrier"
 * is the generic transport pool, which the original fills from Helpers, so it is
 * seeded from the Helper count. Remaining jobs map 1:1 to §6 rows (sawmiller <-
 * Carpenter). Non-P2 jobs (miner, hunter, soldiers, geologist, ...) are in §6
 * but out of scope here.
 */
export const HQ_START_WORKERS: Readonly<Record<JobType, number>> = {
  carrier: 52, // §6 Helper (Normal) — generic carrier/builder pool
  builder: 10, // §6 Builder (Normal)
  woodcutter: 8, // §6 Woodcutter (Normal)
  forester: 4, // §6 Forester (Normal)
  sawmiller: 4, // §6 Carpenter (Normal)
  stonemason: 4, // §6 Stonemason (Normal)
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
 * Source: OBJECTS.md §3b — the granite object_index low nibble is the remaining
 * quantity 1..6 (6 = full pile, 1 = nearly depleted); each unit yields one Stone
 * to the stonemason, so stock = the low-nibble count directly.
 */
export function graniteStock(objIndex: number): number {
  return Math.max(0, objIndex & 0x0f);
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
