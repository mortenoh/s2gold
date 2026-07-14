/**
 * Camera controls for the game canvas: wheel zoom (cursor-anchored), pointer
 * drag panning, and arrow-key panning via a held-key set applied per frame.
 * The camera object is replaced on every map switch, so it is read through a
 * getter rather than captured.
 */

import type { Camera } from '@s2gold/renderer';

/** World-px pan speed per second when holding an arrow key. */
const KEY_PAN_SPEED = 600;

/**
 * True when a key event targets an editable field (text/number inputs, textarea,
 * select, or a contenteditable). Global game shortcuts (pan/zoom/pause) must skip
 * these so typing in the save-name and attack-count inputs is not swallowed.
 * Duck-typed on `tagName`/`isContentEditable` so it also holds up outside a DOM.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

export interface CameraInputOptions {
  canvas: HTMLCanvasElement;
  /** Live camera (replaced on map switch, hence a getter). */
  camera: () => Camera;
  /** Called after any zoom change so the HUD zoom label can update. */
  onZoomChanged: () => void;
  /** Space key: toggle pause. */
  onTogglePause: () => void;
}

export interface CameraInput {
  /** Apply arrow-key panning for a frame (dt in milliseconds). */
  panHeld(dtMs: number): void;
  /**
   * True when the pointer travelled far enough during the last drag that the
   * following click should be treated as a pan, not a map click.
   */
  draggedFar(): boolean;
}

/** Wire wheel/drag/keyboard camera controls; returns the per-frame hooks. */
export function installCameraInput(opts: CameraInputOptions): CameraInput {
  const { canvas, camera, onZoomChanged, onTogglePause } = opts;

  canvas.addEventListener(
    'wheel',
    (ev) => {
      ev.preventDefault();
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const sx = (ev.clientX - rect.left) * dpr;
      const sy = (ev.clientY - rect.top) * dpr;
      const deltaPx = ev.deltaMode === 1 ? ev.deltaY * 16 : ev.deltaY;
      camera().zoomAt(camera().zoom * Math.exp(-deltaPx * 0.001), sx, sy);
      onZoomChanged();
    },
    { passive: false },
  );

  let dragging = false;
  let draggedFarFlag = false;
  let lastX = 0;
  let lastY = 0;
  let dragTotal = 0;
  canvas.addEventListener('pointerdown', (ev) => {
    dragging = true;
    dragTotal = 0;
    draggedFarFlag = false;
    lastX = ev.clientX;
    lastY = ev.clientY;
    canvas.classList.add('dragging');
    canvas.setPointerCapture(ev.pointerId);
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!dragging) return;
    const dpr = window.devicePixelRatio || 1;
    dragTotal += Math.abs(lastX - ev.clientX) + Math.abs(lastY - ev.clientY);
    if (dragTotal > 6) draggedFarFlag = true;
    camera().panScreen((lastX - ev.clientX) * dpr, (lastY - ev.clientY) * dpr);
    lastX = ev.clientX;
    lastY = ev.clientY;
  });
  canvas.addEventListener('pointerup', (ev) => {
    dragging = false;
    canvas.classList.remove('dragging');
    canvas.releasePointerCapture(ev.pointerId);
  });

  const held = new Set<string>();
  const panKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
  window.addEventListener('keydown', (ev) => {
    if (isEditableTarget(ev.target)) return;
    if (panKeys.includes(ev.key)) {
      held.add(ev.key);
      ev.preventDefault();
    } else if (ev.key === 'z' || ev.key === 'Z') {
      camera().toggleZoom(canvas.width, canvas.height);
      onZoomChanged();
    } else if (ev.key === ' ') {
      onTogglePause();
      ev.preventDefault();
    }
  });
  // keyup is unconditional (no editable-target guard): a pan key held while the
  // game had focus and released after focus moved into an input must still clear,
  // or the camera would keep panning. Removing a key never in the set is a no-op.
  window.addEventListener('keyup', (ev) => held.delete(ev.key));
  window.addEventListener('blur', () => held.clear());

  return {
    panHeld(dtMs: number): void {
      if (held.size === 0) return;
      const dist = (KEY_PAN_SPEED * dtMs) / 1000;
      let dx = 0;
      let dy = 0;
      if (held.has('ArrowLeft')) dx -= dist;
      if (held.has('ArrowRight')) dx += dist;
      if (held.has('ArrowUp')) dy -= dist;
      if (held.has('ArrowDown')) dy += dist;
      camera().panWorld(dx, dy);
    },
    draggedFar: () => draggedFarFlag,
  };
}
