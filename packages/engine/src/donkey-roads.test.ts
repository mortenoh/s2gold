/**
 * Donkey roads (CONSTANTS.md §4 "Productivity / donkey upgrade" + "Donkey"):
 *
 * - the donkey breeder turns Grain + Water into a pack donkey in the player pool;
 * - a road whose carrier stays busy for >= DONKEY_PRODUCTIVITY (80%) of a
 *   PRODUCTIVITY_GF (6000 GF) window auto-upgrades to a donkey road;
 * - an upgraded road draws a donkey from the pool as a second carrier, and its
 *   ware throughput roughly doubles versus a single-carrier control;
 * - all the new state serializes, round-trips, and back-patches onto old saves;
 * - the whole flow is deterministic (same seed twice -> same hash).
 */

import { describe, expect, it } from 'vitest';
import { applyCommand } from './commands';
import {
  DONKEY_UPGRADE_BUSY_GF,
  JOB,
  PRODUCTIVITY_GF,
  WARE,
} from './constants';
import { spawnBuilding } from './harness-economy';
import { makeFlatMap } from './harness';
import { hashWorld, deserializeWorld, serializeWorld } from './serialize';
import { tickWorld } from './index';
import { Geometry } from './geometry';
import { createWorld, storeAlloc, storeLive, type Road, type World } from './world';

/** Claim the whole map for player 0 so flags/roads may be placed anywhere. */
function claimAll(world: World): void {
  // owner byte for player 0 == 1 (ownerByteFor); write directly for the fixture.
  for (let n = 0; n < world.owner.length; n++) world.owner[n] = 1;
}

/**
 * Build a feeding road: the HQ door flag (flagA) linked by a straight road to a
 * standalone far flag (flagB) that we keep topped up with stones bound for the HQ
 * warehouse. The single primary carrier hauls flagB -> flagA every trip. Returns
 * the world, geometry, road, far-flag id and HQ id.
 */
function buildFeedingRoad(seed: number, edges = 6): {
  world: World;
  geom: Geometry;
  road: Road;
  farFlag: number;
  hqId: number;
} {
  const world = createWorld(makeFlatMap(40, 20, 5, 10), { seed, players: 1 });
  claimAll(world);
  const geom = new Geometry(world.width, world.height);
  const hqId = world.players[0].hqBuildingId;
  const hqNode = world.buildings.items[hqId]!.node;
  const hqFlagNode = geom.neighbour(hqNode, 'SE');

  // Walk `edges` steps East to the far-flag node (all meadow => walkable).
  let farNode = hqFlagNode;
  for (let i = 0; i < edges; i++) farNode = geom.neighbour(farNode, 'E');

  applyCommand(world, { tick: world.tick, player: 0, type: 'placeFlag', node: farNode });
  const straight: number[] = [hqFlagNode];
  let n = hqFlagNode;
  for (let i = 0; i < edges; i++) {
    n = geom.neighbour(n, 'E');
    straight.push(n);
  }
  applyCommand(world, { tick: world.tick, player: 0, type: 'buildRoad', path: straight });
  tickWorld(world); // execute flag + road

  const farFlag = world.flagAtNode[farNode];
  const road = [...storeLive(world.roads)][0];
  return { world, geom, road, farFlag, hqId };
}

/** Top a flag up to the 8-slot capacity with stones (targeted by dispatch). */
function feedStones(world: World, flagId: number): void {
  const flag = world.flags.items[flagId]!;
  while (flag.wares.length < 8) {
    const wid = storeAlloc(world.wares, (id) => ({
      id,
      type: WARE.stone,
      loc: 'flag' as const,
      locId: flagId,
      targetBuildingId: -1,
      nextFlag: -1,
    }));
    flag.wares.push(wid);
  }
}

/** Run `ticks` frames feeding the far flag; count stones delivered into the HQ. */
function runAndCountDeliveries(
  world: World,
  farFlag: number,
  hqId: number,
  ticks: number,
): number {
  let delivered = 0;
  for (let t = 0; t < ticks; t++) {
    feedStones(world, farFlag);
    for (const e of tickWorld(world)) {
      if (e.type === 'WareDelivered' && e.buildingId === hqId && e.wareType === WARE.stone) {
        delivered++;
      }
    }
  }
  return delivered;
}

describe('donkey breeder', () => {
  it('breeds a pack donkey from grain + water into the player pool', () => {
    const world = createWorld(makeFlatMap(20, 20, 3, 3), { seed: 1, players: 1 });
    const geom = new Geometry(world.width, world.height);
    const breeder = spawnBuilding(world, geom, geom.index(10, 10), 'donkeybreeder', 0, true);
    // Stock a couple of grain + water so at least one cycle can run.
    breeder.inputStock = [3, 3];

    expect(world.players[0].donkeys).toBe(0);
    let bred = 0;
    // workTicks = 370; one consume + one work cycle completes just past that.
    for (let t = 0; t < 420; t++) {
      for (const e of tickWorld(world)) if (e.type === 'DonkeyBred') bred++;
    }
    expect(bred).toBeGreaterThanOrEqual(1);
    expect(world.players[0].donkeys).toBeGreaterThanOrEqual(1);
  });
});

