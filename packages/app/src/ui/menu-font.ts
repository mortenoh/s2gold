/**
 * The font menus draw with: the original bitmap font for the Original
 * graphics set, the vector fonts for HD (see {@link graphicsScale}).
 */

import { graphicsScale, readGraphicsPref } from '../game/view-prefs';
import { BitmapFont, type DrawOptions, type TextOptions } from './font';
import { VectorFont, type TextRole } from './vector-font';

/** Anything that can render a line or block of menu text to a canvas. */
export interface MenuFont {
  render(text: string, opts?: DrawOptions & { role?: TextRole }): HTMLCanvasElement;
  /** Width of `text` in CSS pixels at the given scale. */
  measure(text: string, opts?: TextOptions & { role?: TextRole }): { width: number };
}

/** Load the menu font for the current graphics preference. */
export async function loadMenuFont(bitmapName = 'font14'): Promise<MenuFont> {
  if (graphicsScale(readGraphicsPref(), window.devicePixelRatio || 1) === 2) {
    return VectorFont.load();
  }
  return BitmapFont.load(bitmapName);
}
