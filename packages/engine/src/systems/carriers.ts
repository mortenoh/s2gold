/**
 * Carrier system (tick phase 5, after dispatch has set each ware's next hop).
 *
 * One carrier serves one road segment. It rests at the road middle, and when
 * wares wait at either end flag whose next hop crosses this road it walks to the
 * busier end, picks up a ware, carries it to the far flag, and hands it off
 * (respecting the 8-ware flag limit). Assignment pulls carriers from the HQ
 * pool.
 */

import {
  buildingDef,
  DONKEY_UPGRADE_BUSY_GF,
  FLAG_WARE_CAPACITY,
  JOB,
  PRODUCTIVITY_GF,
  TICKS,
} from '../constants';
import type { EventSink } from '../events';
import type { Geometry } from '../geometry';
import { findWalkPath } from '../pathfinding';
import type { TerrainRules } from '../terrain';
import {
  getFlag,
  getRoad,
  storeFree,
  storeLive,
  type Building,
  type Road,
  type Settler,
  type World,
} from '../world';
import { beginWalk, spawnSettler, stepWalk, walkDone } from './movement';

/** True when a building accepts wares straight into stock (HQ or storehouse). */
function isWarehouse(b: Building): boolean {
  const def = buildingDef(b.type);
  return !!def && (def.kind === 'hq' || def.kind === 'warehouse');
}

/** Nodes along a road from `fromNode` to `toNode` (excludes from, includes to). */
function roadSubPath(road: Road, fromNode: number, toNode: number): number[] {
  const i = road.path.indexOf(fromNode);
  const j = road.path.indexOf(toNode);
  if (i < 0 || j < 0 || i === j) return [];
  return i < j ? road.path.slice(i + 1, j + 1) : road.path.slice(j, i).reverse();
}

/** Count wares at a flag whose next hop is `otherFlag`. */
function demandAt(world: World, flagId: number, otherFlag: number): number {
  const flag = getFlag(world, flagId);
  let n = 0;
  for (const wid of flag.wares) {
    const w = world.wares.items[wid];
    if (w && w.nextFlag === otherFlag) n++;
  }
  return n;
}

/** Assign idle HQ carriers to roads that lack one. */
function assignCarriers(world: World, events: EventSink): void {
  for (const road of storeLive(world.roads)) {
    if (road.carrierId >= 0 && world.settlers.items[road.carrierId]) continue;
    const player = world.players[road.player];
    if (!player || player.workers[JOB.carrier] <= 0) continue;
    const midNode = road.path[Math.floor(road.path.length / 2)];
    const carrier = spawnSettler(world, JOB.carrier, road.player, midNode);
    carrier.roadId = road.id;
    carrier.state = 'carrierIdle';
    road.carrierId = carrier.id;
    player.workers[JOB.carrier]--;
    events.emit({
      type: 'SettlerSpawned',
      settlerId: carrier.id,
      job: JOB.carrier,
      player: road.player,
    });
  }
}

/**
 * At each PRODUCTIVITY_GF window boundary, upgrade any road whose primary carrier
 * was busy for at least DONKEY_UPGRADE_BUSY_GF of the window (CONSTANTS.md §4:
 * productivity >= DONKEY_PRODUCTIVITY = 80% -> UpgradeDonkeyRoad), then reset the
 * accumulator for the next window. Global boundaries (world.tick % window) keep
 * evaluation deterministic and independent of per-road build times.
 */
function evaluateUpgrades(world: World, events: EventSink): void {
  if (world.tick === 0 || world.tick % PRODUCTIVITY_GF !== 0) return;
  for (const road of storeLive(world.roads)) {
    if (!road.upgraded && road.busyGf >= DONKEY_UPGRADE_BUSY_GF) {
      road.upgraded = true;
      events.emit({ type: 'RoadUpgraded', roadId: road.id, player: road.player });
    }
    road.busyGf = 0;
  }
}

/**
 * Assign a pack donkey to each upgraded road that lacks one, drawing from the
 * player's bred-donkey pool (NOT the Helper pool). The donkey spawns at the
 * player's HQ (a warehouse) and walks out to the road middle like a fresh carrier;
 * once there it hauls wares alongside the human carrier (two carriers per road,
 * ~doubling throughput). CONSTANTS.md §4 "Donkey (PackDonkey)".
 */
