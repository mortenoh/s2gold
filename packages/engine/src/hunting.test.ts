import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  createWorld,
  deserializeWorld,
  hashWorld,
  serializeWorld,
  tickWorld,
  worldGeometry,
  WORLD_VERSION,
} from './index';
import { makeFlatMap } from './harness';
import { connectToHq, spawnBuilding } from './harness-economy';
import { spawnSettler } from './systems/movement';
import { storeLive } from './world';

function setup(species = [3], recruit = false) {
  const map = makeFlatMap(32, 32, 10, 10);
  map.animals = species.map((species) => ({ species, x: 15, y: 10 }));
  const world = createWorld(map, { seed: 17, players: 1 });
  const geom = worldGeometry(world);
  const hut = spawnBuilding(world, geom, geom.index(12, 10), 'hunter', 0, !recruit);
  if (recruit) expect(connectToHq(world, geom, hut.node)).not.toBeNull();
  else {
    const worker = spawnSettler(world, 'hunter', 0, hut.node);
    worker.homeBuildingId = hut.id;
    hut.workerId = worker.id;
  }
  for (const a of storeLive(world.animals)) a.timer = 1000;
  return { world, geom, hut };
}

function advance(world: ReturnType<typeof createWorld>, ticks: number): number {
  let meat = 0;
  for (let i = 0; i < ticks; i++)
    for (const e of tickWorld(world))
      if (e.type === 'WareProduced' && e.wareType === 'meat') meat++;
  return meat;
}

describe('finite wildlife hunting', () => {
  it('recruits over a road, hunts outdoors, and produces exactly one meat after returning', () => {
    const { world, hut } = setup([3], true);
    let sawOutdoorWork = false;
    let produced = 0;
    for (let i = 0; i < 4000; i++) {
      for (const e of tickWorld(world))
        if (e.type === 'WareProduced' && e.wareType === 'meat') {
          produced++;
          expect(world.settlers.items[hut.workerId]?.node).toBe(hut.node);
        }
      const worker = world.settlers.items[hut.workerId];
      if (worker?.state === 'working' && worker.node !== hut.node) sawOutdoorWork = true;
    }
    expect(sawOutdoorWork).toBe(true);
    expect(produced).toBe(1);
    expect(storeLive(world.animals)).toHaveLength(0);
  });

  it('does not manufacture meat without prey or hunt ducks and pack donkeys', () => {
    for (const species of [[], [5], [8], [9]]) {
      const { world } = setup(species);
      expect(advance(world, 1600)).toBe(0);
    }
  });

  it('does not hunt an animal across impassable water', () => {
    const { world, geom } = setup();
    for (const node of [geom.index(15, 10), ...geom.neighbours(geom.index(15, 10))]) {
      world.terrain1[node] = world.terrain2[node] = 5;
    }
    expect(advance(world, 1200)).toBe(0);
    expect(storeLive(world.animals)).toHaveLength(1);
  });

  it('reserves one animal for one of two hunters and releases it on demolition', () => {
    const { world, geom, hut } = setup();
    const other = spawnBuilding(world, geom, geom.index(12, 13), 'hunter', 0, true);
    const worker = spawnSettler(world, 'hunter', 0, other.node);
    worker.homeBuildingId = other.id;
    other.workerId = worker.id;
    tickWorld(world);
    expect(storeLive(world.animals)[0].hunterId).toBe(hut.workerId);
    applyCommand(world, { player: 0, type: 'demolish', node: hut.node });
    tickWorld(world);
    expect(storeLive(world.animals)[0].hunterId).not.toBe(hut.workerId);
    expect(advance(world, 4000)).toBe(1);
  });

  it('finishes an active hunt after stop, then waits before hunting the second animal', () => {
    const { world, hut } = setup([3, 4]);
    tickWorld(world);
    applyCommand(world, { player: 0, type: 'toggleProduction', buildingId: hut.id, stopped: true });
    expect(advance(world, 2500)).toBe(1);
    expect(storeLive(world.animals)).toHaveLength(1);
    applyCommand(world, {
      player: 0,
      type: 'toggleProduction',
      buildingId: hut.id,
      stopped: false,
    });
    expect(advance(world, 4000)).toBe(1);
  });

  it('replays identically after saving during a hunt and during roaming', () => {
    const { world } = setup([1, 2, 3]);
    advance(world, 120);
    const loaded = deserializeWorld(serializeWorld(world));
    advance(world, 3500);
    advance(loaded, 3500);
    expect(hashWorld(loaded)).toBe(hashWorld(world));
  });

  it('loads v7 saves with an empty animal store instead of repopulating the map', () => {
    const legacy = JSON.parse(serializeWorld(setup().world));
    legacy.version = 7;
    delete legacy.animals;
    const loaded = deserializeWorld(JSON.stringify(legacy));
    expect(loaded.version).toBe(WORLD_VERSION);
    expect(loaded.animals).toEqual({ items: [], free: [] });
    expect(() => advance(loaded, 10)).not.toThrow();
  });
});
