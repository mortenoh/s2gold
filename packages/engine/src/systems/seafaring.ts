/**
 * Seafaring system (P7): ships, sea ware-transport, and expeditions.
 *
 * Ships are entities that move over navigable-water nodes (deterministic A*),
 * home to a harbor, and do two jobs:
 *  - Sea transport: shuttle ware tokens between a player's harbors when the cargo
 *    cannot reach its target building by road (different island) but a
 *    sea-connected harbor can. The land-vs-sea decision (a shared route chooser)
 *    is used by both dispatch (to steer a ware toward its embarkation harbor) and
 *    the ship (to decide what to load), so the two never disagree.
 *  - Expeditions: carry an assembled kit (boards + stones + a builder) to a
 *    discovered coastal harbor spot on another island and found a new harbor
 *    there, establishing territory — an HQ-lite foothold.
 *
 * SIMPLIFICATIONS vs. the original (documented): ships teleport-free but move at
 * the base 20 GF/node (no faster boat speed); water roads / boat carriers are not
 * modelled (sea transport is a direct harbor-to-harbor shuttle, not a chain of
 * water-road segments); an expedition's building kit is fixed to a harbor's own
 * cost and always founds a harbor (not an arbitrary building).
 */

import {
  BUILDING,
  FLAG_WARE_CAPACITY,
  JOB,
  NUM_SOLDIER_RANKS,
  OBJ_TYPE,
  SEA,
} from '../constants';
import type { EventSink } from '../events';
import type { Geometry } from '../geometry';
import { buildFlagGraph, findFlagRoute, findWaterPath } from '../pathfinding';
import { recalcTerritory } from './territory';
import { harborDockNode } from '../water';
import {
  getFlag,
  storeAlloc,
  storeFree,
  storeLive,
  type Building,
  type Ship,
  type World,
} from '../world';
import { ensureWorkerAvailable } from './recruit';

type FlagGraph = ReturnType<typeof buildFlagGraph>;

/**
 * Per-tick sea routing context: the working, dock-having harbors of each player,
 * a cached road graph per player, and a memoized harbor-pair water-connectivity
 * map. Built once per dispatch/seafaring pass so route queries stay cheap.
 */
export interface SeaContext {
  world: World;
  geom: Geometry;
  harborsByPlayer: Map<number, Building[]>;
  graphByPlayer: Map<number, FlagGraph>;
  connCache: Map<string, boolean>;
}

/** True when a building is a working harbor that has a navigable-water dock. */
function isDockedHarbor(world: World, geom: Geometry, b: Building): boolean {
  return (
    b.type === BUILDING.harbor &&
    b.state === 'working' &&
    harborDockNode(world, geom, b.node) >= 0
  );
}

/** True when the player owns at least one working harbor with a water dock. */
export function playerHasDockedHarbor(world: World, geom: Geometry, player: number): boolean {
  for (const b of storeLive(world.buildings)) {
    if (b.player === player && isDockedHarbor(world, geom, b)) return true;
  }
  return false;
}

/** Build the per-tick sea routing context. */
export function buildSeaContext(world: World, geom: Geometry): SeaContext {
  const harborsByPlayer = new Map<number, Building[]>();
  for (const b of storeLive(world.buildings)) {
    if (!isDockedHarbor(world, geom, b)) continue;
    let list = harborsByPlayer.get(b.player);
    if (!list) {
      list = [];
      harborsByPlayer.set(b.player, list);
    }
    list.push(b);
  }
  return {
    world,
    geom,
    harborsByPlayer,
    graphByPlayer: new Map(),
    connCache: new Map(),
  };
}

/** The player's road graph (built lazily and cached in the context). */
function graphFor(ctx: SeaContext, player: number): FlagGraph {
  let g = ctx.graphByPlayer.get(player);
  if (!g) {
    g = buildFlagGraph(ctx.world, player);
    ctx.graphByPlayer.set(player, g);
  }
  return g;
}

