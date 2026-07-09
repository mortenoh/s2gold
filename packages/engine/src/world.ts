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
  HQ_START_WARES,
  HQ_START_WORKERS,
  JOB_TYPES,
  OBJ_TYPE,
  WARE_TYPES,
  type BuildingType,
  type JobType,
  type WareType,
} from './constants';
import { Geometry } from './geometry';
import { seedRng, type RngState } from './rng';

/** Format version for serialized worlds. */
export const WORLD_VERSION = 1;

/** A stored ware token. */
export interface Ware {
  id: number;
  type: WareType;
  /** 'flag' | 'carried' | 'building'. */
  loc: 'flag' | 'carried' | 'building';
  /** flagId when loc==='flag', settlerId when carried, buildingId when in building. */
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
  /** Production input buffer (e.g. trunks in a sawmill). */
  inputStock: number;
  /** Finished wares produced but not yet placed on the building's flag. */
  outputPending: number;
  /** Production work timer (ticks into the current cycle). */
  workTimer: number;
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
}

export type SettlerState =
  | 'idle'
  | 'toBuilding' // new worker walking to its workplace
  | 'toWork' // walking to a tree / planting spot / granite
  | 'working' // running a work timer at destination
  | 'home' // returning to workplace after field work
  | 'carrierIdle' // carrier resting at road middle
  | 'carrierToPickup' // carrier walking to an end flag to collect a ware
  | 'carrierToDropoff'; // carrier carrying a ware to the far flag

/** Per-player state and warehouse inventory. */
export interface Player {
  index: number;
  hqBuildingId: number;
  /** Ware type -> count stored at HQ. */
  wares: Record<WareType, number>;
  /** Job type -> idle worker count available at HQ. */
  workers: Record<JobType, number>;
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
  players: Player[];
  /** Forester-planted saplings maturing into trees (node + maturation tick). */
  saplings: Array<{ node: number; matureTick: number }>;
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
    players: [],
    saplings: [],
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
    };
    world.players.push(player);
    if (hx === undefined || hy === undefined || hx === 0xffff || hy === 0xffff) continue;
    const node = geom.index(hx, hy);
    placeHeadquarters(world, geom, node, p);
  }

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
    inputStock: 0,
    outputPending: 0,
    workTimer: 0,
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
