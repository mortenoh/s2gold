/**
 * Single source of truth for tunable simulation constants.
 *
 * The gameplay values below are the researched originals extracted into
 * docs/gameplay-notes/CONSTANTS.md, TICKS.md and OBJECTS.md (clean-room facts
 * from the Return-to-the-Roots s25client gameData tables — BuildingConsts,
 * JobConsts, GoodConsts — cross-checked with settlers2.net). Each group cites the
 * CONSTANTS.md / TICKS.md / OBJECTS.md section it comes from.
 *
 * Tick convention (CONSTANTS.md header, TICKS.md §2): 1 game frame (GF) = one
 * engine tick = 50 ms at Normal speed, so every GF duration below maps 1:1 to
 * ticks with no conversion.
 *
 * P3 wave 1 makes the economy data-driven: {@link BUILDING_DEFS} is the single
 * table the production/dispatch/construction systems read, so a P4+ building is a
 * new table entry rather than new control flow. `WareType`/`BuildingType`/
 * `JobType` are widened to `string` (the canonical values live in the `WARE`,
 * `BUILDING`, `JOB` const maps) so the app's existing exhaustive lookup records
 * keep compiling while the engine grows the full ware/job/building space.
 *
 * A few values are not fixed by a single source constant (construction step
 * pacing, flag spacing); those are engine-model approximations and are marked
 * `ENGINE` with a note. Map-file / object encodings verified on-disk are `FACT`.
 */

// --- Ware types -----------------------------------------------------------
// Canonical ware string ids. Numeric GoodType ids live in WARE_ID (CONSTANTS.md
// §1). The three P2 wares keep their original engine names (trunk=Wood,
// plank=Boards, stone=Stones) so the renderer's WARE_JOB map stays valid.
export const WARE = {
  beer: 'beer',
  tongs: 'tongs',
  hammer: 'hammer',
  axe: 'axe',
  saw: 'saw',
  pickaxe: 'pickaxe',
  shovel: 'shovel',
  crucible: 'crucible',
  rodandline: 'rodandline',
  scythe: 'scythe',
  water: 'water',
  cleaver: 'cleaver',
  rollingpin: 'rollingpin',
  bow: 'bow',
  sword: 'sword',
  iron: 'iron',
  flour: 'flour',
  fish: 'fish',
  bread: 'bread',
  shield: 'shield',
  trunk: 'trunk', // GoodType Wood (22): felled tree log
  plank: 'plank', // GoodType Boards (23): sawn board / construction material
  stone: 'stone', // GoodType Stones (24): quarried / mined granite
  grain: 'grain',
  coins: 'coins',
  gold: 'gold', // raw gold ore
  ironore: 'ironore',
  coal: 'coal',
  meat: 'meat',
  ham: 'ham',
} as const;
/** A ware type id. Widened to string so downstream exhaustive records still compile. */
export type WareType = string;

/** GoodType numeric ids (CONSTANTS.md §1). Consistent with the renderer's ware ids. */
export const WARE_ID: Readonly<Record<string, number>> = {
  beer: 0,
  tongs: 1,
  hammer: 2,
  axe: 3,
  saw: 4,
  pickaxe: 5,
  shovel: 6,
  crucible: 7,
  rodandline: 8,
  scythe: 9,
  water: 11,
  cleaver: 12,
  rollingpin: 13,
  bow: 14,
  sword: 16,
  iron: 17,
  flour: 18,
  fish: 19,
  bread: 20,
  shield: 21,
  trunk: 22,
  plank: 23,
  stone: 24,
  grain: 27,
  coins: 28,
  gold: 29,
  ironore: 30,
  coal: 31,
  meat: 32,
  ham: 33,
};

/** All ware types in a fixed canonical order (drives deterministic map keys). */
export const WARE_TYPES: readonly WareType[] = [
  WARE.beer, WARE.tongs, WARE.hammer, WARE.axe, WARE.saw, WARE.pickaxe, WARE.shovel,
  WARE.crucible, WARE.rodandline, WARE.scythe, WARE.water, WARE.cleaver, WARE.rollingpin,
  WARE.bow, WARE.sword, WARE.iron, WARE.flour, WARE.fish, WARE.bread, WARE.shield,
  WARE.trunk, WARE.plank, WARE.stone, WARE.grain, WARE.coins, WARE.gold, WARE.ironore,
  WARE.coal, WARE.meat, WARE.ham,
];

/** The 12 metalworks tools (CONSTANTS.md §1 Tool enum order). */
export const TOOL_WARES: readonly WareType[] = [
  WARE.tongs, WARE.hammer, WARE.axe, WARE.saw, WARE.pickaxe, WARE.shovel,
  WARE.crucible, WARE.rodandline, WARE.scythe, WARE.cleaver, WARE.rollingpin, WARE.bow,
];

