/**
 * Shared scaffolding for the click-to-open building panels (military, harbor):
 * anchored open/close, the 400 ms live-refresh interval, Escape-to-close, the
 * vanished-building dismissal, and the stop-propagation action button. Panels
 * supply what they track at a node and how to render their body.
 */

import { clear, el } from '../lib/dom';

export abstract class BuildingPanel {
  protected panel: HTMLElement | null = null;
  protected node = -1;
  private trackedId = -1;
  private refreshTimer = 0;

  protected constructor(
    private readonly host: HTMLElement,
    private readonly panelClass: string,
    private readonly testid: string,
  ) {
    window.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') this.close();
    });
  }

  /** Id of the tracked entity at `node`, or -1 when there is none. */
  protected abstract idAt(node: number): number;

  /** Render the panel body into `panel` (cleared before each call). */
  protected abstract renderBody(panel: HTMLElement, trackedId: number): void;

  /** True when the panel is open. */
  get isOpen(): boolean {
    return this.panel !== null;
  }

  /**
   * Try to open the panel for the entity at `node`; false when nothing this
   * panel tracks is there (the caller falls back to its default action).
   */
  openAt(node: number, clientX: number, clientY: number): boolean {
    const id = this.idAt(node);
    if (id < 0) return false;
    this.close();
    this.node = node;
    this.trackedId = id;
    const panel = el('div', { class: this.panelClass, attrs: { 'data-testid': this.testid } });
    panel.style.left = `${clientX + 4}px`;
    panel.style.top = `${clientY + 4}px`;
    this.panel = panel;
    this.host.append(panel);
    this.render();
    // Live refresh while open (garrisons fill, expeditions assemble, ...).
    this.refreshTimer = window.setInterval(() => this.render(), 400);
    return true;
  }

  close(): void {
    if (this.refreshTimer) {
      window.clearInterval(this.refreshTimer);
      this.refreshTimer = 0;
    }
    if (this.panel) {
      this.panel.remove();
      this.panel = null;
    }
    this.node = -1;
    this.trackedId = -1;
  }

  protected render(): void {
    const panel = this.panel;
    if (!panel) return;
    // The building was captured/razed/demolished while open: dismiss the
    // panel (the refresh interval dies with it) rather than a dead shell.
    if (this.idAt(this.node) !== this.trackedId) {
      this.close();
      return;
    }
    clear(panel);
    this.renderBody(panel, this.trackedId);
  }

  protected button(text: string, run: () => void, testid: string): HTMLElement {
    const btn = el('button', { text, attrs: { type: 'button', 'data-testid': testid } });
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      run();
    });
    return btn;
  }
}
