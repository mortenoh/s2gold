/**
 * Save / load UI: a compact "Game" menu panel backed by the server's
 * `/api/saves` CRUD. Serialization goes through the engine (via
 * {@link GameSession.serialize}); loading swaps the live world in place so the
 * tick loop keeps running and the camera is untouched.
 *
 * The API is optional: in dev it is reached through the Vite proxy to the
 * FastAPI server, and when that server is down every call fails fast and the UI
 * degrades to a disabled Save button plus an "unavailable" note (no crashes).
 */

import { el } from '../lib/dom';
import type { GameSession } from './session';

/** Server SaveMeta (metadata only; matches the FastAPI model). */
interface SaveMeta {
  id: string;
  name: string;
  map: string;
  tick: number;
  created_at: string;
  updated_at: string;
}

/** Server SaveGame (metadata plus the opaque engine state). */
interface SaveGame extends SaveMeta {
  data: unknown;
}

/** The PUT payload the server expects. */
interface SavePayload {
  name: string;
  map: string;
  tick: number;
  data: unknown;
}

/** Dependencies the save UI reads live (they change on map switch). */
export interface SaveMenuDeps {
  readonly root: HTMLElement;
  session(): GameSession | null;
  /** The current map's file name (matches SaveMeta.map). */
  mapName(): string;
  /** The current map's display title (seeds the default save name). */
  mapTitle(): string;
  /** Brief user feedback, reusing the HUD toast. */
  toast(text: string): void;
  /** Notified on open/close so the HUD bar button can reflect the state. */
  onVisibility?(open: boolean): void;
}

const API_BASE = '/api/saves';
const REQUEST_TIMEOUT_MS = 3000;

