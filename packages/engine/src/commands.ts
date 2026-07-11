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
  buildingDef,
  FLAG_MIN_DISTANCE,
  FLAG_WARE_CAPACITY,
  isFieldObject,
  isTreeType,
  isGraniteType,
  JOB,
  NUM_SOLDIER_RANKS,
  OBJ_TYPE,
  ownerPlayer,
  TICKS,
  WARE,
  type BuildingType,
  type WareType,
} from './constants';
import { findWalkPath } from './pathfinding';
import { beginWalk, spawnSettler } from './systems/movement';
import type { EventSink } from './events';
import { Geometry } from './geometry';
import {
  isBuildableTexture,
  isMountainTexture,
  isWalkableTexture,
  type TerrainRules,
} from './terrain';
import { isCoastalLand } from './water';
import {
  getFlag,
  storeAlloc,
  storeFree,
  storeLive,
  type Building,
  type Flag,
  type Road,
  type World,
} from './world';
import { execAttack } from './systems/military';
import { execPrepareExpedition, execStartExpedition } from './systems/seafaring';
import { recalcTerritory } from './systems/territory';

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
    }
  | {
      tick: number;
      player: number;
      seq: number;
      type: 'setToolPriority';
      tools: WareType[];
    }
  | {
      tick: number;
      player: number;
      seq: number;
      type: 'setTransportPriority';
      wareType: WareType;
      priority: number;
    }
  | {
      // Attack an enemy military building with up to `soldiers` attackers
      // gathered from the player's in-range military buildings (MILITARY.md §4).
      tick: number;
      player: number;
      seq: number;
      type: 'attack';
      targetBuildingId: number;
      soldiers: number;
    }
  | {
      // Toggle gold-coin delivery to a military building (MILITARY.md §3).
      tick: number;
      player: number;
      seq: number;
      type: 'toggleCoins';
      buildingId: number;
      enabled: boolean;
    }
  | {
      // Begin assembling an expedition kit at a harbor (P7).
      tick: number;
      player: number;
      seq: number;
      type: 'prepareExpedition';
      harborId: number;
    }
  | {
      // Launch a ready expedition from a harbor toward a coastal target spot (P7).
      tick: number;
      player: number;
      seq: number;
      type: 'startExpedition';
      harborId: number;
      targetSpot: number;
    }
  | {
      // Send a geologist from a flag to survey nearby mountains for ore.
      tick: number;
      player: number;
      seq: number;
      type: 'sendGeologist';
      flagNode: number;
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
      execDemolish(world, geom, events, cmd.player, cmd.node);
      break;
    case 'cheatSpawnWare':
      execCheatSpawnWare(world, cmd.player, cmd.flag, cmd.wareType, cmd.count);
      break;
    case 'setToolPriority': {
      const pl = world.players[cmd.player];
      if (pl && cmd.tools.length > 0) {
        pl.toolPriority = cmd.tools.slice();
        pl.toolCycle = 0;
      }
      break;
    }
    case 'setTransportPriority': {
      const pl = world.players[cmd.player];
      if (pl && cmd.wareType in pl.transportPriority) {
        pl.transportPriority[cmd.wareType] = cmd.priority;
      }
      break;
    }
    case 'attack':
      execAttack(world, geom, rules, events, cmd.player, cmd.targetBuildingId, cmd.soldiers);
      break;
    case 'toggleCoins': {
      const b = world.buildings.items[cmd.buildingId];
      if (b && b.player === cmd.player && buildingDef(b.type)?.kind === 'military') {
        b.coinsEnabled = cmd.enabled;
      }
      break;
    }
    case 'prepareExpedition':
      execPrepareExpedition(world, cmd.player, cmd.harborId);
      break;
    case 'startExpedition':
      execStartExpedition(world, geom, cmd.player, cmd.harborId, cmd.targetSpot);
      break;
    case 'sendGeologist':
      execSendGeologist(world, geom, rules, events, cmd.player, cmd.flagNode);
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

/**
 * True when a flag may be placed at `node` for `player`. Ownership is enforced
 * only when `player` is given: a flag must sit inside that player's own territory
 * (S2 rule). The argument is optional so the app's build preview and terrain-only
 * callers keep working without an owner.
 */
export function canPlaceFlag(
  world: World,
  geom: Geometry,
  rules: TerrainRules,
  node: number,
  player?: number,
): boolean {
  if (world.flagAtNode[node] >= 0) return false;
  if (world.buildingAtNode[node] >= 0) return false;
  if (player !== undefined && ownerPlayer(world.owner[node]) !== player) return false;
  if (world.objectType[node] !== OBJ_TYPE.none) {
    // A flag cannot sit on a tree, granite, sapling, or crop field.
    const ot = world.objectType[node];
    if (isTreeType(ot) || isGraniteType(ot) || isFieldObject(ot)) return false;
  }
  if (!isWalkableTexture(world.terrain1[node], rules) || !isWalkableTexture(world.terrain2[node], rules)) {
    return false;
  }
  for (const flag of storeLive(world.flags)) {
    if (geom.distance(flag.node, node) < FLAG_MIN_DISTANCE) return false;
  }
  return true;
}

/** True when the node sits on mineable mountain terrain (for mine placement). */
export function terrainMineable(world: World, node: number): boolean {
  return isMountainTexture(world.terrain1[node]) && isMountainTexture(world.terrain2[node]);
}

/** True when a building type must be placed on the coast (harbor / shipyard). P7. */
export function requiresCoast(buildingType: BuildingType): boolean {
  return buildingType === BUILDING.harbor || buildingType === BUILDING.shipyard;
}

/** True when a harbor may be founded at `node`: buildable coastal land with a free door. */
export function canPlaceHarbor(
  world: World,
  geom: Geometry,
  rules: TerrainRules,
  node: number,
  player?: number,
): boolean {
  return canPlaceBuilding(world, geom, rules, node, BUILDING.harbor, player);
}

/** True when `buildingType` may be placed at `node` for `player`. */
export function canPlaceBuilding(
  world: World,
  geom: Geometry,
  rules: TerrainRules,
  node: number,
  buildingType: BuildingType,
  player?: number,
): boolean {
  if (world.buildingAtNode[node] >= 0 || world.flagAtNode[node] >= 0) return false;
  const ot = world.objectType[node];
  if (isTreeType(ot) || isGraniteType(ot) || isFieldObject(ot)) return false;
  // Ownership (MILITARY.md §3, S2 rule): a building may only be founded inside the
  // acting player's own territory — neutral (unclaimed) and enemy land are both
  // rejected. A military building expands the frontier only once it is occupied;
  // it is still placed on land you already own, at the border. The `player`
  // argument is optional so terrain-only callers (and the app's build preview)
  // keep working; ownership is only enforced when a player is given.
  if (player !== undefined && ownerPlayer(world.owner[node]) !== player) return false;
  // Mines require a mountain node; coastal buildings (harbor/shipyard) require a
  // land node on the shore; every other building requires buildable meadow.
  const def = buildingDef(buildingType);
  if (def?.size === 'mine') {
    if (!terrainMineable(world, node)) return false;
  } else if (requiresCoast(buildingType)) {
    // The shore relaxes the full meadow BQ: the node's own two texture layers
    // must be buildable land, and it must touch navigable water (P7).
    if (!isBuildableTexture(world.terrain1[node], rules) || !isBuildableTexture(world.terrain2[node], rules)) {
      return false;
    }
    if (!isCoastalLand(world, geom, node)) return false;
  } else if (!terrainBuildable(world, geom, rules, node)) {
    return false;
  }
  const flagNode = geom.neighbour(node, 'SE');
  const existing = world.flagAtNode[flagNode];
  if (existing >= 0) {
    // Reuse an existing flag only if it belongs to us and the door is free.
    const flag = world.flags.items[existing];
    if (player !== undefined && flag?.player !== player) return false;
    return world.buildingAtNode[flagNode] < 0;
  }
  return canPlaceFlag(world, geom, rules, flagNode, player);
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
  if (!canPlaceFlag(world, geom, rules, node, player)) return null;
  const id = storeAlloc(world.flags, (fid) => ({ id: fid, node, player, wares: [] }));
  world.flagAtNode[node] = id;
  // A flag dropped onto an existing road taps into it: split the road at the
  // flag so both halves connect through it (the S2 way to join a network). Also
  // keeps roads valid — a road may never carry an interior flag.
  splitRoadsAt(world, id, node);
  events.emit({ type: 'FlagPlaced', flagId: id, node, player });
  return getFlag(world, id);
}

/**
 * Release a road's serving carrier back to the free list. A carrier caught
 * mid-carry still holds a live ware token (loc==='carried', locId===carrierId);
 * re-home it onto the first of `dropFlags` with a free slot so dispatch re-routes
 * it, or free the token when every candidate flag is full. Otherwise the token
 * leaks and its targetBuildingId permanently inflates dispatch's en-route count.
 */
function freeCarrier(world: World, carrierId: number, dropFlags: number[]): void {
  const carrier = world.settlers.items[carrierId];
  if (!carrier) return;
  if (carrier.carryingWareId >= 0) {
    const ware = world.wares.items[carrier.carryingWareId];
    if (ware) {
      const flag = dropFlags
        .map((fid) => (fid >= 0 ? world.flags.items[fid] : null))
        .find((f) => f && f.wares.length < FLAG_WARE_CAPACITY);
      if (flag) {
        ware.loc = 'flag';
        ware.locId = flag.id;
        ware.nextFlag = -1; // dispatch recomputes from the new flag
        flag.wares.push(ware.id);
      } else {
        storeFree(world.wares, carrier.carryingWareId);
      }
    }
    carrier.carryingWareId = -1;
  }
  world.settlers.items[carrierId] = null;
  world.settlers.free.push(carrierId);
}

/**
 * Release an upgraded road's pack donkey when the road is destroyed: re-home any
 * carried ware (like {@link freeCarrier}) and return the donkey to the player's
 * bred-donkey pool so it can serve a future donkey road. Clears road.donkeyId.
 */
function freeDonkey(world: World, road: Road, dropFlags: number[]): void {
  const donkeyId = road.donkeyId;
  if (donkeyId < 0) return;
  freeCarrier(world, donkeyId, dropFlags);
  road.donkeyId = -1;
  const pl = world.players[road.player];
  if (pl) pl.donkeys++;
}

/**
 * Split every road whose interior passes through `node` into two roads meeting
 * at the new flag `flagId`. The original road's carrier is released; the carrier
 * system re-staffs both halves next tick.
 */
function splitRoadsAt(world: World, flagId: number, node: number): void {
  for (const road of [...storeLive(world.roads)]) {
    const idx = road.path.indexOf(node);
    if (idx <= 0 || idx >= road.path.length - 1) continue; // endpoint or absent
    const { player, flagA, flagB } = road;
    const left = road.path.slice(0, idx + 1);
    const right = road.path.slice(idx);
    if (road.carrierId >= 0) {
      // Both halves stay connected through the new middle flag, so any carried
      // ware can drop on either endpoint or the new flag and re-route.
      freeCarrier(world, road.carrierId, [flagId, flagA, flagB]);
    }
    // A donkey on the original road returns to the player's bred-donkey pool; the
    // two fresh halves each re-earn their own upgrade from scratch.
    if (road.donkeyId >= 0) freeDonkey(world, road, [flagId, flagA, flagB]);
    storeFree(world.roads, road.id);
    storeAlloc(world.roads, (rid) => ({ id: rid, player, path: left, flagA, flagB: flagId, carrierId: -1, busyGf: 0, upgraded: false, donkeyId: -1 }));
    storeAlloc(world.roads, (rid) => ({ id: rid, player, path: right, flagA: flagId, flagB, carrierId: -1, busyGf: 0, upgraded: false, donkeyId: -1 }));
  }
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
  // Both endpoints must be the commanding player's own flags — a road is never
  // built across players, and its carrier (owned by `player`) must serve them.
  if (world.flags.items[flagA]?.player !== player || world.flags.items[flagB]?.player !== player) {
    return;
  }
  // Territory (S2 rule): every node the road runs over must lie in the building
  // player's own land — a road is never laid across neutral or enemy territory.
  for (const n of path) {
    if (ownerPlayer(world.owner[n]) !== player) return;
  }
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
    busyGf: 0,
    upgraded: false,
    donkeyId: -1,
  }));
  events.emit({ type: 'RoadBuilt', roadId: id, from: start, to: end, player });
}