/** True when two harbors are joined by an all-water route (memoized, symmetric). */
export function seaConnected(ctx: SeaContext, a: Building, b: Building): boolean {
  if (a.id === b.id) return false;
  const key = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
  const cached = ctx.connCache.get(key);
  if (cached !== undefined) return cached;
  const dockA = harborDockNode(ctx.world, ctx.geom, a.node);
  const dockB = harborDockNode(ctx.world, ctx.geom, b.node);
  const ok = dockA >= 0 && dockB >= 0 && findWaterPath(ctx.world, ctx.geom, dockA, dockB) !== null;
  ctx.connCache.set(key, ok);
  return ok;
}

/** Hop count of a flag route (segments = flags - 1), or Infinity when unreachable. */
function routeCost(route: number[] | null): number {
  return route ? route.length - 1 : Infinity;
}

/** A land-vs-sea routing decision for a ware sitting at a flag. */
export interface WareRoutePlan {
  /** Next road flag hop toward the goal (or embarkation harbor); -1 = none/await ship. */
  nextFlag: number;
  /** True when the cheapest route embarks by sea. */
  useSea: boolean;
  /** Chosen embarkation harbor id (the near harbor) when useSea; else -1. */
  nearHarborId: number;
  /** Chosen destination harbor id (the far harbor) when useSea; else -1. */
  farHarborId: number;
}

/**
 * Choose the cheapest route for a ware at `fromFlagId` toward the building
 * `targetBuildingId`, comparing a pure land route with sea-assisted routes
 * (road -> near harbor -> ship -> far harbor -> road) under a fixed sea-leg
 * penalty. Deterministic: harbors are scanned in id order and ties keep land.
 */
export function chooseWareRoute(
  ctx: SeaContext,
  fromFlagId: number,
  targetBuildingId: number,
): WareRoutePlan {
  const { world, geom } = ctx;
  const target = world.buildings.items[targetBuildingId];
  if (!target) return { nextFlag: -1, useSea: false, nearHarborId: -1, farHarborId: -1 };
  const fromFlag = getFlag(world, fromFlagId);
  const player = fromFlag.player;
  const graph = graphFor(ctx, player);

  const landRoute = findFlagRoute(world, geom, graph, fromFlagId, target.flagId);
  let bestCost = routeCost(landRoute);
  let plan: WareRoutePlan = {
    nextFlag: landRoute && landRoute.length >= 2 ? landRoute[1] : -1,
    useSea: false,
    nearHarborId: -1,
    farHarborId: -1,
  };

  const harbors = ctx.harborsByPlayer.get(player) ?? [];
  if (harbors.length >= 2) {
    for (const near of harbors) {
      const toNear = findFlagRoute(world, geom, graph, fromFlagId, near.flagId);
      if (!toNear) continue;
      const costNear = routeCost(toNear);
      for (const far of harbors) {
        if (far.id === near.id || !seaConnected(ctx, near, far)) continue;
        const fromFar = findFlagRoute(world, geom, graph, far.flagId, target.flagId);
        if (!fromFar) continue;
        const total = costNear + SEA.legPenalty + routeCost(fromFar);
        if (total < bestCost) {
          bestCost = total;
          plan = {
            // Already at the embarkation harbor: wait for the ship (-1). Otherwise
            // step over the road toward it.
            nextFlag: costNear === 0 ? -1 : toNear[1],
            useSea: true,
            nearHarborId: near.id,
            farHarborId: far.id,
          };
        }
      }
    }
  }
  return plan;
}

// --- Ship movement --------------------------------------------------------

/** Advance a ship one tick along its water path; true once it has arrived. */
function stepShip(ship: Ship): boolean {
  if (ship.pathIndex >= ship.path.length) return true;
  ship.edgeProgress++;
  if (ship.edgeProgress >= ship.ticksPerEdge) {
    ship.edgeProgress = 0;
    ship.node = ship.path[ship.pathIndex];
    ship.pathIndex++;
  }
  return ship.pathIndex >= ship.path.length && ship.edgeProgress === 0;
}

/** Commit a ship to a water path (excludes current node) at the base sea speed. */
function beginSail(ship: Ship, path: number[]): void {
  ship.path = path;
  ship.pathIndex = 0;
  ship.edgeProgress = 0;
  ship.ticksPerEdge = SEA.ticksPerEdge;
}

