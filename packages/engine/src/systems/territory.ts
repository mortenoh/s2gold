/**
 * Territory / ownership recomputation (MILITARY.md §3 RecalcTerritory).
 *
 * Ownership is derived state: each occupied military building and every HQ is a
 * "military point" that claims the disc of nodes within its radius (MILITARY.md
 * §2). A node is owned by the nearest claiming point; ties break to the lower
 * player index, then the lower building id — a fixed, deterministic rule. The
 * result is written into `world.owner` (encoding: 0 = neutral, else player+1).
 *
 * This is the only place `world.owner` is written after map load, and it runs
 * only on occupation / capture / destruction (cheap: O(nodes x points), and
 * points are few). Border stones and vision derive from `owner` on demand
 * (see the view helpers in index.ts), so nothing else needs storing.
 */

import {
  BUILDING,
  buildingDef,
  HARBOR_RADIUS,
  HQ_RADIUS,
  OWNER_NONE,
  ownerByteFor,
} from '../constants';
import type { Geometry } from '../geometry';
import { storeLive, type World } from './../world';

/** A territory-projecting point: an HQ or an occupied military building. */
interface MilitaryPoint {
  node: number;
  player: number;
  radius: number;
  buildingId: number;
}

/** Collect every territory-projecting point in deterministic (building-id) order. */
function collectPoints(world: World): MilitaryPoint[] {
  const points: MilitaryPoint[] = [];
  for (const b of storeLive(world.buildings)) {
    const def = buildingDef(b.type);
    if (!def) continue;
    if (def.kind === 'hq') {
      points.push({ node: b.node, player: b.player, radius: HQ_RADIUS, buildingId: b.id });
    } else if (b.type === BUILDING.harbor && b.state === 'working') {
      // A harbor anchors territory like an HQ-lite (MILITARY.md §2 HARBOR_RADIUS),
      // which is what lets an expedition establish a foothold on a new island (P7).
      points.push({ node: b.node, player: b.player, radius: HARBOR_RADIUS, buildingId: b.id });
    } else if (def.kind === 'military' && b.occupied) {
      points.push({
        node: b.node,
        player: b.player,
        radius: def.militaryRadius ?? 0,
        buildingId: b.id,
      });
    }
  }
  return points;
}

/**
 * Recompute `world.owner` from scratch. Returns true when ownership changed
 * (so callers can gate a TerritoryChanged event / vision recompute).
 */
export function recalcTerritory(world: World, geom: Geometry): boolean {
  const points = collectPoints(world);
  const size = geom.size;
  const next = new Array<number>(size).fill(OWNER_NONE);

  if (points.length > 0) {
    for (let node = 0; node < size; node++) {
      let bestDist = Infinity;
      let bestPlayer = -1;
      let bestBuilding = Infinity;
      for (const p of points) {
        const d = geom.distance(node, p.node);
        if (d > p.radius) continue;
        // Nearer wins; on a tie prefer lower player, then lower building id.
        if (
          d < bestDist ||
          (d === bestDist &&
            (p.player < bestPlayer || (p.player === bestPlayer && p.buildingId < bestBuilding)))
        ) {
          bestDist = d;
          bestPlayer = p.player;
          bestBuilding = p.buildingId;
        }
      }
      if (bestPlayer >= 0) next[node] = ownerByteFor(bestPlayer);
    }
  }

  let changed = false;
  for (let node = 0; node < size; node++) {
    if (world.owner[node] !== next[node]) {
      world.owner[node] = next[node];
      changed = true;
    }
  }
  return changed;
}
