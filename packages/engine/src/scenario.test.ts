import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildingAt, tickWorld, type GameEvent, type MapJson } from './index';
import { setupDemoWorld } from './harness';

const MAP_PATH = resolve(__dirname, '../../app/public/assets/maps/maps_miss200.json');

function loadMap(): MapJson | null {
  try {
    return JSON.parse(readFileSync(MAP_PATH, 'utf8')) as MapJson;
  } catch {
    return null;
  }
}

const map = loadMap();
const runIt = map ? it : it.skip;

describe('P2 economy scenario', () => {
  runIt('runs the wood/stone/plank loop end to end', () => {
    if (!map) return;
    const { world, layout } = setupDemoWorld(map, 2024);
    const hqId = world.players[0].hqBuildingId;

    const startWares = { ...world.players[0].wares };
    const counts = {
      treeFelled: 0,
      stoneMined: 0,
      planksProduced: 0,
      trunkToSawmill: 0,
      plankToSite: 0,
      buildingsCompleted: 0,
    };

    // Budget sized for the researched (Normal-speed) timings: with 20 GF/edge
    // walking and a 479 GF sawmill cycle the first sawmill-made plank lands
    // around tick ~1400 on MISS200, so run comfortably past that.
    for (let i = 0; i < 3000; i++) {
      const events: GameEvent[] = tickWorld(world);
      for (const e of events) {
        switch (e.type) {
          case 'TreeFelled':
            counts.treeFelled++;
            break;
          case 'StoneMined':
            counts.stoneMined++;
            break;
          case 'WareProduced':
            if (e.wareType === 'plank') counts.planksProduced++;
            break;
          case 'BuildingCompleted':
            counts.buildingsCompleted++;
            break;
          case 'WareDelivered':
            if (e.wareType === 'trunk' && e.buildingId !== hqId) counts.trunkToSawmill++;
            // A plank delivered to a non-HQ building means it reached a
            // construction site (only sites and the HQ accept planks).
            if (e.wareType === 'plank' && e.buildingId !== hqId) counts.plankToSite++;
            break;
        }
      }
    }

    // Buildings placed and completed.
    expect(layout.woodcutter).toBeGreaterThanOrEqual(0);
    expect(layout.sawmill).toBeGreaterThanOrEqual(0);
    expect(layout.quarry).toBeGreaterThanOrEqual(0);
    expect(counts.buildingsCompleted).toBeGreaterThanOrEqual(3);
    expect(buildingAt(world, layout.woodcutter)?.state).toBe('working');
    expect(buildingAt(world, layout.sawmill)?.state).toBe('working');
    expect(buildingAt(world, layout.quarry)?.state).toBe('working');

    // Carriers physically occupy the roads.
    const carriersOnRoads = world.roads.items.filter((r) => r && r.carrierId >= 0).length;
    expect(carriersOnRoads).toBeGreaterThanOrEqual(3);

    // Production chain fired.
    expect(counts.treeFelled).toBeGreaterThan(0);
    expect(counts.stoneMined).toBeGreaterThan(0);
    expect(counts.trunkToSawmill).toBeGreaterThan(0);
    expect(counts.planksProduced).toBeGreaterThan(0);
    expect(counts.plankToSite).toBeGreaterThan(0);

    // Inventory moved: buildings consumed starting boards/stones, and produced
    // wares flowed back into the HQ store.
    expect(world.players[0].wares.trunk + world.players[0].wares.plank).not.toBe(
      startWares.trunk + startWares.plank,
    );
  });
});
