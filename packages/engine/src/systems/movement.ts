/**
 * Shared settler movement: stepping along a committed node path one edge at a
 * time with integer per-edge progress. Used by workers (free walking) and
 * carriers (walking their road).
 */

import type { JobType } from '../constants';
import { storeAlloc, type Settler, type World } from '../world';

/** Assign a walk path and start moving. `path` excludes the current node. */
export function beginWalk(settler: Settler, path: number[], ticksPerEdge: number): void {
  settler.path = path;
  settler.pathIndex = 0;
  settler.edgeProgress = 0;
  settler.ticksPerEdge = Math.max(1, ticksPerEdge);
}

/**
 * Advance a settler one tick along its path. Returns true when the settler has
 * arrived (path fully consumed). Position (`node`) only changes on edge
 * completion so per-edge progress is observable by the renderer.
 */
export function stepWalk(settler: Settler): boolean {
  if (settler.pathIndex >= settler.path.length) return true;
  settler.edgeProgress++;
  if (settler.edgeProgress >= settler.ticksPerEdge) {
    settler.edgeProgress = 0;
    settler.node = settler.path[settler.pathIndex];
    settler.pathIndex++;
  }
  return settler.pathIndex >= settler.path.length && settler.edgeProgress === 0;
}

/** True when the settler has no remaining path to walk. */
export function walkDone(settler: Settler): boolean {
  return settler.pathIndex >= settler.path.length;
}

/** Allocate a fresh settler with default fields at a node. */
export function spawnSettler(
  world: World,
  job: JobType,
  player: number,
  node: number,
): Settler {
  const id = storeAlloc(world.settlers, (sid) => ({
    id: sid,
    job,
    player,
    state: 'idle' as const,
    node,
    path: [],
    pathIndex: 0,
    edgeProgress: 0,
    ticksPerEdge: 1,
    carryingWareId: -1,
    timer: 0,
    homeBuildingId: -1,
    roadId: -1,
    targetNode: -1,
  }));
  const s = world.settlers.items[id];
  if (!s) throw new Error('spawnSettler failed');
  return s;
}
