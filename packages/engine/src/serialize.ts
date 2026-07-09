/**
 * Versioned, canonical world serialization.
 *
 * The World is already plain integer data (typed via interfaces, never classes
 * with hidden state), so JSON is a faithful, deterministic representation: every
 * object is constructed with a fixed key order, so `JSON.stringify` output is
 * stable across runs and a parse/stringify round-trip reproduces it exactly.
 */

import { fnv1a } from './hash';
import { WORLD_VERSION, type World } from './world';

/** Serialize a world to a canonical JSON string. */
export function serializeWorld(world: World): string {
  return JSON.stringify(world);
}

/** Parse a serialized world, checking the format version. */
export function deserializeWorld(data: string): World {
  const parsed = JSON.parse(data) as World;
  if (parsed.version !== WORLD_VERSION) {
    throw new Error(`unsupported world version ${parsed.version} (expected ${WORLD_VERSION})`);
  }
  return parsed;
}

/** FNV-1a fingerprint of the canonical world serialization. */
export function hashWorld(world: World): string {
  return fnv1a(serializeWorld(world));
}
