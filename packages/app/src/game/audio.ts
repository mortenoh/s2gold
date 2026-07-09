/**
 * WebAudio sound-effect + background-music engine for the game page.
 *
 * The browser autoplay policy forbids starting audio before a user gesture, so
 * nothing is created until {@link AudioEngine.unlock} is called from the first
 * click/keypress. SFX clips (sfx/index.json, numeric SOUND.LST ids) are fetched
 * and decoded to AudioBuffers lazily on first use and cached; each {@link play}
 * spins up a short-lived source through a per-voice gain + stereo panner so the
 * caller can position it from world coordinates. A small voice cap and a
 * per-clip cooldown keep 10x-speed event storms from turning into a buzzsaw.
 *
 * Background music is a plain HTMLAudioElement playlist (music/index.json order,
 * continuous — matching the original's in-game jukebox); long mp3s are streamed
 * rather than decoded. The engine lives for the whole page, so music survives a
 * map switch. Mute/volume state is persisted in localStorage.
 */

import { assetUrl, fetchJson } from '../lib/manifest';

/** Max simultaneously-playing SFX voices (older excess plays are dropped). */
const MAX_VOICES = 8;
/** Minimum ms between two plays of the same clip id (anti-spam at high speed). */
const CLIP_COOLDOWN_MS = 90;

interface ClipEntry {
  file: string;
  duration: number;
}
type SfxIndex = Record<string, ClipEntry>;
type MusicIndex = Record<string, ClipEntry>;

/** localStorage keys for persisted audio preferences. */
const LS = {
  muted: 's2gold.audio.muted',
  sfxVolume: 's2gold.audio.sfxVolume',
  musicOn: 's2gold.audio.musicOn',
  musicVolume: 's2gold.audio.musicVolume',
} as const;

function lsGetNum(key: string, fallback: number): number {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}
function lsGetBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}
function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage may be unavailable (private mode) — ignore. */
  }
}

/** Diagnostics surfaced on window.__s2debug.audio for e2e assertions. */
export interface AudioDebug {
  /** AudioContext state, or 'none' before unlock. */
  contextState: string;
  /** Distinct clip ids whose buffer decode has been requested. */
  sfxRequested: number;
  /** Buffers successfully decoded and cached. */
  buffersLoaded: number;
  /** SFX play() calls that actually started a voice. */
  sfxPlayed: number;
  /** Currently active voices. */
  voices: number;
  muted: boolean;
  musicPlaying: boolean;
}

/** Positional play parameters resolved from world position vs. camera. */
export interface PlayOptions {
  /** Linear volume 0..1 (0 = silent, skipped). */
  volume?: number;
  /** Stereo pan -1 (left) .. 1 (right). */
  pan?: number;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxIndex: SfxIndex | null = null;
  private readonly buffers = new Map<number, AudioBuffer>();
  private readonly requested = new Set<number>();
  private readonly lastPlayed = new Map<number, number>();
  private voices = 0;

  private muted = lsGetBool(LS.muted, false);
  private sfxVolume = lsGetNum(LS.sfxVolume, 0.8);
  private buffersLoaded = 0;
  private sfxPlayed = 0;

  readonly music = new MusicPlayer();

  /** True once the AudioContext exists (after the first user gesture). */
  get ready(): boolean {
    return this.ctx !== null;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  get volume(): number {
    return this.sfxVolume;
  }

  /**
   * Create the AudioContext and kick off index/music loading. Idempotent and
   * safe to call from every gesture handler; resumes a suspended context.
   */
  unlock(): void {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : this.sfxVolume;
      this.masterGain.connect(this.ctx.destination);
      void this.loadIndexes();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.music.unlock();
  }

  private async loadIndexes(): Promise<void> {
    if (!this.sfxIndex) {
      const idx = await fetchJson<SfxIndex>(assetUrl('sfx/index.json'));
      if (idx) this.sfxIndex = idx;
    }
    const midx = await fetchJson<MusicIndex>(assetUrl('music/index.json'));
    if (midx) this.music.setPlaylist(midx);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    lsSet(LS.muted, muted ? '1' : '0');
    if (this.masterGain) this.masterGain.gain.value = muted ? 0 : this.sfxVolume;
  }

  setVolume(v: number): void {
    this.sfxVolume = Math.max(0, Math.min(1, v));
    lsSet(LS.sfxVolume, String(this.sfxVolume));
    if (this.masterGain && !this.muted) this.masterGain.gain.value = this.sfxVolume;
  }

  /** Ensure a clip's buffer is decoding/decoded; returns the buffer if ready. */
  private ensureBuffer(id: number): AudioBuffer | null {
    const existing = this.buffers.get(id);
    if (existing) return existing;
    if (!this.requested.has(id) && this.ctx && this.sfxIndex) {
      const entry = this.sfxIndex[String(id)];
      if (entry) {
        this.requested.add(id);
        void this.decode(id, entry.file);
      }
    }
    return null;
  }

  private async decode(id: number, file: string): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      const res = await fetch(assetUrl(file), { cache: 'force-cache' });
      if (!res.ok) return;
      const raw = await res.arrayBuffer();
      const buf = await ctx.decodeAudioData(raw);
      this.buffers.set(id, buf);
      this.buffersLoaded++;
    } catch (err) {
      console.warn(`[s2gold] failed to decode sfx ${id}`, err);
    }
  }

  /**
   * Play SFX clip `id` at the given positional volume/pan. No-ops when muted,
   * silent, over the voice cap, or within the clip's cooldown. The first call
   * for an undecoded clip just requests the decode (so it plays next time).
   */
  play(id: number, opts: PlayOptions = {}): void {
    const ctx = this.ctx;
    const master = this.masterGain;
    if (!ctx || !master || this.muted) return;
    const volume = opts.volume ?? 1;
    if (volume <= 0.001) return;

    const now = performance.now();
    const last = this.lastPlayed.get(id) ?? -Infinity;
    if (now - last < CLIP_COOLDOWN_MS) return;

    const buffer = this.ensureBuffer(id);
    if (!buffer) return;
    if (this.voices >= MAX_VOICES) return;

    this.lastPlayed.set(id, now);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = Math.max(0, Math.min(1, volume));
    let tail: AudioNode = gain;
    if (typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, opts.pan ?? 0));
      gain.connect(panner);
      tail = panner;
    }
    src.connect(gain);
    tail.connect(master);
    this.voices++;
    src.onended = (): void => {
      this.voices = Math.max(0, this.voices - 1);
      src.disconnect();
      gain.disconnect();
      if (tail !== gain) tail.disconnect();
    };
    src.start();
    this.sfxPlayed++;
  }

  debug(): AudioDebug {
    return {
      contextState: this.ctx?.state ?? 'none',
      sfxRequested: this.requested.size,
      buffersLoaded: this.buffersLoaded,
      sfxPlayed: this.sfxPlayed,
      voices: this.voices,
      muted: this.muted,
      musicPlaying: this.music.isPlaying,
    };
  }
}

