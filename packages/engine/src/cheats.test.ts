import { describe, expect, it } from 'vitest';

import {
  applyCommand,
  createWorld,
  deserializeWorld,
  serializeWorld,
  tickWorld,
  warehouseTotals,
  worldGeometry,
} from './index';
import { makeFlatMap } from './harness';
import { CHEAT_HELPER_FLOOR, CHEAT_STOCK_FLOOR } from './systems/cheats';

describe('unlimited-resources cheat', () => {
  it('tops up every ware, the Helper pool and privates while enabled', () => {
    const world = createWorld(makeFlatMap(24, 24, 4, 4), { seed: 1, players: 2 });
    expect(warehouseTotals(world, 0).gold).toBe(0);
    applyCommand(world, { type: 'cheatUnlimited', player: 0, enabled: true });
    tickWorld(world);
    const totals = warehouseTotals(world, 0);
    expect(totals.gold).toBe(CHEAT_STOCK_FLOOR);
    expect(totals.plank).toBeGreaterThanOrEqual(CHEAT_STOCK_FLOOR);
    expect(world.players[0]!.workers.carrier).toBeGreaterThanOrEqual(CHEAT_HELPER_FLOOR);
    expect(world.players[0]!.soldiers[0]).toBeGreaterThanOrEqual(30);
    // Only the cheating player is affected.
    expect(warehouseTotals(world, 1).gold).toBe(0);
    // Off again: nothing is taken away, and no more top-ups happen.
    applyCommand(world, { type: 'cheatUnlimited', player: 0, enabled: false });
    tickWorld(world);
    expect(world.players[0]!.cheatUnlimited).toBe(false);
    expect(warehouseTotals(world, 0).gold).toBe(CHEAT_STOCK_FLOOR);
  });

  it('instant build finishes every site the moment it is placed', () => {
    const world = createWorld(makeFlatMap(24, 24, 4, 4), { seed: 1, players: 1 });
    const geom = worldGeometry(world);
    const hq = world.buildings.items.find((b) => b?.type === 'headquarters')!;
    const site = geom.index(geom.x(hq.node) + 3, geom.y(hq.node));
    applyCommand(world, { type: 'cheatInstantBuild', player: 0, enabled: true });
    applyCommand(world, {
      type: 'placeBuilding',
      player: 0,
      node: site,
      buildingType: 'woodcutter',
    });
    tickWorld(world); // commands apply
    tickWorld(world); // cheat completes the site
    const wc = world.buildings.items.find((b) => b?.type === 'woodcutter');
    expect(wc?.state).toBe('working');
    expect(world.players[0]!.cheatInstantBuild).toBe(true);
  });

  it('survives save/load and migrates older saves to off', () => {
    const world = createWorld(makeFlatMap(24, 24, 4, 4), { seed: 1, players: 1 });
    applyCommand(world, { type: 'cheatUnlimited', player: 0, enabled: true });
    tickWorld(world);
    expect(deserializeWorld(serializeWorld(world)).players[0]!.cheatUnlimited).toBe(true);
    const legacy = JSON.parse(serializeWorld(world)) as {
      version: number;
      players: ({ cheatUnlimited?: boolean } | null)[];
    };
    legacy.version = 5; // the last version without the field
    for (const p of legacy.players) if (p) delete p.cheatUnlimited;
    expect(deserializeWorld(JSON.stringify(legacy)).players[0]!.cheatUnlimited).toBe(false);
  });
});
