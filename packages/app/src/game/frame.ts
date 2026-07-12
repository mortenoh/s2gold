/**
 * Decorative viewport frame: the original's ornamented stone border with a
 * caryatid statue in each corner, from the converted RESOURCE.DAT pieces
 * (ui/index.json). Rendered as a pointer-events-none overlay over the map
 * canvas and under the HUD, so it is purely cosmetic. Silently absent when the
 * ui assets are not installed (CI, or before the pipeline has run).
 */

import { el } from '../lib/dom';
import { assetUrl, fetchJson } from '../lib/manifest';

interface UiIndex {
  pieces: Record<string, { png: string; width: number; height: number }>;
}

/** Corner + edge piece names from RESOURCE.DAT (see convert/ui.py). */
const CORNERS: ReadonlyArray<[name: string, cls: string]> = [
  ['dskbobol', 'frame-tl'],
  ['dskbobor', 'frame-tr'],
  ['dskbobul', 'frame-bl'],
  ['dskbobur', 'frame-br'],
];
/**
 * Build and append the frame overlay to `root`, or do nothing when the ui
 * pieces are unavailable. Returns the overlay element (or null).
 */
export async function installFrame(root: HTMLElement): Promise<HTMLElement | null> {
  const idx = await fetchJson<UiIndex>(assetUrl('ui/index.json'));
  if (!idx?.pieces) return null;

  const overlay = el('div', { class: 'game-frame', attrs: { 'aria-hidden': 'true' } });
  const add = (name: string, cls: string): void => {
    const piece = idx.pieces[name];
    if (!piece) return;
    const img = el('img', {
      class: `frame-piece ${cls}`,
      attrs: { src: assetUrl(piece.png), alt: '', draggable: 'false' },
    });
    overlay.append(img);
  };
  for (const [name, cls] of CORNERS) add(name, cls);
  root.append(overlay);
  return overlay;
}
