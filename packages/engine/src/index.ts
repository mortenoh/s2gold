/**
 * @s2gold/engine — deterministic, DOM-free Settlers II economy simulation.
 *
 * Public API per docs/engine-notes/ARCHITECTURE.md. The renderer and app consume
 * ONLY this surface plus read-only state views; they never mutate world state
 * except through {@link applyCommand}.
 */

import { runDueCommands } from './commands';
import { buildingDef, type BuildingType } from './constants';
import { EventSink, type GameEvent } from './events';
import { Geometry } from './geometry';
import { GREENLAND_RULES, type TerrainRules } from './terrain';
import { runCarriers } from './systems/carriers';
import { runConstruction } from './systems/construction';
import { runPopulation } from './systems/recruit';
import { runProduction } from './systems/production';
import { runDispatch } from './systems/dispatch';
import { runMilitary, garrisonCount } from './systems/military';
import { runSeafaring } from './systems/seafaring';
import {
  HQ_RADIUS,
  SEA,
  VISUALRANGE_LOOKOUTTOWER,
  VISUALRANGE_MILITARY,
  ownerPlayer,
} from './constants';
import {
  storeLive,
  type Building,
  type Flag,
  type Road,
  type Settler,
  type Ship,
  type ShipState,
  type World,
} from './world';

export const ENGINE_VERSION = '0.1.0';

/** Returns the engine package version. */
export function version(): string {
  return ENGINE_VERSION;
}

// --- Re-exports (public API + supporting types) ---------------------------
export { createWorld, WORLD_VERSION } from './world';
export type {
  World,
  Flag,
  Road,
  Building,
  Settler,
  Ware,
  Ship,
  ShipState,
  Expedition,
  Player,
  MapJson,
  CreateWorldOptions,
} from './world';
export {
  applyCommand,
  canPlaceFlag,
  canPlaceBuilding,
  canPlaceHarbor,
  requiresCoast,
  terrainBuildable,
  terrainMineable,
} from './commands';
export type { Command, CommandInput } from './commands';
export { serializeWorld, deserializeWorld, hashWorld } from './serialize';
export { fnv1a } from './hash';
export { Geometry, DIRECTIONS } from './geometry';
export type { Direction } from './geometry';
export { seedRng, nextUint, nextRange, cloneRng } from './rng';
export type { RngState } from './rng';
export {
  GREENLAND_RULES,
  DEFAULT_IMPASSABLE,
  BUILDABLE_IDS,
  MOUNTAIN_IDS,
  NAVIGABLE_WATER_IDS,
  HARBOR_TEXTURE_FLAG,
  terrainId,
  isBuildableTexture,
  isWalkableTexture,
  isMountainTexture,
  isWaterTexture,
  hasHarborFlag,
} from './terrain';
export type { TerrainRules } from './terrain';
export {
  isWaterNode,
  isCoastalLand,
  harborDockNode,
  waterNeighbours,
  waterNeighbourCount,
} from './water';
export { findWalkPath, findWaterPath, findFlagRoute, buildFlagGraph, roadBetween } from './pathfinding';
export type { GameEvent } from './events';
export * from './constants';

// --- AI opponent (P6) ------------------------------------------------------
// Enable a computer player by creating one AiState per AI-controlled player and
// calling runAi(world, state) once per frame just before tickWorld. See ai/.
export { createAiState, stepAi, runAi } from './ai';
export type { AiOptions, AiState } from './ai';

/** Geometry helper for a world (recreated on demand; cheap). */
export function worldGeometry(world: World): Geometry {
  return new Geometry(world.width, world.height);
}

/** Advance the simulation exactly one game frame; returns emitted events. */
export function tickWorld(world: World, rules: TerrainRules = GREENLAND_RULES): GameEvent[] {
  const geom = worldGeometry(world);
  const events = new EventSink();
  runDueCommands(world, geom, rules, events); // 1. commands
  runPopulation(world); // 1b. HQ population growth (tops up the Helper pool)
  runConstruction(world, geom, rules, events); // 2. construction (+ builder steps)
  runProduction(world, geom, rules, events); // 3. production (+ worker steps)
  runMilitary(world, geom, rules, events); // 4. military (occupy/fight/promote/catapult)
  runDispatch(world, geom, events); // 5a. ware routing + delivery
  runCarriers(world, events); // 5b. carriers
  runSeafaring(world, geom, events); // 5c. ships, sea transport, expeditions (P7)
  world.tick++;
  return events.drain(); // 6. events
}

// --- Read-only view helpers -----------------------------------------------

/** The flag at a node, or null. */
export function flagAt(world: World, node: number): Flag | null {
  const id = world.flagAtNode[node];
  return id >= 0 ? (world.flags.items[id] ?? null) : null;
}

/** The building at a node, or null. */
export function buildingAt(world: World, node: number): Building | null {
  const id = world.buildingAtNode[node];
  return id >= 0 ? (world.buildings.items[id] ?? null) : null;
}