/** Fetch JSON from the saves API, throwing on any non-OK/parse/network error. */
async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      signal: controller.signal,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}`);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Slugify a save name into a valid save id (`^[a-z0-9][a-z0-9_-]{0,63}$`). */
function makeSaveId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const stamp = Date.now().toString(36);
  const base = slug.length > 0 ? `${slug}-${stamp}` : `save-${stamp}`;
  return base.replace(/^[^a-z0-9]/, 's');
}

/** The compact Save/Load overlay panel plus its API client. */
export class SaveMenu {
  private readonly panel: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly saveButton: HTMLButtonElement;
  private readonly listBox: HTMLElement;
  private visible = false;
  private busy = false;

  constructor(private readonly deps: SaveMenuDeps) {
    this.nameInput = el('input', {
      class: 'save-name',
      attrs: { type: 'text', 'data-testid': 'save-name', placeholder: 'Save name' },
    }) as HTMLInputElement;
    this.saveButton = el('button', {
      text: 'Save',
      attrs: { type: 'button', 'data-testid': 'save-submit' },
    }) as HTMLButtonElement;
    this.listBox = el('div', { class: 'save-list', attrs: { 'data-testid': 'save-list' } });

    this.saveButton.addEventListener('click', () => void this.save());
    this.nameInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') void this.save();
    });

    const closeButton = el('button', {
      text: '✕',
      attrs: { type: 'button', 'data-testid': 'save-close', title: 'Close' },
    });
    closeButton.addEventListener('click', () => this.close());

    const exitButton = el('button', {
      class: 'menu-exit',
      text: 'Exit to title',
      attrs: { type: 'button', 'data-testid': 'menu-exit' },
    });
    exitButton.addEventListener('click', () => {
      window.location.href = '/';
    });

    this.panel = el(
      'div',
      { class: 'save-panel', attrs: { 'data-testid': 'save-panel' } },
      el(
        'div',
        { class: 'save-panel-head' },
        el('span', { class: 'save-panel-title', text: 'Game' }),
        closeButton,
      ),
      el(
        'div',
        { class: 'save-section' },
        el('div', { class: 'save-section-title', text: 'Save game' }),
        el('div', { class: 'save-row' }, this.nameInput, this.saveButton),
      ),
      el(
        'div',
        { class: 'save-section' },
        el('div', { class: 'save-section-title', text: 'Load game' }),
        this.listBox,
      ),
      el('div', { class: 'save-section save-section-exit' }, exitButton),
    );
    this.panel.hidden = true;
    deps.root.append(this.panel);
  }

  /** True when the panel is open. */
  get isOpen(): boolean {
    return this.visible;
  }

  /** The panel element (persistent; visibility via `hidden`). */
  get element(): HTMLElement {
    return this.panel;
  }

  /** Open the panel; refreshes the save list and default name. */
  open(): void {
    void this.show();
  }

  private async show(): Promise<void> {
    this.visible = true;
    this.panel.hidden = false;
    this.deps.onVisibility?.(true);
    this.nameInput.value = `${this.deps.mapTitle()} quicksave`;
    await this.refresh();
  }

  close(): void {
    this.visible = false;
    this.panel.hidden = true;
    this.deps.onVisibility?.(false);
  }

  // --- Operations -----------------------------------------------------------

  /** Reload the list for the current map and reflect API availability. */
  private async refresh(): Promise<void> {
    this.setListMessage('Loading…');
    let metas: SaveMeta[];
    try {
      metas = await api<SaveMeta[]>('GET', '');
    } catch {
      this.setUnavailable();
      return;
    }
    this.setAvailable();
    const map = this.deps.mapName();
    const mine = metas.filter((m) => m.map === map); // newest-first from the server
    this.renderList(mine);
  }

  private async save(name = this.nameInput.value.trim()): Promise<void> {
    const session = this.deps.session();
    if (!session || this.busy) return;
    if (!name) {
      this.deps.toast('Enter a save name');
      return;
    }
    this.busy = true;
    try {
      const payload: SavePayload = {
        name,
        map: this.deps.mapName(),
        tick: session.world.tick,
        data: session.serialize(),
      };
      await api<SaveGame>('PUT', `/${makeSaveId(name)}`, payload);
      this.deps.toast(`Saved "${name}"`);
      if (this.visible) await this.refresh();
    } catch {
      this.deps.toast('Save failed (API offline)');
    } finally {
      this.busy = false;
    }
  }

  private async load(id: string): Promise<void> {
    const session = this.deps.session();
    if (!session || this.busy) return;
    this.busy = true;
    try {
      const save = await api<SaveGame>('GET', `/${id}`);
      session.loadWorld(save.data);
      this.deps.toast(`Loaded "${save.name}" (tick ${save.tick})`);
      this.close();
    } catch {
      this.deps.toast('Load failed');
    } finally {
      this.busy = false;
    }
  }

  private async remove(id: string, name: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await api<void>('DELETE', `/${id}`);
      this.deps.toast(`Deleted "${name}"`);
      if (this.visible) await this.refresh();
    } catch {
      this.deps.toast('Delete failed');
    } finally {
      this.busy = false;
    }
  }

  // --- Quick save / load (F5 / F9) ------------------------------------------

  /** F5: quicksave the current world under a map-titled name. */
  quicksave(): void {
    void this.save(`${this.deps.mapTitle()} quicksave`);
  }

  /** F9: load the most recent save for the current map. */
  async quickload(): Promise<void> {
    const session = this.deps.session();
    if (!session) return;
    let metas: SaveMeta[];
    try {
      metas = await api<SaveMeta[]>('GET', '');
    } catch {
      this.deps.toast('Quickload failed (API offline)');
      return;
    }
    const map = this.deps.mapName();
    const latest = metas.find((m) => m.map === map); // list is newest-first
    if (!latest) {
      this.deps.toast('No save for this map');
      return;
    }
    await this.load(latest.id);
  }

  // --- Rendering ------------------------------------------------------------

  private renderList(metas: SaveMeta[]): void {
    if (metas.length === 0) {
      this.setListMessage('No saves for this map yet.');
      return;
    }
    this.listBox.replaceChildren(
      ...metas.map((m) => {
        const loadBtn = el('button', {
          text: 'Load',
          attrs: { type: 'button', 'data-testid': 'save-load' },
        });
        loadBtn.addEventListener('click', () => void this.load(m.id));
        const delBtn = el('button', {
          class: 'save-del',
          text: 'Delete',
          attrs: { type: 'button', 'data-testid': 'save-delete' },
        });
        delBtn.addEventListener('click', () => void this.remove(m.id, m.name));
        return el(
          'div',
          { class: 'save-item', attrs: { 'data-testid': 'save-item' } },
          el(
            'span',
            { class: 'save-item-meta' },
            el('span', { class: 'save-item-name', text: m.name }),
            el('span', { class: 'save-item-tick', text: `tick ${m.tick}` }),
          ),
          el('span', { class: 'save-item-actions' }, loadBtn, delBtn),
        );
      }),
    );
  }

  private setListMessage(text: string): void {
    this.listBox.replaceChildren(el('div', { class: 'save-empty', text }));
  }

  private setUnavailable(): void {
    this.saveButton.disabled = true;
    this.saveButton.title = 'Saves unavailable: the game server API is not reachable';
    this.setListMessage('Saves unavailable (game server offline).');
  }

  private setAvailable(): void {
    this.saveButton.disabled = false;
    this.saveButton.title = '';
  }
}