// --- Job types ------------------------------------------------------------
// Engine job ids. `carrier` is the generic Helper pool (recruit source + road
// carriers). Names align with CONSTANTS.md §3 where practical (sawmiller =
// Carpenter, wellman/hunter = Helper-staffed spots). Widened to string.
export const JOB = {
  carrier: 'carrier', // Helper pool (CONSTANTS.md §3 Helper)
  builder: 'builder',
  woodcutter: 'woodcutter',
  forester: 'forester',
  sawmiller: 'sawmiller', // Carpenter
  stonemason: 'stonemason',
  fisher: 'fisher',
  hunter: 'hunter',
  farmer: 'farmer',
  miller: 'miller',
  baker: 'baker',
  butcher: 'butcher',
  miner: 'miner',
  brewer: 'brewer',
  pigbreeder: 'pigbreeder',
  donkeybreeder: 'donkeybreeder',
  ironfounder: 'ironfounder',
  minter: 'minter',
  metalworker: 'metalworker',
  armorer: 'armorer',
  wellman: 'wellman', // Helper-staffed well/lookout spots
  scout: 'scout',
  shipwright: 'shipwright', // P7: builds ships at the shipyard (CONSTANTS.md §3 id 27)
  geologist: 'geologist', // §6 Geologist: surveys mountains for ore (drawn from the Helper pool)
} as const;
export type JobType = string;

export const JOB_TYPES: readonly JobType[] = [
  JOB.carrier, JOB.builder, JOB.woodcutter, JOB.forester, JOB.sawmiller, JOB.stonemason,
  JOB.fisher, JOB.hunter, JOB.farmer, JOB.miller, JOB.baker, JOB.butcher, JOB.miner,
  JOB.brewer, JOB.pigbreeder, JOB.donkeybreeder, JOB.ironfounder, JOB.minter,
  JOB.metalworker, JOB.armorer, JOB.wellman, JOB.scout, JOB.shipwright, JOB.geologist,
];

/** How far from the sent flag a geologist surveys mountain nodes for ore. */
export const GEOLOGIST_RADIUS = 6;
/** Ticks a geologist spends surveying once it reaches the flag. */
export const GEOLOGIST_SURVEY_TICKS = 60;

/**
 * Tool ware required to recruit each civilian job from a Helper (CONSTANTS.md §3
 * "Tool to recruit"). `null` = recruitable from a Helper alone. `carrier` (the
 * Helper itself) is never recruited via this table.
 */
export const JOB_TOOL: Readonly<Record<JobType, WareType | null>> = {
  carrier: null,
  builder: WARE.hammer,
  woodcutter: WARE.axe,
  forester: WARE.shovel,
  sawmiller: WARE.saw,
  stonemason: WARE.pickaxe,
  fisher: WARE.rodandline,
  hunter: WARE.bow,
  farmer: WARE.scythe,
  miller: null,
  baker: WARE.rollingpin,
  butcher: WARE.cleaver,
  miner: WARE.pickaxe,
  brewer: null,
  pigbreeder: null,
  donkeybreeder: null,
  ironfounder: WARE.crucible,
  minter: WARE.crucible,
  metalworker: WARE.tongs,
  armorer: WARE.hammer,
  wellman: null,
  scout: WARE.bow,
  shipwright: WARE.hammer, // CONSTANTS.md §3 Shipwright recruit tool = Hammer
};

// --- Building types -------------------------------------------------------
// Existing P2 names preserved; new economy buildings appended. Widened to string.
export const BUILDING = {
  headquarters: 'headquarters',
  woodcutter: 'woodcutter',
  forester: 'forester',
  sawmill: 'sawmill',
  quarry: 'quarry',
  well: 'well',
  farm: 'farm',
  mill: 'mill',
  bakery: 'bakery',
  fishery: 'fishery',
  hunter: 'hunter',
  pigfarm: 'pigfarm',
  slaughterhouse: 'slaughterhouse',
  brewery: 'brewery',
  coalmine: 'coalmine',
  ironmine: 'ironmine',
  goldmine: 'goldmine',
  granitemine: 'granitemine',
  ironsmelter: 'ironsmelter',
  armory: 'armory',
  metalworks: 'metalworks',
  mint: 'mint',
  donkeybreeder: 'donkeybreeder',
  storehouse: 'storehouse',
  lookout: 'lookout',
  // Seafaring buildings (P7). Shipyard = coastal workshop building ships;
  // harbor = coastal warehouse that anchors territory and launches expeditions.
  shipyard: 'shipyard',
  harbor: 'harbor',
  // Military buildings (MILITARY.md §2). Order matches NUM_MILITARY_BLDS.
  barracks: 'barracks',
  guardhouse: 'guardhouse',
  watchtower: 'watchtower',
  fortress: 'fortress',
  catapult: 'catapult',
} as const;
export type BuildingType = string;

/** Build-quality class a building needs (CONSTANTS.md §2 BuildingQuality). */
export type BuildingSize = 'hut' | 'house' | 'castle' | 'mine' | 'harbor';

/**
 * How a building turns work into wares:
 * - `hq` / `warehouse`: stores + issues wares, no production worker.
 * - `harvester`: outdoor worker walks to a map object/resource node within radius.
 * - `farm`: outdoor worker sows + harvests crop fields (radius) on map nodes.
 * - `generator`: in-building timed producer with no ware input (well, hunter).
 * - `workshop`: in-building; consumes input wares then produces an output.
 * - `mine`: in-building; consumes 1 food + decrements a subsurface resource.
 * - `special`: staffed but no production (lookout tower = vision stub).
 * - `military`: garrisons soldiers, projects territory, can attack/defend
 *   (MILITARY.md §2-6).
 * - `catapult`: throws stones at nearby enemy military buildings (MILITARY.md §7).
 * - `shipyard`: coastal workshop; consumes planks and builds ship entities (P7).
 */
export type BuildingKind =
  | 'hq'
  | 'warehouse'
  | 'harvester'
  | 'farm'
  | 'generator'
  | 'workshop'
  | 'mine'
  | 'special'
  | 'military'
  | 'catapult'
  | 'shipyard';

