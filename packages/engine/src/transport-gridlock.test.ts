/**
 * Transport gridlock guards (code review).
 *
 * Root cause of "a building refuses to build": a producer with no consumer (e.g.
 * a well) floods the road network with surplus that saturates every flag and
 * deadlocks unrelated deliveries. Two guards address it:
 *  - demand gate (systems/production.ts): a producer idles once stored +
 *    in-transit supply of its output reaches a reserve, so surplus stays bounded.
 *  - priority displacement (systems/carriers.ts): a needed good can bump surplus
 *    off a full flag, so it punches through a standing jam.
 *
 * The gate is the directly-observable guard and is asserted here; without it
 * consumer-less wells produce water without limit.
 */

import { describe, expect, it } from 'vitest';
import { createWorld, tickWorld, warehouseWareTotal, worldGeometry, type World } from './index';
import { makeFlatMap } from './harness';
import { connectToHq, spawnBuilding } from './harness-economy';
import { storeLive } from './world';

function waterSupply(world: World): number {
  return (
    warehouseWareTotal(world, 0, 'water') +
    [...storeLive(world.wares)].filter((w) => w.type === 'water').length
  );
}

describe('demand gate bounds surplus production', () => {
  it('idles consumer-less wells so water plateaus near the reserve', () => {
    const world = createWorld(makeFlatMap(40, 40, 2, 2), { seed: 3, players: 1 });
    const geom = worldGeometry(world);
    // Three wells, nothing drinking their water — a strong flood source.
    for (const [x, y] of [
      [8, 8],
      [8, 12],
      [12, 8],
    ] as const) {
      spawnBuilding(world, geom, geom.index(x, y), 'well', 0, false);
      connectToHq(world, geom, geom.index(x, y));
    }

    // Long enough that ungated wells would pour out well over 100 units of water.
    for (let i = 0; i < 20000; i++) tickWorld(world);

    // Gated: total water supply plateaus near the reserve (40) plus per-well
    // queue + in-transit slack (~63 here); ungated this runs to 150+.
    expect(waterSupply(world)).toBeLessThanOrEqual(90);
  });
});
