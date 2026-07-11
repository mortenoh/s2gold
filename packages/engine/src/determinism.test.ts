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
