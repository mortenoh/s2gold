/**
 * Ware dispatch and delivery.
 *
 * Each tick this system (1) lets the HQ push stored material toward buildings
 * that still need it, (2) assigns every unrouted ware a target building and its
 * next flag hop over the road network, and (3) delivers wares that have reached
 * their target building's flag. Carriers (systems/carriers.ts) perform the
 * physical flag-to-flag movement in between.
 */

import {
  BUILDING,
  SAWMILL_INPUT_CAP,
  WARE,
  type WareType,
} from '../constants';
import type { EventSink } from '../events';
import type { Geometry } from '../geometry';
import { buildFlagGraph, findFlagRoute } from '../pathfinding';
import {
  getBuilding,
  getFlag,
  storeAlloc,
  storeFree,
  storeLive,
  type Building,
  type Flag,
  type World,
} from '../world';

/** Count wares (waiting or carried) already heading to a building of a type. */
function enRoute(world: World, buildingId: number, wareType: WareType): number {
  let n = 0;
  for (const w of storeLive(world.wares)) {
    if (w.targetBuildingId === buildingId && w.type === wareType) n++;
  }
  return n;
}

/** Remaining demand of a building for a ware type (0 when satisfied). */
function demand(b: Building, wareType: WareType): number {
  if (b.state === 'site') {
    if (wareType === WARE.plank) return Math.max(0, b.needBoards - b.deliveredBoards);
    if (wareType === WARE.stone) return Math.max(0, b.needStones - b.deliveredStones);
    return 0;
  }
  if (b.type === BUILDING.sawmill && wareType === WARE.trunk) {
    return Math.max(0, SAWMILL_INPUT_CAP - b.inputStock);
  }
  return 0;
}

/** Find the nearest building of `player` still needing `wareType`. */
function findNeeder(
  world: World,
  geom: Geometry,
  player: number,
  wareType: WareType,
  fromNode: number,
): number {
  let best = -1;
  let bestDist = Infinity;
  for (const b of storeLive(world.buildings)) {
    if (b.player !== player) continue;
    const need = demand(b, wareType) - enRoute(world, b.id, wareType);
    if (need <= 0) continue;
    const d = geom.distance(fromNode, getFlag(world, b.flagId).node);
    if (d < bestDist || (d === bestDist && b.id < best)) {
      bestDist = d;
      best = b.id;
    }
  }
  return best;
}

/** Assign a target building for a ware based on its type; HQ is the fallback. */
function assignTarget(world: World, geom: Geometry, wareId: number): void {
  const w = world.wares.items[wareId];
  if (!w || w.loc !== 'flag') return;
  const flag = getFlag(world, w.locId);
  const player = flag.player;
  let target = findNeeder(world, geom, player, w.type, flag.node);
  if (target < 0) target = world.players[player]?.hqBuildingId ?? -1;
  w.targetBuildingId = target;
}

/** Deliver a ware sitting on its target building's flag; returns true if consumed. */
function tryDeliver(world: World, events: EventSink, flag: Flag, wareId: number): boolean {
  const w = world.wares.items[wareId];
  if (!w) return false;
  if (w.targetBuildingId < 0) return false;
  const b = world.buildings.items[w.targetBuildingId];
  if (!b) {
    w.targetBuildingId = -1;
    return false;
  }
  if (b.flagId !== flag.id) return false;

  let accepted = false;
  if (b.state === 'site') {
    if (w.type === WARE.plank && b.deliveredBoards < b.needBoards) {
      b.deliveredBoards++;
      accepted = true;
    } else if (w.type === WARE.stone && b.deliveredStones < b.needStones) {
      b.deliveredStones++;
      accepted = true;
    }
  } else if (b.type === BUILDING.headquarters) {
    world.players[b.player].wares[w.type]++;
    accepted = true;
  } else if (b.type === BUILDING.sawmill && w.type === WARE.trunk) {
    b.inputStock++;
    accepted = true;
  }

  if (!accepted) {
    // Wrong place now (already satisfied): re-route via HQ next tick.
    w.targetBuildingId = -1;
    return false;
  }
  const idx = flag.wares.indexOf(wareId);
  if (idx >= 0) flag.wares.splice(idx, 1);
  storeFree(world.wares, wareId);
  events.emit({ type: 'WareDelivered', wareType: w.type, buildingId: b.id, player: b.player });
  return true;
}

/** Emit HQ-stored material toward buildings that still need it. */
function runHqSupply(world: World, geom: Geometry): void {
  for (const player of world.players) {
    if (player.hqBuildingId < 0) continue;
    const hq = getBuilding(world, player.hqBuildingId);
    const hqFlag = getFlag(world, hq.flagId);
    for (const wareType of [WARE.plank, WARE.stone, WARE.trunk] as WareType[]) {
      let stock = player.wares[wareType];
      if (stock <= 0) continue;
      // Repeatedly satisfy the nearest needer while stock and flag slots remain.
      for (;;) {
        if (stock <= 0 || hqFlag.wares.length >= 8) break;
        const target = findNeeder(world, geom, player.index, wareType, hqFlag.node);
        if (target < 0) break;
        const wid = storeAlloc(world.wares, (id) => ({
          id,
          type: wareType,
          loc: 'flag' as const,
          locId: hqFlag.id,
          targetBuildingId: target,
          nextFlag: -1,
        }));
        hqFlag.wares.push(wid);
        player.wares[wareType]--;
        stock--;
      }
    }
  }
}

/** Run the full dispatch pass for one tick. */
export function runDispatch(world: World, geom: Geometry, events: EventSink): void {
  runHqSupply(world, geom);

  const graphs = new Map<number, ReturnType<typeof buildFlagGraph>>();
  const graphFor = (player: number): ReturnType<typeof buildFlagGraph> => {
    let g = graphs.get(player);
    if (!g) {
      g = buildFlagGraph(world, player);
      graphs.set(player, g);
    }
    return g;
  };

  for (const flag of storeLive(world.flags)) {
    // Iterate over a copy: delivery mutates flag.wares.
    for (const wareId of flag.wares.slice()) {
      const w = world.wares.items[wareId];
      if (!w || w.loc !== 'flag') continue;
      if (w.targetBuildingId < 0 || !world.buildings.items[w.targetBuildingId]) {
        assignTarget(world, geom, wareId);
      }
      if (w.targetBuildingId < 0) {
        w.nextFlag = -1;
        continue;
      }
      const target = getBuilding(world, w.targetBuildingId);
      if (target.flagId === flag.id) {
        if (tryDeliver(world, events, flag, wareId)) continue;
      }
      // Compute the next flag hop toward the target's flag.
      const route = findFlagRoute(world, geom, graphFor(flag.player), flag.id, target.flagId);
      w.nextFlag = route && route.length >= 2 ? route[1] : -1;
    }
  }
}
