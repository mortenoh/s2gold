/**
 * Persisted view preferences (fog of war, tick counter, FPS counter). These are
 * presentation choices, stored like the audio prefs so they survive a reload or
 * loading a save (the save file holds only game state). All reads/writes are
 * defensive: localStorage may be unavailable (private mode).
 */

const FOG_LS_KEY = 's2gold.view.fog';
export const TICK_LS_KEY = 's2gold.view.tick';
export const FPS_LS_KEY = 's2gold.view.fps';

/** Fog of war defaults ON: anything but an explicit '0' reads as enabled. */
export function readFogPref(): boolean {
  try {
    return localStorage.getItem(FOG_LS_KEY) !== '0';
  } catch {
    return true;
  }
}

export function writeFogPref(on: boolean): void {
  try {
    localStorage.setItem(FOG_LS_KEY, on ? '1' : '0');
  } catch {
    /* storage may be unavailable (private mode) — ignore. */
  }
}

/** Debug readouts (tick/FPS) default OFF: only an explicit '1' enables them. */
export function readVisPref(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function writeVisPref(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    /* storage may be unavailable (private mode) — ignore. */
  }
}

/**
 * Graphics set: the original art, the 2x MMPX-magnified HD set, or Auto (HD on
 * high-density screens, where each world pixel covers 1.5 or more device
 * pixels). Read once when the game page starts; a change applies on reload.
 */
export type GraphicsPref = 'auto' | 'original' | 'hd';

export const GRAPHICS_LS_KEY = 's2gold.view.graphics';
const GRAPHICS_PREFS: readonly GraphicsPref[] = ['auto', 'original', 'hd'];

export function readGraphicsPref(): GraphicsPref {
  try {
    const v = localStorage.getItem(GRAPHICS_LS_KEY);
    return GRAPHICS_PREFS.includes(v as GraphicsPref) ? (v as GraphicsPref) : 'auto';
  } catch {
    return 'auto';
  }
}

export function writeGraphicsPref(pref: GraphicsPref): void {
  try {
    localStorage.setItem(GRAPHICS_LS_KEY, pref);
  } catch {
    /* storage may be unavailable (private mode) — ignore. */
  }
}

/** The preference after `pref` in the Auto, Original, HD cycle. */
export function nextGraphicsPref(pref: GraphicsPref): GraphicsPref {
  const i = GRAPHICS_PREFS.indexOf(pref);
  return GRAPHICS_PREFS[(i + 1) % GRAPHICS_PREFS.length] ?? 'auto';
}

/** Asset scale a preference selects on a screen with this device pixel ratio. */
export function graphicsScale(pref: GraphicsPref, dpr: number): 1 | 2 {
  if (pref === 'hd') return 2;
  if (pref === 'original') return 1;
  return dpr >= 1.5 ? 2 : 1;
}

/** Human label, e.g. "Graphics: Auto (HD)". */
export function graphicsLabel(pref: GraphicsPref, dpr: number): string {
  if (pref === 'hd') return 'Graphics: HD';
  if (pref === 'original') return 'Graphics: Original';
  return `Graphics: Auto (${graphicsScale(pref, dpr) === 2 ? 'HD' : 'Original'})`;
}
