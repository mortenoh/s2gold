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
  /** Notified after a save has been loaded into the session (UI re-sync). */
  onLoaded?(): void;
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

/**
 * Fixed per-map save trays, mirroring the original's 11-slot Load/Save dialog
 * (docs/reference-study/captures/loadgame.png). The slot id embeds the map so
 * a save id stays valid (`^[a-z0-9][a-z0-9_-]{0,63}$`) and per-map filtering is
 * a prefix match.
 */
const SLOT_COUNT = 11;

/** Save id for tray `i` of `map` (map names are already id-valid slugs). */
function slotId(map: string, i: number): string {
  return `${map}_slot${i}`;
}

/** Tray index encoded in a save id, or -1 for a non-tray (legacy) id. */
function slotOf(map: string, id: string): number {
  const m = new RegExp(`^${map}_slot(\\d+)$`).exec(id);
  const i = m ? Number(m[1]) : -1;
  return i >= 0 && i < SLOT_COUNT ? i : -1;
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
    const bySlot = new Array<SaveMeta | null>(SLOT_COUNT).fill(null);
    for (const m of metas) {
      if (m.map !== map) continue;
      const i = slotOf(map, m.id);
      if (i >= 0) bySlot[i] = m;
    }
    this.renderTrays(bySlot);
  }

  /**
   * Save into a tray. `slot` picks the tray (an occupied tray is overwritten);
   * when omitted, the first empty tray is used, falling back to slot 0 when all
   * are full. `name` defaults to the map-titled label.
   */
  private async save(slot?: number, name = this.nameInput.value.trim()): Promise<void> {
    const session = this.deps.session();
    if (!session || this.busy) return;
    const map = this.deps.mapName();
    const label = name || `${this.deps.mapTitle()} save`;
    let target = slot;
    if (target === undefined) {
      target = this.slots.findIndex((m) => m === null);
      if (target < 0) target = 0; // all full: reuse the first tray
    }
    this.busy = true;
    try {
      const payload: SavePayload = {
        name: label,
        map,
        tick: session.world.tick,
        data: session.serialize(),
      };
      await api<SaveGame>('PUT', `/${slotId(map, target)}`, payload);
      this.deps.toast(`Saved to tray ${target + 1}`);
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
      this.deps.onLoaded?.();
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

  /** F5: quicksave into the first empty tray (map-titled name). */
  quicksave(): void {
    void this.save(undefined, `${this.deps.mapTitle()} quicksave`);
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
    const latest = metas.find((m) => m.map === map && slotOf(map, m.id) >= 0);
    if (!latest) {
      this.deps.toast('No save for this map');
      return;
    }
    await this.load(latest.id);
  }

  // --- Rendering ------------------------------------------------------------

  /** The current per-map trays (index -> save meta or null). */
  private slots: (SaveMeta | null)[] = new Array<SaveMeta | null>(SLOT_COUNT).fill(null);

  private renderTrays(slots: (SaveMeta | null)[]): void {
    this.slots = slots;
    const map = this.deps.mapName();
    this.listBox.replaceChildren(
      ...slots.map((m, i) => {
        if (!m) {
          // Empty tray: clicking it saves the current game here.
          const tray = el('button', {
            class: 'save-tray save-tray-empty',
            text: `${i + 1}. <Empty tray>`,
            attrs: { type: 'button', 'data-testid': 'save-tray', 'data-slot': String(i) },
          });
          tray.addEventListener('click', () => void this.save(i));
          return tray;
        }
        const load = el('button', {
          class: 'save-tray',
          attrs: { type: 'button', 'data-testid': 'save-load', 'data-slot': String(i) },
        });
        load.append(
          el('span', { class: 'save-item-name', text: `${i + 1}. ${m.name}` }),
          el('span', { class: 'save-item-tick', text: `tick ${m.tick}` }),
        );
        load.addEventListener('click', () => void this.load(slotId(map, i)));
        const delBtn = el('button', {
          class: 'save-del',
          text: 'Delete',
          attrs: { type: 'button', 'data-testid': 'save-delete' },
        });
        delBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          void this.remove(slotId(map, i), m.name);
        });
        return el(
          'div',
          { class: 'save-item', attrs: { 'data-testid': 'save-item', 'data-slot': String(i) } },
          load,
          delBtn,
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
