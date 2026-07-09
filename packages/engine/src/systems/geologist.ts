/**
 * Geologist system: steps each dispatched geologist through walk -> survey ->
 * return. On reaching the sent flag it surveys the ore under every mountain node
 * within {@link GEOLOGIST_RADIUS}, recording a sign per node (the resource kind,
 * 0 = nothing) so the player can see where to build mines. It then walks home and
 * rejoins the Helper pool. Signs are replaced if the geologist re-surveys a node.
 */

import { GEOLOGIST_RADIUS, GEOLOGIST_SURVEY_TICKS, JOB, resourceType, TICKS } from '../constants';
import type { EventSink } from '../events';
import type { Geometry } from '../geometry';
import { findWalkPath } from '../pathfinding';
import { isMountainTexture, type TerrainRules } from '../terrain';
import { getBuilding, storeFree, storeLive, type Settler, type World } from '../world';
import { beginWalk, stepWalk, walkDone } from './movement';

/** True when a node's terrain is mountain (where ore/signs live). */
function isMountainNode(world: World, geom: Geometry, node: number): boolean {
  for (const tri of geom.trianglesAround(node)) {
    const tex = tri.layer === 1 ? world.terrain1[tri.node] : world.terrain2[tri.node];
    if (isMountainTexture(tex)) return true;
  }
  return false;
}

/** Survey every mountain node within range of `center`, recording a sign each. */
function survey(world: World, geom: Geometry, center: number): void {
  for (let node = 0; node < geom.size; node++) {
    if (geom.distance(center, node) > GEOLOGIST_RADIUS) continue;
    if (!isMountainNode(world, geom, node)) continue;
    const res = resourceType(world.resource[node]);
    const existing = world.signs.find((s) => s.node === node);
    if (existing) existing.res = res;
    else world.signs.push({ node, res });
  }
}

/** Step one geologist through its walk -> survey -> return -> retire cycle. */
function stepGeologist(
  world: World,
  geom: Geometry,
  rules: TerrainRules,
  g: Settler,
): void {
  if (g.state === 'toWork') {
    const arrived = walkDone(g) ? true : stepWalk(g);
    if (!arrived) return;
    survey(world, geom, g.node);
    g.state = 'working';
    g.timer = GEOLOGIST_SURVEY_TICKS;
    return;
  }
  if (g.state === 'working') {
    if (g.timer > 0) {
      g.timer--;
      return;
    }
    // Head home to rejoin the Helper pool.
    const hq = g.homeBuildingId >= 0 ? getBuilding(world, g.homeBuildingId) : null;
    if (!hq) {
      retire(world, g);
      return;
    }
    g.state = 'home';
    g.targetNode = hq.node;
    const path = findWalkPath(world, geom, rules, g.node, hq.node);
    if (path) beginWalk(g, path, TICKS.walkPerEdge);
    else g.node = hq.node;
    return;
  }
  if (g.state === 'home') {
    const arrived = walkDone(g) ? true : stepWalk(g);
    if (arrived) retire(world, g);
  }
}

/** Return the geologist's Helper to the pool and remove the settler. */
function retire(world: World, g: Settler): void {
  const pl = world.players[g.player];
  if (pl) pl.workers[JOB.carrier] = (pl.workers[JOB.carrier] ?? 0) + 1;
  storeFree(world.settlers, g.id);
}

/** Run all geologists for one tick. */
export function runGeologists(
  world: World,
  geom: Geometry,
  rules: TerrainRules,
  _events: EventSink,
): void {
  for (const s of storeLive(world.settlers)) {
    if (s.job === JOB.geologist) stepGeologist(world, geom, rules, s);
  }
}
