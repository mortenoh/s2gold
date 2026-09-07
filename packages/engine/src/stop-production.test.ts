/**
 * Building window "stop production": a stopped workshop finishes its cycle,
 * then neither produces nor requests input wares until resumed; the toggle
 * survives save/load and older saves migrate to "running".
 */

import { describe, expect, it } from 'vitest';

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
import { WORLD_VERSION } from './world';

function planksMade(world: ReturnType<typeof createWorld>, ticks: number): number {
  let n = 0;
  for (let i = 0; i < ticks; i++) {
    for (const e of tickWorld(world)) if (e.type === 'WareProduced' && e.wareType === 'plank') n++;
  }
  return n;
}

describe('stop production', () => {
  it('halts a sawmill and its trunk demand, then resumes', () => {
    const world = createWorld(makeFlatMap(32, 32, 4, 16), { seed: 1, players: 1 });
    const geom = worldGeometry(world);
    claimArea(world, geom, 2, 10, 16, 22);
    const saw = spawnBuilding(world, geom, geom.index(14, 12), 'sawmill', 0, true);
    expect(connectToHq(world, geom, saw.node)).not.toBeNull();
    tickWorld(world);
    grantWarehouse(world, 0, { trunk: 40 });

    expect(planksMade(world, 3000)).toBeGreaterThan(0);

    applyCommand(world, { type: 'toggleProduction', player: 0, buildingId: saw.id, stopped: true });
    // Let the cycle in flight finish and the queue drain.
    planksMade(world, 1500);
    expect(world.buildings.items[saw.id]?.productionStopped).toBe(true);
    const stockAtStop = world.buildings.items[saw.id]?.inputStock[0] ?? 0;
    expect(planksMade(world, 3000)).toBe(0);
    // No trunks are delivered to a stopped building either.
    expect(world.buildings.items[saw.id]?.inputStock[0] ?? 0).toBeLessThanOrEqual(stockAtStop);

    applyCommand(world, {
      type: 'toggleProduction',
      player: 0,
      buildingId: saw.id,
      stopped: false,
    });
    expect(planksMade(world, 3000)).toBeGreaterThan(0);
  });

  it('is ignored for warehouses and military buildings', () => {
    const world = createWorld(makeFlatMap(32, 32, 4, 16), { seed: 1, players: 1 });
    const hq = world.buildings.items.find((b) => b?.type === 'headquarters');
    expect(hq).toBeTruthy();
    applyCommand(world, { type: 'toggleProduction', player: 0, buildingId: hq!.id, stopped: true });
    tickWorld(world);
    expect(hq!.productionStopped).toBe(false);
  });

  it('round-trips through save/load and migrates older saves', () => {
    const world = createWorld(makeFlatMap(32, 32, 4, 16), { seed: 1, players: 1 });
    const geom = worldGeometry(world);
    claimArea(world, geom, 2, 10, 16, 22);
    const saw = spawnBuilding(world, geom, geom.index(14, 12), 'sawmill', 0, true);
    applyCommand(world, { type: 'toggleProduction', player: 0, buildingId: saw.id, stopped: true });
    tickWorld(world); // commands apply on the next tick
    const loaded = deserializeWorld(serializeWorld(world));
    expect(loaded.buildings.items[saw.id]?.productionStopped).toBe(true);

    // A v4 save (no field) loads with every building running.
    const legacy = JSON.parse(serializeWorld(world)) as {
      version: number;
      buildings: { items: ({ productionStopped?: boolean } | null)[] };
    };
    legacy.version = WORLD_VERSION - 1;
    for (const b of legacy.buildings.items) if (b) delete b.productionStopped;
    const migrated = deserializeWorld(JSON.stringify(legacy));
    expect(migrated.buildings.items[saw.id]?.productionStopped).toBe(false);
  });
});
