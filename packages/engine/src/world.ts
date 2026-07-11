/**
 * The World model: dense integer state plus free lists, exactly per
 * docs/engine-notes/ARCHITECTURE.md. No floats, no DOM, iteration in id order.
 *
 * `createWorld` consumes an already-parsed converted map JSON object (the shape
 * emitted by src/s2gold/convert/maps.py and read by
 * packages/app/src/game/map-loader.ts) — it never fetches. Layers arrive as
 * base64 strings and are decoded to plain number arrays here.
 */

import type { Command } from './commands';
import {
  BUILDING,
  DEFAULT_TRANSPORT_PRIORITY,
  HQ_START_SOLDIERS,
  HQ_START_WARES,
  HQ_START_WORKERS,
  JOB_TYPES,
  NUM_SOLDIER_RANKS,
  OBJ_TYPE,
  TOOL_WARES,
  WARE_TYPES,
  type BuildingType,
  type JobType,
  type WareType,
} from './constants';
import { Geometry } from './geometry';
import { seedRng, type RngState } from './rng';
import { recalcTerritory } from './systems/territory';

/** Format version for serialized worlds. */
export const WORLD_VERSION = 1;

/** A stored ware token. */
export interface Ware {
  id: number;
  type: WareType;
  /** 'flag' | 'carried' | 'building' | 'ship' (P7 sea cargo). */
  loc: 'flag' | 'carried' | 'building' | 'ship';
  /** flagId when loc==='flag', settlerId carried, buildingId in building, shipId on a ship. */
  locId: number;
  /** Destination building this ware is routed to (-1 = none/at rest). */
  targetBuildingId: number;
  /** Next flag on the route toward the target (-1 = unknown/at target). */
  nextFlag: number;
}

/** A flag: a road-network node holding up to FLAG_WARE_CAPACITY wares. */
export interface Flag {
  id: number;
  node: number;
  player: number;
  /** Ware ids currently waiting (queue order preserved). */
  wares: number[];
}

/** A road segment between two flags, served by one carrier. */
export interface Road {
  id: number;
  player: number;
  /** Node path inclusive of both flag nodes (flagA node .. flagB node). */
  path: number[];
  flagA: number;
  flagB: number;
  /** Serving carrier settler id (-1 until assigned). */
  carrierId: number;
  /**
   * Carrier productivity accumulator (CONSTANTS.md §4): game frames the primary
   * carrier spent hauling/fetching within the current PRODUCTIVITY_GF window.
   * Compared against DONKEY_UPGRADE_BUSY_GF at each window boundary, then reset.
   */
  busyGf: number;
  /** True once the road has auto-upgraded to a donkey road (gets a 2nd carrier). */
  upgraded: boolean;
  /** Second (pack-donkey) carrier settler id on an upgraded road (-1 = none). */
  donkeyId: number;
}

/** A building or construction site. */
export interface Building {
  id: number;
  type: BuildingType;
  node: number;
  player: number;
  /** Flag serving this building's door (node SE of the building). */
  flagId: number;
  state: 'site' | 'working';
  /** Boards/stones delivered to the construction site so far. */
  deliveredBoards: number;
  deliveredStones: number;
  needBoards: number;
  needStones: number;
  /** Construction work accumulated (ticks); site completes at buildTicks. */
  buildProgress: number;
  buildTicks: number;
  /** Assigned worker settler id (-1 = none / not yet arrived). */
  workerId: number;
  /** True once the worker is present and the building can produce. */
  staffed: boolean;
  /**
   * Per-input-type stock, aligned to the building def's `inputs` order (empty for
   * buildings with no ware inputs). Sized when the building starts working.
   */
  inputStock: number[];
  /**
   * Finished wares produced but not yet placed on the building's flag (queue
   * order preserved so alternating outputs — armory sword/shield — stay ordered).
   */
  outputQueue: WareType[];
  /** Production work timer (ticks remaining in the current cycle; 0 = idle). */
  workTimer: number;
  /** Alternating-output toggle (armory: 0 = sword, 1 = shield). */
  altToggle: number;
  // --- Military fields (MILITARY.md; non-military buildings leave these zeroed) ---
  /** Garrisoned soldier count per rank 0..4 (empty for non-military). */
  garrison: number[];
  /** True once at least one soldier has occupied it: territory is active (§3). */
  occupied: boolean;
  /** Coin delivery toggle (MILITARY.md §3; default true). */
  coinsEnabled: boolean;
  /** Soldiers currently walking in to occupy (so we don't over-order) (§3). */
  incoming: number;
  /** Ticks until the next promotion event (-1 = none scheduled) (§6). */
  promotionTimer: number;
}