/** All roads whose node path passes through a node. */
export function roadsThrough(world: World, node: number): Road[] {
  const out: Road[] = [];
  for (const r of storeLive(world.roads)) {
    if (r.path.includes(node)) out.push(r);
  }
  return out;
}

/** Settlers whose current node lies within a (wrapped) rectangle of nodes. */
export function settlersInRect(
  world: World,
  rect: { x: number; y: number; w: number; h: number },
): Settler[] {
  const out: Settler[] = [];
  for (const s of storeLive(world.settlers)) {
    const sx = s.node % world.width;
    const sy = Math.floor(s.node / world.width);
    const dx = ((sx - rect.x) % world.width + world.width) % world.width;
    const dy = ((sy - rect.y) % world.height + world.height) % world.height;
    if (dx < rect.w && dy < rect.h) out.push(s);
  }
  return out;
}

/** Live flags of a player (id order). */
export function flagsOf(world: World, player: number): Flag[] {
  const out: Flag[] = [];
  for (const f of storeLive(world.flags)) if (f.player === player) out.push(f);
  return out;
}

// --- Economy view helpers (read-only; for the UI building panel + tests) ----

/** An input slot view: which ware, how much is stocked, and the capacity. */
export interface InputSlotView {
  ware: string;
  count: number;
  cap: number;
}

/** Read-only snapshot of a building's production inventory and worker state. */
export interface BuildingInventoryView {
  buildingId: number;
  type: BuildingType;
  state: 'site' | 'working';
  staffed: boolean;
  workerId: number;
  inputs: InputSlotView[];
  outputQueue: string[];
  workTimer: number;
  /** Construction sites: material still owed (boards, stones). */
  needBoards: number;
  deliveredBoards: number;
  needStones: number;
  deliveredStones: number;
}

/** Inventory + worker snapshot of a single building (null when the id is dead). */
export function buildingInventory(world: World, buildingId: number): BuildingInventoryView | null {
  const b = world.buildings.items[buildingId];
  if (!b) return null;
  const def = buildingDef(b.type);
  const inputs: InputSlotView[] = (def?.inputs ?? []).map((ware, i) => ({
    ware,
    count: b.inputStock[i] ?? 0,
    cap: def?.inputCap ?? 0,
  }));
  return {
    buildingId: b.id,
    type: b.type,
    state: b.state,
    staffed: b.staffed,
    workerId: b.workerId,
    inputs,
    outputQueue: b.outputQueue.slice(),
    workTimer: b.workTimer,
    needBoards: b.needBoards,
    deliveredBoards: b.deliveredBoards,
    needStones: b.needStones,
    deliveredStones: b.deliveredStones,
  };
}

/** Read-only snapshot of a player's warehouse inventory and worker/donkey pools. */
export interface PlayerInventoryView {
  wares: Record<string, number>;
  workers: Record<string, number>;
  donkeys: number;
  toolPriority: string[];
}

/** Warehouse inventory + idle worker pools for a player (null for an invalid index). */
export function playerInventory(world: World, player: number): PlayerInventoryView | null {
  const p = world.players[player];
  if (!p) return null;
  return {
    wares: { ...p.wares },
    workers: { ...p.workers },
    donkeys: p.donkeys,
    toolPriority: p.toolPriority.slice(),
  };
}

/** The player's current metalworks tool-production priority order. */
export function getToolPriority(world: World, player: number): string[] {
  return world.players[player]?.toolPriority.slice() ?? [];
}

/** The player's per-ware transport priority map (lower number = fetched first). */
export function getTransportPriority(world: World, player: number): Record<string, number> {
  return { ...(world.players[player]?.transportPriority ?? {}) };
}

// --- Military / territory view helpers (read-only) ------------------------

/** Owning player of a node (-1 = neutral). MILITARY.md §3. */
export function ownerAt(world: World, node: number): number {
  return ownerPlayer(world.owner[node]);
}

/** All nodes currently owned by a player (id order). */
export function territoryOf(world: World, player: number): number[] {
  const out: number[] = [];
  for (let node = 0; node < world.owner.length; node++) {
    if (ownerPlayer(world.owner[node]) === player) out.push(node);
  }
  return out;
}

/**
 * Border-stone nodes for a player: owned nodes that touch at least one node not
 * owned by the same player (the derived border ring, MILITARY.md §3). Cheap
 * derivation from `world.owner`; no map objects needed.
 */
export function borderNodes(world: World, player: number): number[] {
  const geom = worldGeometry(world);
  const out: number[] = [];
  for (let node = 0; node < world.owner.length; node++) {
    if (ownerPlayer(world.owner[node]) !== player) continue;
    for (const n of geom.neighbours(node)) {
      if (ownerPlayer(world.owner[n]) !== player) {
        out.push(node);
        break;
      }
    }
  }
  return out;
}