/**
 * Continuous background-music playlist over a single HTMLAudioElement. Streams
 * the mp3s in index order, advancing on `ended`, looping the list. Independent
 * of the sim so it plays across map switches.
 */
export class MusicPlayer {
  private readonly audio = new Audio();
  private order: string[] = [];
  private cursor = 0;
  private enabled = lsGetBool(LS.musicOn, true);
  private vol = lsGetNum(LS.musicVolume, 0.5);
  private unlocked = false;

  constructor() {
    this.audio.preload = 'none';
    this.audio.volume = this.vol;
    this.audio.addEventListener('ended', () => this.next());
  }

  get isEnabled(): boolean {
    return this.enabled;
  }
  get volume(): number {
    return this.vol;
  }
  get isPlaying(): boolean {
    return this.unlocked && this.enabled && !this.audio.paused;
  }
  /** Whether the player has a real <audio> element (for "audio elements exist"). */
  get element(): HTMLAudioElement {
    return this.audio;
  }

  setPlaylist(index: MusicIndex): void {
    this.order = Object.values(index).map((e) => e.file);
    if (this.unlocked && this.enabled && this.audio.paused) this.playCurrent();
  }

  /** Called from the first user gesture; begins playback if enabled. */
  unlock(): void {
    this.unlocked = true;
    if (this.enabled && this.audio.paused && this.order.length > 0) this.playCurrent();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    lsSet(LS.musicOn, on ? '1' : '0');
    if (!on) {
      this.audio.pause();
    } else if (this.unlocked && this.order.length > 0) {
      this.playCurrent();
    }
  }

  setVolume(v: number): void {
    this.vol = Math.max(0, Math.min(1, v));
    lsSet(LS.musicVolume, String(this.vol));
    this.audio.volume = this.vol;
  }

  private playCurrent(): void {
    const file = this.order[this.cursor % this.order.length];
    if (!file) return;
    if (!this.audio.src.endsWith(file)) this.audio.src = assetUrl(file);
    void this.audio.play().catch(() => {
      /* autoplay may still be blocked; a later gesture retries. */
    });
  }

  private next(): void {
    if (this.order.length === 0) return;
    this.cursor = (this.cursor + 1) % this.order.length;
    this.playCurrent();
  }
}

/**
 * Resolve positional volume/pan for a world-pixel point against the camera.
 * Volume falls off linearly with distance from the viewport centre and reaches
 * zero past `margin` beyond the visible half-extent; pan tracks horizontal
 * offset. Wrapping (torus) is handled by folding the delta into [-half, half].
 */
export function positional(
  worldX: number,
  worldY: number,
  cameraX: number,
  cameraY: number,
  zoom: number,
  canvasW: number,
  canvasH: number,
  worldW: number,
  worldH: number,
): PlayOptions {
  const viewW = canvasW / zoom;
  const viewH = canvasH / zoom;
  const cx = cameraX + viewW / 2;
  const cy = cameraY + viewH / 2;
  let dx = worldX - cx;
  dx -= Math.round(dx / worldW) * worldW;
  let dy = worldY - cy;
  dy -= Math.round(dy / worldH) * worldH;

  // Silent once outside the viewport plus a one-tile margin on either side.
  const marginX = viewW / 2 + 56;
  const marginY = viewH / 2 + 56;
  if (Math.abs(dx) > marginX || Math.abs(dy) > marginY) return { volume: 0 };

  const fall = Math.max(Math.abs(dx) / marginX, Math.abs(dy) / marginY);
  const volume = Math.max(0, 1 - fall);
  const pan = Math.max(-1, Math.min(1, dx / (viewW / 2)));
  return { volume, pan };
}
