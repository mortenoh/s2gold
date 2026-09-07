/**
 * First-run screen: shown by the title menu when the converted asset tree is
 * missing. In the desktop app it drives the conversion (native file picker
 * for the GOG installer, log streamed from the `convert_assets` command); in
 * the browser it only explains how to run the pipeline.
 */

import { clear, el } from '../lib/dom';

interface TauriDialog {
  open(options: {
    multiple?: boolean;
    directory?: boolean;
    title?: string;
    filters?: { name: string; extensions: string[] }[];
  }): Promise<string | string[] | null>;
}

interface TauriGlobal {
  core: { invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> };
  event: {
    listen<T>(name: string, handler: (event: { payload: T }) => void): Promise<() => void>;
  };
  dialog?: TauriDialog;
}

interface ConverterStatus {
  available: boolean;
  converter: string;
  innoextract: string | null;
  fluidsynth: string | null;
  ffmpeg: string | null;
  assets_dir: string;
  problems: string[];
}

/** The desktop shell's global, present only inside the Tauri webview. */
export function tauriGlobal(): TauriGlobal | null {
  return (window as { __TAURI__?: TauriGlobal }).__TAURI__ ?? null;
}

const INTRO_TEXT =
  'This app ships without any original game data. It converts the graphics, ' +
  'sounds, music and maps from your own copy of The Settlers II Gold Edition ' +
  'from GOG (the Windows installer, setup_the_settlers_2_gold_*.exe).';

/**
 * Browser fallback: a short hint the title menu shows above its entries when
 * the assets are missing (the menu itself still renders, text-only).
 */
export function missingAssetsHint(): HTMLElement {
  const box = el('div', { class: 'first-run-hint', attrs: { 'data-testid': 'first-run-hint' } });
  box.append(
    el('p', { class: 'first-run-text', text: 'Game assets not installed. ' + INTRO_TEXT }),
  );
  box.append(
    el('p', {
      class: 'first-run-text',
      text: 'Convert them with: make install INSTALLER=path/to/setup_the_settlers_2_gold_*.exe',
    }),
  );
  return box;
}

/** Render the desktop first-run screen into `root` (requires the Tauri global). */
export async function renderFirstRun(root: HTMLElement, tauri: TauriGlobal): Promise<void> {
  clear(root);
  root.className = 'menu-screen menu-title';
  const panel = el('div', { class: 'menu-panel first-run', attrs: { 'data-testid': 'first-run' } });
  panel.append(el('h1', { class: 'first-run-title', text: 'Game assets not installed' }));
  panel.append(el('p', { class: 'first-run-text', text: INTRO_TEXT }));

  const status = await tauri.core.invoke<ConverterStatus>('converter_status').catch((err) => {
    return {
      available: false,
      converter: 'unavailable',
      innoextract: null,
      fluidsynth: null,
      ffmpeg: null,
      assets_dir: '',
      problems: [String(err)],
    } satisfies ConverterStatus;
  });

  const tools = el('ul', { class: 'first-run-tools', attrs: { 'data-testid': 'first-run-tools' } });
  tools.append(el('li', { text: `Converter: ${status.converter}` }));
  tools.append(el('li', { text: `innoextract: ${status.innoextract ?? 'missing (required)'}` }));
  tools.append(
    el('li', { text: `fluidsynth: ${status.fluidsynth ?? 'missing (music is skipped)'}` }),
  );
  tools.append(
    el('li', { text: `ffmpeg: ${status.ffmpeg ?? 'missing (music/intro are skipped)'}` }),
  );
  tools.append(el('li', { text: `Output: ${status.assets_dir}` }));
  panel.append(tools);

  for (const problem of status.problems) {
    panel.append(el('p', { class: 'first-run-problem', text: problem }));
  }

  const pick = el('button', {
    class: 'menu-button first-run-pick',
    type: 'button',
    attrs: { 'data-testid': 'first-run-pick' },
    text: 'Choose GOG installer...',
  }) as HTMLButtonElement;
  pick.disabled = !status.available || !tauri.dialog;
  const log = el('pre', { class: 'first-run-log', attrs: { 'data-testid': 'first-run-log' } });
  log.hidden = true;
  const state = el('p', { class: 'first-run-state', attrs: { 'data-testid': 'first-run-state' } });

  pick.addEventListener('click', () => {
    void (async () => {
      const chosen = await tauri.dialog?.open({
        multiple: false,
        title: 'Select setup_the_settlers_2_gold_*.exe',
        filters: [{ name: 'GOG installer', extensions: ['exe'] }],
      });
      const installer = Array.isArray(chosen) ? chosen[0] : chosen;
      if (!installer) return;
      pick.disabled = true;
      log.hidden = false;
      log.textContent = '';
      state.textContent = 'Converting... this takes a few minutes.';
      const unlisten = await tauri.event.listen<string>('convert-progress', (ev) => {
        log.textContent += ev.payload + '\n';
        log.scrollTop = log.scrollHeight;
      });
      try {
        await tauri.core.invoke('convert_assets', { installer });
        state.textContent = 'Done. Starting the game...';
        window.location.reload();
      } catch (err) {
        state.textContent = `Conversion failed: ${String(err)}`;
        pick.disabled = false;
      } finally {
        unlisten();
      }
    })();
  });

  panel.append(pick, state, log);
  root.append(panel);
}
