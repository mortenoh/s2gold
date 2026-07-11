/**
 * Star-network transport deadlock (reproduced from two long live games).
 *
 * TOPOLOGY: every building hangs off the single HQ flag by its own direct road
 * (a star), so the HQ flag is both the warehouse door AND the shared distribution
 * hub. A flag holds at most FLAG_WARE_CAPACITY (8) wares.
 *
 * THE DEADLOCK CYCLE (pre-fix):
 *  1. The warehouse has sustained outbound demand (here: perpetual construction
 *     sites that keep pulling boards). Each tick, dispatch's warehouse-supply pass
 *     refills the HQ flag to 8 with outbound boards bound OUT to those sites.
 *  2. A quarry on another spoke produces stone bound INTO the warehouse. Its
 *     carrier walks a stone to the HQ flag and tries to drop it.
 *  3. The HQ flag is full (8 outbound boards). The carrier cannot drop:
 *     - no swap partner: the quarry has no input, so the warehouse never sends a
 *       ware back across the quarry's road to exchange with;
 *     - no displacement: stone's transport priority (2) is not higher than the
 *       boards (1) occupying every slot.
 *  4. The stone carrier is stuck holding its ware; the quarry's door flag backs
 *     up to 8 and the quarry stalls. Stone NEVER transits the hub. The warehouse
 *     stone count is frozen forever even though the world keeps ticking.
 *
 * This is the "warehouse ware count freezes / producers stall on backpressure"
 * live symptom: outbound wares monopolise the hub's 8 slots and nothing bound
 * into the warehouse can ever land.
 *
 * THE FIX (systems/carriers.ts): a ware terminating at a warehouse (HQ or
 * storehouse) enters the building's stock through its DOOR, not across the flag.
 * A warehouse-bound delivery no longer competes for one of the flag's 8 transit
 * slots, so it can never be blocked by outbound wares queued on the hub. This
 * matches Settlers II / RttR, where a warehouse absorbs arriving wares directly
 * and the flag's slots are only for wares transiting onward.
 */

import { describe, expect, it } from 'vitest';
import { createWorld, tickWorld, worldGeometry, type World } from './index';
import { makeFlatMap } from './harness';
import { claimArea, connectToHq, spawnBuilding } from './harness-economy';
import { getBuilding, type Building } from './world';

/** Convert a freshly-spawned building into a never-completing construction site:
 * a stand-in for sustained construction demand that keeps the hub saturated. */
function makePerpetualSite(b: Building): void {
  b.state = 'site';
  b.needBoards = 1_000_000;
  b.needStones = 0;
  b.deliveredBoards = 0;
  b.deliveredStones = 0;
  b.staffed = false;
}

function hqFlagWares(world: World): number {
  const hq = getBuilding(world, world.players[0].hqBuildingId);
  return world.flags.items[hq.flagId]!.wares.length;
}

/** A star of stone producers + perpetual board consumers around the HQ flag. */
function buildStarWorld(): { world: World } {
  const world = createWorld(makeFlatMap(60, 60, 30, 30), { seed: 5, players: 1 });
  const geom = worldGeometry(world);
  claimArea(world, geom, 5, 5, 55, 55);
  const p = world.players[0];
  p.wares.plank = 1_000_000; // effectively inexhaustible board stock to hand out
  p.wares.pickaxe = 20; // tools so every quarry can recruit its stonemason

  // Quarry spokes first, so their carriers act right after the hub is refilled to
  // 8 each tick (worst-case ordering that makes the pre-fix freeze deterministic).
  const quarryNodes: number[] = [];
  for (const [x, y] of [
    [24, 40],
    [36, 40],
    [18, 30],
    [42, 30],
  ] as const) {
    const node = geom.index(x, y);
    spawnBuilding(world, geom, node, 'quarry', 0, false);
    if (connectToHq(world, geom, node)) quarryNodes.push(node);
  }
  expect(quarryNodes.length).toBe(4);
  // Ample granite in each quarry's radius so supply never runs out over the run.
  for (const qn of quarryNodes) {
    for (let node = 0; node < geom.size; node++) {
      const d = geom.distance(qn, node);
      if (d < 2 || d > 8) continue;
      if (world.buildingAtNode[node] >= 0 || world.flagAtNode[node] >= 0) continue;
      world.objectType[node] = 0xcc; // granite pile
      world.objectIndex[node] = 0x0f; // full stock
    }
  }

  // Perpetual construction sites: sustained outbound board demand on the hub.
  for (const [x, y] of [
    [24, 26],
    [36, 26],
    [22, 22],
    [38, 22],
  ] as const) {
    const b = spawnBuilding(world, geom, geom.index(x, y), 'sawmill', 0, false);
    makePerpetualSite(b);
    connectToHq(world, geom, geom.index(x, y));
  }
  tickWorld(world); // execute the road commands
  return { world };
}

describe('star-network transport deadlock', () => {
  it('warehouse-bound stone keeps flowing while the HQ hub stays saturated', () => {
    const { world } = buildStarWorld();
    const p = world.players[0];
    const startStone = p.wares.stone;

    // Warm up until the hub saturates and stone has begun arriving.
    for (let i = 0; i < 40_000; i++) tickWorld(world);
    const midStone = p.wares.stone;

    // The hub is genuinely saturated with outbound boards throughout.
    expect(hqFlagWares(world)).toBe(8);

    // Throughput must CONTINUE past saturation, not just in an initial burst.
    for (let i = 0; i < 20_000; i++) tickWorld(world);
    const endStone = p.wares.stone;

    // Pre-fix these are all frozen at startStone (68) forever; post-fix the
    // warehouse absorbs stone through its door despite the full hub.
    expect(midStone).toBeGreaterThan(startStone);
    expect(endStone).toBeGreaterThan(midStone);
    // Sustained rate: well over one stone delivered per 100 ticks in the tail.
    expect(endStone - midStone).toBeGreaterThan(100);
  }, 120_000);
});
