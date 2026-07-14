/**
 * Nation plumbing shared by the setup screen and the game boot: a compact,
 * stable URL/session encoding for per-player {@link Nation}s, plus the setup
 * screen's default assignment.
 *
 * Nations are cosmetic in S2 (see engine `world.ts`), so this module carries no
 * game logic — only the string codec that moves a slot-indexed nation list
 * across the URL query and the sessions API, and the display labels.
 */

import { NATIONS, type Nation } from '@s2gold/engine';

/** Three-letter codes used in the `?nations=` query and the sessions payload. */
export const NATION_CODES: Record<Nation, string> = {
  romans: 'rom',
  vikings: 'vik',
  nubians: 'nub',
  japanese: 'jap',
};

const CODE_TO_NATION: Record<string, Nation> = Object.fromEntries(
  NATIONS.map((n) => [NATION_CODES[n], n]),
) as Record<string, Nation>;

/** Human-readable label for the nation (title-cased people name). */
export function nationLabel(nation: Nation): string {
  return nation.charAt(0).toUpperCase() + nation.slice(1);
}

/**
 * The setup screen's default nation for the i-th opponent (0-based among the
 * enabled AI slots): vikings, nubians, japanese, wrapping. This mirrors the
 * original's habit of giving opponents varied peoples while staying fully
 * reproducible (the human is always {@link romans}). The engine itself defaults
 * everyone to Roman — this variety lives purely in the setup UI.
 */
const AI_DEFAULT_CYCLE: readonly Nation[] = ['vikings', 'nubians', 'japanese'];
export function defaultAiNation(opponentOrdinal: number): Nation {
  return AI_DEFAULT_CYCLE[opponentOrdinal % AI_DEFAULT_CYCLE.length] ?? 'vikings';
}

/** True when every entry is Roman (so the encoding can be omitted entirely). */
export function isAllRoman(nations: readonly Nation[]): boolean {
  return nations.every((n) => n === 'romans');
}

/** Encode a slot-indexed nation list to a `?nations=` value (`rom,vik,...`). */
export function encodeNations(nations: readonly Nation[]): string {
  return nations.map((n) => NATION_CODES[n]).join(',');
}

/**
 * Decode a `?nations=` value (or a sessions-payload code list) into a
 * slot-indexed nation array. Unknown or missing codes fall back to 'romans', so
 * a malformed or truncated value never throws and old URLs (no param) map to an
 * all-Roman game at the call site (an empty array).
 */
export function decodeNations(value: string | null | undefined): Nation[] {
  if (!value) return [];
  return value.split(',').map((code) => CODE_TO_NATION[code.trim()] ?? 'romans');
}
