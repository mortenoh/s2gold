/**
 * Intro video: a fullscreen overlay that plays the converted intro movie
 * (`video/intro.mp4`) with a native HTML5 <video>. Click anywhere or press Esc
 * to skip; playing to the end or skipping records that the intro was watched in
 * localStorage so it is offered only once automatically (a "Replay intro" menu
 * entry can still open it on demand).
 */

import { assetUrl, fetchJson } from '../lib/manifest';
import { el } from '../lib/dom';

const WATCHED_KEY = 's2gold.intro.watched';

/** True when the intro has been watched (or skipped) at least once. */
export function introWatched(): boolean {
  try {
    return window.localStorage.getItem(WATCHED_KEY) === '1';
  } catch {
    return false;
  }
}

/** Record that the intro has been watched/skipped. */
function markWatched(): void {
  try {
    window.localStorage.setItem(WATCHED_KEY, '1');
  } catch {
    // Non-fatal: worst case the intro auto-offers again next visit.
  }
}

/** Resolve the intro video URL from video/index.json, falling back to the default. */
async function introUrl(): Promise<string> {
  const idx = await fetchJson<{ intro?: string }>(assetUrl('video/index.json'));
  const rel = idx?.intro ?? 'video/intro.mp4';
  return assetUrl(rel);
}

/**
 * Open the intro overlay over `host`. Resolves when the video ends, is skipped,
 * or fails to load. Safe to call repeatedly; only one overlay exists at a time.
 */
export async function openIntro(host: HTMLElement): Promise<void> {
  // Never stack two overlays.
  if (host.querySelector('[data-testid="intro-overlay"]')) return;

  const url = await introUrl();

  return new Promise<void>((resolve) => {
    const video = el('video', {
      class: 'intro-video',
      attrs: { 'data-testid': 'intro-video', playsinline: '', preload: 'auto' },
    }) as HTMLVideoElement;
    video.src = url;
    video.controls = true;
    video.autoplay = true;

    const skipBtn = el('button', {
      class: 'intro-skip',
      type: 'button',
      text: 'Skip ▶',
      attrs: { 'data-testid': 'intro-skip', title: 'Skip the intro (Esc)' },
    });

    const overlay = el(
      'div',
      { class: 'intro-overlay', attrs: { 'data-testid': 'intro-overlay' } },
      video,
      skipBtn,
    );

    let done = false;
    const close = (): void => {
      if (done) return;
      done = true;
      markWatched();
      try {
        video.pause();
      } catch {
        // ignore
      }
      window.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve();
    };

    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        close();
      }
    };

    skipBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      close();
    });
    // Click on the backdrop (not the video/controls) skips too.
    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay) close();
    });
    video.addEventListener('ended', close);
    video.addEventListener('error', close);
    window.addEventListener('keydown', onKey);

    host.append(overlay);
    // Autoplay may be blocked before a gesture; controls + click-to-skip cover it.
    void video.play().catch(() => {
      /* user can press play via the native controls */
    });
  });
}