/** A single data-driven building definition. All timings in GF/ticks. */
export interface BuildingDef {
  /** s25 BuildingType enum id (CONSTANTS.md §2), for reference/renderer parity. */
  id: number;
  /** Construction cost (boards a.k.a. planks, stones). CONSTANTS.md §2. */
  cost: { boards: number; stones: number };
  size: BuildingSize;
  kind: BuildingKind;
  /** Worker job that must occupy the finished building (null = none). */
  worker: JobType | null;
  /** Input ware types in fixed order (aligned to Building.inputStock indices). */
  inputs: readonly WareType[];
  /** Per-input stock capacity (numSpacesPerWare; default 6, mines 2). */
  inputCap: number;
  /**
   * true = consume one of EACH input per cycle (BLD_WORK_DESC useOneWareEach);
   * false = consume one of whichever input is most-stocked (mines: any 1 food).
   */
  useOneEach: boolean;
  /** Output ware types. `alternate` cycles them; otherwise outputs[0] each cycle. */
  outputs: readonly WareType[];
  /** Armory-style alternation between outputs each successful cycle. */
  alternate?: boolean;
  /** Worker work_length (CONSTANTS.md §3/§5). */
  workTicks: number;
  /** Outdoor work radius in lattice steps (CONSTANTS.md §2). */
  radius?: number;
  /** Subsurface ResourceType nibble a mine/fishery searches (OBJECTS.md §5a). */
  resource?: number;
  /** Metalworks: output ware is chosen from the player's tool priority list. */
  producesTool?: boolean;
  /** Donkey breeder: cycle breeds a PackDonkey (stubbed as a player-pool count). */
  breedsDonkey?: boolean;
  /** Military: max garrisoned soldiers (MILITARY.md §2 NUM_TROOPS). */
  maxTroops?: number;
  /** Military: max stored gold coins (MILITARY.md §2 NUM_GOLDS). */
  maxGold?: number;
  /** Military: armor slots (MILITARY.md §2 NUM_ARMOR). */
  armorCap?: number;
  /** Military/HQ: owned-territory radius in nodes (MILITARY.md §2 MILITARY_RADIUS). */
  militaryRadius?: number;
}

const CAP = 6; // default numSpacesPerWare (CONSTANTS.md §2)
const MINE_CAP = 2; // mines hold 2 of each food (CONSTANTS.md §2)

/**
 * The full economy table. Sources: CONSTANTS.md §2 (costs/size/worker/inputs),
 * §3 (job work lengths), §5 (per-chain cycle numbers), OBJECTS.md §5a (mine
 * resources). Enum ids in the `id` field are the original S2/s25 building ids.
 */
