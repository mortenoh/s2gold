/**
 * Construction system (tick phase 2 + the builder's settler steps).
 *
 * For each construction site: request a builder from the HQ pool, walk it to the
 * site, and — once every board and stone has been delivered and the builder is
 * present — advance the build. On completion the building starts working, the
 * builder returns to the pool, and the producer worker is left to be recruited
 * by the production system.
 */

import { BUILDING, buildingDef, JOB, TICKS } from '../constants';
import type { EventSink } from '../events';
import type { Geometry } from '../geometry';
import { findWalkPath } from '../pathfinding';
import type { TerrainRules } from '../terrain';
import { getBuilding, getFlag, storeFree, storeLive, type World } from '../world';
import { beginWalk, spawnSettler, stepWalk, walkDone } from './movement';
import { recalcTerritory } from './territory';
import { ensureWorkerAvailable } from './recruit';

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

    // Acquire a builder if none assigned (recruiting one from a Helper + Hammer
    // when the builder pool is empty, per CONSTANTS.md §7).
    if (b.workerId < 0) {
      if (!ensureWorkerAvailable(world, events, player, JOB.builder)) continue;
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
      events.emit({
        type: 'SettlerSpawned',
        settlerId: builder.id,
        job: JOB.builder,
        player: b.player,
      });
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
      if (b.buildProgress >= b.buildTicks) completeBuilding(world, geom, events, b.id);
    }
  }
}

function completeBuilding(
  world: World,
  geom: Geometry,
  events: EventSink,
  buildingId: number,
): void {
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
  // Size the input-stock buffer to the finished building's input count.
  const def = buildingDef(b.type);
  if (def) {
    b.inputStock = new Array<number>(def.inputs.length).fill(0);
  }
  // Ensure a serving flag lookup stays valid.
  getFlag(world, b.flagId);
  // A completed harbor projects territory like an HQ-lite; claim it now
  // rather than waiting for some unrelated event to trigger a recalc.
  if (b.type === BUILDING.harbor && recalcTerritory(world, geom)) {
    events.emit({ type: 'TerritoryChanged', player: b.player });
  }
  events.emit({
    type: 'BuildingCompleted',
    buildingId: b.id,
    buildingType: b.type,
    node: b.node,
    player: b.player,
  });
}
