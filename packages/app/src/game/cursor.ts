/**
 * Hand cursor: the original's pointing-hand pointer (handa, from RESOURCE.DAT's
 * ui pieces) installed as the CSS `cursor` for the map canvas and menu
 * backdrops. Sets a `--hand-cursor` custom property on :root when the ui assets
 * are present; does nothing when ui/index.json is absent (CI, or before the
 * pipeline has run), so the CSS `var(..., grab)`/`var(..., default)` fallbacks
 * keep the browser cursors.
 */

import { assetUrl, fetchJson } from '../lib/manifest';

interface UiIndex {
  pieces: Record<string, { png: string; width: number; height: number }>;
}

/**
 * The default pointing-hand piece. Its fingertip (the hotspot) sits at the
 * top-left of the sprite, so the cursor points from `1 1`.
 */
const HAND_PIECE = 'handa';

/**
 * Install the hand cursor as `--hand-cursor` on the document root, or do
 * nothing when the ui pieces are unavailable. Fire-and-forget: never throws,
 * never blocks boot.
 */
export async function installHandCursor(): Promise<void> {
  const idx = await fetchJson<UiIndex>(assetUrl('ui/index.json'));
  const piece = idx?.pieces?.[HAND_PIECE];
  if (!piece) return;
  // The hotspot is the fingertip at the top-left (1,1); `auto` is the required
  // keyword fallback for the url() cursor.
  const value = `url(${assetUrl(piece.png)}) 1 1, auto`;
  document.documentElement.style.setProperty('--hand-cursor', value);
}
