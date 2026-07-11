/**
 * Roman campaign data table (clean-room) plus progress + win-condition helpers.
 *
 * The original campaign is ten chapters (I-X) played over MISS200-209. Its win
 * conditions are driven by per-mission event scripts (texts/mission/mis_000N)
 * that this reimplementation does not execute. Instead each chapter carries a
 * single, *checkable* approximate goal expressed against the engine views the
 * app already has (building counts, owned-land counts, enemy elimination). The
 * chosen goals are documented in the table below and match the spirit of the
 * mission (economy build-up for the tutorial, elimination for the war maps, a
 * territory share for the sprawling/scarce maps). Chapter progress is stored in
 * localStorage so only completed chapters and the next uncompleted one unlock,
 * mirroring the original's linear campaign gating.
 */

import { assetUrl, fetchJson } from '../lib/manifest';

/** A checkable, approximate chapter goal (see module docstring). */
export type WinCondition =
  /** Player 0 reaches `count` live buildings (economy build-up). */
  | { readonly kind: 'buildings'; readonly count: number }
  /** Player 0 holds at least `fraction` of all settled land (0..1). */
  | { readonly kind: 'territory'; readonly fraction: number }
  /** Every computer opponent that started with buildings has been wiped out. */
  | { readonly kind: 'defeatAll' };

export interface Chapter {
  /** 1-based chapter number (1..10). */
  readonly id: number;
  /** Roman numeral label (I..X). */
  readonly roman: string;
  /** Map name (matches maps/index.json `name`). */
  readonly mapName: string;
  /** Display title (matches the map's title). */
  readonly title: string;
  /** Converted mission-text bank for this chapter (diary + goals). */
  readonly textFile: string;
  /** Short English objective shown in the briefing + in-game Objectives panel. */
  readonly objective: string;
  /** The approximate, engine-checkable win condition. */
  readonly win: WinCondition;
}

/**
 * The ten Roman chapters. `textFile` maps chapter N to `txt_miss_{N:03d}` (the
 * English diary/goal bank; `txt_miss_000` is a German duplicate of chapter I and
 * is not used). Titles mirror maps/index.json.
 */
export const CHAPTERS: readonly Chapter[] = [
  {
    id: 1,
    roman: 'I',
    mapName: 'maps_miss200',
    title: 'I - Off we go',
    textFile: 'texts/eng/txt_miss_001.json',
    objective: 'Establish your settlement and build up a working economy (reach 10 buildings).',
    win: { kind: 'buildings', count: 10 },
  },
  {
    id: 2,
    roman: 'II',
    mapName: 'maps_miss201',
    title: 'II - Initial contact',
    textFile: 'texts/eng/txt_miss_002.json',
    objective: 'Make contact with the rival tribe and destroy their settlement.',
    win: { kind: 'defeatAll' },
  },
  {
    id: 3,
    roman: 'III',
    mapName: 'maps_miss202',
    title: 'III - The pass',
    textFile: 'texts/eng/txt_miss_003.json',
    objective: 'Seize the mountain pass by eliminating every enemy.',
    win: { kind: 'defeatAll' },
  },
  {
    id: 4,
    roman: 'IV',
    mapName: 'maps_miss203',
    title: 'IV: On the high seas',
    textFile: 'texts/eng/txt_miss_004.json',
    objective: 'Cross the high seas and destroy every enemy stronghold.',
    win: { kind: 'defeatAll' },
  },
  {
    id: 5,
    roman: 'V',
    mapName: 'maps_miss204',
    title: 'V - In the wasteland',
    textFile: 'texts/eng/txt_miss_005.json',
    objective: 'Survive the wasteland: control at least half of all settled land.',
    win: { kind: 'territory', fraction: 0.5 },
  },
  {
    id: 6,
    roman: 'VI',
    mapName: 'maps_miss205',
    title: 'VI - Divided country',
    textFile: 'texts/eng/txt_miss_006.json',
    objective: 'Unite the divided country: hold 60% of all settled land.',
    win: { kind: 'territory', fraction: 0.6 },
  },
  {
    id: 7,
    roman: 'VII',
    mapName: 'maps_miss206',
    title: 'VII - The snake',
    textFile: 'texts/eng/txt_miss_007.json',
    objective: 'Work your way along the snake and defeat all opponents.',
    win: { kind: 'defeatAll' },
  },
  {
    id: 8,
    roman: 'VIII',
    mapName: 'maps_miss207',
    title: 'VIII - Sea routes',
    textFile: 'texts/eng/txt_miss_008.json',
    objective: 'Secure the sea routes by eliminating every enemy.',
    win: { kind: 'defeatAll' },
  },
  {
    id: 9,
    roman: 'IX',
    mapName: 'maps_miss208',
    title: 'IX - The Gray Island',
    textFile: 'texts/eng/txt_miss_009.json',
    objective: 'Conquer the Gray Island: destroy every enemy settlement.',
    win: { kind: 'defeatAll' },
  },
  {
    id: 10,
    roman: 'X',
    mapName: 'maps_miss209',
    title: 'X - The Last Gate',
    textFile: 'texts/eng/txt_miss_010.json',
    objective: 'Break through the last gate and vanquish all remaining foes.',
    win: { kind: 'defeatAll' },
  },
];

/** Look up a chapter by its 1-based id. */
export function chapterById(id: number): Chapter | undefined {
  return CHAPTERS.find((c) => c.id === id);
}

