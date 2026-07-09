/**
 * Player commands: typed payloads, buildability validation, and the queue that
 * applies due commands at the start of a tick in (tick, player, seq) order.
 *
 * Validation approximates the original Settlers II rules per ARCHITECTURE.md:
 * flag spacing >= 2 lattice edges, a building needs buildable meadow terrain and
 * a free flag spot at the node SE of its door, roads run over walkable ground
 * between two existing flags.
 */

import {
  BUILD_COST,
  BUILDING,
  FLAG_MIN_DISTANCE,
  isTreeType,
  isGraniteType,
  OBJ_TYPE,
  TICKS,
  WARE,
  type BuildingType,
  type WareType,
} from './constants';
import type { EventSink } from './events';
import { Geometry } from './geometry';
import { isBuildableTexture, isWalkableTexture, type TerrainRules } from './terrain';
import {
  getFlag,
  storeAlloc,
  storeLive,
  type Building,
  type Flag,
  type World,
} from './world';

/** A queued player command (discriminated on `type`). */
export type Command =
  | { tick: number; player: number; seq: number; type: 'placeFlag'; node: number }
  | { tick: number; player: number; seq: number; type: 'buildRoad'; path: number[] }
  | {
      tick: number;
      player: number;
      seq: number;
      type: 'placeBuilding';
      node: number;
      buildingType: BuildingType;
    }
  | { tick: number; player: number; seq: number; type: 'demolish'; node: number }
  | {
      tick: number;
      player: number;
      seq: number;
      type: 'cheatSpawnWare';
      flag: number;
      wareType: WareType;
      count: number;
    };

/** Distributive Omit that preserves discriminated-union members. */
type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * Input to {@link applyCommand}: a command minus the engine-assigned `seq`, with
 * `tick` optional (defaults to the current tick). Distributes over the union so
 * each command's own fields remain required.
 */
export type CommandInput = DistOmit<Command, 'seq' | 'tick'> & { tick?: number };

/**
 * Validate structurally and enqueue a command. Returns the assigned command.
 * Deep validation of world preconditions happens again at execution time so the
 * queue stays consistent even if state changes between queueing and the due tick.
 */
export function applyCommand(world: World, input: CommandInput): Command {
  const cmd = {
    ...input,
    tick: input.tick ?? world.tick,
    seq: world.seqCounter++,
  } as Command;
  world.commands.push(cmd);
  return cmd;
}

/** Execute all commands due at or before the current tick, in canonical order. */
export function runDueCommands(
  world: World,
  geom: Geometry,
  rules: TerrainRules,
  events: EventSink,
): void {
  const due = world.commands.filter((c) => c.tick <= world.tick);
  if (due.length === 0) return;
  world.commands = world.commands.filter((c) => c.tick > world.tick);
  due.sort((a, b) => a.tick - b.tick || a.player - b.player || a.seq - b.seq);
  for (const cmd of due) executeCommand(world, geom, rules, events, cmd);
}

function executeCommand(
  world: World,
  geom: Geometry,
  rules: TerrainRules,
  events: EventSink,
  cmd: Command,
): void {
  switch (cmd.type) {
    case 'placeFlag':
      execPlaceFlag(world, geom, rules, events, cmd.player, cmd.node);
      break;
    case 'buildRoad':
      execBuildRoad(world, geom, rules, events, cmd.player, cmd.path);
      break;
    case 'placeBuilding':
      execPlaceBuilding(world, geom, rules, events, cmd.player, cmd.node, cmd.buildingType);
      break;
    case 'demolish':
      execDemolish(world, events, cmd.player, cmd.node);
      break;
    case 'cheatSpawnWare':
      execCheatSpawnWare(world, cmd.player, cmd.flag, cmd.wareType, cmd.count);
      break;
  }
}

// --- Validation (also exported as view helpers) ---------------------------

/** True when the node's six surrounding triangles are all buildable meadow. */
export function terrainBuildable(world: World, geom: Geometry, rules: TerrainRules, node: number): boolean {
  for (const tri of geom.trianglesAround(node)) {
    const tex = tri.layer === 1 ? world.terrain1[tri.node] : world.terrain2[tri.node];
    if (!isBuildableTexture(tex, rules)) return false;
  }
  return true;
}

/** True when a flag may be placed at `node` for `player`. */
export function canPlaceFlag(world: World, geom: Geometry, rules: TerrainRules, node: number): boolean {
  if (world.flagAtNode[node] >= 0) return false;
  if (world.buildingAtNode[node] >= 0) return false;
  if (world.objectType[node] !== OBJ_TYPE.none) {
    // A flag cannot sit on a tree or granite; other markers (HQ) are handled below.
    if (isTreeType(world.objectType[node]) || isGraniteType(world.objectType[node])) return false;
  }
  if (!isWalkableTexture(world.terrain1[node], rules) || !isWalkableTexture(world.terrain2[node], rules)) {
    return false;
  }
  for (const flag of storeLive(world.flags)) {
    if (geom.distance(flag.node, node) < FLAG_MIN_DISTANCE) return false;
  }
  return true;
}