export const BUILDING_DEFS: Readonly<Record<string, BuildingDef>> = {
  headquarters: { id: 0, cost: { boards: 0, stones: 0 }, size: 'castle', kind: 'hq', worker: null, inputs: [], inputCap: CAP, useOneEach: true, outputs: [], workTicks: 0 },

  // Outdoor harvesters (walk to a map object / resource node).
  woodcutter: { id: 17, cost: { boards: 2, stones: 0 }, size: 'hut', kind: 'harvester', worker: JOB.woodcutter, inputs: [], inputCap: CAP, useOneEach: true, outputs: [WARE.trunk], workTicks: 148, radius: 6 }, // §3 Woodcutter work=148, §2 radius 6
  forester: { id: 20, cost: { boards: 2, stones: 0 }, size: 'hut', kind: 'harvester', worker: JOB.forester, inputs: [], inputCap: CAP, useOneEach: true, outputs: [], workTicks: 66, radius: 6 }, // §3 Forester work=66 (plants trees)
  quarry: { id: 19, cost: { boards: 2, stones: 0 }, size: 'hut', kind: 'harvester', worker: JOB.stonemason, inputs: [], inputCap: CAP, useOneEach: true, outputs: [WARE.stone], workTicks: 129, radius: 8 }, // §3 Stonemason work=129, §2 radius 8
  fishery: { id: 18, cost: { boards: 2, stones: 0 }, size: 'hut', kind: 'harvester', worker: JOB.fisher, inputs: [], inputCap: CAP, useOneEach: true, outputs: [WARE.fish], workTicks: 129, radius: 7, resource: 6 }, // §3 Fisher work=129, §2 radius 7, Fish resource nibble 6

  // In-building timed producers with no ware input.
  well: { id: 35, cost: { boards: 2, stones: 0 }, size: 'hut', kind: 'generator', worker: JOB.wellman, inputs: [], inputCap: CAP, useOneEach: true, outputs: [WARE.water], workTicks: 92 }, // §2 Well (Helper); short cycle (Helper wait pacing)
  hunter: { id: 22, cost: { boards: 2, stones: 0 }, size: 'hut', kind: 'generator', worker: JOB.hunter, inputs: [], inputCap: CAP, useOneEach: true, outputs: [WARE.meat], workTicks: 300 }, // §3 Hunter work=0/wait1=300 (no game-animal objects modelled; timed producer — SIMPLIFIED)

  // Farm: crop-field sow/harvest lifecycle on map nodes.
  farm: { id: 37, cost: { boards: 3, stones: 3 }, size: 'castle', kind: 'farm', worker: JOB.farmer, inputs: [], inputCap: CAP, useOneEach: true, outputs: [WARE.grain], workTicks: 117, radius: 2 }, // §3 Farmer work=117, §2 radius 2

  // Workshops (consume inputs -> produce output).
  sawmill: { id: 33, cost: { boards: 2, stones: 2 }, size: 'house', kind: 'workshop', worker: JOB.sawmiller, inputs: [WARE.trunk], inputCap: CAP, useOneEach: true, outputs: [WARE.plank], workTicks: 479 }, // §5 Carpenter 1 Wood->1 Boards, work=479
  mill: { id: 31, cost: { boards: 2, stones: 2 }, size: 'house', kind: 'workshop', worker: JOB.miller, inputs: [WARE.grain], inputCap: CAP, useOneEach: true, outputs: [WARE.flour], workTicks: 470 }, // §5 Miller 1 Grain->1 Flour, work=470
  bakery: { id: 32, cost: { boards: 2, stones: 2 }, size: 'house', kind: 'workshop', worker: JOB.baker, inputs: [WARE.flour, WARE.water], inputCap: CAP, useOneEach: true, outputs: [WARE.bread], workTicks: 470 }, // §5 Baker Flour+Water->Bread, work=470
  pigfarm: { id: 28, cost: { boards: 3, stones: 3 }, size: 'castle', kind: 'workshop', worker: JOB.pigbreeder, inputs: [WARE.grain, WARE.water], inputCap: CAP, useOneEach: true, outputs: [WARE.ham], workTicks: 390 }, // §5 PigBreeder Grain+Water->Ham, work=390
  slaughterhouse: { id: 21, cost: { boards: 2, stones: 2 }, size: 'house', kind: 'workshop', worker: JOB.butcher, inputs: [WARE.ham], inputCap: CAP, useOneEach: true, outputs: [WARE.meat], workTicks: 478 }, // §5 Butcher Ham->Meat, work=478
  brewery: { id: 23, cost: { boards: 2, stones: 2 }, size: 'house', kind: 'workshop', worker: JOB.brewer, inputs: [WARE.grain, WARE.water], inputCap: CAP, useOneEach: true, outputs: [WARE.beer], workTicks: 530 }, // §5 Brewer Grain+Water->Beer, work=530
  ironsmelter: { id: 26, cost: { boards: 2, stones: 2 }, size: 'house', kind: 'workshop', worker: JOB.ironfounder, inputs: [WARE.ironore, WARE.coal], inputCap: CAP, useOneEach: true, outputs: [WARE.iron], workTicks: 950 }, // §5 IronFounder IronOre+Coal->Iron, work=950
  armory: { id: 24, cost: { boards: 2, stones: 2 }, size: 'house', kind: 'workshop', worker: JOB.armorer, inputs: [WARE.iron, WARE.coal], inputCap: CAP, useOneEach: true, outputs: [WARE.sword, WARE.shield], alternate: true, workTicks: 940 }, // §5 Armorer Iron+Coal->Sword/Shield alternating, work=940
  metalworks: { id: 25, cost: { boards: 2, stones: 2 }, size: 'house', kind: 'workshop', worker: JOB.metalworker, inputs: [WARE.iron, WARE.plank], inputCap: CAP, useOneEach: true, outputs: [WARE.scythe], producesTool: true, workTicks: 850 }, // §5/§7 Metalworker Iron+Boards->1 tool (by tool priority), work=850
  mint: { id: 34, cost: { boards: 2, stones: 2 }, size: 'house', kind: 'workshop', worker: JOB.minter, inputs: [WARE.gold, WARE.coal], inputCap: CAP, useOneEach: true, outputs: [WARE.coins], workTicks: 1050 }, // §5 Minter Gold+Coal->Coins, work=1050
  donkeybreeder: { id: 38, cost: { boards: 3, stones: 3 }, size: 'castle', kind: 'workshop', worker: JOB.donkeybreeder, inputs: [WARE.grain, WARE.water], inputCap: CAP, useOneEach: true, outputs: [], breedsDonkey: true, workTicks: 370 }, // §5 DonkeyBreeder Grain+Water->PackDonkey (stubbed to a player pool count), work=370

  // Mines (consume 1 food; decrement a subsurface resource within radius 2).
  coalmine: { id: 11, cost: { boards: 4, stones: 0 }, size: 'mine', kind: 'mine', worker: JOB.miner, inputs: [WARE.fish, WARE.meat, WARE.bread], inputCap: MINE_CAP, useOneEach: false, outputs: [WARE.coal], workTicks: 583, radius: 2, resource: 3 }, // §5 Miner food->Coal, work=583; OBJECTS §5a Coal nibble 3
  ironmine: { id: 12, cost: { boards: 4, stones: 0 }, size: 'mine', kind: 'mine', worker: JOB.miner, inputs: [WARE.fish, WARE.meat, WARE.bread], inputCap: MINE_CAP, useOneEach: false, outputs: [WARE.ironore], workTicks: 583, radius: 2, resource: 1 }, // Iron nibble 1
  goldmine: { id: 13, cost: { boards: 4, stones: 0 }, size: 'mine', kind: 'mine', worker: JOB.miner, inputs: [WARE.fish, WARE.meat, WARE.bread], inputCap: MINE_CAP, useOneEach: false, outputs: [WARE.gold], workTicks: 583, radius: 2, resource: 2 }, // Gold nibble 2
  granitemine: { id: 10, cost: { boards: 4, stones: 0 }, size: 'mine', kind: 'mine', worker: JOB.miner, inputs: [WARE.fish, WARE.meat, WARE.bread], inputCap: MINE_CAP, useOneEach: false, outputs: [WARE.stone], workTicks: 583, radius: 2, resource: 4 }, // Granite nibble 4

  // Warehouse + vision.
  storehouse: { id: 29, cost: { boards: 4, stones: 3 }, size: 'house', kind: 'warehouse', worker: null, inputs: [], inputCap: CAP, useOneEach: true, outputs: [], workTicks: 0 },
  lookout: { id: 14, cost: { boards: 4, stones: 0 }, size: 'hut', kind: 'special', worker: JOB.scout, inputs: [], inputCap: CAP, useOneEach: true, outputs: [], workTicks: 0 }, // §2 Lookout tower: vision only (stub)

  // Seafaring (P7). Shipyard: House-class coastal workshop; Shipwright turns
  // Boards into ship entities (§2 id 36, §3 Shipwright work_length=1250). Harbor:
  // Harbor-class coastal warehouse; anchors territory (HARBOR_RADIUS=8) and hosts
  // ships/expeditions (§2 id 39). No producer worker (acts like the HQ/storehouse).
  shipyard: { id: 36, cost: { boards: 2, stones: 3 }, size: 'house', kind: 'shipyard', worker: JOB.shipwright, inputs: [WARE.plank], inputCap: CAP, useOneEach: true, outputs: [], workTicks: 1250 }, // §5 Shipwright Boards->Ship, work=1250
  harbor: { id: 39, cost: { boards: 4, stones: 6 }, size: 'harbor', kind: 'warehouse', worker: null, inputs: [], inputCap: CAP, useOneEach: true, outputs: [], workTicks: 0, militaryRadius: 8 }, // §2 Harbor building: warehouse + HARBOR_RADIUS territory anchor

  // Military buildings (MILITARY.md §2). Costs from CONSTANTS.md §2. No worker
  // job (soldiers occupy via the military system, not the recruit-a-worker path);
  // coins are delivered as the `coins` input for promotion (MILITARY.md §6).
  barracks: { id: 1, cost: { boards: 2, stones: 0 }, size: 'hut', kind: 'military', worker: null, inputs: [WARE.coins], inputCap: 1, useOneEach: false, outputs: [], workTicks: 0, maxTroops: 2, maxGold: 1, armorCap: 1, militaryRadius: 8 }, // §2 Barracks: troops 2, gold 1, radius 8
  guardhouse: { id: 2, cost: { boards: 2, stones: 3 }, size: 'hut', kind: 'military', worker: null, inputs: [WARE.coins], inputCap: 2, useOneEach: false, outputs: [], workTicks: 0, maxTroops: 3, maxGold: 2, armorCap: 2, militaryRadius: 9 }, // §2 Guardhouse: troops 3, gold 2, radius 9
  watchtower: { id: 4, cost: { boards: 3, stones: 5 }, size: 'house', kind: 'military', worker: null, inputs: [WARE.coins], inputCap: 4, useOneEach: false, outputs: [], workTicks: 0, maxTroops: 6, maxGold: 4, armorCap: 4, militaryRadius: 10 }, // §2 Watchtower: troops 6, gold 4, radius 10
  fortress: { id: 9, cost: { boards: 4, stones: 7 }, size: 'castle', kind: 'military', worker: null, inputs: [WARE.coins], inputCap: 6, useOneEach: false, outputs: [], workTicks: 0, maxTroops: 9, maxGold: 6, armorCap: 6, militaryRadius: 11 }, // §2 Fortress: troops 9, gold 6, radius 11

  // Catapult (MILITARY.md §7). Consumes 1 Stones per shot (store of 4).
  catapult: { id: 16, cost: { boards: 4, stones: 2 }, size: 'house', kind: 'catapult', worker: null, inputs: [WARE.stone], inputCap: 4, useOneEach: true, outputs: [], workTicks: 0 }, // §7 Catapult: 4-stone store, throws at enemy military buildings
};

