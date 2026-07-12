/**
 * Versioned, canonical world serialization.
 *
 * The World is already plain integer data (typed via interfaces, never classes
 * with hidden state), so JSON is a faithful, deterministic representation: every
 * object is constructed with a fixed key order, so `JSON.stringify` output is
 * stable across runs and a parse/stringify round-trip reproduces it exactly.
 */

import { buildingDef, NUM_SOLDIER_RANKS } from './constants';
import { fnv1a } from './hash';
import { WORLD_VERSION, type World } from './world';

/** Serialize a world to a canonical JSON string. */
export function serializeWorld(world: World): string {
  return JSON.stringify(world);
}

/**
 * Per-version migrations: `MIGRATIONS[v]` upgrades a version-v world in place
 * to version v+1. Every schema change from now on bumps WORLD_VERSION and adds
 * exactly one entry here; deserializeWorld chains them, so any historical save
 * loads through the same audited path.
 */
const MIGRATIONS: Readonly<Record<number, (w: World) => void>> = {
  // v1 -> v2: everything that landed on top of frozen-v1 saves without a bump:
  // seafaring stores, geologist signs, donkey-road upgrade state, and the
  // military fields (garrison/occupied/coins/promotion), which the old ad-hoc
  // back-patch list missed entirely (loading a true v1 save crashed on
  // `for (const g of b.garrison)`).
  1: (w) => {
    w.ships ??= { items: [], free: [] };
    w.expeditions ??= [];
    w.signs ??= [];
    for (const road of w.roads?.items ?? []) {
      if (!road) continue;
      road.busyGf ??= 0;
      road.upgraded ??= false;
      road.donkeyId ??= -1;
    }
    for (const player of w.players ?? []) {
      if (player) player.donkeys ??= 0;
    }
    for (const b of w.buildings?.items ?? []) {
      if (!b) continue;
      b.garrison ??= new Array<number>(NUM_SOLDIER_RANKS).fill(0);
      // HQs are always occupied; other buildings only via their garrison.
      b.occupied ??= buildingDef(b.type)?.kind === 'hq' || b.garrison.some((n) => n > 0);
      // Coin delivery defaults on for military buildings (MILITARY.md §3).
      b.coinsEnabled ??= buildingDef(b.type)?.kind === 'military';
      b.incoming ??= 0;
      b.promotionTimer ??= -1;
    }
  },
};

/** Parse a serialized world, migrating older versions up to the current one. */
export function deserializeWorld(data: string): World {
  const parsed = JSON.parse(data) as World;
  const version = parsed.version;
  if (typeof version !== 'number' || version < 1 || version > WORLD_VERSION) {
    throw new Error(`unsupported world version ${String(version)} (expected <= ${WORLD_VERSION})`);
  }
  for (let v = version; v < WORLD_VERSION; v++) {
    MIGRATIONS[v]?.(parsed);
    parsed.version = v + 1;
  }
  return parsed;
}

/** FNV-1a fingerprint of the canonical world serialization. */
export function hashWorld(world: World): string {
  return fnv1a(serializeWorld(world));
}
