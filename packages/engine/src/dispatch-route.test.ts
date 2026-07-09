/**
 * Regression: a ware must not leave the warehouse until a route to its target
 * exists. Previously planks were emitted onto the HQ flag immediately, froze
 * there when the construction site's flag had no road, and the site never
 * completed even though the player later saw materials "gone" from stock.
 */
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyCommand, createWorld, flagsOf, tickWorld, worldGeometry } from './index';
import { canPlaceBuilding } from './commands';
import { findWalkPath } from './pathfinding';
import { GREENLAND_RULES } from './terrain';

const MAP = '/Users/morteoh/dev/local/s2gold/packages/app/public/assets/maps/maps_miss203.json';

describe.skipIf(!existsSync(MAP))('warehouse supply requires a route', () => {
  it('holds wares until the site flag is connected, then builds', () => {
    const raw = JSON.parse(readFileSync(MAP, 'utf8')) as Parameters<typeof createWorld>[0];
    const world = createWorld(raw, { seed: 42, players: 1 });
    const geom = worldGeometry(world);
    const hqB = world.buildings.items.find((b) => b !== null && b.type === 'headquarters');
    if (!hqB) throw new Error('no HQ');
    const w = world.width;
    const hx = hqB.node % w;
    const hy = Math.floor(hqB.node / w);
    let spot = -1;
    outer: for (let dy = 2; dy < 8; dy++) {
      for (let dx = -6; dx < 7; dx++) {
        const n = ((hy + dy) % world.height) * w + ((hx + dx + w) % w);
        if (canPlaceBuilding(world, geom, GREENLAND_RULES, n, 'woodcutter', 0)) {
          spot = n;
          break outer;
        }
      }
    }
    expect(spot).toBeGreaterThanOrEqual(0);

    const planksBefore = world.players[0]?.wares.plank ?? 0;
    applyCommand(world, { player: 0, type: 'placeBuilding', node: spot, buildingType: 'woodcutter' });

    // No road: the planks must stay in the warehouse and off the HQ flag.
    for (let t = 0; t < 500; t++) tickWorld(world);
    expect(world.players[0]?.wares.plank).toBe(planksBefore);
    const hqFlag = flagsOf(world, 0)[0];
    if (!hqFlag) throw new Error('no HQ flag');
    expect(hqFlag.wares.length).toBe(0);

    // Connect the site flag; the economy must now complete the building.
    const siteFlags = flagsOf(world, 0);
    const siteFlag = siteFlags[siteFlags.length - 1];
    if (!siteFlag) throw new Error('no site flag');
    const path = findWalkPath(world, geom, GREENLAND_RULES, hqFlag.node, siteFlag.node);
    expect(path).not.toBeNull();
    applyCommand(world, {
      player: 0,
      type: 'buildRoad',
      path: [hqFlag.node, ...(path ?? [])],
    });
    for (let t = 0; t < 4000; t++) tickWorld(world);
    const done = world.buildings.items.filter(
      (b) => b !== null && b.type === 'woodcutter' && b.state !== 'site',
    );
    expect(done.length).toBeGreaterThan(0);
  });
});
