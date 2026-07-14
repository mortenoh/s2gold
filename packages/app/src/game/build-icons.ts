/**
 * Build-menu building icons cropped straight from the loaded nation atlas
 * (rom_z). The original build window shows buildings as pictures, not text; we
 * reuse the same building sprites the map draws — the working-building frame at
 * rom_z index `250 + 5 * id` (the stride-5 rule mirrored from
 * {@link buildingSprite}) — as CSS background crops, so no extra assets or
 * converter work are needed. When the atlas is absent the factory returns null
 * and the menu falls back to its text rows.
 */

import type { BuildingType } from '@s2gold/engine';
import { BUILDING_TYPE_ID } from './game-render';
import type { LoadedAtlas } from './sprite-atlas';

/** rom_z sprite index of a building's finished (working) frame, or null. */
function workingSpriteIndex(type: BuildingType): number | null {
  const id = BUILDING_TYPE_ID[type];
  return id === undefined ? null : 250 + 5 * id;
}

/** Applies cropped building-sprite icons onto menu cells. */
export interface BuildIconSet {
  /**
   * Style `box` as the building's icon, scaled to fit a `cellPx` square while
   * preserving aspect ratio. Returns false when the sprite is unavailable so the
   * caller can fall back to a text row.
   */
  apply(box: HTMLElement, type: BuildingType, cellPx: number): boolean;
}

/**
 * Build an icon set from an already-loaded atlas (the app loads rom_z before the
 * interaction layer is constructed, so this is a zero-cost handoff). Returns null
 * when the atlas or its page image is missing — the menu then stays textual.
 */
export function makeBuildIconSet(atlas: LoadedAtlas | null): BuildIconSet | null {
  if (!atlas || atlas.pages.length === 0) return null;
  const { meta, pages } = atlas;
  return {
    apply(box, type, cellPx) {
      const index = workingSpriteIndex(type);
      if (index === null) return false;
      const frame = meta.sprites.get(index);
      if (!frame) return false;
      const page = pages[frame.atlas] as (HTMLImageElement & { width: number; height: number }) | undefined;
      if (!page) return false;
      const src = page.src;
      const natW = page.naturalWidth || page.width;
      const natH = page.naturalHeight || page.height;
      if (!src || !natW || !natH || frame.w <= 0 || frame.h <= 0) return false;
      // Fit within the cell, never upscaling past 1:1 (the sprites are 60-130px,
      // so this only ever shrinks the taller buildings).
      const scale = Math.min(cellPx / frame.w, cellPx / frame.h, 1);
      const dispW = Math.round(frame.w * scale);
      const dispH = Math.round(frame.h * scale);
      box.style.width = `${dispW}px`;
      box.style.height = `${dispH}px`;
      box.style.backgroundImage = `url("${src}")`;
      box.style.backgroundRepeat = 'no-repeat';
      box.style.backgroundSize = `${natW * scale}px ${natH * scale}px`;
      box.style.backgroundPosition = `${-frame.x * scale}px ${-frame.y * scale}px`;
      box.style.imageRendering = 'pixelated';
      return true;
    },
  };
}