/** Spawn a ship built by a shipyard, docked at the nearest harbor of the player. */
export function spawnShip(
  world: World,
  geom: Geometry,
  events: EventSink,
  shipyard: Building,
): Ship | null {
  let harbor: Building | null = null;
  let bestDist = Infinity;
  for (const b of storeLive(world.buildings)) {
    if (b.player !== shipyard.player || !isDockedHarbor(world, geom, b)) continue;
    const d = geom.distance(shipyard.node, b.node);
    if (d < bestDist || (d === bestDist && (!harbor || b.id < harbor.id))) {
      bestDist = d;
      harbor = b;
    }
  }
  if (!harbor) return null;
  const dock = harborDockNode(world, geom, harbor.node);
  if (dock < 0) return null;
  const homeId = harbor.id;
  const id = storeAlloc(world.ships, (sid) => ({
    id: sid,
    player: shipyard.player,
    node: dock,
    state: 'idle' as const,
    homeHarborId: homeId,
    destHarborId: -1,
    path: [],
    pathIndex: 0,
    edgeProgress: 0,
    ticksPerEdge: SEA.ticksPerEdge,
    cargo: [],
    expeditionTargetSpot: -1,
    expeditionBoards: 0,
    expeditionStones: 0,
    expeditionBuilder: false,
  }));
  events.emit({ type: 'ShipBuilt', shipId: id, buildingId: shipyard.id, homeHarborId: homeId, player: shipyard.player });
  return world.ships.items[id] as Ship;
}

/** Found a working harbor (HQ-lite) at a land node, with its SE door flag. */
function foundHarbor(world: World, geom: Geometry, node: number, player: number): number {
  const flagNode = geom.neighbour(node, 'SE');
  let flagId = world.flagAtNode[flagNode];
  if (flagId < 0) {
    flagId = storeAlloc(world.flags, (id) => ({ id, node: flagNode, player, wares: [] }));
    world.flagAtNode[flagNode] = flagId;
  }
  const bId = storeAlloc(world.buildings, (id) => ({
    id,
    type: BUILDING.harbor,
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
    occupied: false,
    coinsEnabled: false,
    incoming: 0,
    promotionTimer: -1,
  }));
  world.buildingAtNode[node] = bId;
  world.objectType[node] = OBJ_TYPE.none;
  return bId;
}

/** Load sea-bound cargo at an idle ship's home harbor and depart, if any. */
function loadAndDepart(ctx: SeaContext, ship: Ship): void {
  const { world, geom } = ctx;
  const home = world.buildings.items[ship.homeHarborId];
  if (!home || home.type !== BUILDING.harbor || home.state !== 'working') return;
  const homeFlag = getFlag(world, home.flagId);

  // Group eligible cargo at the home flag by the destination harbor that the
  // shared route chooser picks; ship the busiest destination (lowest id on tie).
  const byDest = new Map<number, number[]>();
  for (const wareId of homeFlag.wares) {
    const w = world.wares.items[wareId];
    if (!w || w.loc !== 'flag' || w.targetBuildingId < 0) continue;
    const plan = chooseWareRoute(ctx, home.flagId, w.targetBuildingId);
    if (!plan.useSea || plan.nearHarborId !== home.id) continue;
    let list = byDest.get(plan.farHarborId);
    if (!list) {
      list = [];
      byDest.set(plan.farHarborId, list);
    }
    list.push(wareId);
  }
  if (byDest.size === 0) return;

  let destId = -1;
  let bestCount = 0;
  for (const [dest, list] of byDest) {
    if (list.length > bestCount || (list.length === bestCount && (destId < 0 || dest < destId))) {
      bestCount = list.length;
      destId = dest;
    }
  }
  const dest = destId >= 0 ? world.buildings.items[destId] : null;
  if (!dest) return;
  const dockHome = harborDockNode(world, geom, home.node);
  const dockDest = harborDockNode(world, geom, dest.node);
  if (dockHome < 0 || dockDest < 0) return;
  const path = findWaterPath(world, geom, dockHome, dockDest);
  if (!path) return;

  const cargo = byDest.get(destId) as number[];
  for (const wareId of cargo) {
    if (ship.cargo.length >= SEA.cargoCapacity) break;
    const w = world.wares.items[wareId];
    if (!w) continue;
    const idx = homeFlag.wares.indexOf(wareId);
    if (idx >= 0) homeFlag.wares.splice(idx, 1);
    w.loc = 'ship';
    w.locId = ship.id;
    w.nextFlag = -1;
    ship.cargo.push(wareId);
  }
  if (ship.cargo.length === 0) return;
  ship.destHarborId = destId;
  ship.state = 'shuttleOut';
  beginSail(ship, path);
}

