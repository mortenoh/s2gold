/**
 * Ware dispatch and delivery (generalized for the full economy).
 *
 * Each tick this system (1) lets every warehouse (HQ + storehouses) push stored
 * wares toward buildings that still need them, (2) assigns each unrouted ware a
 * target building and its next flag hop over the road network, and (3) delivers
 * wares that have reached their target building's flag. Carriers
 * (systems/carriers.ts) perform the physical flag-to-flag movement in between.
 *
 * Distribution fairness: when several buildings want the same ware type, the
 * neediest (largest remaining demand net of wares already en route) wins, with a
 * nearest-then-lowest-id tie-break — deterministic, and it round-robins evenly
 * across equal consumers because each dispatched ware raises that building's
 * en-route count for the next pick.
 */

import { buildingDef, FLAG_WARE_CAPACITY, WARE, WARE_TYPES, type WareType } from '../constants';
import type { EventSink } from '../events';
import type { Geometry } from '../geometry';
import { buildSeaContext, chooseWareRoute, type SeaContext } from './seafaring';
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

/** True when a building acts as a warehouse (accepts + issues wares). */
function isWarehouse(b: Building): boolean {
  const def = buildingDef(b.type);
  return !!def && (def.kind === 'hq' || def.kind === 'warehouse');
}

/**
 * Per-tick census of live wares by raw targetBuildingId and type, replacing a
 * full ware-store scan per findNeeder call (O(buildings x wares) per tick).
 * Built once at the top of runDispatch and mirrored at every mutation inside
 * the pass (assignTarget, tryDeliver, warehouse emission), so reads are
 * identical to a live scan.
 */
type EnRouteCensus = Map<number, Map<WareType, number>>;

function buildEnRouteCensus(world: World): EnRouteCensus {
  const census: EnRouteCensus = new Map();
  for (const w of storeLive(world.wares)) censusAdd(census, w.targetBuildingId, w.type, 1);
  return census;
}

function censusAdd(census: EnRouteCensus, buildingId: number, type: WareType, delta: number): void {
  if (buildingId < 0) return;
  let byType = census.get(buildingId);
  if (!byType) {
    byType = new Map();
    census.set(buildingId, byType);
  }
  byType.set(type, (byType.get(type) ?? 0) + delta);
}

function censusGet(census: EnRouteCensus, buildingId: number, type: WareType): number {
  return census.get(buildingId)?.get(type) ?? 0;
}

/** Remaining demand of a building for a ware type (0 when satisfied). */
function demand(b: Building, wareType: WareType): number {
  if (b.state === 'site') {
    if (wareType === WARE.plank) return Math.max(0, b.needBoards - b.deliveredBoards);
    if (wareType === WARE.stone) return Math.max(0, b.needStones - b.deliveredStones);
    return 0;
  }
  const def = buildingDef(b.type);
  if (!def) return 0;
  // Military buildings only accept coins once occupied and with delivery enabled
  // (MILITARY.md §3); an empty/new building or one with coins toggled off wants none.
  if (def.kind === 'military' && wareType === WARE.coins && (!b.occupied || !b.coinsEnabled)) {
    return 0;
  }
  const idx = def.inputs.indexOf(wareType);
  if (idx < 0) return 0;
  return Math.max(0, def.inputCap - (b.inputStock[idx] ?? 0));
}

/**
 * Find the best building of `player` still needing `wareType`: the neediest
 * (largest remaining demand net of en-route wares), tie-broken by nearest flag
 * then lowest id. Buildings in `skip` are ignored — the warehouse supply pass
 * uses this to pass over targets it has found to be unroutable, so one
 * unconnected site can't block delivery to the reachable ones. Returns -1 when
 * nobody (else) needs it.
 */
function findNeeder(
  world: World,
  geom: Geometry,
  census: EnRouteCensus,
  player: number,
  wareType: WareType,
  fromNode: number,
  skip?: Set<number>,
): number {
  let best = -1;
  let bestNeed = 0;
  let bestDist = Infinity;
  for (const b of storeLive(world.buildings)) {
    if (b.player !== player) continue;
    if (skip?.has(b.id)) continue;
    const need = demand(b, wareType) - censusGet(census, b.id, wareType);
    if (need <= 0) continue;
    const d = geom.distance(fromNode, getFlag(world, b.flagId).node);
    if (
      need > bestNeed ||
      (need === bestNeed && (d < bestDist || (d === bestDist && (best < 0 || b.id < best))))
    ) {
      best = b.id;
      bestNeed = need;
      bestDist = d;
    }
  }
  return best;
}

/** Nearest warehouse (HQ or storehouse) of a player, by flag distance then id. */
function nearestWarehouse(world: World, geom: Geometry, player: number, fromNode: number): number {
  let best = -1;
  let bestDist = Infinity;
  for (const b of storeLive(world.buildings)) {
    if (b.player !== player || b.state !== 'working' || !isWarehouse(b)) continue;
    const d = geom.distance(fromNode, getFlag(world, b.flagId).node);
    if (d < bestDist || (d === bestDist && (best < 0 || b.id < best))) {
      best = b.id;
      bestDist = d;
    }
  }
  return best;
}

/** Assign a target building for a ware based on its type; a warehouse is the fallback. */
function assignTarget(world: World, geom: Geometry, census: EnRouteCensus, wareId: number): void {
  const w = world.wares.items[wareId];
  if (!w || w.loc !== 'flag') return;
  const flag = getFlag(world, w.locId);
  const player = flag.player;
  let target = findNeeder(world, geom, census, player, w.type, flag.node);
  if (target < 0) target = nearestWarehouse(world, geom, player, flag.node);
  if (target < 0) target = world.players[player]?.hqBuildingId ?? -1;
  censusAdd(census, w.targetBuildingId, w.type, -1);
  w.targetBuildingId = target;
  censusAdd(census, target, w.type, 1);
}

