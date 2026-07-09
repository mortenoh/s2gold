import { describe, expect, it } from 'vitest';
import {
  BUILDING_DEFS,
  BUILD_COST,
  JOB_TYPES,
  RESOURCE,
  WARE_TYPES,
  buildingInventory,
  createWorld,
  makeResource,
  playerInventory,
  resourceAmount,
  resourceType,
  tickWorld,
  worldGeometry,
  applyCommand,
  type GameEvent,
} from './index';
import { makeFlatMap } from './harness';
import { connectToHq, setResource, spawnBuilding } from './harness-economy';

/** Run `n` ticks, collecting every emitted event. */
function runTicks(world: ReturnType<typeof createWorld>, n: number): GameEvent[] {
  const all: GameEvent[] = [];
  for (let i = 0; i < n; i++) all.push(...tickWorld(world));
  return all;
}

describe('BUILDING_DEFS table', () => {
  it('is internally consistent (jobs, wares, costs, mine resources)', () => {
    const wares = new Set(WARE_TYPES);
    const jobs = new Set(JOB_TYPES);
    for (const [name, def] of Object.entries(BUILDING_DEFS)) {
      // Cost matches the derived BUILD_COST map.
      expect(BUILD_COST[name]).toEqual(def.cost);
      // Worker (when present) is a known job.
      if (def.worker) expect(jobs.has(def.worker)).toBe(true);
      // Inputs and outputs are known wares.
      for (const w of def.inputs) expect(wares.has(w)).toBe(true);
      for (const w of def.outputs) expect(wares.has(w)).toBe(true);
      // Mines declare a resource nibble and hold 2 of each food.
      if (def.kind === 'mine') {
        expect(def.resource).toBeGreaterThan(0);
        expect(def.inputCap).toBe(2);
        expect(def.useOneEach).toBe(false);
      }
    }
    // The full economy is present.
    expect(Object.keys(BUILDING_DEFS).length).toBeGreaterThanOrEqual(25);
  });
});

describe('resource layer encoding (original S2 WLD ranges)', () => {
  it('round-trips type + amount and clamps the amount to 0..7', () => {
    const b = makeResource(RESOURCE.gold, 7);
    expect(resourceType(b)).toBe(RESOURCE.gold);
    expect(resourceAmount(b)).toBe(7);
    // Amount is the low 3 bits (0..7), matching the 8-wide S2 resource ranges.
    expect(resourceAmount(makeResource(RESOURCE.coal, 20))).toBe(7);
    expect(resourceAmount(makeResource(RESOURCE.coal, -3))).toBe(0);
  });

  it('decodes the raw S2 resource byte ranges', () => {
    expect(resourceType(0x47)).toBe(RESOURCE.coal); // 0x40-0x47 coal
    expect(resourceType(0x4e)).toBe(RESOURCE.iron); // 0x48-0x4F iron
    expect(resourceAmount(0x4e)).toBe(6);
    expect(resourceType(0x54)).toBe(RESOURCE.gold); // 0x50-0x57 gold
    expect(resourceType(0x5d)).toBe(RESOURCE.granite); // 0x58-0x5F granite
    expect(resourceType(0x21)).toBe(RESOURCE.fish); // 0x20-0x27 fish
    expect(resourceType(0x87)).toBe(RESOURCE.water); // singleton
    expect(resourceType(0x00)).toBe(RESOURCE.none);
  });
});

describe('mine food consumption + resource depletion (CONSTANTS.md §5)', () => {
  it('consumes one food, decrements the subsurface resource, and yields ore', () => {
    const world = createWorld(makeFlatMap(24, 24, 4, 4), { seed: 1, players: 1 });
    const geom = worldGeometry(world);
    const mineNode = geom.index(12, 12);
    setResource(world, mineNode, RESOURCE.coal, 5); // within radius 0 of the mine
    const mine = spawnBuilding(world, geom, mineNode, 'coalmine', 0, true);
    mine.inputStock = [2, 0, 0]; // 2 fish stocked (Fish/Meat/Bread order)

    const events = runTicks(world, 620); // > one 583-GF cycle
    const produced = events.filter((e) => e.type === 'WareProduced' && e.wareType === 'coal').length;
    const started = events.filter((e) => e.type === 'WorkStarted' && e.kind === 'mining').length;

    expect(started).toBeGreaterThanOrEqual(1);
    expect(produced).toBeGreaterThanOrEqual(1);
    // Food was consumed and the resource amount dropped.
    expect(mine.inputStock[0]).toBeLessThan(2);
    expect(resourceAmount(world.resource[mineNode])).toBeLessThan(5);
    expect(resourceType(world.resource[mineNode])).toBe(RESOURCE.coal);
  });

  it('idles and reports depletion when no matching resource is in range', () => {
    const world = createWorld(makeFlatMap(24, 24, 4, 4), { seed: 1, players: 1 });
    const geom = worldGeometry(world);
    const mineNode = geom.index(12, 12);
    // No resource painted at all -> nothing to mine.
    const mine = spawnBuilding(world, geom, mineNode, 'ironmine', 0, true);
    mine.inputStock = [2, 0, 0];
    const events = runTicks(world, 200);
    expect(events.some((e) => e.type === 'MineDepleted')).toBe(true);
    // Food is NOT consumed while depleted.
    expect(mine.inputStock[0]).toBe(2);
  });
});

