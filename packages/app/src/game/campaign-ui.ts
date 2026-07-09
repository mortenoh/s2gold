/**
 * In-game campaign layer: an Objectives panel, a periodic win-condition check
 * against the live session, and a victory overlay that records chapter progress
 * and returns to the campaign menu.
 *
 * Only active when the game page is opened in campaign mode
 * (`/play/<map>?campaign=<id>`). The win condition is the chapter's checkable
 * approximation (see menu/campaign-data.ts); it is evaluated roughly once a
 * second from the session's building/territory views. A `window.__s2campaign`
 * debug hook exposes the current status and a force-complete trigger for e2e.
 */

import { el, clear } from '../lib/dom';
import type { GameSession } from './session';
import {
  makeWinTracker,
  markChapterCompleted,
  winConditionText,
  type Chapter,
  type CampaignWorldView,
  type WinStatus,
  type WinTracker,
} from '../menu/campaign-data';

/** How often (ms) to re-check the win condition. */
const CHECK_INTERVAL_MS = 1000;

export interface CampaignDeps {
  readonly root: HTMLElement;
  /** The active session (null before the first map load). */
  session(): GameSession | null;
  readonly chapter: Chapter;
}

/** Debug surface exposed on window for e2e assertions. */
interface CampaignDebug {
  readonly chapter: number;
  /** Current progress line + done flag. */
  status(): WinStatus;
  /** Force the victory flow (records progress, shows the overlay). */
  forceComplete(): void;
}

declare global {
  interface Window {
    __s2campaign?: CampaignDebug;
  }
}

export class CampaignController {
  /** The HUD button that toggles the Objectives panel. */
  readonly button: HTMLButtonElement;
  private readonly panel: HTMLElement;
  private readonly progressEl: HTMLElement;
  private readonly tracker: WinTracker;
  private timer = 0;
  private open = false;
  private won = false;
  private lastStatus: WinStatus = { done: false, progress: '' };

  constructor(private readonly deps: CampaignDeps) {
    this.tracker = makeWinTracker(deps.chapter.win);

    this.button = el('button', {
      text: 'Objectives',
      attrs: { 'data-testid': 'objectives-toggle', type: 'button', title: 'Mission objectives' },
    }) as HTMLButtonElement;
    this.button.addEventListener('click', () => this.toggle());

    this.progressEl = el('div', {
      class: 'campaign-obj-progress',
      attrs: { 'data-testid': 'objectives-progress' },
    });

    const closeBtn = el('button', {
      text: '✕',
      attrs: { type: 'button', 'data-testid': 'objectives-close', title: 'Close' },
    });
    closeBtn.addEventListener('click', () => this.close());

    this.panel = el(
      'div',
      { class: 'campaign-obj-panel', attrs: { 'data-testid': 'objectives-panel' } },
      el(
        'div',
        { class: 'campaign-obj-head' },
        el('span', { class: 'campaign-obj-title', text: deps.chapter.title }),
        closeBtn,
      ),
      el('div', { class: 'campaign-obj-text', text: deps.chapter.objective }),
      el('div', { class: 'campaign-obj-win', text: winConditionText(deps.chapter.win) }),
      this.progressEl,
    );
    this.panel.hidden = true;
    deps.root.append(this.panel);

    window.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && this.open) this.close();
    });

    window.__s2campaign = {
      chapter: deps.chapter.id,
      status: () => this.lastStatus,
      forceComplete: () => this.win(),
    };
  }

  /** Begin periodic win-condition evaluation. */
  start(): void {
    this.evaluate();
    this.timer = window.setInterval(() => this.evaluate(), CHECK_INTERVAL_MS);
  }

  /** Build the world view the tracker needs from the current session. */
  private view(): CampaignWorldView | null {
    const session = this.deps.session();
    if (!session) return null;
    return {
      playerCount: session.playerCount,
      buildingsOf: (p) => session.buildingsOf(p),
      ownedLandOf: (p) => session.territory(p).length,
    };
  }

  private evaluate(): void {
    if (this.won) return;
    const view = this.view();
    if (!view) return;
    this.lastStatus = this.tracker.evaluate(view);
    this.progressEl.textContent = this.lastStatus.progress;
    if (this.lastStatus.done) this.win();
  }

  toggle(): void {
    if (this.open) this.close();
    else this.show();
  }

  private show(): void {
    this.open = true;
    this.panel.hidden = false;
    this.evaluate();
  }

  private close(): void {
    this.open = false;
    this.panel.hidden = true;
  }

  /** Record the win and present the victory overlay (idempotent). */
  private win(): void {
    if (this.won) return;
    this.won = true;
    window.clearInterval(this.timer);
    markChapterCompleted(this.deps.chapter.id);
    const session = this.deps.session();
    if (session) session.paused = true;
    this.showVictory();
  }

  private showVictory(): void {
    // Avoid stacking overlays.
    if (this.deps.root.querySelector('[data-testid="campaign-victory"]')) return;

    const continueBtn = el('a', {
      class: 'menu-start-btn',
      href: '/campaign',
      text: 'Continue',
      attrs: { 'data-testid': 'victory-continue' },
    });

    const card = el(
      'div',
      { class: 'campaign-victory-card' },
      el('div', { class: 'campaign-victory-title', text: 'Victory!' }),
      el('div', {
        class: 'campaign-victory-sub',
        text: `${this.deps.chapter.title} complete`,
      }),
      el('div', {
        class: 'campaign-victory-note',
        attrs: { 'data-testid': 'victory-note' },
        text: 'Chapter recorded. The next chapter is now unlocked.',
      }),
      continueBtn,
    );

    const overlay = el(
      'div',
      { class: 'campaign-victory', attrs: { 'data-testid': 'campaign-victory' } },
      card,
    );
    this.deps.root.append(overlay);
  }

  /** Remove listeners/timers (not currently needed; the page is per-map). */
  dispose(): void {
    window.clearInterval(this.timer);
    clear(this.panel);
    this.panel.remove();
  }
}
