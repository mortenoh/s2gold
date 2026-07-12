/**
 * Fishery: fish live in water (0x80-0x87 resource on water tiles), so a fisher
 * stands on reachable shore next to fish-bearing water and catches it. Verifies a
 * coastal fishery with fish in the adjacent water actually produces.
 */

import { describe, expect, it } from 'vitest';
import { createWorld, tickWorld, worldGeometry } from './index';
import { makeResource, RESOURCE, resourceType } from './constants';
import { makeTwoIslandMap } from './harness';
import { connectToHq, setResource, spawnBuilding } from './harness-economy';
import { isWaterNode } from './water';

describe('fishery catches fish from adjacent water', () => {
  it('produces fish when there is a fish deposit in the water next to it', () => {
    const world = createWorld(makeTwoIslandMap(), { seed: 1, players: 1 });
    const geom = worldGeometry(world);

    // (3,6) is open water beside island A's west coast; the fishery at (5,6) is
    // in reach of the (4,6) shore, which is adjacent to that water.
    const water = geom.index(3, 6);
    expect(isWaterNode(world, water)).toBe(true);
    setResource(world, water, RESOURCE.fish, 7);
    expect(resourceType(makeResource(RESOURCE.fish, 7))).toBe(RESOURCE.fish);

    // A fishery on the coast within reach of that shore spot; it recruits its
    // fisher from the HQ over the first ticks (needs a rod-and-line, in stock).
    // The fisher walks the road network to the site, so connect it to the HQ.
    const fishery = spawnBuilding(world, geom, geom.index(5, 6), 'fishery', 0, false);
    connectToHq(world, geom, geom.index(5, 6));

    const before = world.players[0].wares.fish;
    let produced = false;
    for (let i = 0; i < 6000 && !produced; i++) {
      tickWorld(world);
      // Count fish anywhere (warehouse, flags, in transit) so a delivered-or-not
      // fish still shows the fishery worked.
      const inTransit = [...world.wares.items].filter((w) => w && w.type === 'fish').length;
      if (world.players[0].wares.fish > before || inTransit > 0 || fishery.outputQueue.length > 0) {
        produced = true;
      }
    }
    expect(produced).toBe(true);
  });
});
