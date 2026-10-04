/**
 * The postbox: the original's in-game message list. Engine events that matter
 * to the local player become short messages (under attack, building captured
 * or lost, construction finished, mine exhausted, ore found, ships and
 * expeditions, promotions, a player defeated). Each message remembers where it
 * happened, so clicking it centres the camera there.
 *
 * The model is DOM-free so its filtering is unit-testable; `PostboxPanel` is
 * the HUD window. Messages are presentation state, saved alongside the world
 * by the session (not part of the deterministic engine world).
 */

import { buildingDef, RESOURCE, type GameEvent, type World } from '@s2gold/engine';
import { clear, el } from '../lib/dom';
import { buildingLabel } from './building-labels';

export type PostKind =
  | 'attack'
  | 'captured'
  | 'lost'
  | 'finished'
  | 'mine'
  | 'ore'
  | 'ship'
  | 'expedition'
  | 'promoted'
  | 'defeated';

export interface PostMessage {
  readonly id: number;
  readonly tick: number;
  readonly kind: PostKind;
  readonly text: string;
  /** Map node to centre on, or -1 when the event has no place. */
  readonly node: number;
  read: boolean;
}

/** Messages kept; older ones drop off the bottom. */
export const POSTBOX_CAP = 100;
/** One "under attack" message per attacked spot per this many ticks. */
export const ATTACK_MESSAGE_COOLDOWN = 3000;

const ORE_NAME: Readonly<Record<number, string>> = {
  [RESOURCE.coal]: 'coal',
  [RESOURCE.iron]: 'iron ore',
  [RESOURCE.gold]: 'gold',
  [RESOURCE.granite]: 'granite',
};

export class Postbox {
  messages: PostMessage[] = [];
  private nextId = 1;
  private readonly lastAttack = new Map<number, number>();

  get unread(): number {
    let n = 0;
    for (const m of this.messages) if (!m.read) n++;
    return n;
  }

  /** Turn one engine event into a message for `me`, or null when it is not news. */
  ingest(e: GameEvent, world: World, me: number): PostMessage | null {
    const msg = this.describe(e, world, me);
    if (!msg) return null;
    const full: PostMessage = { ...msg, id: this.nextId++, tick: world.tick, read: false };
    this.messages.unshift(full);
    if (this.messages.length > POSTBOX_CAP) this.messages.length = POSTBOX_CAP;
    return full;
  }

  markRead(id: number): void {
    const m = this.messages.find((x) => x.id === id);
    if (m) m.read = true;
  }

  markAllRead(): void {
    for (const m of this.messages) m.read = true;
  }

  clear(): void {
    this.messages = [];
    this.lastAttack.clear();
  }

  toJSON(): { messages: PostMessage[]; nextId: number } {
    return { messages: this.messages.map((m) => ({ ...m })), nextId: this.nextId };
  }

  /** Restore from a save; anything missing or malformed leaves an empty postbox. */
  restore(data: unknown): void {
    this.clear();
    this.nextId = 1;
    if (!data || typeof data !== 'object') return;
    const raw = (data as { messages?: unknown; nextId?: unknown }).messages;
    if (!Array.isArray(raw)) return;
    for (const m of raw.slice(0, POSTBOX_CAP)) {
      if (!m || typeof m !== 'object') continue;
      const v = m as Partial<PostMessage>;
      if (typeof v.id !== 'number' || typeof v.text !== 'string' || typeof v.kind !== 'string') {
        continue;
      }
      this.messages.push({
        id: v.id,
        tick: typeof v.tick === 'number' ? v.tick : 0,
        kind: v.kind,
        text: v.text,
        node: typeof v.node === 'number' ? v.node : -1,
        read: v.read === true,
      });
    }
    const next = (data as { nextId?: unknown }).nextId;
    const maxId = this.messages.reduce((a, m) => Math.max(a, m.id), 0);
    this.nextId = typeof next === 'number' && next > maxId ? next : maxId + 1;
  }

