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
import { runProduction } from './systems/production';
import { runDispatch } from './systems/dispatch';
import { storeLive, type Building, type Flag, type Road, type Settler, type World } from './world';

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
  Player,
  MapJson,
  CreateWorldOptions,
} from './world';
export { applyCommand, canPlaceFlag, canPlaceBuilding, terrainBuildable, terrainMineable } from './commands';
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
  terrainId,
  isBuildableTexture,
  isWalkableTexture,
  isMountainTexture,
} from './terrain';
export type { TerrainRules } from './terrain';
export { findWalkPath, findFlagRoute, buildFlagGraph, roadBetween } from './pathfinding';
export type { GameEvent } from './events';
export * from './constants';

/** Geometry helper for a world (recreated on demand; cheap). */
export function worldGeometry(world: World): Geometry {
  return new Geometry(world.width, world.height);
}

/** Advance the simulation exactly one game frame; returns emitted events. */
export function tickWorld(world: World, rules: TerrainRules = GREENLAND_RULES): GameEvent[] {
  const geom = worldGeometry(world);
  const events = new EventSink();
  runDueCommands(world, geom, rules, events); // 1. commands
  runConstruction(world, geom, rules, events); // 2. construction (+ builder steps)
  runProduction(world, geom, rules, events); // 3. production (+ worker steps)
  runDispatch(world, geom, events); // 5a. ware routing + delivery
  runCarriers(world, events); // 5b. carriers
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
