/**
 * P3 economy test harness helpers (kept separate from the stable P2 harness).
 *
 * These build small deterministic worlds for the full-economy scenario suite:
 * directly spawning working buildings (bypassing the construction pipeline where
 * a test only cares about production), painting mountain terrain + subsurface
 * resources, and wiring a building's flag to the HQ with a road.
 */

import { applyCommand } from './commands';
import { buildingDef, makeResource, type BuildingType } from './constants';
import { Geometry } from './geometry';
import { findWalkPath } from './pathfinding';
import { GREENLAND_RULES } from './terrain';
import { tickWorld } from './index';
import { getBuilding, storeAlloc, type Building, type World } from './world';

/** The node of a player's HQ door flag (SE of the HQ). */
export function hqFlagNode(world: World, geom: Geometry, player = 0): number {
  const hq = getBuilding(world, world.players[player].hqBuildingId);
  return getBuilding(world, hq.id).flagId >= 0
    ? world.flags.items[hq.flagId]!.node
    : geom.neighbour(hq.node, 'SE');
}

/**
 * Directly create a finished ('working') building plus its door flag at `node`,
 * bypassing construction. `staffed:true` marks it worker-present immediately —
 * valid for in-building producers (workshops/mines/generators) that don't need a
 * physical worker settler; leave it false to exercise recruitment + walk-in.
 */
export function spawnBuilding(
  world: World,
  geom: Geometry,
  node: number,
  type: BuildingType,
  player = 0,
  staffed = false,
): Building {
  const flagNode = geom.neighbour(node, 'SE');
  let flagId = world.flagAtNode[flagNode];
  if (flagId < 0) {
    flagId = storeAlloc(world.flags, (id) => ({ id, node: flagNode, player, wares: [] }));
    world.flagAtNode[flagNode] = flagId;
  }
  const def = buildingDef(type);
  const bid = storeAlloc(world.buildings, (id) => ({
    id,
    type,
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
    staffed,
    inputStock: new Array<number>(def?.inputs.length ?? 0).fill(0),
    outputQueue: [],
    workTimer: 0,
    altToggle: 0,
    garrison: def?.kind === 'military' ? [0, 0, 0, 0, 0] : [],
    occupied: false,
    coinsEnabled: true,
    incoming: 0,
    promotionTimer: -1,
  }));
  world.buildingAtNode[node] = bid;
  return getBuilding(world, bid);
}

/** Paint mountain terrain (id 0x01) on a node so a mine may sit there. */
export function paintMountain(world: World, node: number): void {
  world.terrain1[node] = 0x01;
  world.terrain2[node] = 0x01;
}

/** Set a node's subsurface resource (OBJECTS.md §5a runtime encoding). */
export function setResource(world: World, node: number, type: number, amount: number): void {
  world.resource[node] = makeResource(type, amount);
}

/**
 * Build a road between two existing flag nodes over walkable ground. Applies the
 * command and returns the road path, or null when no walkable route exists (or
 * the route would cross another flag/building interior node).
 */
export function connectRoad(
  world: World,
  geom: Geometry,
  fromFlagNode: number,
  toFlagNode: number,
  player = 0,
): number[] | null {
  const walk = findWalkPath(world, geom, GREENLAND_RULES, fromFlagNode, toFlagNode);
  if (!walk) return null;
  const path = [fromFlagNode, ...walk];
  applyCommand(world, { tick: world.tick, player, type: 'buildRoad', path });
  return path;
}

/** The door flag node of a building at `node` (SE neighbour). */
export function doorFlagNode(geom: Geometry, node: number): number {
  return geom.neighbour(node, 'SE');
}

/** Build a road from the HQ door flag to a building's door flag. */
export function connectToHq(
  world: World,
  geom: Geometry,
  buildingNode: number,
  player = 0,
): number[] | null {
  return connectRoad(world, geom, hqFlagNode(world, geom, player), doorFlagNode(geom, buildingNode), player);
}

/** Build a direct road between two buildings' door flags. */
export function connectBuildings(
  world: World,
  geom: Geometry,
  nodeA: number,
  nodeB: number,
  player = 0,
): number[] | null {
  return connectRoad(world, geom, doorFlagNode(geom, nodeA), doorFlagNode(geom, nodeB), player);
}

/**
 * Directly garrison a (working) military building with soldiers per rank and mark
 * it occupied — bypasses the occupation walk-in for combat/promotion tests.
 */
export function garrisonBuilding(b: Building, perRank: number[]): void {
  for (let r = 0; r < b.garrison.length; r++) b.garrison[r] = perRank[r] ?? 0;
  const total = b.garrison.reduce((a, c) => a + c, 0);
  if (total > 0) b.occupied = true;
}

/** Convenience: place a building via command, then tick once so its flag exists. */
export function placeBuildingAndTick(
  world: World,
  node: number,
  type: BuildingType,
  player = 0,
): void {
  applyCommand(world, { tick: world.tick, player, type: 'placeBuilding', node, buildingType: type });
  tickWorld(world);
}
