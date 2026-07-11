/**
 * Statistics screen: the original Settlers II in-game statistics, drawn on
 * plain 2D canvases (no chart library). A HUD "Stats" button opens a panel with
 * four per-player time-series charts — land (owned territory node count),
 * buildings, soldiers, and total goods — sampled by the session every
 * {@link STATS_INTERVAL} ticks into ring buffers.
 *
 * Faithfulness note: the original shows full statistics for every player
 * regardless of fog of war, so this panel does the same (all players, always),
 * rather than restricting to what the local player could scout.
 */

import { PLAYER_COLORS, unpackColor } from '@s2gold/renderer';
import { clear, el } from '../lib/dom';
import type { GameSession, StatsSeries } from './session';

/** One chart: its title and the series key it reads from a StatsSeries. */
interface ChartDef {
  readonly key: keyof StatsSeries;
  readonly title: string;
}

const CHARTS: readonly ChartDef[] = [
  { key: 'land', title: 'Land' },
  { key: 'buildings', title: 'Buildings' },
  { key: 'soldiers', title: 'Soldiers' },
  { key: 'goods', title: 'Goods' },
];

/** Logical (CSS px) chart size; the canvas backing store scales by DPR. */
const CHART_W = 320;
const CHART_H = 120;
const PAD = { top: 8, right: 8, bottom: 8, left: 30 };

/** Dependencies the panel reads live (they change on map switch). */
export interface StatsPanelDeps {
  readonly root: HTMLElement;
  session(): GameSession | null;
  /** Notified on open/close so the HUD bar button can reflect the state. */
  onVisibility?(open: boolean): void;
}