/** A settler entity (workers and carriers). */
export interface Settler {
  id: number;
  job: JobType;
  player: number;
  state: SettlerState;
  /** Current node. */
  node: number;
  /** Remaining node sequence to walk through (excludes current node). */
  path: number[];
  /** Index into `path` of the next node to step onto. */
  pathIndex: number;
  /** Ticks accumulated into the current edge. */
  edgeProgress: number;
  /** Ticks per edge for this settler's current movement. */
  ticksPerEdge: number;
  /** Carried ware id (-1 = none). */
  carryingWareId: number;
  /** Generic work/idle timer (ticks). */
  timer: number;
  /** Home building (worker's workplace; -1 for unattached carriers). */
  homeBuildingId: number;
  /** Road this carrier serves (-1 for non-carriers). */
  roadId: number;
  /** Target node the carrier is currently walking to (-1 = none). */
  targetNode: number;
  // --- Soldier fields (MILITARY.md; civilians leave these at rank -1 / hp 0) ---
  /** Soldier rank 0..4, or -1 for a civilian settler. */
  rank: number;
  /** Remaining hitpoints (MILITARY.md §1). */
  hp: number;
  /** Carries armor absorbing one hit (Gold edition, MILITARY.md §1/§5). */
  hasArmor: boolean;
  /** Attack target building id while marching/fighting (-1 = none). */
  attackTargetId: number;
  /** In a fight: opponent's rank / remaining hp / armor and round timer (§5). */
  oppRank: number;
  oppHp: number;
  oppHasArmor: boolean;
  /** Fight round timer (ticks) and whose turn it is (0 = this soldier). */
  fightTimer: number;
  fightTurn: number;
}

/**
 * A ship entity (P7): a transport/expedition vessel that moves over water nodes,
 * shuttling ware cargo between a player's harbors and carrying expeditions to new
 * coastal harbor spots. Ships home to a harbor and idle at its dock.
 */
export interface Ship {
  id: number;
  player: number;
  /** Current water node. */
  node: number;
  state: ShipState;
  /** Home harbor building id the ship docks at when idle. */
  homeHarborId: number;
  /** Destination harbor building id while shuttling cargo (-1 = none). */
  destHarborId: number;
  /** Remaining water-node sequence to sail through (excludes current node). */
  path: number[];
  pathIndex: number;
  edgeProgress: number;
  ticksPerEdge: number;
  /** Ware ids loaded as cargo (queue order preserved). */
  cargo: number[];
  /**
   * When carrying an expedition, the founding kit + target: land node to found a
   * harbor on, and the materials/builder aboard. `targetSpot` = -1 when the ship
   * is not on an expedition.
   */
  expeditionTargetSpot: number;
  expeditionBoards: number;
  expeditionStones: number;
  expeditionBuilder: boolean;
}

export type ShipState =
  | 'idle' // docked at home harbor, available
  | 'shuttleOut' // sailing to a destination harbor with cargo
  | 'shuttleBack' // sailing home after delivering cargo
  | 'expedition'; // sailing to a target harbor spot to found a colony

/**
 * A pending expedition being assembled at a harbor (P7): the harbor draws boards,
 * stones and a builder from the player pool until the kit is complete, then a
 * ship can carry it to a new coastal spot. One entry per preparing harbor.
 */
export interface Expedition {
  harborId: number;
  player: number;
  boards: number;
  stones: number;
  hasBuilder: boolean;
  /** True once boards/stones/builder are all assembled (ExpeditionReady fired). */
  ready: boolean;
}

export type SettlerState =
  | 'idle'
  | 'toBuilding' // new worker walking to its workplace
  | 'toWork' // walking to a tree / planting spot / granite
  | 'working' // running a work timer at destination
  | 'home' // returning to workplace after field work
  | 'carrierIdle' // carrier resting at road middle
  | 'donkeyToRoad' // pack donkey walking from its warehouse out to the road middle
  | 'carrierToPickup' // carrier walking to an end flag to collect a ware
  | 'carrierToDropoff' // carrier carrying a ware to the far flag
  | 'soldierToOccupy' // soldier walking in to garrison a military building
  | 'soldierMarch' // soldier marching to an attack target's flag
  | 'soldierFight'; // soldier resolving a one-on-one duel at a flag

