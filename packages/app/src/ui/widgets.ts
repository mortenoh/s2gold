/**
 * Small DOM widgets that compose the bitmap font into clickable menu chrome.
 *
 * Each label is a pixel-scaled canvas drawn from the original font; the widget
 * wraps it in a real anchor/button so hover, focus, keyboard activation and
 * tooltips work, and exposes an `aria-label` (plus `data-testid`) so the text
 * is discoverable by assistive tech and Playwright even though it is drawn to a
 * canvas rather than laid out as text.
 */

import type { BitmapFont, DrawOptions } from './font';
import { el } from '../lib/dom';

/** Build a right-sized canvas rendering `text` with `font`. */
export function fontCanvas(font: BitmapFont, text: string, opts: DrawOptions = {}): HTMLCanvasElement {
  const canvas = font.render(text, opts);
  canvas.className = 'font-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  // Downscale display to CSS pixels equal to the unscaled glyph size * scale
  // via image-rendering pixelated on the intrinsic canvas; the element already
  // has the scaled bitmap, so no extra CSS sizing is needed.
  return canvas;
}

export interface MenuEntryOptions {
  font: BitmapFont;
  label: string;
  /** Draw scale for the label. */
  scale?: number;
  /** Glyph tint. */
  color?: string;
  /** Navigation target; omit for a pure button (use onClick). */
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  /** Native tooltip (e.g. why a disabled entry is disabled). */
  tooltip?: string;
  testid?: string;
}

/**
 * A single main-menu entry. Enabled entries are anchors (or buttons) that the
 * user can click or activate with the keyboard; disabled entries render dimmed,
 * are not focusable, and carry a tooltip explaining the state.
 */
export function menuEntry(opts: MenuEntryOptions): HTMLElement {
  const { font, label, scale = 3, color, href, onClick, disabled, tooltip, testid } = opts;
  const canvas = fontCanvas(font, label, { scale, color });

  const classes = ['menu-entry'];
  if (disabled) classes.push('disabled');

  const attrs: Record<string, string> = { 'aria-label': label };
  if (testid) attrs['data-testid'] = testid;
  if (disabled) attrs['aria-disabled'] = 'true';

  if (disabled) {
    const span = el('span', { class: classes.join(' '), title: tooltip, attrs }, canvas);
    return span;
  }

  const node = href
    ? el('a', { class: classes.join(' '), href, title: tooltip, attrs }, canvas)
    : el('button', { class: classes.join(' '), title: tooltip, type: 'button', attrs }, canvas);
  if (onClick) node.addEventListener('click', onClick);
  return node;
}

/** A heading rendered from the bitmap font (non-interactive). */
export function fontHeading(
  font: BitmapFont,
  text: string,
  opts: DrawOptions & { testid?: string } = {},
): HTMLElement {
  const { testid, ...draw } = opts;
  const canvas = fontCanvas(font, text, draw);
  const attrs: Record<string, string> = { 'aria-label': text };
  if (testid) attrs['data-testid'] = testid;
  return el('div', { class: 'font-heading', attrs }, canvas);
}
