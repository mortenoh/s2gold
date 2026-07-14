import { describe, expect, it } from 'vitest';
import { RESOURCE, createWorld, hashWorld, tickWorld, worldGeometry, type World } from './index';
import { makeFlatMap } from './harness';
import {
  claimArea,
  connectBuildings,
  connectToHq,
  grantWarehouse,
  paintMountain,
  setResource,
  spawnBuilding,
} from './harness-economy';

type Geom = ReturnType<typeof worldGeometry>;

/** Place a working building at `node` and wire its flag to the HQ (food/material). */
function addWired(world: World, geom: Geom, node: number, type: string): number {
  const b = spawnBuilding(world, geom, node, type, 0, false);
  connectToHq(world, geom, node);
  return b.id;
}

/** Paint a small mountain patch (a node + its neighbours) and set its resource. */
function mountainResource(world: World, geom: Geom, node: number, res: number): void {
  for (const d of geom.neighbours(node)) paintMountain(world, d);
  paintMountain(world, node);
  setResource(world, node, res, 15);
}

describe('bread chain (farm -> mill -> bakery)', () => {
  it('sows and harvests grain, mills flour, and bakes bread', () => {
    const world = createWorld(makeFlatMap(30, 30, 3, 15), { seed: 7, players: 1 });
    const geom = worldGeometry(world);
    claimArea(world, geom, 1, 8, 20, 22); // own the land the chain and its roads span
    addWired(world, geom, geom.index(14, 15), 'farm');
    addWired(world, geom, geom.index(10, 10), 'well');
    addWired(world, geom, geom.index(10, 20), 'mill');
    addWired(world, geom, geom.index(18, 12), 'bakery');
    tickWorld(world); // execute the road commands

    const counts = { harvested: 0, flour: 0, bread: 0, planted: 0 };
    for (let i = 0; i < 22000; i++) {
      for (const e of tickWorld(world)) {
        if (e.type === 'CropPlanted') counts.planted++;
        else if (e.type === 'CropHarvested') counts.harvested++;
        else if (e.type === 'WareProduced' && e.wareType === 'flour') counts.flour++;
        else if (e.type === 'WareProduced' && e.wareType === 'bread') counts.bread++;
      }
      if (counts.bread > 0) break;
    }

    expect(counts.planted).toBeGreaterThan(0);
    expect(counts.harvested).toBeGreaterThan(0);
    expect(counts.flour).toBeGreaterThan(0);
    expect(counts.bread).toBeGreaterThan(0);
  }, 120000);
});

/**
 * Coin pipeline on a synthetic map: a gold mine and a coal mine feed a mint over
 * direct roads (mine ore -> consumer), with the HQ supplying mine food. Compact
 * layout so a single carrier per road keeps the ore/food flowing.
 */
function buildCoinPipeline(seed: number): World {
  const world = createWorld(makeFlatMap(30, 30, 4, 10), { seed, players: 1 });
  const geom = worldGeometry(world);
  const gold = geom.index(8, 6);
  const coal = geom.index(11, 6);
  const mint = geom.index(9, 11);
  mountainResource(world, geom, gold, RESOURCE.gold);
  mountainResource(world, geom, coal, RESOURCE.coal);
  grantWarehouse(world, 0, { fish: 400 }); // mine food
  spawnBuilding(world, geom, gold, 'goldmine', 0, false);
  spawnBuilding(world, geom, coal, 'coalmine', 0, false);
  spawnBuilding(world, geom, mint, 'mint', 0, false);
  connectToHq(world, geom, gold);
  connectToHq(world, geom, coal);
  connectBuildings(world, geom, gold, mint); // gold -> mint
  connectBuildings(world, geom, coal, mint); // coal -> mint
  tickWorld(world);
  return world;
}

/**
 * Weapon chain: iron mine + two coal mines feed an iron smelter and armory over
 * direct roads (ore -> smelter -> armory; coal -> smelter + armory), HQ supplies
 * mine food.
 */
