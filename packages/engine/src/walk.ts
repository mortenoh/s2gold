/**
 * Node walkability, the original's rule: a settler may stand on a node unless
 * any of the six triangles touching it is lava (unreachable), and only if at
 * least one of those six is walkable ground. So shorelines, swamp edges and
 * mountain feet are walkable (you walk along the beach), while a node fully
 * inside water, swamp or snow is not.
 *
 * Validated against every shipped map's own build layer (`scripts/walk-probe.ts`):
 * the old "both of the node's own triangles must be walkable" rule rejected
 * 42,950 nodes the original lets you put a flag on (one campaign map even had
 * a headquarters whose flag could never be reached); this rule rejects none.
 */

import type { Geometry } from './geometry';
import { isWalkableTexture, terrainId, type TerrainRules } from './terrain';
import type { World } from './world';

/** Lava family: a node touching any of these is unreachable on every landscape. */
const UNREACHABLE_IDS: ReadonlySet<number> = new Set([0x10, 0x11, 0x14, 0x15, 0x16]);

/**
 * Per-world walkability mask (1 = walkable). Terrain never changes, so the
 * six-triangle test runs once per node per world; A* and the AI site scans
 * then read a byte instead of walking six triangles per visited node.
 */
const maskCache = new WeakMap<World, Uint8Array>();

function walkableMask(world: World, geom: Geometry, rules: TerrainRules): Uint8Array {
  let mask = maskCache.get(world);
  if (!mask) {
    mask = new Uint8Array(geom.size);
    for (let n = 0; n < geom.size; n++) if (computeWalkable(world, geom, n, rules)) mask[n] = 1;
    maskCache.set(world, mask);
  }
  return mask;
}

/** True when a walking settler may stand on `node` (terrain only; objects aside). */
export function isWalkableNode(
  world: World,
  geom: Geometry,
  node: number,
  rules: TerrainRules,
): boolean {
  return walkableMask(world, geom, rules)[node] === 1;
}

function computeWalkable(world: World, geom: Geometry, node: number, rules: TerrainRules): boolean {
  let anyWalkable = false;
  for (const t of geom.trianglesAround(node)) {
    const byte = t.layer === 1 ? world.terrain1[t.node] : world.terrain2[t.node];
    if (UNREACHABLE_IDS.has(terrainId(byte))) return false;
    if (!anyWalkable && isWalkableTexture(byte, rules)) anyWalkable = true;
  }
  return anyWalkable;
}