describe('mint produces coins (CONSTANTS.md §5)', () => {
  it('turns gold + coal into a coin', () => {
    const world = createWorld(makeFlatMap(24, 24, 4, 4), { seed: 1, players: 1 });
    const geom = worldGeometry(world);
    const mint = spawnBuilding(world, geom, geom.index(12, 12), 'mint', 0, true);
    mint.inputStock = [3, 3]; // gold, coal

    const events = runTicks(world, 1100); // > one 1050-GF cycle
    expect(events.some((e) => e.type === 'WareProduced' && e.wareType === 'coins')).toBe(true);
    expect(mint.inputStock[0]).toBeLessThan(3); // gold consumed
    expect(mint.inputStock[1]).toBeLessThan(3); // coal consumed
  });
});

describe('metalworks tool production is tool-priority driven (CONSTANTS.md §7)', () => {
  it('produces the configured tool from iron + boards', () => {
    const world = createWorld(makeFlatMap(24, 24, 4, 4), { seed: 1, players: 1 });
    const geom = worldGeometry(world);
    const mw = spawnBuilding(world, geom, geom.index(12, 12), 'metalworks', 0, true);
    mw.inputStock = [2, 2]; // iron, boards
    applyCommand(world, { player: 0, type: 'setToolPriority', tools: ['axe'] });

    const events = runTicks(world, 900); // > one 850-GF cycle
    expect(events.some((e) => e.type === 'WareProduced' && e.wareType === 'axe')).toBe(true);
  });
});

describe('new-settler recruitment (Helper + tool -> worker, CONSTANTS.md §7)', () => {
  it('recruits a farmer from a Helper + Scythe when the pool is empty', () => {
    const world = createWorld(makeFlatMap(24, 24, 4, 4), { seed: 1, players: 1 });
    const geom = worldGeometry(world);
    const p = world.players[0];
    expect(p.workers.farmer).toBe(0); // no farmers to start (Normal preset)
    const scytheBefore = p.wares.scythe;
    const helperBefore = p.workers.carrier;
    expect(scytheBefore).toBeGreaterThan(0);

    // A farm with no farmer must recruit one.
    spawnBuilding(world, geom, geom.index(12, 12), 'farm', 0, false);
    const events = runTicks(world, 60);

    const recruited = events.filter(
      (e) => e.type === 'SettlerRecruited' && e.job === 'farmer',
    );
    expect(recruited.length).toBe(1);
    expect(p.wares.scythe).toBe(scytheBefore - 1); // tool consumed
    expect(p.workers.carrier).toBe(helperBefore - 1); // Helper consumed
  });
});

describe('distribution fairness (CONSTANTS.md §3-4)', () => {
  it('spreads a shared ware evenly across equal consumers', () => {
    const world = createWorld(makeFlatMap(32, 32, 4, 16), { seed: 1, players: 1 });
    const geom = worldGeometry(world);
    // Two sawmills, both consuming trunks, wired to the HQ.
    const sawA = spawnBuilding(world, geom, geom.index(14, 12), 'sawmill', 0, true);
    const sawB = spawnBuilding(world, geom, geom.index(14, 20), 'sawmill', 0, true);
    expect(connectToHq(world, geom, sawA.node)).not.toBeNull();
    expect(connectToHq(world, geom, sawB.node)).not.toBeNull();
    tickWorld(world); // execute the road commands
    world.players[0].wares.trunk = 16; // known shared stock

    let toA = 0;
    let toB = 0;
    for (let i = 0; i < 3000; i++) {
      for (const e of tickWorld(world)) {
        if (e.type === 'WareDelivered' && e.wareType === 'trunk') {
          if (e.buildingId === sawA.id) toA++;
          else if (e.buildingId === sawB.id) toB++;
        }
      }
    }
    expect(toA).toBeGreaterThanOrEqual(3);
    expect(toB).toBeGreaterThanOrEqual(3);
    expect(Math.abs(toA - toB)).toBeLessThanOrEqual(2);
  });
});

describe('economy view helpers', () => {
  it('exposes building input inventory and player pools', () => {
    const world = createWorld(makeFlatMap(20, 20, 3, 3), { seed: 1, players: 1 });
    const geom = worldGeometry(world);
    const bakery = spawnBuilding(world, geom, geom.index(10, 10), 'bakery', 0, true);
    bakery.inputStock = [2, 1];
    const view = buildingInventory(world, bakery.id);
    expect(view?.inputs.map((s) => s.ware)).toEqual(['flour', 'water']);
    expect(view?.inputs[0].count).toBe(2);
    expect(view?.inputs[0].cap).toBe(6);

    const pv = playerInventory(world, 0);
    expect(pv?.wares.plank).toBe(44);
    expect(pv?.donkeys).toBe(0);
    expect(pv?.toolPriority.length).toBe(12);
  });
});