/** CSS `rgb()` for a player index from the shared renderer palette. */
function playerRgb(player: number): string {
  const [r, g, b] = unpackColor(PLAYER_COLORS[player % PLAYER_COLORS.length] ?? 0xffffff);
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

export class StatsPanel {
  private panel: HTMLElement | null = null;
  private readonly canvases = new Map<keyof StatsSeries, HTMLCanvasElement>();
  private legend: HTMLElement | null = null;
  /** Tick of the newest stats sample last drawn; -1 forces the next redraw. */
  private lastSampleTick = -1;

  constructor(private readonly deps: StatsPanelDeps) {}

  /** True when the panel is open. */
  get isOpen(): boolean {
    return this.panel !== null;
  }

  /** The live panel element (null while closed). */
  get element(): HTMLElement | null {
    return this.panel;
  }

  close(): void {
    if (this.panel) {
      this.panel.remove();
      this.panel = null;
    }
    this.canvases.clear();
    this.legend = null;
    this.lastSampleTick = -1;
    this.deps.onVisibility?.(false);
  }

  open(): void {
    if (!this.deps.session()) return;
    this.close();
    const closeButton = el('button', {
      text: '✕',
      attrs: { type: 'button', 'data-testid': 'stats-close', title: 'Close' },
    });
    closeButton.addEventListener('click', () => this.close());

    const charts = el('div', { class: 'stats-charts' });
    this.canvases.clear();
    for (const def of CHARTS) {
      const canvas = el('canvas', {
        class: 'stats-canvas',
        attrs: { 'data-testid': `stats-canvas-${def.key}` },
      });
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(CHART_W * dpr);
      canvas.height = Math.round(CHART_H * dpr);
      canvas.style.width = `${CHART_W}px`;
      canvas.style.height = `${CHART_H}px`;
      this.canvases.set(def.key, canvas);
      charts.append(
        el(
          'div',
          { class: 'stats-chart' },
          el('div', { class: 'stats-chart-title', text: def.title }),
          canvas,
        ),
      );
    }

    this.legend = el('div', { class: 'stats-legend', attrs: { 'data-testid': 'stats-legend' } });

    this.panel = el(
      'div',
      { class: 'stats-panel', attrs: { 'data-testid': 'stats-panel' } },
      el(
        'div',
        { class: 'stats-panel-head' },
        el('span', { class: 'stats-panel-title', text: 'Statistics' }),
        closeButton,
      ),
      charts,
      this.legend,
    );
    this.deps.root.append(this.panel);
    this.render();
    this.deps.onVisibility?.(true);
  }

  /**
   * Redraw the charts + legend from live session state when a new statistics
   * sample has been recorded. Called from the game's per-frame loop while open
   * (a no-op when closed). Samples are appended only every STATS_INTERVAL
   * ticks, so gating on the newest sample's tick keeps the per-frame cost to one
   * comparison and still tracks the running economy (robust once the ring buffer
   * saturates and its length stops growing).
   */
  update(): void {
    if (!this.panel) return;
    const session = this.deps.session();
    if (!session) return;
    const ticks = session.statsTicks;
    const newest = ticks.length > 0 ? (ticks[ticks.length - 1] ?? -1) : -1;
    if (newest === this.lastSampleTick) return;
    this.render();
  }

  private render(): void {
    if (!this.panel) return;
    const session = this.deps.session();
    if (!session) return;
    const ticks = session.statsTicks;
    this.lastSampleTick = ticks.length > 0 ? (ticks[ticks.length - 1] ?? -1) : -1;
    const playerCount = session.statsSeries.length;
    for (const def of CHARTS) {
      const canvas = this.canvases.get(def.key);
      if (canvas) this.drawChart(canvas, session, def.key, playerCount);
    }
    this.renderLegend(session, playerCount);
  }

  private drawChart(
    canvas: HTMLCanvasElement,
    session: GameSession,
    key: keyof StatsSeries,
    playerCount: number,
  ): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, CHART_W, CHART_H);
    // Background + frame.
    ctx.fillStyle = '#12141a';
    ctx.fillRect(0, 0, CHART_W, CHART_H);
    ctx.strokeStyle = '#33333c';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, CHART_W - 1, CHART_H - 1);

    const plotW = CHART_W - PAD.left - PAD.right;
    const plotH = CHART_H - PAD.top - PAD.bottom;
    const samples = session.statsTicks.length;

    // Peak value across all players for this metric (y-axis scale).
    let peak = 1;
    for (let p = 0; p < playerCount; p++) {
      const arr = session.statsSeries[p]?.[key];
      if (!arr) continue;
      for (const v of arr) if (v > peak) peak = v;
    }

    // Baseline + peak axis labels.
    ctx.fillStyle = '#6b6f7a';
    ctx.font = '9px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(peak), PAD.left - 4, PAD.top + 4);
    ctx.fillText('0', PAD.left - 4, PAD.top + plotH - 2);
    ctx.strokeStyle = '#22242c';
    ctx.beginPath();
    ctx.moveTo(PAD.left, PAD.top + plotH);
    ctx.lineTo(PAD.left + plotW, PAD.top + plotH);
    ctx.stroke();

    if (samples < 2) return;
    const xAt = (i: number): number => PAD.left + (plotW * i) / (samples - 1);
    const yAt = (v: number): number => PAD.top + plotH - (plotH * v) / peak;

    for (let p = 0; p < playerCount; p++) {
      const arr = session.statsSeries[p]?.[key];
      if (!arr || arr.length < 2) continue;
      ctx.strokeStyle = playerRgb(p);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < arr.length; i++) {
        const x = xAt(i);
        const y = yAt(arr[i] ?? 0);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  private renderLegend(session: GameSession, playerCount: number): void {
    const legend = this.legend;
    if (!legend) return;
    clear(legend);
    const last = session.statsTicks.length - 1;
    const aiSet = new Set(session.aiPlayers);
    for (let p = 0; p < playerCount; p++) {
      const s = session.statsSeries[p];
      if (!s) continue;
      const val = (arr: number[]): number => (last >= 0 ? (arr[last] ?? 0) : 0);
      const role =
        p === session.localPlayer ? 'You' : aiSet.has(p) ? 'Computer' : 'Idle';
      const swatch = el('span', { class: 'stats-swatch' });
      swatch.style.background = playerRgb(p);
      legend.append(
        el(
          'div',
          { class: 'stats-legend-row', attrs: { 'data-testid': `stats-legend-${p}` } },
          swatch,
          el('span', { class: 'stats-legend-name', text: `Player ${p + 1} (${role})` }),
          el('span', {
            class: 'stats-legend-vals',
            text:
              `Land ${val(s.land)} · Bld ${val(s.buildings)} · ` +
              `Sol ${val(s.soldiers)} · Goods ${val(s.goods)}`,
          }),
        ),
      );
    }
  }
}
