/** Finite map wildlife, deterministic roaming, and the hunter's outdoor trip. */
import { isGraniteType, TICKS, WARE } from '../constants';
import type { EventSink } from '../events';
import type { Geometry } from '../geometry';
import { findWalkPath } from '../pathfinding';
import { nextRange } from '../rng';
import type { TerrainRules } from '../terrain';
import { isWalkableNode } from '../walk';
import { isWaterNode } from '../water';
import {
  storeFree,
  storeLive,
  type Animal,
  type Building,
  type Settler,
  type World,
} from '../world';
import { beginWalk, stepWalk, walkDone } from './movement';

export const HUNT_SHOOT_TICKS = 32;

function canRoam(
  world: World,
  geom: Geometry,
  rules: TerrainRules,
  a: Animal,
  node: number,
): boolean {
  if (world.buildingAtNode[node] >= 0 || world.flagAtNode[node] >= 0) return false;
  if (a.species === 5 || a.species === 8) return isWaterNode(world, node);
  return isWalkableNode(world, geom, node, rules) && !isGraniteType(world.objectType[node]);
}

export function runWildlife(world: World, geom: Geometry, rules: TerrainRules): void {
  for (const a of storeLive(world.animals)) {
    if (a.hunterId >= 0) {
      const hunter = world.settlers.items[a.hunterId];
      const home = hunter && world.buildings.items[hunter.homeBuildingId];
      if (
        hunter?.job === 'hunter' &&
        home?.workerId === hunter.id &&
        home.player === hunter.player &&
        hunter.targetNode === a.node &&
        hunter.state !== 'idle'
      )
        continue;
      // Demolition or capture must release the reservation, even if a settler id
      // was reused during the command phase. An abandoned carcass is lost.
      a.hunterId = -1;
      if (a.dead) {
        storeFree(world.animals, a.id);
        continue;
      }
    }
    if (!walkDone(a)) {
      if (!canRoam(world, geom, rules, a, a.path[a.pathIndex])) {
        beginWalk(a, [], a.ticksPerEdge);
      } else if (!stepWalk(a)) continue;
      a.timer = 30 + nextRange(world.rng, 70);
    }
    if (a.timer > 0) {
      a.timer--;
      continue;
    }
    const neighbours = geom.neighbours(a.node);
    const offset = nextRange(world.rng, 6);
    for (let i = 0; i < 6; i++) {
      const node = neighbours[(offset + i) % 6];
      if (!canRoam(world, geom, rules, a, node)) continue;
      beginWalk(a, [node], 20);
      break;
    }
    // A trapped animal waits, allowing a demolished building to reopen a path.
    a.timer = 30;
  }
}

/** No input-free meat: reserve prey, walk out, shoot, dress it, and carry it home. */
export function runHunter(
  world: World,
  geom: Geometry,
  rules: TerrainRules,
  events: EventSink,
  b: Building,
  worker: Settler,
  workTicks: number,
  radius: number,
): void {
  const prey = storeLive(world.animals).find((a) => a.hunterId === worker.id);
  const goHome = (): void => {
    worker.state = 'home';
    beginWalk(worker, [], TICKS.walkPerEdge);
  };
  switch (worker.state) {
    case 'idle': {
      if (worker.timer > 0) {
        worker.timer--;
        return;
      }
      if (b.outputQueue.length >= 8) return;
      const candidates = storeLive(world.animals)
        .filter(
          (a) =>
            !a.dead &&
            a.hunterId < 0 &&
            a.species !== 5 &&
            a.species !== 8 &&
            a.species !== 9 &&
            geom.distance(b.node, a.node) <= radius,
        )
        .sort(
          (a, c) => geom.distance(b.node, a.node) - geom.distance(b.node, c.node) || a.id - c.id,
        );
      for (const a of candidates) {
        const path = findWalkPath(world, geom, rules, worker.node, a.node);
        if (!path || path.length > 50) continue;
        a.hunterId = worker.id;
        beginWalk(a, [], a.ticksPerEdge);
        worker.targetNode = a.node;
        worker.state = 'toWork';
        beginWalk(worker, path, TICKS.walkPerEdge);
        return;
      }
      worker.timer = 100; // bounded search cadence when wildlife is exhausted
      return;
    }
    case 'toWork':
      if (!prey) {
        goHome();
        break;
      }
      if (walkDone(worker) || stepWalk(worker)) {
        worker.state = 'working';
        worker.timer = workTicks;
        events.emit({
          type: 'WorkStarted',
          kind: 'hunting',
          buildingId: b.id,
          node: worker.node,
          player: b.player,
        });
      }
      break;
    case 'working':
      if (!prey) {
        goHome();
        break;
      }
      if (worker.timer > 0) worker.timer--;
      if (worker.timer <= workTicks - HUNT_SHOOT_TICKS) prey.dead = true;
      if (worker.timer === 0) goHome();
      break;
    case 'home': {
      if (worker.node !== b.node && walkDone(worker)) {
        const path = findWalkPath(world, geom, rules, worker.node, b.node);
        if (!path) return; // never teleport meat across a disconnected route
        beginWalk(worker, path, TICKS.walkPerEdge);
      }
      if (stepWalk(worker) && worker.node === b.node) {
        if (prey?.dead) {
          b.outputQueue.push(WARE.meat);
          storeFree(world.animals, prey.id);
        } else if (prey) prey.hunterId = -1;
        worker.state = 'idle';
        worker.timer = 0;
      }
      break;
    }
    default:
      if (prey) prey.hunterId = -1;
      goHome();
  }
}
