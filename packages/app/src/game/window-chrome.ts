/**
 * Window chrome: the original's ornamented panel windows, from the converted
 * RESOURCE.DAT window pieces (ui/index.json). Sets CSS custom properties on the
 * document root only when the pieces are present, so the panel styles in
 * styles.css can key off them (`var(--win-body, <dark fallback>)` etc.). Does
 * nothing when the ui assets are absent (CI, or before the pipeline has run),
 * where the CSS falls back to the flat-dark styling.
 */

import { assetUrl, fetchJson } from '../lib/manifest';

interface UiIndex {
  pieces: Record<string, { png: string; width: number; height: number }>;
}

/**
 * The window-chrome pieces mapped onto the CSS custom properties the panel
 * styles consume. Each property is set to a `url(...)` only when its piece is
 * present; a missing piece leaves the property unset so the CSS fallback wins.
 */
const CHROME_VARS: ReadonlyArray<[cssVar: string, piece: string]> = [
  ['--win-title', 'titleact'],
  ['--win-body', 'patter01'],
  ['--win-frame-l', 'leftfram'],
  ['--win-frame-r', 'rghtfram'],
  ['--win-frame-b', 'bottfram'],
  ['--win-corner-l', 'leftbord'],
  ['--win-corner-r', 'rghtbord'],
  ['--win-close', 'closicup'],
];

/**
 * Install the window-chrome custom properties on the document root, or do
 * nothing when the ui pieces are unavailable. Fire-and-forget: never throws,
 * never blocks boot.
 */
export async function installWindowChrome(): Promise<void> {
  const idx = await fetchJson<UiIndex>(assetUrl('ui/index.json'));
  if (!idx?.pieces) return;
  const style = document.documentElement.style;
  for (const [cssVar, piece] of CHROME_VARS) {
    const p = idx.pieces[piece];
    if (!p) continue;
    style.setProperty(cssVar, `url(${assetUrl(p.png)})`);
  }
}
