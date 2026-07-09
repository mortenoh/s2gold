/**
 * Game page (P1): load a converted map, render the terrain with the WebGL2
 * renderer, and provide scrolling (drag + arrow keys), a 1x/2x zoom toggle,
 * an FPS counter, a map picker and a wrap-aware minimap.
 */

import './styles.css';
import { Camera, SpriteRenderer, TerrainRenderer, TR_H, TR_W } from '@s2gold/renderer';
import { clear, el } from '../lib/dom';
import { loadMap, loadMapIndex, loadTerrainImage, pickMap, type MapIndexEntry } from './map-loader';
import { buildStaticObjects, objectAtlasForLandscape } from './map-objects';
import { loadAtlas } from './sprite-atlas';
import { MinimapView } from './minimap-view';

/** World-px pan speed per second when holding an arrow key. */
const KEY_PAN_SPEED = 600;

/**
 * Milliseconds per tree-wave animation frame. The original advances the wind
 * animation roughly every 4-5 game frames; at the original's ~28 fps game clock
 * that is about 150 ms, giving an ~1.2 s eight-frame cycle.
 */
const ANIM_FRAME_MS = 150;

/** Debug counters exposed on window for e2e assertions. */
interface S2Debug {
  staticObjects: number;
  trees: number;
  granite: number;
  decorations: number;
  skipped: number;
  spriteQuads: number;
  spriteDrawCalls: number;
}

declare global {
  interface Window {
    __s2debug?: S2Debug;
  }
}

function showMessage(root: HTMLElement, testid: string, html: string): void {
  clear(root);
  root.append(el('div', { class: 'game-message', html, attrs: { 'data-testid': testid } }));
}