/** Look up a building's definition (undefined for unknown types). */
export function buildingDef(type: BuildingType): BuildingDef | undefined {
  return BUILDING_DEFS[type];
}

/**
 * Construction cost per building in (boards, stones), derived from BUILDING_DEFS.
 * Kept as a standalone export for the app's build menu (CONSTANTS.md §2).
 */
export const BUILD_COST: Readonly<Record<BuildingType, { boards: number; stones: number }>> =
  Object.fromEntries(Object.entries(BUILDING_DEFS).map(([k, d]) => [k, d.cost]));

/** Ware a completed building produces (first/only output; null = none). CONSTANTS.md §2/§5. */
export const BUILDING_OUTPUT: Readonly<Record<BuildingType, WareType | null>> = Object.fromEntries(
  Object.entries(BUILDING_DEFS).map(([k, d]) => [k, d.outputs[0] ?? null]),
);

/** Worker job occupying each producing building (null = none). CONSTANTS.md §2. */
export const BUILDING_WORKER: Readonly<Record<BuildingType, JobType | null>> = Object.fromEntries(
  Object.entries(BUILDING_DEFS).map(([k, d]) => [k, d.worker]),
);

// --- Timings (in game frames / ticks; 1 GF = 1 tick) ----------------------
export const TICKS = {
  /**
   * Ticks of "builder work" added per delivered board/stone once the builder is
   * on site. ENGINE: RttR drives a building site through incremental build
   * events rather than a single per-material constant, and CONSTANTS.md does not
   * expose a clean tick-per-material figure (Builder job §3 is work=0/wait=0).
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
   * through 3 stages, each = wait 835 GF + grow 15 GF (CONSTANTS.md §5): 2550 GF.
   */
  treeGrow: 2550, // §5 3 x (WAIT_LENGTH 835 + GROWING_LENGTH 15)
  /**
   * Ticks for a sown grain field to mature. 3 stages, each wait 1100 GF + grow
   * 16 GF (CONSTANTS.md §5 noGrainfield): 3 x 1116 = 3348 GF.
   */
  cropGrow: 3348, // §5 3 x (GROWING_WAITING_LENGTH 1100 + GROWING_LENGTH 16)
  /** Sawmill/carpenter: one trunk -> one board. CONSTANTS.md §3/§5 Carpenter work_length. */
  sawmillWork: 479, // §3 Carpenter work=479
  /** Quarry/stonemason: chip one stone from granite. CONSTANTS.md §3/§5 Stonemason work_length. */
  quarryWork: 129, // §3 Stonemason work=129
  /**
   * Ticks a free-walking settler (worker/builder) takes to cross one lattice
   * edge. CONSTANTS.md §3: every figure walks 1 node per 20 GF on flat ground.
   */
  walkPerEdge: 20, // §3 flat-ground walk = 20 GF/node
  /** Ticks a carrier takes to cross one road edge. CONSTANTS.md §4 = 20 GF/node. */
  carrierPerEdge: 20, // §4 carrier walk = 20 GF/node
} as const;