function assignDonkeys(world: World, geom: Geometry, rules: TerrainRules, events: EventSink): void {
  for (const road of storeLive(world.roads)) {
    if (!road.upgraded) continue;
    if (road.donkeyId >= 0 && world.settlers.items[road.donkeyId]) continue;
    const player = world.players[road.player];
    if (!player || player.donkeys <= 0) continue;
    const midNode = road.path[Math.floor(road.path.length / 2)];
    const hq = player.hqBuildingId >= 0 ? world.buildings.items[player.hqBuildingId] : null;
    const startNode = hq ? hq.node : midNode;
    const donkey = spawnSettler(world, JOB.packdonkey, road.player, startNode);
    donkey.roadId = road.id;
    const path =
      startNode === midNode ? null : findWalkPath(world, geom, rules, startNode, midNode);
    if (path && path.length > 0) {
      donkey.state = 'donkeyToRoad';
      donkey.targetNode = midNode;
      beginWalk(donkey, path, TICKS.walkPerEdge);
    } else {
      donkey.node = midNode;
      donkey.state = 'carrierIdle';
    }
    road.donkeyId = donkey.id;
    player.donkeys--;
    events.emit({
      type: 'SettlerSpawned',
      settlerId: donkey.id,
      job: JOB.packdonkey,
      player: road.player,
    });
  }
}

/** Walk a freshly assigned donkey out to its road middle, then rest there. */
function stepDonkeyToRoad(donkey: Settler): void {
  const arrived = walkDone(donkey) ? true : stepWalk(donkey);
  if (arrived) donkey.state = 'carrierIdle';
}

