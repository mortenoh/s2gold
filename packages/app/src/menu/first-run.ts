/**
 * Missing-assets screens. The converted asset tree is produced from the
 * user's own game data by `make install`; the app never converts anything
 * itself. In the browser the title menu keeps rendering with a hint; in the
 * desktop app (which bundles the assets at build time) a missing tree means
 * the bundle was built before `make install`, so a full-panel message says so.
 */

import { clear, el } from '../lib/dom';

interface TauriGlobal {
  core: { invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> };
}

/** The desktop shell's global, present only inside the Tauri webview. */
export function tauriGlobal(): TauriGlobal | null {
  return (window as { __TAURI__?: TauriGlobal }).__TAURI__ ?? null;
}

const INTRO_TEXT =
  'This build carries no original game data. The graphics, sounds, music and ' +
  'maps are converted from your own copy of The Settlers II Gold Edition (GOG) ' +
  'by the asset pipeline.';

const MAKE_HINT =
  'Convert them with: make install INSTALLER=path/to/setup_the_settlers_2_gold_*.exe';

/**
 * Browser fallback: a short hint the title menu shows above its entries when
 * the assets are missing (the menu itself still renders, text-only).
 */
export function missingAssetsHint(): HTMLElement {
  const box = el('div', { class: 'first-run-hint', attrs: { 'data-testid': 'first-run-hint' } });
  box.append(
    el('p', { class: 'first-run-text', text: 'Game assets not installed. ' + INTRO_TEXT }),
  );
  box.append(el('p', { class: 'first-run-text', text: MAKE_HINT }));
  return box;
}

/** Desktop: replace the menu with the rebuild instructions. */
export function renderFirstRun(root: HTMLElement): void {
  clear(root);
  root.className = 'menu-screen menu-title';
  const panel = el('div', { class: 'menu-panel first-run', attrs: { 'data-testid': 'first-run' } });
  panel.append(el('h1', { class: 'first-run-title', text: 'Game assets not installed' }));
  panel.append(el('p', { class: 'first-run-text', text: INTRO_TEXT }));
  panel.append(
    el('p', {
      class: 'first-run-text',
      text:
        'This desktop build was made before the assets were converted, so nothing was ' +
        'bundled. Run the pipeline in the repository, then rebuild the app:',
    }),
  );
  panel.append(el('pre', { class: 'first-run-log', text: `${MAKE_HINT}\nmake desktop-app` }));
  root.append(panel);
}
