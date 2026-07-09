/**
 * Original in-game menu strings, read from the converted text bank
 * `texts/eng/txt_ongame.json` (the OnGame string table) by their original
 * indices so the menu shows the game's own wording. Each lookup carries an
 * English fallback so the menu still reads correctly when assets are absent.
 */

import { assetUrl, fetchJson } from '../lib/manifest';

/** OnGame string indices used by the menu, with fallbacks. */
export const S = {
  title: { i: 340, fallback: 'The Settlers II Gold Edition' },
  campaign: { i: 341, fallback: 'Roman Campaign' },
  loadGame: { i: 343, fallback: 'Load game' },
  unlimited: { i: 344, fallback: 'Unlimited play' },
  unlimitedSettings: { i: 348, fallback: 'Unlimited play - Settings' },
  startGame: { i: 353, fallback: 'Start game' },
  selectionOfMaps: { i: 359, fallback: 'Selection of maps' },
  objective: { i: 384, fallback: 'Game objective' },
} as const;

let bank: string[] | null | undefined;

async function loadBank(): Promise<string[] | null> {
  if (bank !== undefined) return bank;
  const raw = await fetchJson<string[]>(assetUrl('texts/eng/txt_ongame.json'));
  bank = Array.isArray(raw) ? raw : null;
  return bank;
}

/** Resolve one string spec to its original text, or the fallback. */
export async function menuString(spec: { i: number; fallback: string }): Promise<string> {
  const b = await loadBank();
  const s = b?.[spec.i];
  return typeof s === 'string' && s.length > 0 ? s : spec.fallback;
}

/** Resolve every entry of {@link S} at once. */
export async function menuStrings(): Promise<Record<keyof typeof S, string>> {
  const keys = Object.keys(S) as (keyof typeof S)[];
  const values = await Promise.all(keys.map((k) => menuString(S[k])));
  const out = {} as Record<keyof typeof S, string>;
  keys.forEach((k, idx) => (out[k] = values[idx] ?? S[k].fallback));
  return out;
}
