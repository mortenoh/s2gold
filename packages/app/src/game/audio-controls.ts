/**
 * Audio HUD controls (SFX mute + volume, music on/off + volume), wired to the
 * page-lived {@link AudioEngine}. Lives in the Settings panel; the engine
 * persists every preference itself, so this is presentation only.
 */

import { el } from '../lib/dom';
import type { AudioEngine } from './audio';

/** Build the audio control cluster (two labelled button+slider groups). */
export function buildAudioControls(audio: AudioEngine): HTMLElement {
  const muteButton = el('button', {
    text: audio.isMuted ? 'Unmute' : 'Mute',
    attrs: { 'data-testid': 'sfx-mute', type: 'button' },
  });
  const sfxVolume = el('input', {
    class: 'vol',
    attrs: {
      'data-testid': 'sfx-volume',
      type: 'range',
      min: '0',
      max: '100',
      value: String(Math.round(audio.volume * 100)),
      title: 'SFX volume',
    },
  });
  const musicButton = el('button', {
    text: audio.music.isEnabled ? 'Music: on' : 'Music: off',
    attrs: { 'data-testid': 'music-toggle', type: 'button' },
  });
  const musicVolume = el('input', {
    class: 'vol',
    attrs: {
      'data-testid': 'music-volume',
      type: 'range',
      min: '0',
      max: '100',
      value: String(Math.round(audio.music.volume * 100)),
      title: 'Music volume',
    },
  });

  muteButton.addEventListener('click', () => {
    audio.setMuted(!audio.isMuted);
    muteButton.textContent = audio.isMuted ? 'Unmute' : 'Mute';
  });
  sfxVolume.addEventListener('input', () => {
    audio.setVolume(Number(sfxVolume.value) / 100);
  });
  musicButton.addEventListener('click', () => {
    audio.music.setEnabled(!audio.music.isEnabled);
    musicButton.textContent = audio.music.isEnabled ? 'Music: on' : 'Music: off';
  });
  musicVolume.addEventListener('input', () => {
    audio.music.setVolume(Number(musicVolume.value) / 100);
  });

  return el(
    'span',
    { class: 'audio-controls' },
    el(
      'span',
      { class: 'audio-group' },
      el('span', { class: 'audio-label', text: 'SFX' }),
      muteButton,
      sfxVolume,
    ),
    el(
      'span',
      { class: 'audio-group' },
      el('span', { class: 'audio-label', text: 'Music' }),
      musicButton,
      musicVolume,
    ),
  );
}