/** Step one carrier through its pickup / carry / dropoff cycle. */
function stepCarrier(world: World, carrier: Settler, events: EventSink): void {
  const road = world.roads.items[carrier.roadId];
  if (!road) {
    carrier.state = 'idle';
    return;
  }
  const nodeA = getFlag(world, road.flagA).node;
  const nodeB = getFlag(world, road.flagB).node;

  if (carrier.state === 'carrierIdle') {
    const demandA = demandAt(world, road.flagA, road.flagB);
    const demandB = demandAt(world, road.flagB, road.flagA);
    if (demandA === 0 && demandB === 0) return;
    const pickA = demandA >= demandB;
    const target = pickA ? nodeA : nodeB;
    carrier.state = 'carrierToPickup';
    carrier.targetNode = target;
    beginWalk(carrier, roadSubPath(road, carrier.node, target), TICKS.carrierPerEdge);
  }

  if (carrier.state === 'carrierToPickup') {
    const arrived = walkDone(carrier) ? true : stepWalk(carrier);
    if (!arrived) return;
    const atA = carrier.node === nodeA;
    const thisFlag = atA ? road.flagA : road.flagB;
    const otherFlag = atA ? road.flagB : road.flagA;
    const flag = getFlag(world, thisFlag);
    // Pick the waiting ware bound across this road with the lowest transport
    // priority number (highest priority); queue order breaks ties (CONSTANTS.md §4).
    const prio = world.players[road.player]?.transportPriority;
    let pickIdx = -1;
    let bestPrio = Infinity;
    for (let i = 0; i < flag.wares.length; i++) {
      const w = world.wares.items[flag.wares[i]];
      if (!w || w.nextFlag !== otherFlag) continue;
      const p = prio ? (prio[w.type] ?? 999) : 999;
      if (p < bestPrio) {
        bestPrio = p;
        pickIdx = i;
      }
    }
    if (pickIdx < 0) {
      carrier.state = 'carrierIdle';
      return;
    }
    const wareId = flag.wares.splice(pickIdx, 1)[0];
    const ware = world.wares.items[wareId];
    if (!ware) {
      carrier.state = 'carrierIdle';
      return;
    }
    ware.loc = 'carried';
    ware.locId = carrier.id;
    carrier.carryingWareId = wareId;
    const dropNode = atA ? nodeB : nodeA;
    carrier.state = 'carrierToDropoff';
    carrier.targetNode = dropNode;
    beginWalk(carrier, roadSubPath(road, carrier.node, dropNode), TICKS.carrierPerEdge);
    return;
  }

  if (carrier.state === 'carrierToDropoff') {
    const arrived = walkDone(carrier) ? true : stepWalk(carrier);
    if (!arrived) return;
    const dropFlagId = carrier.node === nodeA ? road.flagA : road.flagB;
    const flag = getFlag(world, dropFlagId);
    // Warehouse door: a ware terminating at a warehouse (HQ/storehouse) on this
    // flag enters the building's stock directly, never occupying one of the
    // flag's 8 transit slots (S2/RttR: the warehouse door is not the flag). The
    // HQ flag doubles as the distribution hub, so it can sit full of outbound
    // wares; without the door, inbound deliveries to the warehouse deadlock
    // behind them and the whole economy freezes (transport-deadlock.test.ts).
    {
      const carried = world.wares.items[carrier.carryingWareId];
      const tgt = carried ? world.buildings.items[carried.targetBuildingId] : undefined;
      if (carried && tgt && tgt.flagId === dropFlagId && isWarehouse(tgt)) {
        world.players[tgt.player].wares[carried.type]++;
        storeFree(world.wares, carried.id);
        carrier.carryingWareId = -1;
        carrier.state = 'carrierIdle';
        events.emit({
          type: 'WareDelivered',
          wareType: carried.type,
          buildingId: tgt.id,
          player: tgt.player,
        });
        return;
      }
    }
    if (flag.wares.length >= FLAG_WARE_CAPACITY) {
      // Full flag: swap with a waiting ware headed back across this road (S2
      // carriers exchange wares at flags). The slot count stays constant, and
      // it breaks the two-full-flags gridlock where every carrier waits for a
      // slot only another waiting carrier could free. Deterministic pick:
      // highest transport priority first, then queue order.
      const backFlag = dropFlagId === road.flagA ? road.flagB : road.flagA;
      const prio = world.players[road.player]?.transportPriority;
      const prioOf = (t: string): number => (prio ? (prio[t] ?? 999) : 999);
      let swapIdx = -1;
      let bestPrio = Infinity;
      // Displacement fallback: the lowest-priority ware on the flag, so a needed
      // good can bump surplus when no genuine exchange is available (below).
      let worstIdx = -1;
      let worstPrio = -Infinity;
      for (let i = 0; i < flag.wares.length; i++) {
        const w = world.wares.items[flag.wares[i]];
        if (!w) continue;
        const p = prioOf(w.type);
        if (w.nextFlag === backFlag && p < bestPrio) {
          bestPrio = p;
          swapIdx = i;
        }
        if (p > worstPrio) {
          worstPrio = p;
          worstIdx = i;
        }
      }
      if (swapIdx < 0) {
        // No return-bound exchange. If we carry something strictly higher
        // priority than the flag's least-wanted ware, displace it: ours takes the
        // slot and the surplus rides back to re-route. This lets a construction
        // plank punch forward through a jam of low-value goods instead of
        // deadlocking behind them (the displaced good moves one flag back while
        // ours advances one flag on — so the needed ware makes monotonic progress).
        const myWare0 = world.wares.items[carrier.carryingWareId];
        const myPrio = myWare0 ? prioOf(myWare0.type) : 999;
        if (worstIdx >= 0 && myPrio < worstPrio) swapIdx = worstIdx;
      }
      if (swapIdx < 0) return; // nothing to give way: wait for a slot
      const outWare = world.wares.items[flag.wares[swapIdx]];
      const myWare = world.wares.items[carrier.carryingWareId];
      if (!outWare || !myWare) return;
      flag.wares[swapIdx] = carrier.carryingWareId; // ours takes its slot
      myWare.loc = 'flag';
      myWare.locId = dropFlagId;
      myWare.nextFlag = -1; // dispatch recomputes from the new flag
      outWare.loc = 'carried';
      outWare.locId = carrier.id;
      carrier.carryingWareId = outWare.id;
      const backNode = dropFlagId === road.flagA ? nodeB : nodeA;
      carrier.targetNode = backNode;
      beginWalk(carrier, roadSubPath(road, carrier.node, backNode), TICKS.carrierPerEdge);
      return;
    }
    const wareId = carrier.carryingWareId;
    const ware = world.wares.items[wareId];
    if (ware) {
      ware.loc = 'flag';
      ware.locId = dropFlagId;
      ware.nextFlag = -1; // dispatch recomputes from the new flag
      flag.wares.push(wareId);
    }
    carrier.carryingWareId = -1;
    carrier.state = 'carrierIdle';
  }
}

/** Run the carrier system for one tick. */
export function runCarriers(
  world: World,
  geom: Geometry,
  rules: TerrainRules,
  events: EventSink,
): void {
  evaluateUpgrades(world, events);
  assignCarriers(world, events);
  assignDonkeys(world, geom, rules, events);
  for (const s of storeLive(world.settlers)) {
    if (s.roadId < 0) continue;
    if (s.job !== JOB.carrier && s.job !== JOB.packdonkey) continue;
    if (s.state === 'donkeyToRoad') {
      stepDonkeyToRoad(s);
      continue;
    }
    stepCarrier(world, s, events);
    // Productivity is measured on the primary (human) carrier only: a tick counts
    // as busy whenever it is walking to fetch or deliver (i.e. not resting idle).
    const road = world.roads.items[s.roadId];
    if (road && s.id === road.carrierId && s.state !== 'carrierIdle') road.busyGf++;
  }
}

/** Exported for tests: current serving carrier of a road, or -1. */
export function roadCarrier(world: World, roadId: number): number {
  const r = getRoad(world, roadId);
  return r.carrierId;
}
