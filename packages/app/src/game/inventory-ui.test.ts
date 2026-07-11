import type { MapJson } from '@s2gold/engine';
import { describe, expect, it } from 'vitest';
import { goodsEntries } from './inventory-ui';
import { GameSession } from './session';

/**
 * The Goods panel builds its grid once and, while open, patches the count cells
 * every frame from {@link GameSession.goods} via {@link goodsEntries}. Vitest
 * runs in the node env (no DOM), so we exercise that shared, pure update logic
 * directly: the numbers it produces must track live world state, which is what
 * makes the open panel refresh instead of showing an open-time snapshot.
 */

/** Minimal flat all-meadow map (buildable everywhere) for a live session. */
function makeFlatMap(width: number, height: number): MapJson {
  const size = width * height;
  const b64 = (fill: number): string =>
    Buffer.from(new Uint8Array(size).fill(fill)).toString('base64');
  return {
    title: 'flat',
    width,
    height,
    terrain: 0,
    players: 1,
    hq_x: [1, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff],
    hq_y: [1, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff],
    encoding: 'base64',
    layers: {
      texture1: b64(0x08),
      texture2: b64(0x08),
      height: b64(0),
      object_type: b64(0),
      object_index: b64(0),
      resources: b64(0),
      owner: b64(0),
    },
  };
}

const countOf = (goods: Record<string, number>, key: string): number =>
  goodsEntries(goods).find((e) => e.key === key)?.count ?? -1;

describe('goodsEntries', () => {
  it('lists every ware and defaults missing wares to zero', () => {
    const entries = goodsEntries({ trunk: 5 });
    // A representative ware from each group is present.
    for (const key of ['trunk', 'plank', 'stone', 'bread', 'sword', 'hammer']) {
      expect(entries.some((e) => e.key === key)).toBe(true);
    }
    expect(countOf({ trunk: 5 }, 'trunk')).toBe(5);
    // Wares absent from the snapshot read as 0, not undefined.
    expect(countOf({ trunk: 5 }, 'plank')).toBe(0);
    expect(entries.every((e) => Number.isInteger(e.count))).toBe(true);
  });

  it('tracks live world state so an open panel refreshes (not an open-time snapshot)', () => {
    const session = new GameSession(makeFlatMap(16, 16), 1);
    const plankBefore = countOf(session.goods, 'plank');
    const coalBefore = countOf(session.goods, 'coal');

    // Simulate the running economy delivering wares into the warehouse.
    const wares = session.world.players[0]!.wares;
    wares.plank = (wares.plank ?? 0) + 7;
    wares.coal = (wares.coal ?? 0) + 3;

    // Re-reading the live snapshot (as the per-frame update() does) reflects it.
    expect(countOf(session.goods, 'plank')).toBe(plankBefore + 7);
    expect(countOf(session.goods, 'coal')).toBe(coalBefore + 3);
  });
});