/** Planks produced per trunk consumed by a sawmill. CONSTANTS.md §5: 1 board/cycle. */
export const SAWMILL_PLANKS_PER_TRUNK = 1; // §5 (1 output per completed cycle)
/** Legacy alias kept for compatibility: default input stock cap (CONSTANTS.md §2). */
export const SAWMILL_INPUT_CAP = 6; // §2 spaces (numSpacesPerWare)

// --- Work radii (in lattice steps) ----------------------------------------
// Source: CONSTANTS.md §2 "Work radius (nodes) for outdoor workers".
export const RADIUS = {
  woodcutter: 6, // §2 Woodcutter radius
  forester: 6, // §2 Forester radius
  quarry: 8, // §2 Stonemason (quarry) radius
  fisher: 7, // §2 Fisher radius
  hunter: 2, // §2 Hunter radius
  farmer: 2, // §2 Farmer radius
  miner: 2, // §2 MINER_RADIUS
} as const;

// --- Flag / road rules ----------------------------------------------------
/**
 * Minimum lattice distance required between two flags. ENGINE approximation of
 * S2 flag spacing (CONSTANTS.md §4; ARCHITECTURE.md fixes our rule at >= 2).
 */
export const FLAG_MIN_DISTANCE = 2;
/** Maximum wares that may queue at a single flag. CONSTANTS.md §4: noFlag holds 8. */
export const FLAG_WARE_CAPACITY = 8;

/**
 * Default per-ware transport priority (lower number = fetched first). CONSTANTS.md
 * §4: a flag/carrier selects the waiting ware with the lowest transport-priority
 * number. Construction materials and food outrank bulk production inputs by
 * default; coins/tools sit near the top so they reach the HQ promptly. ENGINE
 * ordering (S2 exposes tunable priority classes; this is a sane default).
 */
export const DEFAULT_TRANSPORT_PRIORITY: Readonly<Record<WareType, number>> = (() => {
  const order: WareType[] = [
    WARE.coins, WARE.plank, WARE.stone, WARE.trunk,
    WARE.fish, WARE.bread, WARE.meat, WARE.water, WARE.flour, WARE.grain, WARE.ham,
    WARE.ironore, WARE.coal, WARE.iron, WARE.gold,
    WARE.sword, WARE.shield, WARE.beer,
    WARE.tongs, WARE.hammer, WARE.axe, WARE.saw, WARE.pickaxe, WARE.shovel,
    WARE.crucible, WARE.rodandline, WARE.scythe, WARE.cleaver, WARE.rollingpin, WARE.bow,
  ];
  const r: Record<WareType, number> = {};
  for (const w of WARE_TYPES) {
    const i = order.indexOf(w);
    r[w] = i < 0 ? order.length : i;
  }
  return r;
})();

// --- HQ starting inventory (standard free game = "Normal" preset) ---------
/**
 * Source: CONSTANTS.md §6 HQ starting inventory, Normal column
 * (buildings/nobHQ.cpp getStartInventory). Wares not listed default to 0.
 * (Boat is a §6 ware but the boat/water economy is out of P3 wave-1 scope.)
 */
export const HQ_START_WARES: Readonly<Record<WareType, number>> = {
  beer: 6, hammer: 16, axe: 6, saw: 2, pickaxe: 2, shovel: 4, crucible: 4,
  rodandline: 6, scythe: 8, cleaver: 2, rollingpin: 2, bow: 2, tongs: 0,
  sword: 6, fish: 4, bread: 8, shield: 6, trunk: 24, plank: 44, stone: 68,
  ironore: 16, coal: 16, meat: 6,
};
/**
 * Source: CONSTANTS.md §6 settlers/jobs, Normal column. `carrier` seeds from the
 * Helper pool. Jobs not listed start at 0 and are recruited on demand from a
 * Helper + tool (CONSTANTS.md §7). Planer/soldiers/geologist/PackDonkey are §6
 * rows outside P3 wave-1 scope.
 */
