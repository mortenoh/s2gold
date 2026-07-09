/**
 * Construction system (tick phase 2 + the builder's settler steps).
 *
 * For each construction site: request a builder from the HQ pool, walk it to the
 * site, and — once every board and stone has been delivered and the builder is
 * present — advance the build. On completion the building starts working, the
 * builder returns to the pool, and the producer worker is left to be recruited
 * by the production system.
 */

import { BUILDING, JOB, TICKS } from '../constants';
import type { EventSink } from '../events';
import type { Geometry } from '../geometry';
import { findWalkPath } from '../pathfinding';
import type { TerrainRules } from '../terrain';
import { getBuilding, getFlag, storeFree, storeLive, type World } from '../world';
import { beginWalk, spawnSettler, stepWalk, walkDone } from './movement';

/** Run construction for one tick. */
export function runConstruction(
  world: World,
  geom: Geometry,
  rules: TerrainRules,
  events: EventSink,
): void {
  for (const b of storeLive(world.buildings)) {
    if (b.state !== 'site' || b.type === BUILDING.headquarters) continue;
    const player = world.players[b.player];
    if (!player) continue;

    // Acquire a builder if none assigned.
    if (b.workerId < 0) {
      if (player.workers[JOB.builder] <= 0) continue;
      const hq = player.hqBuildingId >= 0 ? getBuilding(world, player.hqBuildingId) : null;
      const startNode = hq ? hq.node : b.node;
      const builder = spawnSettler(world, JOB.builder, b.player, startNode);
      builder.homeBuildingId = b.id;
      builder.state = 'toBuilding';
      builder.targetNode = b.node;
      const path = findWalkPath(world, geom, rules, startNode, b.node);
      if (path) beginWalk(builder, path, TICKS.walkPerEdge);
      else builder.node = b.node; // fallback: no route — place at the door
      b.workerId = builder.id;
      player.workers[JOB.builder]--;
      events.emit({ type: 'SettlerSpawned', settlerId: builder.id, job: JOB.builder, player: b.player });
      continue;
    }

    const builder = world.settlers.items[b.workerId];
    if (!builder) {
      b.workerId = -1;
      continue;
    }

    if (builder.state === 'toBuilding') {
      const arrived = walkDone(builder) ? true : stepWalk(builder);
      if (arrived && builder.node === b.node) builder.state = 'working';
      if (builder.state !== 'working') continue;
    }

    // Builder present: advance the build once all material is on site.
    if (b.deliveredBoards >= b.needBoards && b.deliveredStones >= b.needStones) {
      b.buildProgress++;
      if (b.buildProgress >= b.buildTicks) completeBuilding(world, events, b.id);
    }
  }
}

function completeBuilding(world: World, events: EventSink, buildingId: number): void {
  const b = getBuilding(world, buildingId);
  // Return the builder to the HQ pool.
  if (b.workerId >= 0 && world.settlers.items[b.workerId]) {
    const player = world.players[b.player];
    if (player) player.workers[JOB.builder]++;
    storeFree(world.settlers, b.workerId);
  }
  b.workerId = -1;
  b.staffed = false;
  b.state = 'working';
  b.buildProgress = b.buildTicks;
  // Ensure a serving flag lookup stays valid.
  getFlag(world, b.flagId);
  events.emit({
    type: 'BuildingCompleted',
    buildingId: b.id,
    buildingType: b.type,
    node: b.node,
    player: b.player,
  });
}