/** True when `buildingType` may be placed at `node` for `player`. */
export function canPlaceBuilding(
  world: World,
  geom: Geometry,
  rules: TerrainRules,
  node: number,
  _buildingType: BuildingType,
): boolean {
  if (world.buildingAtNode[node] >= 0 || world.flagAtNode[node] >= 0) return false;
  if (isTreeType(world.objectType[node]) || isGraniteType(world.objectType[node])) return false;
  if (!terrainBuildable(world, geom, rules, node)) return false;
  const flagNode = geom.neighbour(node, 'SE');
  const existing = world.flagAtNode[flagNode];
  if (existing >= 0) {
    // Reuse an existing flag only if it belongs to us and the door is free.
    return world.buildingAtNode[flagNode] < 0;
  }
  return canPlaceFlag(world, geom, rules, flagNode);
}

// --- Executors ------------------------------------------------------------

function execPlaceFlag(
  world: World,
  geom: Geometry,
  rules: TerrainRules,
  events: EventSink,
  player: number,
  node: number,
): Flag | null {
  if (!canPlaceFlag(world, geom, rules, node)) return null;
  const id = storeAlloc(world.flags, (fid) => ({ id: fid, node, player, wares: [] }));
  world.flagAtNode[node] = id;
  events.emit({ type: 'FlagPlaced', flagId: id, node, player });
  return getFlag(world, id);
}

function execBuildRoad(
  world: World,
  geom: Geometry,
  rules: TerrainRules,
  events: EventSink,
  player: number,
  path: number[],
): void {
  if (path.length < 2) return;
  const start = path[0];
  const end = path[path.length - 1];
  const flagA = world.flagAtNode[start];
  const flagB = world.flagAtNode[end];
  if (flagA < 0 || flagB < 0 || flagA === flagB) return;
  // Interior nodes: adjacent, walkable, and not flags/buildings.
  for (let i = 1; i < path.length; i++) {
    if (!geom.neighbours(path[i - 1]).includes(path[i])) return;
  }
  for (let i = 1; i < path.length - 1; i++) {
    const n = path[i];
    if (world.flagAtNode[n] >= 0 || world.buildingAtNode[n] >= 0) return;
    if (!isWalkableTexture(world.terrain1[n], rules) || !isWalkableTexture(world.terrain2[n], rules)) {
      return;
    }
  }
  const id = storeAlloc(world.roads, (rid) => ({
    id: rid,
    player,
    path: path.slice(),
    flagA,
    flagB,
    carrierId: -1,
  }));
  events.emit({ type: 'RoadBuilt', roadId: id, from: start, to: end, player });
}

function execPlaceBuilding(
  world: World,
  geom: Geometry,
  rules: TerrainRules,
  events: EventSink,
  player: number,
  node: number,
  buildingType: BuildingType,
): void {
  if (buildingType === BUILDING.headquarters) return;
  if (!canPlaceBuilding(world, geom, rules, node, buildingType)) return;
  const flagNode = geom.neighbour(node, 'SE');
  let flagId = world.flagAtNode[flagNode];
  if (flagId < 0) {
    const created = execPlaceFlag(world, geom, rules, events, player, flagNode);
    if (!created) return;
    flagId = created.id;
  }
  const cost = BUILD_COST[buildingType];
  const buildTicks = Math.max(
    TICKS.buildMinTicks,
    (cost.boards + cost.stones) * TICKS.buildStepPerMaterial,
  );
  const id = storeAlloc(world.buildings, (bid) => ({
    id: bid,
    type: buildingType,
    node,
    player,
    flagId,
    state: 'site' as const,
    deliveredBoards: 0,
    deliveredStones: 0,
    needBoards: cost.boards,
    needStones: cost.stones,
    buildProgress: 0,
    buildTicks,
    workerId: -1,
    staffed: false,
    inputStock: 0,
    outputPending: 0,
    workTimer: 0,
  }));
  world.buildingAtNode[node] = id;
  events.emit({ type: 'BuildingPlaced', buildingId: id, buildingType, node, player });
}

function execDemolish(world: World, events: EventSink, player: number, node: number): void {
  const bId = world.buildingAtNode[node];
  if (bId < 0) return;
  const b = world.buildings.items[bId] as Building;
  if (b.player !== player || b.type === BUILDING.headquarters) return;
  // Remove the bound worker settler, if any.
  if (b.workerId >= 0 && world.settlers.items[b.workerId]) {
    world.settlers.items[b.workerId] = null;
    world.settlers.free.push(b.workerId);
  }
  world.buildingAtNode[node] = -1;
  world.objectType[node] = OBJ_TYPE.none;
  world.buildings.items[bId] = null;
  world.buildings.free.push(bId);
  events.emit({ type: 'BuildingDemolished', buildingId: bId, node, player });
}

function execCheatSpawnWare(
  world: World,
  player: number,
  flagId: number,
  wareType: WareType,
  count: number,
): void {
  const flag = world.flags.items[flagId];
  if (!flag || flag.player !== player) return;
  const type: WareType = wareType ?? WARE.trunk;
  for (let i = 0; i < count && flag.wares.length < 8; i++) {
    const wid = storeAlloc(world.wares, (id) => ({
      id,
      type,
      loc: 'flag' as const,
      locId: flagId,
      targetBuildingId: -1,
      nextFlag: -1,
    }));
    flag.wares.push(wid);
  }
}