export const HQ_START_WORKERS: Readonly<Record<JobType, number>> = {
  carrier: 52, // §6 Helper (Normal) — generic carrier/builder/recruit pool
  builder: 10, // §6 Builder (Normal)
  woodcutter: 8, // §6 Woodcutter (Normal)
  forester: 4, // §6 Forester (Normal)
  sawmiller: 4, // §6 Carpenter (Normal)
  stonemason: 4, // §6 Stonemason (Normal)
  hunter: 2, // §6 Hunter (Normal)
  miner: 10, // §6 Miner (Normal)
  metalworker: 2, // §6 Metalworker (Normal)
  armorer: 4, // §6 Armorer (Normal)
  scout: 2, // §6 Scout (Normal)
};
/**
 * Starting idle soldiers by rank 0..4 (CONSTANTS.md §6 "Private (soldier)",
 * Normal column = 46). Only privates start; higher ranks are earned via
 * promotion (MILITARY.md §6).
 */
export const HQ_START_SOLDIERS: readonly number[] = [46, 0, 0, 0, 0];

// --- Military (MILITARY.md) -----------------------------------------------

/** Soldier rank ids 0..4 (MILITARY.md §1). rank = Job - Private. */
export const SOLDIER_RANK = {
  private: 0,
  privateFirstClass: 1,
  sergeant: 2,
  officer: 3,
  general: 4,
} as const;

/** Number of soldier ranks (MILITARY.md §1 NUM_SOLDIER_RANKS). */
export const NUM_SOLDIER_RANKS = 5;
/** Highest rank a soldier can reach (MILITARY.md §1 MAX_MILITARY_RANK). */
export const MAX_MILITARY_RANK = 4;

/** English rank names, indexed by rank 0..4 (MILITARY.md §1). */
export const SOLDIER_RANK_NAMES: readonly string[] = [
  'private',
  'private_first_class',
  'sergeant',
  'officer',
  'general',
];

/** Hitpoints per rank (MILITARY.md §1 HITPOINTS): higher rank survives more hits. */
export const SOLDIER_HITPOINTS: readonly number[] = [3, 4, 5, 6, 7];

/** Territory radius of the headquarters/warehouse (MILITARY.md §2 HQ_RADIUS). */
export const HQ_RADIUS = 9;
/** Territory radius of a harbor building (MILITARY.md §2 HARBOR_RADIUS). */
export const HARBOR_RADIUS = 8;

/** Extra sight range added on top of a military building's territory reach (§3). */
export const VISUALRANGE_MILITARY = 3;
/** Absolute sight range of a lookout tower (MILITARY.md §3). */
export const VISUALRANGE_LOOKOUTTOWER = 20;
/** Sight range of a walking scout / soldier (MILITARY.md §3). */
export const VISUALRANGE_SCOUT = 3;
export const VISUALRANGE_SOLDIER = 2;

/**
 * Attack mechanics constants (MILITARY.md §4). Straight-line node distances.
 */
export const MILITARY_ATTACK = {
  /** A building can attack targets this far without losing attackers (§4.2). */
  baseDistance: 21, // BASE_ATTACKING_DISTANCE
  /** Longest on-foot path attackers will walk to reach the target (§4.3). */
  maxRunDistance: 40, // MAX_ATTACKING_RUN_DISTANCE
  /** Opponents within this distance move together and start a fight (§4). */
  meetDistance: 5, // MEET_FOR_FIGHT_DISTANCE
  /** Idle friendly attackers this close may join a capture (§4). */
  farAwayCapture: 15, // MAX_FAR_AWAY_CAPTURING_DISTANCE
} as const;

/**
 * `ADJUST_MILITARY_STRENGTH` game setting (MILITARY.md §5). 0 = max (rank+6),
 * 1 = medium/DEFAULT (rank+10), 2 = min (10, rank-independent). We use the
 * default. Roll = RANDOM_RAND(bound) in [0, bound-1].
 */
export const ADJUST_MILITARY_STRENGTH: number = 1;

/** Strength-roll bound for a rank under the current strength setting (§5). */
export function strengthRollBound(rank: number): number {
  if (ADJUST_MILITARY_STRENGTH === 0) return rank + 6;
  if (ADJUST_MILITARY_STRENGTH === 2) return 10;
  return rank + 10; // default (medium)
}

/** Fight timings in GF (MILITARY.md §5). */
export const FIGHT_ROUND_GF = 15; // each attack/defense round
export const FIGHT_DEATH_GF = 30; // death sequence

/** Promotion timings in GF (MILITARY.md §6). schedule = 100 + rand(300). */
export const UPGRADE_TIME = 100;
export const UPGRADE_TIME_RANDOM = 300;

/** Recruitment timings in GF (MILITARY.md §6 / CONSTANTS.md §7). 200 + rand(200). */
export const RECRUITE_GF = 200;
export const RECRUITE_RANDOM_GF = 200;

/** Catapult behaviour (MILITARY.md §7). */
export const CATAPULT = {
  /** Enemy military buildings strictly nearer than this are candidates (§7). */
  range: 14, // distance < 14
  /** Percent hit chance: RANDOM_RAND(99) < 70 (§7). */
  hitPercent: 70,
  /**
   * Between-shot wait in GF. MILITARY.md §7 notes RttR inflated this to 1300 to
   * slow ware use; the original S2 value is 310. We deliberately use the ORIGINAL
   * 310 for a faithful pace (documented choice).
   */
  wait: 310, // CATAPULT_WAIT1_LENGTH (original S2, not RttR's 1300)
  /** Stone store capacity (§7 / CONSTANTS.md §2). */
  stoneStore: 4,
} as const;

