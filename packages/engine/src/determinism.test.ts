import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deserializeWorld, hashWorld, serializeWorld, tickWorld, type MapJson } from './index';
import { makeFlatMap, setupDemoWorld } from './harness';

const MAP_PATH = resolve(__dirname, '../../app/public/assets/maps/maps_miss200.json');

// Prefer a real converted map for richer terrain coverage, but never skip:
// without assets (CI) the synthetic flat map still exercises the full
// construction/carrier/dispatch pipeline these gates depend on.
function loadMap(): MapJson {
  try {
    return JSON.parse(readFileSync(MAP_PATH, 'utf8')) as MapJson;
  } catch {
    return makeFlatMap(64, 64, 10, 10);
  }
}

const map = loadMap();

describe('determinism', () => {
  it('produces identical state hashes for identical seed + commands', () => {
    const hashesA: string[] = [];
    const hashesB: string[] = [];
    const { world: a } = setupDemoWorld(map, 12345);
    const { world: b } = setupDemoWorld(map, 12345);
    for (let i = 1; i <= 2000; i++) {
      tickWorld(a);
      tickWorld(b);
      if (i % 500 === 0) {
        hashesA.push(hashWorld(a));
        hashesB.push(hashWorld(b));
      }
    }
    expect(hashesA).toEqual(hashesB);
    // Sanity: the simulation actually changed state (not all-equal frozen world).
    expect(new Set(hashesA).size).toBeGreaterThan(1);
  });

  it('survives a serialize/deserialize round-trip mid-run', () => {
    const { world: full } = setupDemoWorld(map, 777);
    for (let i = 0; i < 2000; i++) tickWorld(full);
    const finalHash = hashWorld(full);

    const { world: split } = setupDemoWorld(map, 777);
    for (let i = 0; i < 1000; i++) tickWorld(split);
    const revived = deserializeWorld(serializeWorld(split));
    for (let i = 0; i < 1000; i++) tickWorld(revived);

    expect(hashWorld(revived)).toBe(finalHash);
  });
});

describe('save migrations', () => {
  it('migrates a true v1 save (no military/seafaring/donkey fields) to current', () => {
    const { world } = setupDemoWorld(makeFlatMap(32, 32, 4, 4), 99);
    for (let i = 0; i < 200; i++) tickWorld(world);
    // Strip everything v1 predates, as an old save would look.
    const raw = JSON.parse(serializeWorld(world)) as Record<string, unknown>;
    raw.version = 1;
    delete raw.ships;
    delete raw.expeditions;
    delete raw.signs;
    for (const b of (raw.buildings as { items: (Record<string, unknown> | null)[] }).items) {
      if (!b) continue;
      delete b.garrison;
      delete b.occupied;
      delete b.coinsEnabled;
      delete b.incoming;
      delete b.promotionTimer;
    }
    for (const r of (raw.roads as { items: (Record<string, unknown> | null)[] }).items) {
      if (!r) continue;
      delete r.busyGf;
      delete r.upgraded;
      delete r.donkeyId;
    }
    for (const p of raw.players as Record<string, unknown>[]) delete p.donkeys;

    const revived = deserializeWorld(JSON.stringify(raw));
    expect(revived.version).toBe(2);
    // Migrated fields exist and the world ticks without throwing (pre-fix a
    // v1 save crashed stats sampling on `for (const g of b.garrison)`).
    for (const b of revived.buildings.items) {
      if (!b) continue;
      expect(Array.isArray(b.garrison)).toBe(true);
      expect(typeof b.occupied).toBe('boolean');
      expect(typeof b.coinsEnabled).toBe('boolean');
    }
    expect(() => {
      for (let i = 0; i < 200; i++) tickWorld(revived);
    }).not.toThrow();
  });

  it('rejects a future version', () => {
    const { world } = setupDemoWorld(makeFlatMap(16, 16, 2, 2), 1);
    const raw = JSON.parse(serializeWorld(world)) as { version: number };
    raw.version = 999;
    expect(() => deserializeWorld(JSON.stringify(raw))).toThrow(/unsupported world version/);
  });
});