/** Human-readable summary of a win condition (for the Objectives panel). */
export function winConditionText(win: WinCondition): string {
  switch (win.kind) {
    case 'buildings':
      return `Build up your settlement to ${win.count} buildings.`;
    case 'territory':
      return `Control at least ${Math.round(win.fraction * 100)}% of all settled land.`;
    case 'defeatAll':
      return 'Destroy every enemy settlement.';
  }
}

// --- Progress (localStorage) ------------------------------------------------

const PROGRESS_KEY = 's2gold.campaign.progress';

interface ProgressData {
  completed: number[];
}

/** Read the set of completed chapter ids from localStorage (empty on error). */
export function loadProgress(): Set<number> {
  try {
    const raw = window.localStorage.getItem(PROGRESS_KEY);
    if (!raw) return new Set();
    const data = JSON.parse(raw) as ProgressData;
    if (!Array.isArray(data.completed)) return new Set();
    return new Set(data.completed.filter((n) => Number.isInteger(n)));
  } catch {
    return new Set();
  }
}

/** Persist the completed-chapter set. */
function saveProgress(completed: Set<number>): void {
  try {
    const data: ProgressData = { completed: [...completed].sort((a, b) => a - b) };
    window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(data));
  } catch {
    // Ignore quota/availability errors: progress is a convenience, not required.
  }
}

/** True when the chapter has been completed. */
export function isChapterCompleted(id: number): boolean {
  return loadProgress().has(id);
}

/**
 * True when the chapter is playable: chapter I is always open; any other chapter
 * unlocks once the previous one is completed (matching the original's gating).
 */
export function isChapterUnlocked(id: number): boolean {
  if (id <= 1) return true;
  return isChapterCompleted(id - 1);
}

/** Mark a chapter completed and persist. Returns the new completed set. */
export function markChapterCompleted(id: number): Set<number> {
  const completed = loadProgress();
  completed.add(id);
  saveProgress(completed);
  return completed;
}

/** Clear all campaign progress (used by tests / a future reset button). */
export function resetProgress(): void {
  saveProgress(new Set());
}

// --- Win-condition evaluation -----------------------------------------------

/** Minimal engine view the win evaluator needs (satisfied by GameSession). */
export interface CampaignWorldView {
  /** Number of players seeded in the world. */
  readonly playerCount: number;
  /** Live building count for a player (HQ + sites + working). */
  buildingsOf(player: number): number;
  /** Count of nodes owned by a player. */
  ownedLandOf(player: number): number;
}

/** The result of one evaluation tick. */
export interface WinStatus {
  /** True once the chapter's goal is met. */
  readonly done: boolean;
  /** Short progress line for the Objectives panel (e.g. "7 / 10 buildings"). */
  readonly progress: string;
}

/**
 * Stateful win-condition checker. Some conditions need memory across ticks
 * (`defeatAll` must ignore phantom players that never had a building, so a map
 * seeded with more player slots than actual HQs never counts as an instant
 * win); create one per game via {@link makeWinTracker} and call {@link evaluate}
 * periodically with a fresh world view.
 */
export class WinTracker {
  /** Enemy players observed holding at least one building (the "real" foes). */
  private readonly activeEnemies = new Set<number>();

  constructor(private readonly win: WinCondition) {}

  evaluate(view: CampaignWorldView): WinStatus {
    switch (this.win.kind) {
      case 'buildings': {
        const have = view.buildingsOf(0);
        return {
          done: have >= this.win.count,
          progress: `${Math.min(have, this.win.count)} / ${this.win.count} buildings`,
        };
      }
      case 'territory': {
        let total = 0;
        let mine = 0;
        for (let p = 0; p < view.playerCount; p++) {
          const land = view.ownedLandOf(p);
          total += land;
          if (p === 0) mine = land;
        }
        const share = total > 0 ? mine / total : 0;
        const target = this.win.fraction;
        return {
          done: total > 0 && share >= target,
          progress: `${Math.round(share * 100)}% of ${Math.round(target * 100)}% land`,
        };
      }
      case 'defeatAll': {
        // Register any enemy that currently holds buildings as a real foe, then
        // require every registered foe to have been wiped out.
        let standing = 0;
        for (let p = 1; p < view.playerCount; p++) {
          const n = view.buildingsOf(p);
          if (n > 0) this.activeEnemies.add(p);
          if (this.activeEnemies.has(p) && n > 0) standing++;
        }
        const total = this.activeEnemies.size;
        return {
          done: total > 0 && standing === 0,
          progress:
            total === 0 ? 'Locate the enemy' : `${total - standing} / ${total} enemies defeated`,
        };
      }
    }
  }
}

/** Create a fresh win tracker for a chapter's condition. */
export function makeWinTracker(win: WinCondition): WinTracker {
  return new WinTracker(win);
}

/**
 * Fetch a map's JSON and return the non-human player slots that own a starting
 * HQ (i.e. the slots that should be Computer opponents in campaign mode). The
 * campaign maps declare `hq_x` per slot with 0xffff meaning "no HQ", so this
 * derives the real opponent count regardless of the map's nominal player field.
 * Returns an empty array on any failure (the game still starts, solo).
 */
export async function campaignAiSlots(mapFile: string): Promise<number[]> {
  const raw = await fetchJson<{ hq_x?: number[] }>(assetUrl(mapFile));
  const hq = raw?.hq_x;
  if (!Array.isArray(hq)) return [];
  const slots: number[] = [];
  for (let p = 1; p < hq.length; p++) {
    if (hq[p] !== undefined && hq[p] !== 0xffff) slots.push(p);
  }
  return slots;
}
