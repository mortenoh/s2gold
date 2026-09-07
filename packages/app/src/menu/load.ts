/**
 * Load game screen ("/load"): every save the game server knows, grouped by
 * map, with the original's tray numbering. Clicking a save boots that map and
 * loads the save (`/play/<map>?save=<id>`). Without the server the screen
 * explains that saves need it (the same degradation as the in-game trays).
 */

import { clear, el } from '../lib/dom';
import { fetchJson } from '../lib/manifest';
import { BitmapFont } from '../ui/font';
import { fontHeading } from '../ui/widgets';
import { applyBackdrop, TITLE_PIC_KEYS } from './pics';

/** Server save metadata (mirrors the in-game SaveMeta). */
export interface SaveMeta {
  id: string;
  name: string;
  map: string;
  tick: number;
  created_at: string;
  updated_at: string;
}

interface MapIndexEntry {
  name: string;
  title: string;
}

const GOLD = '#f0c84a';
const REQUEST_TIMEOUT_MS = 3000;

/** List saves from the API, or null when the server is unreachable. */
export async function listSaves(): Promise<SaveMeta[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch('/api/saves', { signal: controller.signal });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
    return (await res.json()) as SaveMeta[];
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Tray number (1-based) encoded in a save id, or null for non-tray ids. */
export function trayOf(map: string, id: string): number | null {
  const m = /_slot(\d+)$/.exec(id);
  if (!m || !id.startsWith(`${map}_slot`)) return null;
  return Number(m[1]) + 1;
}

/** The game URL that boots `map` and loads save `id`. */
export function loadHref(map: string, id: string): string {
  return `/play/${encodeURIComponent(map)}?save=${encodeURIComponent(id)}`;
}

/** Group saves by map, newest map first, trays in order within a map. */
export function groupSaves(saves: SaveMeta[]): [string, SaveMeta[]][] {
  const byMap = new Map<string, SaveMeta[]>();
  for (const s of saves) byMap.set(s.map, [...(byMap.get(s.map) ?? []), s]);
  const groups = [...byMap.entries()];
  const newest = (list: SaveMeta[]): string =>
    list.reduce((acc, s) => (s.updated_at > acc ? s.updated_at : acc), '');
  groups.sort((a, b) => newest(b[1]).localeCompare(newest(a[1])));
  for (const [map, list] of groups) {
    list.sort((a, b) => (trayOf(map, a.id) ?? 99) - (trayOf(map, b.id) ?? 99));
  }
  return groups;
}

export async function renderLoadGame(root: HTMLElement): Promise<void> {
  clear(root);
  root.className = 'menu-screen menu-title';
  await applyBackdrop(root, TITLE_PIC_KEYS);

  let font: BitmapFont | null = null;
  try {
    font = await BitmapFont.load('font14');
  } catch {
    font = null;
  }

  const panel = el('div', {
    class: 'menu-panel load-panel',
    attrs: { 'data-testid': 'load-panel' },
  });
  const header = el('div', { class: 'setup-header' });
  header.append(
    el('a', {
      class: 'menu-back',
      href: '/',
      text: '← Back',
      attrs: { 'data-testid': 'load-back' },
    }),
    font
      ? fontHeading(font, 'Load game', { scale: 2, color: GOLD, testid: 'load-heading' })
      : el('h1', {
          class: 'setup-heading',
          text: 'Load game',
          attrs: { 'data-testid': 'load-heading' },
        }),
  );
  panel.append(header);

  const [saves, index] = await Promise.all([
    listSaves(),
    fetchJson<{ maps?: MapIndexEntry[] }>('/assets/maps/index.json'),
  ]);
  const titles = new Map((index?.maps ?? []).map((m) => [m.name, m.title]));

  if (saves === null) {
    panel.append(
      el('div', {
        class: 'menu-note',
        text: 'Saves unavailable: the game server is not running (make serve, or the desktop app).',
        attrs: { 'data-testid': 'load-unavailable' },
      }),
    );
  } else if (saves.length === 0) {
    panel.append(
      el('div', {
        class: 'menu-note',
        text: 'No saved games yet.',
        attrs: { 'data-testid': 'load-empty' },
      }),
    );
  } else {
    const list = el('div', { class: 'load-list', attrs: { 'data-testid': 'load-list' } });
    for (const [map, entries] of groupSaves(saves)) {
      list.append(
        el('div', {
          class: 'load-map-title',
          text: titles.get(map) ?? map,
          attrs: { 'data-map': map },
        }),
      );
      for (const s of entries) {
        const tray = trayOf(map, s.id);
        const row = el('a', {
          class: 'setup-map-item load-item',
          href: loadHref(map, s.id),
          attrs: { 'data-testid': 'load-item', 'data-save-id': s.id },
        });
        row.append(
          el('span', {
            class: 'map-item-title',
            text: `${tray === null ? '' : `${tray}. `}${s.name}`,
          }),
          el('span', {
            class: 'map-item-meta',
            text: `tick ${s.tick} - ${new Date(s.updated_at).toLocaleString()}`,
          }),
        );
        list.append(row);
      }
    }
    panel.append(list);
  }
  root.append(panel);
}