/** Unload as much cargo as the destination flag can hold; true once empty. */
function unloadAtDest(world: World, ship: Ship, dest: Building): boolean {
  const flag = getFlag(world, dest.flagId);
  while (ship.cargo.length > 0 && flag.wares.length < FLAG_WARE_CAPACITY) {
    const wareId = ship.cargo[0];
    const w = world.wares.items[wareId];
    ship.cargo.shift();
    if (!w) continue;
    w.loc = 'flag';
    w.locId = flag.id;
    w.nextFlag = -1; // dispatch re-routes by road from the destination island
    flag.wares.push(wareId);
  }
  return ship.cargo.length === 0;
}

/** Advance one ship through its state machine. */
function stepOneShip(ctx: SeaContext, events: EventSink, ship: Ship): void {
  const { world, geom } = ctx;
  switch (ship.state) {
    case 'idle':
      loadAndDepart(ctx, ship);
      break;

    case 'shuttleOut': {
      const arrived = ship.pathIndex >= ship.path.length ? true : stepShip(ship);
      if (!arrived) break;
      const dest = world.buildings.items[ship.destHarborId];
      if (!dest || dest.type !== BUILDING.harbor) {
        // Destination gone: drop cargo back to sea-return and go home.
        ship.state = 'shuttleBack';
        beginReturnHome(ctx, ship);
        break;
      }
      const empty = unloadAtDest(world, ship, dest);
      events.emit({ type: 'ShipArrived', shipId: ship.id, harborId: dest.id, player: ship.player });
      if (empty) {
        ship.state = 'shuttleBack';
        beginReturnHome(ctx, ship);
      }
      break;
    }

    case 'shuttleBack': {
      const arrived = ship.pathIndex >= ship.path.length ? true : stepShip(ship);
      if (!arrived) break;
      ship.destHarborId = -1;
      ship.state = 'idle';
      events.emit({ type: 'ShipArrived', shipId: ship.id, harborId: ship.homeHarborId, player: ship.player });
      break;
    }

    case 'expedition': {
      const arrived = ship.pathIndex >= ship.path.length ? true : stepShip(ship);
      if (!arrived) break;
      const spot = ship.expeditionTargetSpot;
      const newHarborId = foundHarbor(world, geom, spot, ship.player);
      recalcTerritory(world, geom);
      events.emit({ type: 'ExpeditionLanded', shipId: ship.id, harborId: newHarborId, node: spot, player: ship.player });
      events.emit({ type: 'ShipArrived', shipId: ship.id, harborId: newHarborId, player: ship.player });
      // Re-home the ship to the new colony and clear the expedition kit.
      ship.homeHarborId = newHarborId;
      ship.destHarborId = -1;
      ship.expeditionTargetSpot = -1;
      ship.expeditionBoards = 0;
      ship.expeditionStones = 0;
      ship.expeditionBuilder = false;
      ship.node = harborDockNode(world, geom, spot);
      ship.state = 'idle';
      break;
    }
  }
}

/** Point a ship back at its home harbor dock. */
function beginReturnHome(ctx: SeaContext, ship: Ship): void {
  const { world, geom } = ctx;
  const home = world.buildings.items[ship.homeHarborId];
  if (!home) {
    ship.state = 'idle';
    return;
  }
  const dockHome = harborDockNode(world, geom, home.node);
  const path = dockHome >= 0 ? findWaterPath(world, geom, ship.node, dockHome) : null;
  beginSail(ship, path ?? []);
}

// --- Expedition assembly --------------------------------------------------

