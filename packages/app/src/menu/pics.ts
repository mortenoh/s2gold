/**
 * Access to the converted original menu artwork (GFX/PICS/*.LBM -> pics/*.png).
 *
 * `pics/index.json` maps a key to `{ file, w, h, group }` where group is
 * "setup" (menu/backdrop screens) or "mission" (briefing backdrops). The menu
 * uses a couple of the setup screens as full-bleed backgrounds; helpers here
 * resolve a URL and preload the image, degrading to null when assets are
 * absent so the flow still renders on a plain dark background.
 */

import { assetUrl, fetchJson } from '../lib/manifest';

export interface PicEntry {
  file: string;
  w: number;
  h: number;
  group: string;
}

export type PicsIndex = Record<string, PicEntry>;

/** Preferred title-screen backdrops, in order (first that exists wins). */
export const TITLE_PIC_KEYS = ['setup896', 'setup998', 'setup801'] as const;
/** Preferred setup-page backdrops, in order. */
export const SETUP_PIC_KEYS = ['setup801', 'setup895', 'setup896'] as const;

let cache: PicsIndex | null | undefined;

/** Load and memoise pics/index.json; null when the pics category is absent. */
export async function loadPicsIndex(): Promise<PicsIndex | null> {
  if (cache !== undefined) return cache;
  const raw = await fetchJson<PicsIndex>(assetUrl('pics/index.json'));
  cache = raw && typeof raw === 'object' ? raw : null;
  return cache;
}

/** Resolve the first available key from `keys` to an asset URL, else null. */
export function pickPicUrl(index: PicsIndex | null, keys: readonly string[]): string | null {
  if (!index) return null;
  for (const key of keys) {
    const entry = index[key];
    if (entry?.file) return assetUrl(entry.file);
  }
  return null;
}

/**
 * Apply the first available backdrop from `keys` as a cover background on `el`.
 * No-op (leaving the CSS fallback) when no pic is available. Returns the URL
 * used, or null.
 */
export async function applyBackdrop(el: HTMLElement, keys: readonly string[]): Promise<string | null> {
  const url = pickPicUrl(await loadPicsIndex(), keys);
  if (!url) return null;
  el.style.backgroundImage = `url("${url}")`;
  return url;
}
