/**
 * HUD bar button icons cropped straight from the original UI archive (io.dat →
 * the `io_dat` atlas), reusing the same loaded-atlas CSS-crop trick as
 * {@link makeBuildIconSet}. Each button's old text label is preserved in a
 * visually-hidden span so it stays the accessible name and remains in the
 * element's textContent (the e2e suite asserts button text such as "Resume" and
 * "Zoom 2x"); the icon span carries the sprite as a background crop. When the
 * atlas is missing the button keeps its plain text label — the same graceful
 * degradation build-icons uses.
 */

import { el } from '../lib/dom';
import type { LoadedAtlas } from './sprite-atlas';

/** Archive holding the original menu/HUD icon sprites (io.dat). */
export const IO_ARCHIVE = 'io_dat';

/**
 * io_dat sprite index per HUD button. Each index was verified by cropping the
 * atlas and reading the resulting image; the parenthesised `iocon_NNN` is the
 * sprite's name in atlas.json and the words describe what it actually depicts.
 */
export const HUD_ICON = {
  /** iocon_113: an hourglass — time frozen, i.e. the pause control. */
  pause: 131,
  /** iocon_040: a monitor with a floppy disk — the save/load game menu. */
  game: 58,
  /** iocon_035: a 3D bar chart — the statistics panel. */
  stats: 53,
  /** iocon_180: a warehouse shelf stacked with wares — the goods inventory. */
  goods: 198,
  /** iocon_018: a magnifying glass — the zoom toggle. */
  zoom: 36,
  /** iocon_025: a cog with crossed spanners — settings. */
  settings: 43,
} as const;

/** Default on-screen icon size (px); the sprites are 24-32px and only shrink. */
const ICON_PX = 22;

/** Applies a cropped io_dat sprite as an element's background. */
export interface HudIconSet {
  /**
   * Style `box` as sprite `spriteIndex`, fit within a `px` square keeping aspect
   * ratio. Returns false when the sprite or its page is unavailable.
   */
  apply(box: HTMLElement, spriteIndex: number, px?: number): boolean;
}

/**
 * Build a HUD icon set from an already-loaded atlas. Returns null when the atlas
 * or its page image is missing so callers keep their text buttons.
 */
export function makeHudIconSet(atlas: LoadedAtlas | null): HudIconSet | null {
  if (!atlas || atlas.pages.length === 0) return null;
  const { meta, pages } = atlas;
  return {
    apply(box, spriteIndex, px = ICON_PX) {
      const frame = meta.sprites.get(spriteIndex);
      if (!frame) return false;
      const page = pages[frame.atlas] as (HTMLImageElement & { width: number; height: number }) | undefined;
      if (!page) return false;
      const src = page.src;
      const natW = page.naturalWidth || page.width;
      const natH = page.naturalHeight || page.height;
      if (!src || !natW || !natH || frame.w <= 0 || frame.h <= 0) return false;
      // Fit within the target square, never upscaling past 1:1.
      const scale = Math.min(px / frame.w, px / frame.h, 1);
      box.style.width = `${Math.round(frame.w * scale)}px`;
      box.style.height = `${Math.round(frame.h * scale)}px`;
      box.style.backgroundImage = `url("${src}")`;
      box.style.backgroundRepeat = 'no-repeat';
      box.style.backgroundSize = `${natW * scale}px ${natH * scale}px`;
      box.style.backgroundPosition = `${-frame.x * scale}px ${-frame.y * scale}px`;
      box.style.imageRendering = 'pixelated';
      return true;
    },
  };
}

/**
 * Turn a text HUD button into an icon button. The current text moves into a
 * hidden `.hud-btn-label` span (kept for a11y + the e2e text assertions) and the
 * icon span is prepended; the button keeps its plain text label when the atlas
 * or sprite is unavailable. Existing testid/title/handlers are untouched. A
 * title (tooltip) defaults to the label only when the button has none. Returns
 * whether the icon was applied.
 */
export function iconifyHudButton(
  button: HTMLElement,
  iconSet: HudIconSet | null,
  spriteIndex: number,
  px = ICON_PX,
): boolean {
  const text = button.textContent ?? '';
  button.setAttribute('aria-label', text);
  if (!button.hasAttribute('title')) button.setAttribute('title', text);
  const label = el('span', { class: 'hud-btn-label', text });
  const icon = el('span', { class: 'hud-btn-icon' });
  const applied = iconSet?.apply(icon, spriteIndex, px) ?? false;
  button.textContent = '';
  if (applied) {
    button.classList.add('hud-icon-btn');
    label.classList.add('sr-only');
    button.append(icon, label);
  } else {
    button.append(label);
  }
  return applied;
}
