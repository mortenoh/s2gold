import { describe, expect, it } from 'vitest';
import { createWorld } from './world';
import { deserializeWorld, serializeWorld } from './serialize';
import { tickWorld } from './index';
import { makeFlatMap } from './harness';

describe('deserializeWorld back-patches post-v1 fields', () => {
  it('loads a version=1 save missing ships/expeditions/signs and ticks without throwing', () => {
    const world = createWorld(makeFlatMap(16, 16), { seed: 1, players: 1 });
    const raw = JSON.parse(serializeWorld(world)) as Record<string, unknown>;
    // Simulate a save written before these fields existed (they were added
    // while the format was still version 1).
    raw.version = 1;
    delete raw.ships;
    delete raw.expeditions;
    delete raw.signs;
    const loaded = deserializeWorld(JSON.stringify(raw));

    expect(loaded.ships).toEqual({ items: [], free: [] });
    expect(loaded.expeditions).toEqual([]);
    expect(loaded.signs).toEqual([]);
    expect(() => tickWorld(loaded)).not.toThrow();
  });
});