/** Draw boards/stones/builder from the player pool into preparing expeditions. */
function runExpeditionAssembly(world: World, events: EventSink): void {
  for (const e of world.expeditions) {
    if (e.ready) continue;
    const player = world.players[e.player];
    if (!player) continue;
    while (e.boards < SEA.expeditionBoards && (player.wares.plank ?? 0) > 0) {
      player.wares.plank--;
      e.boards++;
    }
    while (e.stones < SEA.expeditionStones && (player.wares.stone ?? 0) > 0) {
      player.wares.stone--;
      e.stones++;
    }
    if (!e.hasBuilder && ensureWorkerAvailable(world, events, player, JOB.builder)) {
      player.workers[JOB.builder]--;
      e.hasBuilder = true;
    }
    if (e.boards >= SEA.expeditionBoards && e.stones >= SEA.expeditionStones && e.hasBuilder) {
      e.ready = true;
      events.emit({ type: 'ExpeditionReady', harborId: e.harborId, player: e.player });
    }
  }
}

/** Run the whole seafaring pass for one tick. */
export function runSeafaring(world: World, geom: Geometry, events: EventSink): void {
  runExpeditionAssembly(world, events);
  if (world.ships.items.length === 0 && world.ships.free.length === 0) return; // no ships yet
  const ctx = buildSeaContext(world, geom);
  for (const ship of storeLive(world.ships)) stepOneShip(ctx, events, ship);
}

// --- Command executors (called from commands.ts) --------------------------

/** Start assembling an expedition at a harbor (idempotent per harbor). */
export function execPrepareExpedition(world: World, player: number, harborId: number): void {
  const h = world.buildings.items[harborId];
  if (!h || h.player !== player || h.type !== BUILDING.harbor || h.state !== 'working') return;
  if (world.expeditions.some((e) => e.harborId === harborId)) return;
  world.expeditions.push({ harborId, player, boards: 0, stones: 0, hasBuilder: false, ready: false });
}

/**
 * Launch a ready expedition from a harbor toward a coastal target spot. Requires
 * a ready kit, an idle ship homed at the harbor, and an all-water route from the
 * harbor's dock to a water node beside the target land spot.
 */
export function execStartExpedition(
  world: World,
  geom: Geometry,
  player: number,
  harborId: number,
  targetSpot: number,
): void {
  const eIdx = world.expeditions.findIndex((e) => e.harborId === harborId && e.ready && e.player === player);
  if (eIdx < 0) return;
  const harbor = world.buildings.items[harborId];
  if (!harbor || harbor.type !== BUILDING.harbor || harbor.state !== 'working') return;

  // The target must be a free coastal land spot with a free SE door node.
  if (world.buildingAtNode[targetSpot] >= 0) return;
  const targetDock = harborDockNode(world, geom, targetSpot);
  if (targetDock < 0) return;
  const doorNode = geom.neighbour(targetSpot, 'SE');
  if (world.buildingAtNode[doorNode] >= 0) return;

  // Find an idle ship homed here with a water route to the target.
  const dockHome = harborDockNode(world, geom, harbor.node);
  if (dockHome < 0) return;
  let ship: Ship | null = null;
  for (const s of storeLive(world.ships)) {
    if (s.player === player && s.homeHarborId === harborId && s.state === 'idle' && s.cargo.length === 0) {
      ship = s;
      break;
    }
  }
  if (!ship) return;
  const path = findWaterPath(world, geom, ship.node, targetDock);
  if (!path) return;

  const e = world.expeditions[eIdx];
  ship.expeditionTargetSpot = targetSpot;
  ship.expeditionBoards = e.boards;
  ship.expeditionStones = e.stones;
  ship.expeditionBuilder = e.hasBuilder;
  ship.destHarborId = -1;
  ship.state = 'expedition';
  ship.path = path;
  ship.pathIndex = 0;
  ship.edgeProgress = 0;
  ship.ticksPerEdge = SEA.ticksPerEdge;
  world.expeditions.splice(eIdx, 1);
}

/** Exported for tests / the app: free a ship entity (unused-cargo cleanup). */
export function removeShip(world: World, shipId: number): void {
  const ship = world.ships.items[shipId];
  if (!ship) return;
  for (const wareId of ship.cargo) storeFree(world.wares, wareId);
  storeFree(world.ships, shipId);
}