/** Per-player state and warehouse inventory. */
export interface Player {
  index: number;
  hqBuildingId: number;
  /** Ware type -> count stored across the player's warehouses (HQ + storehouses). */
  wares: Record<WareType, number>;
  /** Job type -> idle worker count available for dispatch/recruitment. */
  workers: Record<JobType, number>;
  /**
   * Bred pack donkeys available to staff upgraded (donkey) roads as a second
   * carrier. Filled by the donkey breeder, drained when a donkey is assigned to a
   * road, refilled if that road is destroyed. CONSTANTS.md §4.
   */
  donkeys: number;
  /**
   * Ordered tool ware list the metalworks cycles through (player tool-priority,
   * CONSTANTS.md §7; default = the 12 tools in enum order). `toolCycle` indexes it.
   */
  toolPriority: WareType[];
  toolCycle: number;
  /** Per-ware transport priority (lower = fetched first). CONSTANTS.md §4. */
  transportPriority: Record<WareType, number>;
  /**
   * Idle soldiers waiting in warehouses, count per rank 0..4 (MILITARY.md §1).
   * Recruited privates land in slot 0; occupation draws from the weak end.
   */
  soldiers: number[];
  /** Ticks until the next soldier is recruited (-1 = idle). MILITARY.md §6. */
  recruitTimer: number;
}

/** A generic dense store with a free list; ids are array indices. */
export interface Store<T> {
  items: (T | null)[];
  free: number[];
}

function makeStore<T>(): Store<T> {
  return { items: [], free: [] };
}

/** Allocate a slot in a store, returning its id. Caller fills items[id]. */
export function storeAlloc<T>(store: Store<T>, make: (id: number) => T): number {
  const id = store.free.length > 0 ? (store.free.pop() as number) : store.items.length;
  store.items[id] = make(id);
  return id;
}

/** Free a slot; the id becomes reusable. */
export function storeFree<T>(store: Store<T>, id: number): void {
  store.items[id] = null;
  store.free.push(id);
}

/** Iterate live items in ascending id order (deterministic). */
export function* storeLive<T>(store: Store<T>): Generator<T> {
  for (const item of store.items) {
    if (item !== null) yield item;
  }
}

/** The complete simulation state. */
export interface World {
  version: number;
  tick: number;
  rng: RngState;
  width: number;
  height: number;
  // Static-ish node layers (plain arrays; integer bytes).
  terrain1: number[];
  terrain2: number[];
  heightMap: number[];
  objectType: number[];
  objectIndex: number[];
  resource: number[];
  owner: number[];
  // Dynamic node lookups.
  flagAtNode: number[]; // flagId or -1
  buildingAtNode: number[]; // buildingId or -1
  // Entity stores.
  flags: Store<Flag>;
  roads: Store<Road>;
  buildings: Store<Building>;
  settlers: Store<Settler>;
  wares: Store<Ware>;
  /** Ship entities (P7 seafaring). */
  ships: Store<Ship>;
  players: Player[];
  /** Forester-planted saplings maturing into trees (node + maturation tick). */
  saplings: Array<{ node: number; matureTick: number }>;
  /** Farmer-sown grain fields maturing into harvestable crops (node + mature tick). */
  cropFields: Array<{ node: number; matureTick: number }>;
  /** Pending expeditions being assembled at harbors (P7). */
  expeditions: Expedition[];
  /** Geologist survey signs: a mountain node and the resource kind found there
   * (RESOURCE.*; 0 = nothing). Placed by geologists so the player can see where
   * to build mines. */
  signs: Array<{ node: number; res: number }>;
  // Command queue (pending, applied at their due tick).
  commands: Command[];
  seqCounter: number;
}

/** The parsed converted-map JSON shape (subset the engine consumes). */
export interface MapJson {
  title?: string;
  width: number;
  height: number;
  terrain?: number;
  players?: number;
  hq_x: number[];
  hq_y: number[];
  encoding?: string;
  layers: Record<string, string>;
}

