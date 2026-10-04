import { describe, expect, it } from 'vitest';
import { createWorld, RESOURCE, type GameEvent, type MapJson } from '@s2gold/engine';

import { ATTACK_MESSAGE_COOLDOWN, POSTBOX_CAP, Postbox } from './postbox';

/** Minimal flat map; the postbox only reads the tick and building nodes. */
function flatMap(size: number): MapJson {
  const b64 = (fill: number): string =>
    Buffer.from(new Uint8Array(size * size).fill(fill)).toString('base64');
  return {
    title: 'flat',
    width: size,
    height: size,
    terrain: 0,
    players: 1,
    hq_x: [4, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff],
    hq_y: [4, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff],
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

const world = () => createWorld(flatMap(20), { seed: 1, players: 1 });

describe('Postbox', () => {
  it('keeps only news for the local player, newest first', () => {
    const w = world();
    const box = new Postbox();
    const events: GameEvent[] = [
      { type: 'MineDepleted', buildingId: 1, node: 10, player: 1 }, // not mine
      { type: 'MineDepleted', buildingId: 1, node: 11, player: 0 },
      { type: 'TreeFelled', node: 12, player: 0 }, // not news
      { type: 'ResourceFound', node: 13, res: RESOURCE.gold, player: 0 },
    ];
    for (const e of events) box.ingest(e, w, 0);
    expect(box.messages.map((m) => m.text)).toEqual([
      'Geologist found gold',
      'A mine is exhausted',
    ]);
    expect(box.messages[0].node).toBe(13);
    expect(box.unread).toBe(2);
  });

  it('only letters military and warehouse completions', () => {
    const w = world();
    const box = new Postbox();
    box.ingest(
      { type: 'BuildingCompleted', buildingId: 2, buildingType: 'woodcutter', node: 5, player: 0 },
      w,
      0,
    );
    box.ingest(
      { type: 'BuildingCompleted', buildingId: 3, buildingType: 'guardhouse', node: 6, player: 0 },
      w,
      0,
    );
    box.ingest(
      { type: 'BuildingCompleted', buildingId: 4, buildingType: 'storehouse', node: 7, player: 0 },
      w,
      0,
    );
    expect(box.messages.map((m) => m.kind)).toEqual(['finished', 'finished']);
    expect(box.messages.map((m) => m.node)).toEqual([7, 6]);
  });

  it('rate-limits "under attack" per spot', () => {
    const w = world();
    const box = new Postbox();
    const fight = (node: number): GameEvent => ({
      type: 'FightStarted',
      node,
      attackerPlayer: 1,
      attackerRank: 0,
      defenderPlayer: 0,
      defenderRank: 0,
    });
    box.ingest(fight(30), w, 0);
    box.ingest(fight(30), w, 0); // same spot, same tick: suppressed
    box.ingest(fight(31), w, 0); // another spot
    expect(box.messages).toHaveLength(2);
    w.tick += ATTACK_MESSAGE_COOLDOWN;
    box.ingest(fight(30), w, 0); // cooldown over
    expect(box.messages).toHaveLength(3);
    // A fight where we attack is not "under attack".
    box.ingest(
      { ...(fight(40) as object), attackerPlayer: 0, defenderPlayer: 1 } as GameEvent,
      w,
      0,
    );
    expect(box.messages).toHaveLength(3);
  });

  it('tells captures from losses and reports defeats', () => {
    const w = world();
    const box = new Postbox();
    const cap = (from: number, to: number, burned = false): GameEvent => ({
      type: 'BuildingCaptured',
      buildingId: 9,
      buildingType: 'guardhouse',
      node: 50,
      fromPlayer: from,
      toPlayer: to,
      burned,
    });
    box.ingest(cap(1, 0), w, 0);
    box.ingest(cap(0, 1), w, 0);
    box.ingest({ type: 'PlayerDefeated', player: 1, byPlayer: 0, node: 60 }, w, 0);
    box.ingest({ type: 'PlayerDefeated', player: 0, byPlayer: 1, node: 61 }, w, 0);
    expect(box.messages.map((m) => m.text).reverse()).toEqual([
      'Guardhouse captured',
      'Guardhouse lost',
      'Player 2 defeated',
      'Your headquarters has fallen',
    ]);
  });

  it('caps the list, marks read and round-trips through a save', () => {
    const w = world();
    const box = new Postbox();
    for (let i = 0; i < POSTBOX_CAP + 5; i++) {
      box.ingest({ type: 'MineDepleted', buildingId: 1, node: i, player: 0 }, w, 0);
    }
    expect(box.messages).toHaveLength(POSTBOX_CAP);
    expect(box.messages[0].node).toBe(POSTBOX_CAP + 4); // newest kept
    box.markRead(box.messages[0].id);
    expect(box.unread).toBe(POSTBOX_CAP - 1);

    const copy = new Postbox();
    copy.restore(JSON.parse(JSON.stringify(box.toJSON())));
    expect(copy.messages).toEqual(box.messages);
    // New letters after a restore get fresh ids.
    const added = copy.ingest({ type: 'MineDepleted', buildingId: 1, node: 999, player: 0 }, w, 0);
    expect(box.messages.some((m) => m.id === added?.id)).toBe(false);

    const empty = new Postbox();
    empty.restore(undefined); // an older save
    expect(empty.messages).toEqual([]);
  });
});
