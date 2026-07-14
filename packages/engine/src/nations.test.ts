import { describe, expect, it } from 'vitest';
import { createWorld, hashWorld, deserializeWorld, serializeWorld, tickWorld } from './index';
import { makeFlatMap } from './harness';
import type { Nation } from './index';

describe('per-player nations', () => {
  it('defaults every player to romans when no nations are given', () => {
    const world = createWorld(makeFlatMap(32, 32, 3, 3), { seed: 1, players: 3 });
    expect(world.players.map((p) => p.nation)).toEqual(['romans', 'romans', 'romans']);
  });

  it('assigns nations by player slot, defaulting short/omitted slots to romans', () => {
    const nations: Nation[] = ['vikings', 'nubians'];
    const world = createWorld(makeFlatMap(32, 32, 3, 3), { seed: 1, players: 3, nations });
    // Slots 0/1 explicit; slot 2 (short) falls back to romans.
    expect(world.players.map((p) => p.nation)).toEqual(['vikings', 'nubians', 'romans']);
  });

  it('nations are cosmetic: identical seed + nations vs. all-Roman diverge only on the label', () => {
    const roman = createWorld(makeFlatMap(24, 24, 2, 2), { seed: 5, players: 2 });
    const mixed = createWorld(makeFlatMap(24, 24, 2, 2), {
      seed: 5,
      players: 2,
      nations: ['romans', 'japanese'],
    });
    // Only player 1's nation label differs; everything else about the seeded
    // world is byte-identical (the field feeds no simulation branch).
    mixed.players[1].nation = 'romans';
    expect(hashWorld(mixed)).toBe(hashWorld(roman));
  });

  it('runs twice deterministically with mixed nations', () => {
    const opts = { seed: 4242, players: 3, nations: ['romans', 'vikings', 'nubians'] as Nation[] };
    const a = createWorld(makeFlatMap(40, 40, 5, 5), opts);
    const b = createWorld(makeFlatMap(40, 40, 5, 5), opts);
    const hashesA: string[] = [];
    const hashesB: string[] = [];
    for (let i = 1; i <= 1000; i++) {
      tickWorld(a);
      tickWorld(b);
      if (i % 250 === 0) {
        hashesA.push(hashWorld(a));
        hashesB.push(hashWorld(b));
      }
    }
    expect(hashesA).toEqual(hashesB);
  });

  it('serializes the nation and survives a round-trip', () => {
    const world = createWorld(makeFlatMap(24, 24, 2, 2), {
      seed: 9,
      players: 2,
      nations: ['nubians', 'japanese'],
    });
    const revived = deserializeWorld(serializeWorld(world));
    expect(revived.players.map((p) => p.nation)).toEqual(['nubians', 'japanese']);
  });

  it('migrates a v3 save (no nation field) to v4 defaulting nation=romans', () => {
    const world = createWorld(makeFlatMap(24, 24, 2, 2), {
      seed: 3,
      players: 2,
      nations: ['vikings', 'nubians'],
    });
    // Rewrite into a v3 shape: bump down and strip the nation the schema added.
    const raw = JSON.parse(serializeWorld(world)) as Record<string, unknown>;
    raw.version = 3;
    for (const p of raw.players as Record<string, unknown>[]) delete p.nation;

    const revived = deserializeWorld(JSON.stringify(raw));
    expect(revived.version).toBe(4);
    // A v3 save predates nations, so it was an all-Roman game.
    expect(revived.players.map((p) => p.nation)).toEqual(['romans', 'romans']);
    expect(() => tickWorld(revived)).not.toThrow();
  });
});
