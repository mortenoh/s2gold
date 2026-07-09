import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deserializeWorld, hashWorld, serializeWorld, tickWorld, type MapJson } from './index';
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

describe('determinism', () => {
  runIt('produces identical state hashes for identical seed + commands', () => {
    if (!map) return;
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

  runIt('survives a serialize/deserialize round-trip mid-run', () => {
    if (!map) return;
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