function buildIronChain(seed: number): World {
  const world = createWorld(makeFlatMap(32, 32, 4, 12), { seed, players: 1 });
  const geom = worldGeometry(world);
  claimArea(world, geom, 2, 4, 16, 14); // own the land the chain and its roads span
  const iron = geom.index(8, 6);
  const coal1 = geom.index(11, 6);
  const coal2 = geom.index(14, 6);
  const smelter = geom.index(9, 12);
  const armory = geom.index(14, 12);
  mountainResource(world, geom, iron, RESOURCE.iron);
  mountainResource(world, geom, coal1, RESOURCE.coal);
  mountainResource(world, geom, coal2, RESOURCE.coal);
  grantWarehouse(world, 0, { fish: 500 });
  spawnBuilding(world, geom, iron, 'ironmine', 0, false);
  spawnBuilding(world, geom, coal1, 'coalmine', 0, false);
  spawnBuilding(world, geom, coal2, 'coalmine', 0, false);
  spawnBuilding(world, geom, smelter, 'ironsmelter', 0, false);
  spawnBuilding(world, geom, armory, 'armory', 0, false);
  connectToHq(world, geom, iron);
  connectToHq(world, geom, coal1);
  connectToHq(world, geom, coal2);
  connectBuildings(world, geom, iron, smelter);
  connectBuildings(world, geom, coal1, smelter);
  connectBuildings(world, geom, smelter, armory);
  connectBuildings(world, geom, coal2, armory);
  tickWorld(world);
  return world;
}

describe('mine chain (coalmine + ironmine -> smelter -> armory)', () => {
  it('mines ore, smelts iron, and forges alternating weapons', () => {
    const world = buildIronChain(11);
    const counts = { ore: 0, iron: 0, sword: 0, shield: 0 };
    for (let i = 0; i < 45000; i++) {
      for (const e of tickWorld(world)) {
        if (e.type !== 'WareProduced') continue;
        if (e.wareType === 'ironore' || e.wareType === 'coal') counts.ore++;
        else if (e.wareType === 'iron') counts.iron++;
        else if (e.wareType === 'sword') counts.sword++;
        else if (e.wareType === 'shield') counts.shield++;
      }
      if (counts.sword > 0 && counts.shield > 0) break;
    }
    expect(counts.ore).toBeGreaterThan(0);
    expect(counts.iron).toBeGreaterThan(0);
    // The armory alternates Sword/Shield (CONSTANTS.md §5).
    expect(counts.sword).toBeGreaterThan(0);
    expect(counts.shield).toBeGreaterThan(0);
  }, 180000);
});

describe('long-run integration: full pipeline produces coins', () => {
  it('mints a coin from mines over 10k+ ticks on a flat-map harness', () => {
    const world = buildCoinPipeline(23);
    let coins = 0;
    let firstCoinTick = -1;
    for (let i = 0; i < 30000; i++) {
      for (const e of tickWorld(world)) {
        if (e.type === 'WareProduced' && e.wareType === 'coins') {
          coins++;
          if (firstCoinTick < 0) firstCoinTick = world.tick;
        }
      }
      if (coins > 0 && world.tick > 10000) break;
    }
    console.log(`long-run: first coin minted at tick ${firstCoinTick}, coins so far=${coins}`);
    expect(world.tick).toBeGreaterThan(10000);
    expect(coins).toBeGreaterThan(0);
  }, 180000);
});

describe('economy determinism', () => {
  it('produces identical hashes across two runs of the coin economy', () => {
    const a = buildCoinPipeline(99);
    const b = buildCoinPipeline(99);
    const hashesA: string[] = [];
    const hashesB: string[] = [];
    for (let i = 1; i <= 6000; i++) {
      tickWorld(a);
      tickWorld(b);
      if (i % 1500 === 0) {
        hashesA.push(hashWorld(a));
        hashesB.push(hashWorld(b));
      }
    }
    expect(hashesA).toEqual(hashesB);
    expect(new Set(hashesA).size).toBeGreaterThan(1);
  }, 120000);
});