/**
 * Owner-layer encoding. `owner[node]` = 0 for neutral/unclaimed land, otherwise
 * `player + 1`. Kept small so the byte layer stays compact. Territory is derived
 * (systems/territory.ts RecalcTerritory), mirroring MILITARY.md §3.
 */
export const OWNER_NONE = 0;
/** Player index owning a node, or -1 when neutral. */
export function ownerPlayer(ownerByte: number): number {
  return ownerByte === OWNER_NONE ? -1 : ownerByte - 1;
}
/** Owner byte for a player index. */
export function ownerByteFor(player: number): number {
  return player + 1;
}

// --- Seafaring (P7) -------------------------------------------------------
/**
 * Ship + sea-transport + expedition tunables. Ships are entities (like settlers
 * but on water); harbors are coastal warehouses. All timings in GF/ticks.
 *
 * Original references (CONSTANTS.md): a ship holds up to 40 cargo units; boat
 * carriers move 1 node / 20 GF (§3/§4 — ships reuse the same base speed, no
 * source constant makes them faster); the shipyard's Shipwright takes 1250 GF
 * (§5). Expedition material amounts are an ENGINE model (the original founds a
 * colony from an on-board building kit; we fix it to a harbor's own cost so the
 * kit matches what it raises). The sea-leg penalty is an ENGINE routing weight
 * that biases wares onto land whenever a comparable land route exists.
 */
export const SEA = {
  /** Max ware tokens a transport ship carries (CONSTANTS.md: ship holds ~40). */
  cargoCapacity: 40,
  /** Ticks a ship takes to cross one water-lattice edge (§3/§4 base 20 GF/node). */
  ticksPerEdge: 20,
  /** Extra hop-cost added to a sea-assisted ware route vs. a pure land route (ENGINE). */
  legPenalty: 15,
  /** Boards a shipyard consumes to build one ship (ENGINE: ships are entities, not wares). */
  shipPlankCost: 6,
  /** Boards an expedition loads before it can found a harbor (ENGINE = harbor cost). */
  expeditionBoards: 4,
  /** Stones an expedition loads before it can found a harbor (ENGINE = harbor cost). */
  expeditionStones: 6,
} as const;

// --- Map object encoding (FACT: settlers2.net objects doc + on-disk data) --
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
 * Stones remaining in a granite pile, from its object_index (OBJECTS.md §3b:
 * low nibble = remaining quantity 1..6).
 */
export function graniteStock(objIndex: number): number {
  return Math.max(0, objIndex & 0x0f);
}

/** Engine-internal sapling object type (kept outside the tree range so it is not felled). */
export const OBJ_TYPE_SAPLING = 0xc3;
export const OBJ_INDEX_SAPLING = 0x01;
export const OBJ_INDEX_MATURE = 0x30;
/**
 * Engine-internal growing/mature grain-field object type (kept outside tree and
 * granite ranges). index = growth stage (OBJ_INDEX_SAPLING while growing,
 * OBJ_INDEX_MATURE when harvestable).
 */
export const OBJ_TYPE_CROP = 0xc2;

/** True when a node object is an engine-planted sapling or growing crop field. */
export function isFieldObject(objType: number): boolean {
  return objType === OBJ_TYPE_SAPLING || objType === OBJ_TYPE_CROP;
}

// --- Subsurface resource layer -------------------------------------------
// The byte is the original Settlers II WLD resource encoding (map layer 12),
// which the runtime uses directly: the type is a value RANGE and the amount is
// the low 3 bits (0..7).
//   0x20-0x27 water (underground; wells)   0x40-0x47 coal   0x48-0x4F iron
//   0x50-0x57 gold   0x58-0x5F granite   0x80-0x87 fish (in water)   else nothing
/** Resource kind ids used by building defs (`def.resource`). */
export const RESOURCE = {
  none: 0,
  iron: 1,
  gold: 2,
  coal: 3,
  granite: 4,
  water: 5,
  fish: 6,
} as const;

const RESOURCE_BASE: Readonly<Record<number, number>> = {
  [RESOURCE.water]: 0x20,
  [RESOURCE.coal]: 0x40,
  [RESOURCE.iron]: 0x48,
  [RESOURCE.gold]: 0x50,
  [RESOURCE.granite]: 0x58,
  [RESOURCE.fish]: 0x80,
};

/** Resource kind of a raw S2 resource byte (see the range table above). */
export function resourceType(byte: number): number {
  if (byte >= 0x20 && byte <= 0x27) return RESOURCE.water;
  if (byte >= 0x40 && byte <= 0x47) return RESOURCE.coal;
  if (byte >= 0x48 && byte <= 0x4f) return RESOURCE.iron;
  if (byte >= 0x50 && byte <= 0x57) return RESOURCE.gold;
  if (byte >= 0x58 && byte <= 0x5f) return RESOURCE.granite;
  if (byte >= 0x80 && byte <= 0x87) return RESOURCE.fish;
  return RESOURCE.none;
}
/** Remaining minable/catchable amount (0..7) of a raw resource byte. */
export function resourceAmount(byte: number): number {
  return resourceType(byte) === RESOURCE.none ? 0 : byte & 0x07;
}
/** Compose a resource byte from a kind + amount (0..7); decrement by 1 to consume. */
export function makeResource(type: number, amount: number): number {
  const base = RESOURCE_BASE[type];
  if (base === undefined) return 0;
  return base | (Math.max(0, Math.min(7, amount)) & 0x07);
}
