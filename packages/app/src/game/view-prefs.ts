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
