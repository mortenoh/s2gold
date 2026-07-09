/**
 * Free-play setup page ("/setup"): choose a map, preview it, and start.
 *
 * The map list comes from `maps/index.json` (title / size / players). Selecting
 * an entry paints a one-pixel-per-node preview ({@link buildMapPreview}) and
 * shows its stats; "Start game" navigates to `/play/<name>`, which the game
 * page resolves. Headings use the original bitmap font; a converted SETUP
 * backdrop sits behind, with a dark fallback.
 */

import { clear, el } from '../lib/dom';
import { assetUrl, fetchJson } from '../lib/manifest';
import { BitmapFont } from '../ui/font';
import { fontHeading } from '../ui/widgets';
import { applyBackdrop, SETUP_PIC_KEYS } from './pics';
import { buildMapPreview } from './minimap';
import { menuStrings } from './strings';
import { MenuMusic } from './music';

interface MapIndexEntry {
  file: string;
  name: string;
  title: string;
  width: number;
  height: number;
  players: number;
  terrain: number;
  terrain_name: string;
}

const GOLD = '#f0c84a';

async function loadMapIndex(): Promise<MapIndexEntry[] | null> {
  const raw = await fetchJson<{ maps?: MapIndexEntry[] }>(assetUrl('maps/index.json'));
  if (!raw || !Array.isArray(raw.maps) || raw.maps.length === 0) return null;
  return raw.maps;
}

export async function renderSetup(root: HTMLElement): Promise<void> {
  clear(root);
  root.className = 'menu-screen menu-setup';

  const music = new MenuMusic();
  music.mount(root);
  await applyBackdrop(root, SETUP_PIC_KEYS);

  const strings = await menuStrings();
  let font: BitmapFont | null = null;
  try {
    font = await BitmapFont.load('font14');
  } catch {
    font = null;
  }

  const panel = el('div', { class: 'menu-panel setup-panel', attrs: { 'data-testid': 'setup-panel' } });

  // Header with a back link.
  const header = el('div', { class: 'setup-header' });
  header.append(
    el('a', { class: 'menu-back', href: '/', text: '← Back', attrs: { 'data-testid': 'setup-back' } }),
    font
      ? fontHeading(font, strings.unlimitedSettings, { scale: 2, color: GOLD, testid: 'setup-heading' })
      : el('h1', { text: strings.unlimitedSettings, attrs: { 'data-testid': 'setup-heading' } }),
  );
  panel.append(header);

  const maps = await loadMapIndex();
  if (!maps) {
    panel.append(
      el('div', {
        class: 'menu-note',
        attrs: { 'data-testid': 'setup-no-maps' },
        text: 'No maps found. Run the asset pipeline to convert the WORLDS maps.',
      }),
    );
    root.append(panel);
    return;
  }

  const body = el('div', { class: 'setup-body' });

  // --- Left: map list -------------------------------------------------------
  const listWrap = el('div', { class: 'setup-list-wrap' });
  listWrap.append(
    font
      ? fontHeading(font, strings.selectionOfMaps, { scale: 1, color: '#e8dcc0' })
      : el('div', { class: 'setup-subheading', text: strings.selectionOfMaps }),
  );
  const list = el('ul', { class: 'setup-map-list', attrs: { 'data-testid': 'map-list', role: 'listbox' } });
  listWrap.append(list);

  // --- Right: preview + start ----------------------------------------------
  const previewWrap = el('div', { class: 'setup-preview-wrap' });
  const previewTitle = el('div', { class: 'setup-preview-title', attrs: { 'data-testid': 'preview-title' } });
  const previewCanvasHost = el('div', { class: 'setup-preview-canvas', attrs: { 'data-testid': 'preview-canvas' } });
  const previewInfo = el('div', { class: 'setup-preview-info', attrs: { 'data-testid': 'preview-info' } });
  const startBtn = el('button', {
    class: 'menu-start-btn',
    type: 'button',
    text: strings.startGame,
    attrs: { 'data-testid': 'start-game', disabled: 'true' },
  }) as HTMLButtonElement;
  startBtn.disabled = true;
  previewWrap.append(previewTitle, previewCanvasHost, previewInfo, startBtn);

  body.append(listWrap, previewWrap);
  panel.append(body);
  root.append(panel);

  let selected: MapIndexEntry | null = null;
  let previewToken = 0;

  const select = async (entry: MapIndexEntry, item: HTMLElement): Promise<void> => {
    selected = entry;
    for (const child of Array.from(list.children)) child.classList.remove('active');
    item.classList.add('active');
    item.setAttribute('aria-selected', 'true');

    previewTitle.textContent = entry.title;
    previewInfo.textContent = `${entry.width} x ${entry.height}  -  ${entry.players} player${entry.players === 1 ? '' : 's'}  -  ${entry.terrain_name}`;
    startBtn.disabled = false;
    startBtn.dataset.map = entry.name;

    const token = ++previewToken;
    clear(previewCanvasHost);
    previewCanvasHost.classList.add('loading');
    try {
      const preview = await buildMapPreview(entry.file);
      if (token !== previewToken) return; // superseded by a newer selection
      preview.canvas.className = 'minimap-canvas';
      preview.canvas.setAttribute('data-testid', 'minimap');
      // Integer-upscale small maps crisply so a 64x64 island is legible while
      // large maps display near 1:1 within the preview box (~340x280 css px).
      const factor = Math.max(1, Math.floor(Math.min(340 / preview.width, 280 / preview.height)));
      preview.canvas.style.width = `${preview.width * factor}px`;
      preview.canvas.style.height = `${preview.height * factor}px`;
      clear(previewCanvasHost);
      previewCanvasHost.append(preview.canvas);
    } catch {
      if (token !== previewToken) return;
      clear(previewCanvasHost);
      previewCanvasHost.append(el('div', { class: 'menu-note', text: 'Preview unavailable' }));
    } finally {
      if (token === previewToken) previewCanvasHost.classList.remove('loading');
    }
  };

  maps.forEach((entry, idx) => {
    const item = el('li', {
      class: 'setup-map-item',
      attrs: { role: 'option', 'data-testid': 'map-item', 'data-map': entry.name, tabindex: '0' },
    });
    item.append(
      el('span', { class: 'map-item-title', text: entry.title }),
      el('span', { class: 'map-item-meta', text: `${entry.width}x${entry.height} - ${entry.players}p` }),
    );
    const activate = (): void => void select(entry, item);
    item.addEventListener('click', activate);
    item.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        activate();
      }
    });
    list.append(item);
    if (idx === 0) void select(entry, item);
  });

  startBtn.addEventListener('click', () => {
    if (selected) window.location.assign(`/play/${selected.name}`);
  });
}