  private describe(
    e: GameEvent,
    world: World,
    me: number,
  ): { kind: PostKind; text: string; node: number } | null {
    const nodeOf = (buildingId: number): number => world.buildings.items[buildingId]?.node ?? -1;
    switch (e.type) {
      case 'FightStarted': {
        if (e.defenderPlayer !== me) return null;
        const last = this.lastAttack.get(e.node);
        if (last !== undefined && world.tick - last < ATTACK_MESSAGE_COOLDOWN) return null;
        this.lastAttack.set(e.node, world.tick);
        return { kind: 'attack', text: 'Under attack!', node: e.node };
      }
      case 'BuildingCaptured': {
        const name = buildingLabel(e.buildingType);
        if (e.toPlayer === me) {
          return {
            kind: 'captured',
            text: e.burned ? `Enemy ${name.toLowerCase()} destroyed` : `${name} captured`,
            node: e.node,
          };
        }
        if (e.fromPlayer === me) return { kind: 'lost', text: `${name} lost`, node: e.node };
        return null;
      }
      case 'BuildingCompleted': {
        if (e.player !== me) return null;
        const kind = buildingDef(e.buildingType)?.kind;
        // Only the buildings worth a letter: military, warehouses, harbors and
        // shipyards. Every hut finishing would bury the important news.
        if (kind !== 'military' && kind !== 'warehouse' && kind !== 'shipyard') return null;
        return {
          kind: 'finished',
          text: `${buildingLabel(e.buildingType)} finished`,
          node: e.node,
        };
      }
      case 'MineDepleted':
        if (e.player !== me) return null;
        return { kind: 'mine', text: 'A mine is exhausted', node: e.node };
      case 'ResourceFound': {
        if (e.player !== me) return null;
        const ore = ORE_NAME[e.res];
        if (!ore) return null;
        return { kind: 'ore', text: `Geologist found ${ore}`, node: e.node };
      }
      case 'ShipBuilt':
        if (e.player !== me) return null;
        return { kind: 'ship', text: 'A new ship is ready', node: nodeOf(e.buildingId) };
      case 'ExpeditionReady':
        if (e.player !== me) return null;
        return { kind: 'expedition', text: 'Expedition ready to sail', node: nodeOf(e.harborId) };
      case 'ExpeditionLanded':
        if (e.player !== me) return null;
        return { kind: 'expedition', text: 'Expedition landed', node: e.node };
      case 'SoldierPromoted':
        if (e.player !== me) return null;
        return {
          kind: 'promoted',
          text: e.count > 1 ? `${e.count} soldiers promoted` : 'A soldier was promoted',
          node: nodeOf(e.buildingId),
        };
      case 'PlayerDefeated':
        if (e.player === me) {
          return { kind: 'defeated', text: 'Your headquarters has fallen', node: e.node };
        }
        return {
          kind: 'defeated',
          text:
            e.byPlayer === me
              ? `Player ${e.player + 1} defeated`
              : `Player ${e.player + 1} was defeated`,
          node: e.node,
        };
      default:
        return null;
    }
  }
}

export interface PostboxPanelDeps {
  readonly root: HTMLElement;
  postbox(): Postbox | null;
  /** Centre the camera on a map node. */
  centerOn(node: number): void;
  onVisibility?(open: boolean): void;
}

/** The HUD postbox window: newest first, click a letter to go there. */
export class PostboxPanel {
  private panel: HTMLElement | null = null;
  private list: HTMLElement | null = null;
  /** Rendered message state; null forces a render (an empty list has key ''). */
  private lastKey: string | null = null;

  constructor(private readonly deps: PostboxPanelDeps) {}

  get isOpen(): boolean {
    return this.panel !== null;
  }

  get element(): HTMLElement | null {
    return this.panel;
  }

  open(): void {
    if (!this.deps.postbox()) return;
    this.close();
    const closeButton = el('button', {
      text: '✕',
      attrs: { type: 'button', 'data-testid': 'postbox-close', title: 'Close' },
    });
    closeButton.addEventListener('click', () => this.close());
    this.list = el('div', { class: 'postbox-list', attrs: { 'data-testid': 'postbox-list' } });
    this.panel = el(
      'div',
      {
        class: 'goods-panel postbox-panel',
        attrs: { 'data-testid': 'postbox-panel', role: 'dialog', 'aria-label': 'Postbox' },
      },
      el(
        'div',
        { class: 'goods-panel-head' },
        el('span', { class: 'goods-panel-title', text: 'Postbox' }),
        closeButton,
      ),
      this.list,
    );
    this.deps.root.append(this.panel);
    this.lastKey = null;
    this.update();
    this.deps.onVisibility?.(true);
  }

  close(): void {
    if (this.panel) {
      this.panel.remove();
      this.panel = null;
      this.list = null;
    }
    this.deps.onVisibility?.(false);
  }

  /** Refresh the list when messages changed (called once per frame while open). */
  update(): void {
    const box = this.deps.postbox();
    if (!box || !this.list) return;
    const key = box.messages.map((m) => `${m.id}${m.read ? 'r' : 'u'}`).join(',');
    if (key === this.lastKey) return;
    this.lastKey = key;
    clear(this.list);
    if (box.messages.length === 0) {
      this.list.append(el('div', { class: 'postbox-empty', text: 'No messages.' }));
      return;
    }
    for (const m of box.messages) {
      const item = el(
        'button',
        {
          class: `postbox-item postbox-${m.kind}${m.read ? '' : ' unread'}`,
          attrs: { type: 'button', 'data-testid': 'postbox-item', 'data-kind': m.kind },
        },
        el('span', { class: 'postbox-text', text: m.text }),
      );
      if (m.node < 0) (item as HTMLButtonElement).disabled = true;
      item.addEventListener('click', (ev) => {
        ev.stopPropagation();
        box.markRead(m.id);
        if (m.node >= 0) this.deps.centerOn(m.node);
        this.update();
      });
      this.list.append(item);
    }
  }
}
