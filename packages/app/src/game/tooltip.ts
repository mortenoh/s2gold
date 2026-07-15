/**
 * Fast tooltips: native `title` bubbles only appear after the OS hover delay
 * (around a second, not configurable), which makes the build menu and HUD feel
 * unresponsive. A single delegated handler adopts `title` attributes at hover
 * time into a styled fixed-position tip shown after a short delay. Adopted
 * elements keep their accessible name: the text is copied to `aria-label`
 * when none is present.
 */

import { el } from '../lib/dom';

const DELAY_MS = 150;

export function installTooltips(root: HTMLElement = document.body): void {
  const tip = el('div', {
    class: 'ui-tooltip',
    attrs: { role: 'tooltip', 'aria-hidden': 'true' },
  });
  document.body.append(tip);
  let timer: number | undefined;
  let current: HTMLElement | null = null;

  const hide = (): void => {
    window.clearTimeout(timer);
    tip.classList.remove('ui-tooltip-visible');
    current = null;
  };

  const show = (target: HTMLElement, text: string): void => {
    tip.textContent = text;
    tip.classList.add('ui-tooltip-visible');
    const anchor = target.getBoundingClientRect();
    const rect = tip.getBoundingClientRect();
    const margin = 6;
    let left = anchor.left + anchor.width / 2 - rect.width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - rect.width - margin));
    let top = anchor.top - rect.height - margin;
    if (top < margin) top = anchor.bottom + margin;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  };

  root.addEventListener('pointerover', (ev) => {
    const target = (ev.target as HTMLElement).closest?.('[title], [data-tip]');
    if (!(target instanceof HTMLElement)) return;
    // Adopt the native title (also on re-hover, so dynamically updated titles
    // stay fresh) — removing it keeps the OS bubble from racing ours.
    const title = target.getAttribute('title');
    if (title) {
      target.setAttribute('data-tip', title);
      if (!target.getAttribute('aria-label')) target.setAttribute('aria-label', title);
      target.removeAttribute('title');
    }
    const text = target.getAttribute('data-tip');
    if (!text || target === current) return;
    hide();
    current = target;
    timer = window.setTimeout(() => show(target, text), DELAY_MS);
  });
  root.addEventListener('pointerout', (ev) => {
    const target = (ev.target as HTMLElement).closest?.('[data-tip]');
    if (target instanceof HTMLElement && target === current) hide();
  });
  // Clicking usually changes what is under the cursor (menus open/close).
  root.addEventListener('pointerdown', hide, true);
}