/**
 * Send a geologist from `flagNode` to survey nearby mountains. Costs one Helper
 * (drawn from the pool); the geologist walks to the flag, surveys the ore under
 * mountains within range, then returns (see systems/geologist.ts). A no-op if the
 * flag isn't the player's or no Helper is free.
 */
function execSendGeologist(
  world: World,
  geom: Geometry,
  rules: TerrainRules,
  events: EventSink,
  player: number,
  flagNode: number,
): void {
  const flagId = world.flagAtNode[flagNode];
  if (flagId < 0) return;
  const flag = world.flags.items[flagId];
  if (!flag || flag.player !== player) return;
  const pl = world.players[player];
  if (!pl || (pl.workers[JOB.carrier] ?? 0) <= 0) return; // need a Helper to send
  const hq = pl.hqBuildingId >= 0 ? world.buildings.items[pl.hqBuildingId] : null;
  const startNode = hq ? hq.node : flag.node;
  const g = spawnSettler(world, JOB.geologist, player, startNode);
  g.state = 'toWork';
  g.targetNode = flag.node; // walk to the flag first; survey happens on arrival
  g.homeBuildingId = hq ? hq.id : -1;
  const path = findWalkPath(world, geom, rules, startNode, flag.node);
  if (path) beginWalk(g, path, TICKS.walkPerEdge);
  else g.node = flag.node;
  pl.workers[JOB.carrier]--;
  events.emit({ type: 'SettlerSpawned', settlerId: g.id, job: JOB.geologist, player });
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
  if (!canPlaceBuilding(world, geom, rules, node, buildingType, player)) return;
  const flagNode = geom.neighbour(node, 'SE');
  let flagId = world.flagAtNode[flagNode];
  if (flagId < 0) {
    const created = execPlaceFlag(world, geom, rules, events, player, flagNode);
    if (!created) return;
    flagId = created.id;
  }
  const def = buildingDef(buildingType);
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
    inputStock: [],
    outputQueue: [],
    workTimer: 0,
    altToggle: 0,
    garrison: def?.kind === 'military' ? new Array<number>(NUM_SOLDIER_RANKS).fill(0) : [],
    occupied: false,
    coinsEnabled: true,
    incoming: 0,
    promotionTimer: -1,
  }));
  world.buildingAtNode[node] = id;
  events.emit({ type: 'BuildingPlaced', buildingId: id, buildingType, node, player });
}

