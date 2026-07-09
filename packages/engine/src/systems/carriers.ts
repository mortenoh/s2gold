/**
 * Carrier system (tick phase 5, after dispatch has set each ware's next hop).
 *
 * One carrier serves one road segment. It rests at the road middle, and when
 * wares wait at either end flag whose next hop crosses this road it walks to the
 * busier end, picks up a ware, carries it to the far flag, and hands it off
 * (respecting the 8-ware flag limit). Assignment pulls carriers from the HQ
 * pool.
 */

import { FLAG_WARE_CAPACITY, JOB, TICKS } from '../constants';
import type { EventSink } from '../events';
import { getFlag, getRoad, storeLive, type Road, type Settler, type World } from '../world';
import { beginWalk, spawnSettler, stepWalk, walkDone } from './movement';

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
    events.emit({ type: 'SettlerSpawned', settlerId: carrier.id, job: JOB.carrier, player: road.player });
  }
}

/** Step one carrier through its pickup / carry / dropoff cycle. */
function stepCarrier(world: World, carrier: Settler): void {
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
    if (flag.wares.length >= FLAG_WARE_CAPACITY) return; // wait for a slot
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
export function runCarriers(world: World, events: EventSink): void {
  assignCarriers(world, events);
  for (const s of storeLive(world.settlers)) {
    if (s.job === JOB.carrier && s.roadId >= 0) stepCarrier(world, s);
  }
}

/** Exported for tests: current serving carrier of a road, or -1. */
export function roadCarrier(world: World, roadId: number): number {
  const r = getRoad(world, roadId);
  return r.carrierId;
}