/** Options for {@link createWorld}. */
export interface CreateWorldOptions {
  seed: number;
  /** Number of players to seed with an HQ (defaults to those with a valid hq). */
  players?: number;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = (() => {
  const t = new Int16Array(256).fill(-1);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  return t;
})();

/** Decode a base64 string to a plain number array (portable; no atob/Buffer). */
export function decodeBase64ToBytes(b64: string): number[] {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const v = B64_LOOKUP[clean.charCodeAt(i)];
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return out;
}

function zeroWares(): Record<WareType, number> {
  const r = {} as Record<WareType, number>;
  for (const w of WARE_TYPES) r[w] = 0;
  return r;
}

function zeroWorkers(): Record<JobType, number> {
  const r = {} as Record<JobType, number>;
  for (const j of JOB_TYPES) r[j] = 0;
  return r;
}

/**
 * Build a World from a parsed map JSON. Places one HQ (with starting inventory)
 * per requested player that has a valid headquarters marker on the map.
 */
export function createWorld(map: MapJson, options: CreateWorldOptions): World {
  const width = map.width;
  const height = map.height;
  const size = width * height;
  const geom = new Geometry(width, height);

  const layer = (name: string): number[] => {
    const b64 = map.layers[name];
    if (b64 === undefined) return new Array<number>(size).fill(0);
    const bytes = decodeBase64ToBytes(b64);
    if (bytes.length < size) {
      while (bytes.length < size) bytes.push(0);
    }
    return bytes.slice(0, size);
  };

  const world: World = {
    version: WORLD_VERSION,
    tick: 0,
    rng: seedRng(options.seed, 0),
    width,
    height,
    terrain1: layer('texture1'),
    terrain2: layer('texture2'),
    heightMap: layer('height'),
    objectType: layer('object_type'),
    objectIndex: layer('object_index'),
    resource: layer('resources'),
    owner: layer('owner'),
    flagAtNode: new Array<number>(size).fill(-1),
    buildingAtNode: new Array<number>(size).fill(-1),
    flags: makeStore<Flag>(),
    roads: makeStore<Road>(),
    buildings: makeStore<Building>(),
    settlers: makeStore<Settler>(),
    wares: makeStore<Ware>(),
    ships: makeStore<Ship>(),
    players: [],
    saplings: [],
    cropFields: [],
    expeditions: [],
    signs: [],
    commands: [],
    seqCounter: 0,
  };

  // Determine how many players to seed.
  const validHqs: number[] = [];
  for (let p = 0; p < map.hq_x.length; p++) {
    const hx = map.hq_x[p];
    const hy = map.hq_y[p];
    if (hx !== undefined && hy !== undefined && hx !== 0xffff && hy !== 0xffff) validHqs.push(p);
  }
  const wanted = options.players ?? validHqs.length;

  for (let p = 0; p < wanted; p++) {
    const hx = map.hq_x[p];
    const hy = map.hq_y[p];
    const player: Player = {
      index: p,
      hqBuildingId: -1,
      wares: { ...zeroWares(), ...HQ_START_WARES },
      workers: { ...zeroWorkers(), ...HQ_START_WORKERS },
      donkeys: 0,
      toolPriority: [...TOOL_WARES],
      toolCycle: 0,
      transportPriority: { ...DEFAULT_TRANSPORT_PRIORITY },
      soldiers: [...HQ_START_SOLDIERS],
      recruitTimer: -1,
    };
    world.players.push(player);
    if (hx === undefined || hy === undefined || hx === 0xffff || hy === 0xffff) continue;
    const node = geom.index(hx, hy);
    placeHeadquarters(world, geom, node, p);
  }

  // Seed ownership from every HQ (MILITARY.md §3): the HQ claims its radius disc.
  recalcTerritory(world, geom);

  return world;
}

/** Place a headquarters building plus its flag for a player. */
function placeHeadquarters(world: World, geom: Geometry, node: number, player: number): void {
  const flagNode = geom.neighbour(node, 'SE');
  const flagId = storeAlloc(world.flags, (id) => ({ id, node: flagNode, player, wares: [] }));
  world.flagAtNode[flagNode] = flagId;

  const bId = storeAlloc(world.buildings, (id) => ({
    id,
    type: BUILDING.headquarters,
    node,
    player,
    flagId,
    state: 'working' as const,
    deliveredBoards: 0,
    deliveredStones: 0,
    needBoards: 0,
    needStones: 0,
    buildProgress: 0,
    buildTicks: 0,
    workerId: -1,
    staffed: true,
    inputStock: [],
    outputQueue: [],
    workTimer: 0,
    altToggle: 0,
    garrison: new Array<number>(NUM_SOLDIER_RANKS).fill(0),
    occupied: true, // the HQ is always a manned territory anchor (MILITARY.md §3)
    coinsEnabled: false,
    incoming: 0,
    promotionTimer: -1,
  }));
  world.buildingAtNode[node] = bId;
  world.objectType[node] = OBJ_TYPE.hqMarker;
  world.players[player].hqBuildingId = bId;
}

// --- Small typed accessors reused across systems --------------------------

export function getFlag(world: World, id: number): Flag {
  const f = world.flags.items[id];
  if (!f) throw new Error(`no flag ${id}`);
  return f;
}
export function getBuilding(world: World, id: number): Building {
  const b = world.buildings.items[id];
  if (!b) throw new Error(`no building ${id}`);
  return b;
}
export function getSettler(world: World, id: number): Settler {
  const s = world.settlers.items[id];
  if (!s) throw new Error(`no settler ${id}`);
  return s;
}
export function getRoad(world: World, id: number): Road {
  const r = world.roads.items[id];
  if (!r) throw new Error(`no road ${id}`);
  return r;
}
export function getWare(world: World, id: number): Ware {
  const w = world.wares.items[id];
  if (!w) throw new Error(`no ware ${id}`);
  return w;
}
export function getShip(world: World, id: number): Ship {
  const s = world.ships.items[id];
  if (!s) throw new Error(`no ship ${id}`);
  return s;
}
