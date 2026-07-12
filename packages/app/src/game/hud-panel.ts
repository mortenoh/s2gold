/**
 * Shared mechanics for floating HUD panels anchored under their top-bar button:
 * clicking the button toggles the panel, clicking outside or pressing Escape
 * closes it, and the button reflects the open state (active class +
 * aria-expanded). Panels that can also close themselves (their own close
 * button, load-and-close) should call {@link syncHudPanelButton} from their
 * visibility hook so the bar button follows.
 */

/** Functional adapter over a panel; `element()` is null while a create-on-open panel is closed. */
export interface HudPanel {
  isOpen(): boolean;
  open(): void;
  close(): void;
  element(): HTMLElement | null;
}

/** Reflect a panel's open state on its bar button. */
export function syncHudPanelButton(button: HTMLElement, open: boolean): void {
  button.classList.toggle('active', open);
  button.setAttribute('aria-expanded', String(open));
}

/**
 * Anchor `panel` to `button`, clamped to the viewport edges. Opens below the
 * button normally, but above it when the button sits in the lower half of the
 * screen (the HUD bar is bottom-anchored), so the panel stays on-screen.
 */
function position(button: HTMLElement, panel: HTMLElement): void {
  const rect = button.getBoundingClientRect();
  const openUp = rect.top > window.innerHeight / 2;
  if (openUp) {
    panel.style.top = 'auto';
    panel.style.bottom = `${window.innerHeight - rect.top + 6}px`;
  } else {
    panel.style.bottom = 'auto';
    panel.style.top = `${rect.bottom + 6}px`;
  }
  const left = Math.min(rect.left, window.innerWidth - panel.offsetWidth - 8);
  panel.style.left = `${Math.max(8, left)}px`;
}

export function wireHudPanel(button: HTMLElement, panel: HudPanel): void {
  const setOpen = (next: boolean): void => {
    if (next) {
      panel.open();
      // Fixed positioning escapes the bar's overflow clip; anchor after open
      // so offsetWidth is measurable. open() may refuse (e.g. no session yet),
      // hence the re-read of isOpen() below.
      const elm = panel.element();
      if (elm) position(button, elm);
    } else {
      panel.close();
    }
    syncHudPanelButton(button, panel.isOpen());
  };
  button.addEventListener('click', () => setOpen(!panel.isOpen()));
  document.addEventListener('pointerdown', (ev) => {
    if (!panel.isOpen()) return;
    const target = ev.target as Node;
    if (button.contains(target) || panel.element()?.contains(target)) return;
    setOpen(false);
  });
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && panel.isOpen()) setOpen(false);
  });
}