describe('road donkey-upgrade', () => {
  it('upgrades a continuously busy road at the productivity threshold', () => {
    const { world, road, farFlag } = buildFeedingRoad(7);
    expect(road.upgraded).toBe(false);

    // Run through one full productivity window; the primary carrier stays busy.
    let upgradeEvent = false;
    for (let t = world.tick; t <= PRODUCTIVITY_GF; t++) {
      feedStones(world, farFlag);
      for (const e of tickWorld(world)) {
        if (e.type === 'RoadUpgraded' && e.roadId === road.id) upgradeEvent = true;
      }
    }
    expect(road.upgraded).toBe(true);
    expect(upgradeEvent).toBe(true);
  });

  it('does not upgrade an idle road (productivity below threshold)', () => {
    const { world, road } = buildFeedingRoad(9);
    // Never feed the road: the carrier rests, so busy time stays ~0.
    for (let t = world.tick; t <= PRODUCTIVITY_GF; t++) tickWorld(world);
    expect(road.upgraded).toBe(false);
  });

  it('threshold constant is 80% of the window', () => {
    expect(DONKEY_UPGRADE_BUSY_GF).toBe((PRODUCTIVITY_GF * 80) / 100);
  });
});

describe('donkey second carrier throughput', () => {
  it('assigns a donkey to an upgraded road and roughly doubles throughput', () => {
    const measureTicks = 2500;

    // Control: single carrier, road left un-upgraded.
    const control = buildFeedingRoad(11);
    const controlDelivered = runAndCountDeliveries(
      control.world, control.farFlag, control.hqId, measureTicks,
    );

    // Upgraded: force the road to a donkey road and stock one bred donkey.
    const up = buildFeedingRoad(11);
    up.road.upgraded = true;
    up.world.players[0].donkeys = 1;
    const upDelivered = runAndCountDeliveries(
      up.world, up.farFlag, up.hqId, measureTicks,
    );

    // A pack donkey should have been drawn from the pool and placed on the road.
    expect(up.world.players[0].donkeys).toBe(0);
    expect(up.road.donkeyId).toBeGreaterThanOrEqual(0);
    const donkey = up.world.settlers.items[up.road.donkeyId]!;
    expect(donkey.job).toBe(JOB.packdonkey);

    // Two carriers ~ double the single-carrier haul rate (allow generous slack).
    expect(controlDelivered).toBeGreaterThan(0);
    expect(upDelivered).toBeGreaterThan(controlDelivered * 1.5);
  });
});

describe('donkey-road determinism and serialization', () => {
  it('same seed twice produces the same hash through an upgrade', () => {
    const run = (): string => {
      const { world, road, farFlag } = buildFeedingRoad(21);
      road.upgraded = true;
      world.players[0].donkeys = 1;
      for (let t = 0; t < 600; t++) {
        feedStones(world, farFlag);
        tickWorld(world);
      }
      return hashWorld(world);
    };
    expect(run()).toBe(run());
  });

  it('round-trips upgraded-road + donkey state through serialize', () => {
    const { world, road, farFlag } = buildFeedingRoad(31);
    road.upgraded = true;
    world.players[0].donkeys = 1;
    for (let t = 0; t < 300; t++) {
      feedStones(world, farFlag);
      tickWorld(world);
    }
    const before = hashWorld(world);
    const restored = deserializeWorld(serializeWorld(world));
    expect(hashWorld(restored)).toBe(before);
    // Restored world keeps ticking without diverging in shape.
    expect(() => tickWorld(restored)).not.toThrow();
    const restoredRoad = [...storeLive(restored.roads)].find((r) => r.id === road.id);
    expect(restoredRoad?.upgraded).toBe(true);
  });

  it('loads an old-format save with the new fields deleted', () => {
    const { world } = buildFeedingRoad(41);
    // Serialize, then strip the donkey-road fields to mimic a pre-feature save.
    const parsed = JSON.parse(serializeWorld(world)) as Record<string, unknown>;
    const roads = (parsed.roads as { items: Array<Record<string, unknown> | null> }).items;
    for (const r of roads) {
      if (!r) continue;
      delete r.upgraded;
      delete r.busyGf;
      delete r.donkeyId;
    }
    for (const p of parsed.players as Array<Record<string, unknown>>) {
      delete p.donkeys;
    }
    const restored = deserializeWorld(JSON.stringify(parsed));
    for (const road of storeLive(restored.roads)) {
      expect(road.upgraded).toBe(false);
      expect(road.busyGf).toBe(0);
      expect(road.donkeyId).toBe(-1);
    }
    expect(restored.players[0].donkeys).toBe(0);
    expect(() => tickWorld(restored)).not.toThrow();
  });
});