/**
 * Per-player visibility set (fog-of-war groundwork, MILITARY.md §3). A node is
 * visible when it lies within the player's owned territory plus the extra sight
 * range of its military buildings/HQ (VISUALRANGE_MILITARY), or within a lookout
 * tower's absolute range. Returned as a `Set<number>` of visible node ids; the
 * renderer can consume it directly. Cheap enough to recompute when territory
 * changes (the intended trigger).
 */
export function visibleNodes(world: World, player: number): Set<number> {
  const geom = worldGeometry(world);
  const visible = new Set<number>();
  // Owned territory is always visible.
  for (let node = 0; node < world.owner.length; node++) {
    if (ownerPlayer(world.owner[node]) === player) visible.add(node);
  }
  // Add each military building's / HQ's extra sight disc, and lookout towers.
  const addDisc = (center: number, radius: number): void => {
    for (let node = 0; node < geom.size; node++) {
      if (geom.distance(center, node) <= radius) visible.add(node);
    }
  };
  for (const b of storeLive(world.buildings)) {
    if (b.player !== player) continue;
    const def = buildingDef(b.type);
    if (!def) continue;
    if (def.kind === 'hq') addDisc(b.node, HQ_RADIUS + VISUALRANGE_MILITARY);
    else if (def.kind === 'military' && b.occupied) {
      addDisc(b.node, (def.militaryRadius ?? 0) + VISUALRANGE_MILITARY);
    } else if (b.type === 'lookout') addDisc(b.node, VISUALRANGE_LOOKOUTTOWER);
  }
  return visible;
}

/** Read-only snapshot of a military building's garrison, coins and state. */
export interface MilitaryView {
  buildingId: number;
  type: BuildingType;
  player: number;
  occupied: boolean;
  /** Soldier count per rank 0..4. */
  garrison: number[];
  troops: number;
  maxTroops: number;
  coins: number;
  maxGold: number;
  coinsEnabled: boolean;
  militaryRadius: number;
}

// --- Seafaring view helpers (read-only; for the app UI wave) --------------

/** Live ships of a player (id order). */
export function shipsOf(world: World, player: number): Ship[] {
  const out: Ship[] = [];
  for (const s of storeLive(world.ships)) if (s.player === player) out.push(s);
  return out;
}

/** Working harbor buildings of a player (id order). */
export function harborsOf(world: World, player: number): Building[] {
  const out: Building[] = [];
  for (const b of storeLive(world.buildings)) {
    if (b.player === player && b.type === 'harbor' && b.state === 'working') out.push(b);
  }
  return out;
}

/** Read-only snapshot of a ship's position, home, state, and cargo. */
export interface ShipView {
  shipId: number;
  player: number;
  node: number;
  state: ShipState;
  homeHarborId: number;
  destHarborId: number;
  cargoCount: number;
  cargoCapacity: number;
  onExpedition: boolean;
}

/** Snapshot of a single ship (null when the id is dead). */
export function shipView(world: World, shipId: number): ShipView | null {
  const s = world.ships.items[shipId];
  if (!s) return null;
  return {
    shipId: s.id,
    player: s.player,
    node: s.node,
    state: s.state,
    homeHarborId: s.homeHarborId,
    destHarborId: s.destHarborId,
    cargoCount: s.cargo.length,
    cargoCapacity: SEA.cargoCapacity,
    onExpedition: s.expeditionTargetSpot >= 0,
  };
}

/** Read-only snapshot of an expedition being assembled at a harbor. */
export interface ExpeditionView {
  harborId: number;
  player: number;
  boards: number;
  stones: number;
  neededBoards: number;
  neededStones: number;
  hasBuilder: boolean;
  ready: boolean;
}

/** The pending expedition at a harbor, or null if none is being prepared. */
export function expeditionStatus(world: World, harborId: number): ExpeditionView | null {
  const e = world.expeditions.find((x) => x.harborId === harborId);
  if (!e) return null;
  return {
    harborId: e.harborId,
    player: e.player,
    boards: e.boards,
    stones: e.stones,
    neededBoards: SEA.expeditionBoards,
    neededStones: SEA.expeditionStones,
    hasBuilder: e.hasBuilder,
    ready: e.ready,
  };
}

/** Garrison/coin snapshot of a military building (null when not military/dead). */
export function militaryView(world: World, buildingId: number): MilitaryView | null {
  const b = world.buildings.items[buildingId];
  if (!b) return null;
  const def = buildingDef(b.type);
  if (!def || def.kind !== 'military') return null;
  return {
    buildingId: b.id,
    type: b.type,
    player: b.player,
    occupied: b.occupied,
    garrison: b.garrison.slice(),
    troops: garrisonCount(b),
    maxTroops: def.maxTroops ?? 0,
    coins: b.inputStock[0] ?? 0,
    maxGold: def.maxGold ?? 0,
    coinsEnabled: b.coinsEnabled,
    militaryRadius: def.militaryRadius ?? 0,
  };
}