/** Deliver a ware sitting on its target building's flag; returns true if consumed. */
function tryDeliver(
  world: World,
  events: EventSink,
  census: EnRouteCensus,
  flag: Flag,
  wareId: number,
): boolean {
  const w = world.wares.items[wareId];
  if (!w) return false;
  if (w.targetBuildingId < 0) return false;
  const b = world.buildings.items[w.targetBuildingId];
  if (!b) {
    censusAdd(census, w.targetBuildingId, w.type, -1);
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
  } else if (isWarehouse(b)) {
    world.players[b.player].wares[w.type]++;
    accepted = true;
  } else {
    const def = buildingDef(b.type);
    const idx = def ? def.inputs.indexOf(w.type) : -1;
    // Same gate as demand(): a military building that is unoccupied or has
    // coins toggled off also rejects coins already in flight to it.
    const coinsBlocked =
      def?.kind === 'military' && w.type === WARE.coins && (!b.occupied || !b.coinsEnabled);
    if (def && idx >= 0 && !coinsBlocked && (b.inputStock[idx] ?? 0) < def.inputCap) {
      while (b.inputStock.length <= idx) b.inputStock.push(0);
      b.inputStock[idx]++;
      accepted = true;
    }
  }

  if (!accepted) {
    // Wrong place now (already satisfied): re-route next tick.
    censusAdd(census, w.targetBuildingId, w.type, -1);
    w.targetBuildingId = -1;
    return false;
  }
  const idx = flag.wares.indexOf(wareId);
  if (idx >= 0) flag.wares.splice(idx, 1);
  censusAdd(census, w.targetBuildingId, w.type, -1);
  storeFree(world.wares, wareId);
  events.emit({ type: 'WareDelivered', wareType: w.type, buildingId: b.id, player: b.player });
  return true;
}

/** Ware types in ascending transport-priority order for a player (lower = first). */
function priorityOrder(world: World, player: number): WareType[] {
  const prio = world.players[player]?.transportPriority ?? {};
  return [...WARE_TYPES].sort((a, b) => (prio[a] ?? 999) - (prio[b] ?? 999) || (a < b ? -1 : 1));
}

/** Emit warehouse-stored wares toward buildings that still need them. */
function runWarehouseSupply(
  world: World,
  geom: Geometry,
  census: EnRouteCensus,
  seaCtx: SeaContext,
): void {
  for (const player of world.players) {
    const order = priorityOrder(world, player.index);
    for (const wh of storeLive(world.buildings)) {
      if (wh.player !== player.index || wh.state !== 'working' || !isWarehouse(wh)) continue;
      const whFlag = getFlag(world, wh.flagId);
      for (const wareType of order) {
        // Targets found to be unroutable this pass; skipped so the neediest
        // unconnected site can't starve the reachable ones behind it.
        const skip = new Set<number>();
        while (player.wares[wareType] > 0 && whFlag.wares.length < FLAG_WARE_CAPACITY) {
          const target = findNeeder(world, geom, census, player.index, wareType, whFlag.node, skip);
          if (target < 0) break;
          // A ware only leaves the warehouse when it can actually travel: either
          // the target uses this very flag, or a road/sea route exists. Without
          // this check the ware would freeze at the flag (and its slot) forever
          // when the player has not yet connected the target's flag. Skip such a
          // target and try the next-neediest rather than abandoning the pass.
          const targetBuilding = getBuilding(world, target);
          if (targetBuilding.flagId !== whFlag.id) {
            const route = chooseWareRoute(seaCtx, whFlag.id, target);
            if (route.nextFlag < 0 && !route.useSea) {
              skip.add(target);
              continue;
            }
          }
          const wid = storeAlloc(world.wares, (id) => ({
            id,
            type: wareType,
            loc: 'flag' as const,
            locId: whFlag.id,
            targetBuildingId: target,
            nextFlag: -1,
          }));
          whFlag.wares.push(wid);
          censusAdd(census, target, wareType, 1);
          player.wares[wareType]--;
        }
      }
    }
  }
}

/** Run the full dispatch pass for one tick. */
export function runDispatch(world: World, geom: Geometry, events: EventSink): void {
  // Shared land-vs-sea routing context (harbors + road graphs + water links).
  const seaCtx = buildSeaContext(world, geom);
  const census = buildEnRouteCensus(world);
  runWarehouseSupply(world, geom, census, seaCtx);

  for (const flag of storeLive(world.flags)) {
    // Iterate over a copy: delivery mutates flag.wares.
    for (const wareId of flag.wares.slice()) {
      const w = world.wares.items[wareId];
      if (!w || w.loc !== 'flag') continue;
      if (w.targetBuildingId < 0 || !world.buildings.items[w.targetBuildingId]) {
        assignTarget(world, geom, census, wareId);
      }
      if (w.targetBuildingId < 0) {
        w.nextFlag = -1;
        continue;
      }
      const target = getBuilding(world, w.targetBuildingId);
      if (target.flagId === flag.id) {
        if (tryDeliver(world, events, census, flag, wareId)) continue;
      }
      // Next hop toward the target, choosing land or a sea leg via harbors.
      w.nextFlag = chooseWareRoute(seaCtx, flag.id, w.targetBuildingId).nextFlag;
    }
  }
}