function execDemolish(
  world: World,
  geom: Geometry,
  events: EventSink,
  player: number,
  node: number,
): void {
  const bId = world.buildingAtNode[node];
  if (bId >= 0) {
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
    // The door flag is deliberately left standing (matching the original: burning
    // a building keeps its flag; the player removes it separately). With the
    // building gone it is now an ordinary standalone flag — its roads and carriers
    // keep working, and execDemolishFlag will remove it on a later demolish command
    // since no building references its flagId anymore.
    events.emit({ type: 'BuildingDemolished', buildingId: bId, node, player });
    // Ownership is derived from buildings: a demolished HQ / harbor / occupied
    // military building stops projecting territory, so recompute (no-op and free
    // of an event when the building claimed no land).
    if (recalcTerritory(world, geom)) events.emit({ type: 'TerritoryChanged', player });
    return;
  }
  // No building here: demolish a standalone flag and the roads it anchors.
  execDemolishFlag(world, player, node);
}

/**
 * Remove a player's flag and every road that ends at it (freeing each road's
 * carrier and dropping any wares parked on the flag). A flag that a building
 * depends on — its door flag — cannot be removed while the building stands; the
 * building must be demolished instead, matching the original.
 */
function execDemolishFlag(world: World, player: number, node: number): void {
  const flagId = world.flagAtNode[node];
  if (flagId < 0) return;
  const flag = world.flags.items[flagId];
  if (!flag || flag.player !== player) return;
  for (const b of storeLive(world.buildings)) {
    if (b.flagId === flagId) return; // door flag of a standing building
  }
  // Roads anchored here: free their carriers, then the road itself. This flag is
  // going away (its parked wares are dropped below), so a mid-carry ware re-homes
  // onto the road's surviving far flag.
  for (const road of [...storeLive(world.roads)]) {
    if (road.flagA !== flagId && road.flagB !== flagId) continue;
    if (road.carrierId >= 0) {
      const farFlag = road.flagA === flagId ? road.flagB : road.flagA;
      freeCarrier(world, road.carrierId, [farFlag]);
    }
    if (road.donkeyId >= 0) {
      const farFlag = road.flagA === flagId ? road.flagB : road.flagA;
      freeDonkey(world, road, [farFlag]);
    }
    storeFree(world.roads, road.id);
  }
  // Drop wares parked on the flag (in transit wares re-route next tick).
  for (const wid of flag.wares) storeFree(world.wares, wid);
  world.flagAtNode[node] = -1;
  storeFree(world.flags, flagId);
  // No event needed: roads/flags are re-derived from world state every frame.
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