async function boot(): Promise<void> {
  const root = document.querySelector<HTMLElement>('#game');
  if (!root) return;

  const index = await loadMapIndex();
  if (!index) {
    showMessage(
      root,
      'game-assets-missing',
      'No converted maps found at <code>/assets/maps/index.json</code>.<br />' +
        'Run <code>make install INSTALLER=path/to/gog.exe</code>, then reload.',
    );
    return;
  }

  clear(root);
  const canvas = el('canvas', { class: 'game-canvas', attrs: { 'data-testid': 'game-canvas' } });
  const mapSelect = el('select', { attrs: { 'data-testid': 'map-select' } });
  const zoomButton = el('button', {
    text: 'Zoom 1x',
    attrs: { 'data-testid': 'zoom-toggle', type: 'button' },
  });
  const mapTitle = el('span', { class: 'map-title', attrs: { 'data-testid': 'map-title' } });
  const fps = el('span', { class: 'fps', text: '-- fps', attrs: { 'data-testid': 'fps' } });
  const minimapCanvas = el('canvas', { attrs: { 'data-testid': 'minimap' } });

  for (const entry of index) {
    mapSelect.append(
      el('option', {
        text: `${entry.title || entry.name} (${entry.width}x${entry.height}, ${entry.terrain_name})`,
        attrs: { value: entry.name },
      }),
    );
  }

  root.append(
    canvas,
    el(
      'div',
      { class: 'hud-top' },
      el('a', { href: '/', text: 's2gold' }),
      mapTitle,
      mapSelect,
      zoomButton,
      fps,
    ),
    el('div', { class: 'minimap-box' }, minimapCanvas),
  );

  let renderer: TerrainRenderer;
  let sprites: SpriteRenderer;
  try {
    renderer = new TerrainRenderer(canvas);
    sprites = new SpriteRenderer(renderer.glContext);
  } catch (err) {
    showMessage(root, 'game-no-webgl', `WebGL2 unavailable: ${String(err)}`);
    return;
  }

  let camera = new Camera(1, 1);
  const minimap = new MinimapView(minimapCanvas, (wx, wy) => {
    camera.centerOn(wx, wy, canvas.width, canvas.height);
  });

  async function switchMap(entry: MapIndexEntry): Promise<void> {
    delete document.body.dataset.mapReady;
    const map = await loadMap(entry);
    const atlas = await loadTerrainImage(map.terrain);
    renderer.resize();
    renderer.load(map.data, atlas);

    // Build the object layer: register the landscape's object atlas (once) and
    // translate the map's object planes into static sprites.
    const archive = objectAtlasForLandscape(map.terrain);
    if (!sprites.hasAtlas(archive)) {
      const loaded = await loadAtlas(archive);
      if (loaded) sprites.registerAtlas(loaded.meta, loaded.pages);
    }
    const built = buildStaticObjects(
      map.data.width,
      map.data.height,
      map.objectType,
      map.objectIndex,
      map.terrain,
    );
    sprites.setMap(map.data.width, map.data.height, map.data.heightLayer);
    sprites.setStaticObjects(sprites.hasAtlas(archive) ? built.objects : []);
    window.__s2debug = {
      staticObjects: sprites.hasAtlas(archive) ? built.objects.length : 0,
      trees: built.counts.trees,
      granite: built.counts.granite,
      decorations: built.counts.decorations,
      skipped: built.counts.skipped,
      spriteQuads: 0,
      spriteDrawCalls: 0,
    };

    camera = new Camera(map.data.width, map.data.height);
    minimap.setMap(map.data, camera.worldSize.w, camera.worldSize.h);

    // Start over player 1's HQ when the map defines one (0xFFFF = unused).
    const hqX = map.hqX[0] ?? 0xffff;
    const hqY = map.hqY[0] ?? 0xffff;
    if (hqX !== 0xffff && hqY !== 0xffff) {
      camera.centerOn(hqX * TR_W, hqY * TR_H, canvas.width, canvas.height);
    } else {
      camera.centerOn(camera.worldSize.w / 2, camera.worldSize.h / 2, canvas.width, canvas.height);
    }

    mapTitle.textContent = map.title || entry.name;
    mapSelect.value = entry.name;
    zoomButton.textContent = zoomLabel();
    document.title = `s2gold — ${map.title || entry.name}`;
    const url = new URL(window.location.href);
    url.searchParams.set('map', entry.name);
    window.history.replaceState(null, '', url);
    document.body.dataset.mapReady = entry.name;
  }

  mapSelect.addEventListener('change', () => {
    const entry = index.find((m) => m.name === mapSelect.value);
    if (entry) void switchMap(entry);
  });

  const zoomLabel = (): string => `Zoom ${camera.zoom.toFixed(camera.zoom % 1 === 0 ? 0 : 2)}x`;
  zoomButton.addEventListener('click', () => {
    camera.toggleZoom(canvas.width, canvas.height);
    zoomButton.textContent = zoomLabel();
  });

  // Mouse-wheel zoom anchored at the cursor. Scale by the actual scroll delta so
  // trackpads (many small events) zoom gently while a full wheel notch (~100px)
  // gives a moderate step; deltaMode 1 means lines, normalize to ~16px each.
  canvas.addEventListener(
    'wheel',
    (ev) => {
      ev.preventDefault();
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const sx = (ev.clientX - rect.left) * dpr;
      const sy = (ev.clientY - rect.top) * dpr;
      const deltaPx = ev.deltaMode === 1 ? ev.deltaY * 16 : ev.deltaY;
      camera.zoomAt(camera.zoom * Math.exp(-deltaPx * 0.001), sx, sy);
      zoomButton.textContent = zoomLabel();
    },
    { passive: false },
  );

  // Drag-to-scroll on the main canvas.
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  canvas.addEventListener('pointerdown', (ev) => {
    dragging = true;
    lastX = ev.clientX;
    lastY = ev.clientY;
    canvas.classList.add('dragging');
    canvas.setPointerCapture(ev.pointerId);
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!dragging) return;
    const dpr = window.devicePixelRatio || 1;
    camera.panScreen((lastX - ev.clientX) * dpr, (lastY - ev.clientY) * dpr);
    lastX = ev.clientX;
    lastY = ev.clientY;
  });
  canvas.addEventListener('pointerup', (ev) => {
    dragging = false;
    canvas.classList.remove('dragging');
    canvas.releasePointerCapture(ev.pointerId);
  });

  // Arrow-key panning (smooth, per-frame while held).
  const held = new Set<string>();
  const panKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
  window.addEventListener('keydown', (ev) => {
    if (panKeys.includes(ev.key)) {
      held.add(ev.key);
      ev.preventDefault();
    } else if (ev.key === 'z' || ev.key === 'Z') {
      camera.toggleZoom(canvas.width, canvas.height);
      zoomButton.textContent = zoomLabel();
    }
  });
  window.addEventListener('keyup', (ev) => held.delete(ev.key));
  window.addEventListener('blur', () => held.clear());

  // Render loop with an FPS counter.
  let frames = 0;
  let fpsWindowStart = performance.now();
  let lastFrame = performance.now();
  function frame(now: number): void {
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;

    if (held.size > 0) {
      const dist = KEY_PAN_SPEED * dt;
      let dx = 0;
      let dy = 0;
      if (held.has('ArrowLeft')) dx -= dist;
      if (held.has('ArrowRight')) dx += dist;
      if (held.has('ArrowUp')) dy -= dist;
      if (held.has('ArrowDown')) dy += dist;
      camera.panWorld(dx, dy);
    }

    renderer.resize();
    renderer.render(camera);
    const tick = Math.floor(now / ANIM_FRAME_MS);
    const stats = sprites.render(camera, tick);
    if (window.__s2debug) {
      window.__s2debug.spriteQuads = stats.quads;
      window.__s2debug.spriteDrawCalls = stats.drawCalls;
    }
    minimap.draw(camera, canvas.width, canvas.height);

    frames++;
    if (now - fpsWindowStart >= 500) {
      fps.textContent = `${Math.round((frames * 1000) / (now - fpsWindowStart))} fps`;
      frames = 0;
      fpsWindowStart = now;
    }
    requestAnimationFrame(frame);
  }

  const query = new URLSearchParams(window.location.search).get('map');
  await switchMap(pickMap(index, query));
  requestAnimationFrame(frame);
}

void boot();
