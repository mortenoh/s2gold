/**
 * Distribution window: per-ware consumer weights steer scarce wares. A mill and
 * a brewery both consume grain; with limited grain the weights decide who gets
 * it, weight 0 starves a consumer, and equal weights keep the even split the
 * dispatcher always had.
 */

import { describe, expect, it } from 'vitest';

import { DISTRIBUTION_DEFAULT_WEIGHT } from './constants';
import {
  applyCommand,
  createWorld,
  deserializeWorld,
  serializeWorld,
  tickWorld,
  worldGeometry,
} from './index';
import { makeFlatMap } from './harness';
import { claimArea, connectToHq, grantWarehouse, spawnBuilding } from './harness-economy';

function setup(): {
  world: ReturnType<typeof createWorld>;
  millId: number;
  breweryId: number;
} {
  const world = createWorld(makeFlatMap(32, 32, 4, 16), { seed: 1, players: 1 });
  const geom = worldGeometry(world);
  claimArea(world, geom, 2, 10, 16, 22);
  const mill = spawnBuilding(world, geom, geom.index(14, 12), 'mill', 0, true);
  const brewery = spawnBuilding(world, geom, geom.index(14, 20), 'brewery', 0, true);
  expect(connectToHq(world, geom, mill.node)).not.toBeNull();
  expect(connectToHq(world, geom, brewery.node)).not.toBeNull();
  tickWorld(world); // execute the road commands
  return { world, millId: mill.id, breweryId: brewery.id };
}

/** Grain delivered to each building over `ticks`, after granting `grain`. */
function deliveries(
  world: ReturnType<typeof createWorld>,
  millId: number,
  breweryId: number,
  grain: number,
  ticks = 4000,
): { mill: number; brewery: number } {
  grantWarehouse(world, 0, { grain });
  let mill = 0;
  let brewery = 0;
  for (let i = 0; i < ticks; i++) {
    for (const e of tickWorld(world)) {
      if (e.type !== 'WareDelivered' || e.wareType !== 'grain') continue;
      if (e.buildingId === millId) mill++;
      else if (e.buildingId === breweryId) brewery++;
    }
  }
  return { mill, brewery };
}

describe('ware distribution weights', () => {
  it('equal weights split scarce grain evenly', () => {
    const { world, millId, breweryId } = setup();
    const got = deliveries(world, millId, breweryId, 8);
    expect(got.mill + got.brewery).toBe(8);
    expect(Math.abs(got.mill - got.brewery)).toBeLessThanOrEqual(2);
  });

  it('a heavier weight takes the lion share', () => {
    const { world, millId, breweryId } = setup();
    applyCommand(world, {
      type: 'setDistribution',
      player: 0,
      wareType: 'grain',
      consumer: 'mill',
      weight: 10,
    });
    applyCommand(world, {
      type: 'setDistribution',
      player: 0,
      wareType: 'grain',
      consumer: 'brewery',
      weight: 1,
    });
    tickWorld(world);
    const got = deliveries(world, millId, breweryId, 8);
    expect(got.mill + got.brewery).toBe(8);
    expect(got.mill).toBeGreaterThanOrEqual(6);
  });

  it('weight 0 starves a consumer', () => {
    const { world, millId, breweryId } = setup();
    applyCommand(world, {
      type: 'setDistribution',
      player: 0,
      wareType: 'grain',
      consumer: 'brewery',
      weight: 0,
    });
    tickWorld(world);
    const got = deliveries(world, millId, breweryId, 8);
    expect(got.brewery).toBe(0);
    // The mill fills its input stock; grain it cannot take stays in the warehouse.
    expect(got.mill).toBeGreaterThanOrEqual(6);
  });

  it('rejects unknown consumers and clamps the weight', () => {
    const world = createWorld(makeFlatMap(24, 24, 4, 4), { seed: 1, players: 1 });
    applyCommand(world, {
      type: 'setDistribution',
      player: 0,
      wareType: 'grain',
      consumer: 'sawmill',
      weight: 3,
    });
    applyCommand(world, {
      type: 'setDistribution',
      player: 0,
      wareType: 'trunk',
      consumer: 'sawmill',
      weight: 3,
    });
    applyCommand(world, {
      type: 'setDistribution',
      player: 0,
      wareType: 'iron',
      consumer: 'armory',
      weight: 99,
    });
    tickWorld(world);
    const d = world.players[0]!.distribution;
    expect(d.grain.sawmill).toBeUndefined();
    expect(d.trunk).toBeUndefined();
    expect(d.iron.armory).toBe(10);
  });

  it('survives save/load and migrates older saves to the defaults', () => {
    const world = createWorld(makeFlatMap(24, 24, 4, 4), { seed: 1, players: 1 });
    applyCommand(world, {
      type: 'setDistribution',
      player: 0,
      wareType: 'coal',
      consumer: 'mint',
      weight: 0,
    });
    tickWorld(world);
    expect(deserializeWorld(serializeWorld(world)).players[0]!.distribution.coal.mint).toBe(0);

    const legacy = JSON.parse(serializeWorld(world)) as {
      version: number;
      players: ({ distribution?: unknown } | null)[];
    };
    legacy.version = 8; // the last version without the field
    for (const p of legacy.players) if (p) delete p.distribution;
    const migrated = deserializeWorld(JSON.stringify(legacy));
    expect(migrated.players[0]!.distribution.coal.mint).toBe(DISTRIBUTION_DEFAULT_WEIGHT);
    expect(migrated.players[0]!.distribution.plank.construction).toBe(DISTRIBUTION_DEFAULT_WEIGHT);
  });
});
