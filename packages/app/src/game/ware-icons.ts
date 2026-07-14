/**
 * HUD ware icons cropped from the loaded landscape object atlas (map00/01/02).
 *
 * The original's small ware pictographs live in the map-object archive at
 * sprite index 2200 + GoodType id — the same GoodType space the engine's
 * WARE_ID table and the carrier ware overlays use (trunk 22, plank 23, stone
 * 24; verified by decoding the converted map00 atlas: 2222 is the log, 2223
 * the board stack, 2224 the stone slab). Icons are applied as CSS background
 * crops, mirroring build-icons.ts; when the atlas (or a sprite) is missing the
 * caller keeps its text-only rendering.
 */

import { WARE_ID, type WareType } from '@s2gold/engine';
import type { LoadedAtlas } from './sprite-atlas';

/** Object-archive sprite index of a ware's small pictograph, or null. */
function wareSpriteIndex(ware: WareType): number | null {
  const id = WARE_ID[ware];
  return id === undefined ? null : 2200 + id;
}

/** Applies ware pictographs onto HUD cells. */
export interface WareIconSet {
  /**
   * Style `box` as the ware's pictograph at its native size (the icons are
   * 8-24 px, already HUD-scaled). Returns false when the sprite is unavailable
   * so the caller can keep a text label instead.
   */
  apply(box: HTMLElement, ware: WareType): boolean;
}

/** Build a ware icon set from an already-loaded object atlas (null-safe). */
export function makeWareIconSet(atlas: LoadedAtlas | null): WareIconSet | null {
  if (!atlas || atlas.pages.length === 0) return null;
  const { meta, pages } = atlas;
  return {
    apply(box, ware) {
      const index = wareSpriteIndex(ware);
      if (index === null) return false;
      const frame = meta.sprites.get(index);
      if (!frame) return false;
      // The atlas pages are decoded <img> elements at runtime (AtlasPage is the
      // renderer's minimal width/height view of them) — same cast build-icons uses.
      const page = pages[frame.atlas] as
        (HTMLImageElement & { width: number; height: number }) | undefined;
      if (!page) return false;
      const src = page.src;
      const natW = page.naturalWidth || page.width;
      const natH = page.naturalHeight || page.height;
      if (!src || !natW || !natH || frame.w <= 0 || frame.h <= 0) return false;
      box.style.width = `${frame.w}px`;
      box.style.height = `${frame.h}px`;
      box.style.backgroundImage = `url("${src}")`;
      box.style.backgroundRepeat = 'no-repeat';
      box.style.backgroundPosition = `${-frame.x}px ${-frame.y}px`;
      box.style.imageRendering = 'pixelated';
      return true;
    },
  };
}
