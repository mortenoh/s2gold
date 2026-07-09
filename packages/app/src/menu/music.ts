/**
 * Menu background music, reusing the game's {@link MusicPlayer} (the same
 * HTMLAudioElement playlist the in-game jukebox uses) so preferences and track
 * order stay consistent between the menu and the game. Autoplay policy forbids
 * sound before a gesture, so playback is armed on the first pointer/key event.
 */

import { assetUrl, fetchJson } from '../lib/manifest';
import { MusicPlayer } from '../game/audio';

interface ClipEntry {
  file: string;
  duration: number;
}

/** Owns a MusicPlayer, loads the playlist, and unlocks it on first gesture. */
export class MenuMusic {
  readonly player = new MusicPlayer();
  private armed = false;

  constructor() {
    this.player.element.hidden = true;
  }

  /** Attach the audio element to the DOM and start loading the playlist. */
  mount(host: HTMLElement): void {
    host.append(this.player.element);
    void this.loadPlaylist();
    const arm = (): void => this.unlock();
    window.addEventListener('pointerdown', arm, { once: true });
    window.addEventListener('keydown', arm, { once: true });
  }

  private async loadPlaylist(): Promise<void> {
    const idx = await fetchJson<Record<string, ClipEntry>>(assetUrl('music/index.json'));
    if (idx) this.player.setPlaylist(idx);
  }

  /** Begin playback if music is enabled (safe to call repeatedly). */
  unlock(): void {
    this.armed = true;
    this.player.unlock();
  }

  get isArmed(): boolean {
    return this.armed;
  }

  /** Toggle music on/off, returning the new state. */
  toggle(): boolean {
    const next = !this.player.isEnabled;
    this.player.setEnabled(next);
    if (next) this.player.unlock();
    return next;
  }
}
