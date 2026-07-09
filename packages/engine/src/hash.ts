/**
 * FNV-1a hashing for the determinism gate.
 *
 * A 32-bit FNV-1a over the canonical serialization gives a compact,
 * platform-independent fingerprint of world state. Used by tests to assert that
 * identical seed + commands produce identical state after N ticks.
 */

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** 32-bit FNV-1a of a string, returned as 8 lowercase hex digits. */
export function fnv1a(input: string): string {
  let hash = FNV_OFFSET >>> 0;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    // Fold UTF-16 code unit into two bytes so all characters contribute.
    hash ^= code & 0xff;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
    hash ^= (code >> 8) & 0xff;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
