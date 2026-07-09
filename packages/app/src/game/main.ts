/**
 * Game page (P2): load a converted map, run the deterministic engine world in a
 * fixed-tick loop, and render the live economy — HQ, flags, roads-as-flags,
 * buildings, carriers and workers — over the WebGL2 terrain. Keeps the P1 map
 * picker, wheel zoom, drag/arrow scroll, minimap and FPS counter.
 */

import './styles.css';
import {
  Camera,
  RoadRenderer,
  SpriteRenderer,
  TerrainRenderer,
  TR_H,
  TR_W,
  type LandscapeSet,
} from '@s2gold/renderer';
import { clear, el } from '../lib/dom';
import { loadMap, loadMapIndex, loadTerrainImage, pickMap, type MapIndexEntry } from './map-loader';
import { buildStaticObjects, objectAtlasForLandscape } from './map-objects';
import { loadAtlas } from './sprite-atlas';
import { loadBobAtlas, type BobAtlas } from './bob-atlas';
import { MinimapView } from './minimap-view';
import { GameSession, SPEEDS, type Speed } from './session';
import {
  buildDynamics,
  nodeAnchor,
  roadSegments,
  BUILDING_ARCHIVE,
  BOB_ARCHIVE,
} from './game-render';
import { Interaction } from './interaction';

/** World-px pan speed per second when holding an arrow key. */
const KEY_PAN_SPEED = 600;

/**
 * Milliseconds per flag/tree wave-animation frame. The original advances the
 * wind animation every ~4-5 game frames (~150 ms), an ~1.2 s eight-frame cycle.
 */
const ANIM_FRAME_MS = 150;
/** Milliseconds per settler walk-cycle frame (legs). */
const WALK_FRAME_MS = 90;
/** Fixed RNG seed so the economy is reproducible across runs. */
const GAME_SEED = 0x5eed;

/** Debug counters + helpers exposed on window for e2e assertions. */
interface S2Debug {
  // P1 fields (kept for the P1 gate).
  staticObjects: number;
  trees: number;
  granite: number;
  decorations: number;
  skipped: number;
  spriteQuads: number;
  spriteDrawCalls: number;
  // P2 fields.
  tick: number;
  paused: boolean;
  speed: number;
  inventory: { trunk: number; plank: number; stone: number };
  counters: Record<string, number>;
  settlers: number;
  flags: number;
  buildings: number;
  roads: number;
  /** HQ building node id for player 0 (-1 when none). */
  hqNode: number;
  /** Node id nearest a map (x, y) lattice coordinate. */
  nodeOf(x: number, y: number): number;
  /** The flag node (SE of a door node) that a building here would use. */
  flagNodeOf(node: number): number;
  /** The flag id owned by player 0 at a node, or -1. */
  flagIdAt(node: number): number;
  /** True when player 0 may place a building of `type` on `node`. */
  canBuild(node: number, type: string): boolean;
  /** True when player 0 may place a flag on `node`. */
  canFlag(node: number): boolean;
  /** Client-space (CSS px) position of a node's ground anchor. */
  nodeToScreen(node: number): { x: number; y: number };
  /** Queue player-0 commands directly (test helper). */
  placeFlag(node: number): void;
  placeBuilding(node: number, type: string): void;
  buildRoad(path: number[]): void;
  /** Node path between two flag nodes over walkable ground, or null. */
  suggestRoad(startNode: number, endNode: number): number[] | null;
  setSpeed(speed: number): void;
  setPaused(paused: boolean): void;
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
  const resources = el('span', { class: 'resources', attrs: { 'data-testid': 'resources' } });
  const tickLabel = el('span', { class: 'tick', attrs: { 'data-testid': 'tick-counter' } });
  const pauseButton = el('button', {
    text: 'Pause',
    attrs: { 'data-testid': 'pause-toggle', type: 'button' },
  });
  const status = el('span', { class: 'build-status', attrs: { 'data-testid': 'build-status' } });
  const minimapCanvas = el('canvas', { attrs: { 'data-testid': 'minimap' } });

  const speedButtons = SPEEDS.map((s) =>
    el('button', { text: `${s}x`, attrs: { 'data-testid': `speed-${s}`, type: 'button' } }),
  );

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
      pauseButton,
      ...speedButtons,
      resources,
      tickLabel,
      status,
      fps,
    ),
    el('div', { class: 'minimap-box' }, minimapCanvas),
  );

  let renderer: TerrainRenderer;
  let sprites: SpriteRenderer;
  let roads: RoadRenderer;
  try {
    renderer = new TerrainRenderer(canvas);
    sprites = new SpriteRenderer(renderer.glContext);
    roads = new RoadRenderer(renderer.glContext);
  } catch (err) {
    showMessage(root, 'game-no-webgl', `WebGL2 unavailable: ${String(err)}`);
    return;
  }

  // Building/flag (rom_z) and settler (carrier BOB) atlases are map-independent
  // for the Roman nation; register them once.
  const romanAtlas = await loadAtlas(BUILDING_ARCHIVE);
  if (romanAtlas) sprites.registerAtlas(romanAtlas.meta, romanAtlas.pages);
  const carrier: BobAtlas | null = await loadBobAtlas('carrier', BOB_ARCHIVE);
  if (carrier) sprites.registerAtlas(carrier.meta, carrier.pages);

  let camera = new Camera(1, 1);
  let session: GameSession | null = null;
  let landscape: LandscapeSet = 0;
  let objAtlasReady = false;
  const minimap = new MinimapView(minimapCanvas, (wx, wy) => {
    camera.centerOn(wx, wy, canvas.width, canvas.height);
  });

  function rebuildStatics(): void {
    if (!session) return;
    const built = buildStaticObjects(
      session.world.width,
      session.world.height,
      session.world.objectType,
      session.world.objectIndex,
      landscape,
    );
    sprites.setStaticObjects(objAtlasReady ? built.objects : []);
    session.staticsDirty = false;
    if (window.__s2debug) {
      window.__s2debug.staticObjects = objAtlasReady ? built.objects.length : 0;
      window.__s2debug.trees = built.counts.trees;
      window.__s2debug.granite = built.counts.granite;
      window.__s2debug.decorations = built.counts.decorations;
      window.__s2debug.skipped = built.counts.skipped;
    }
  }

  async function switchMap(entry: MapIndexEntry): Promise<void> {
    delete document.body.dataset.mapReady;
    const map = await loadMap(entry);
    const atlas = await loadTerrainImage(map.terrain);
    renderer.resize();
    renderer.load(map.data, atlas);

    landscape = map.terrain;
    const archive = objectAtlasForLandscape(map.terrain);
    if (!sprites.hasAtlas(archive)) {
      const loaded = await loadAtlas(archive);
      if (loaded) sprites.registerAtlas(loaded.meta, loaded.pages);
    }
    objAtlasReady = sprites.hasAtlas(archive);

    session = new GameSession(map.engineMap, GAME_SEED);
    sprites.setMap(map.data.width, map.data.height, map.data.heightLayer);
    roads.setMap(map.data.width, map.data.height);
    rebuildStatics();

    camera = new Camera(map.data.width, map.data.height);
    minimap.setMap(map.data, camera.worldSize.w, camera.worldSize.h);

    const hqX = map.hqX[0] ?? 0xffff;
    const hqY = map.hqY[0] ?? 0xffff;
    if (hqX !== 0xffff && hqY !== 0xffff) {
      camera.centerOn(hqX * TR_W, hqY * TR_H, canvas.width, canvas.height);
    } else {
      camera.centerOn(camera.worldSize.w / 2, camera.worldSize.h / 2, canvas.width, canvas.height);
    }

    installDebug();

    mapTitle.textContent = map.title || entry.name;
    mapSelect.value = entry.name;
    zoomButton.textContent = zoomLabel();
    document.title = `s2gold — ${map.title || entry.name}`;
    const url = new URL(window.location.href);
    url.searchParams.set('map', entry.name);
    window.history.replaceState(null, '', url);
    document.body.dataset.mapReady = entry.name;
  }

  function hqNode(): number {
    if (!session) return -1;
    const hqId = session.world.players[0]?.hqBuildingId ?? -1;
    if (hqId < 0) return -1;
    return session.world.buildings.items[hqId]?.node ?? -1;
  }

  function nodeToScreen(node: number): { x: number; y: number } {
    if (!session) return { x: 0, y: 0 };
    const a = nodeAnchor(session.world, node);
    const dpr = window.devicePixelRatio || 1;
    const pw = camera.worldSize.w * camera.zoom;
    const ph = camera.worldSize.h * camera.zoom;
    let sx = ((a.x - camera.x) * camera.zoom) % pw;
    if (sx < 0) sx += pw;
    if (sx > canvas.width) sx -= pw;
    let sy = ((a.y - camera.y) * camera.zoom) % ph;
    if (sy < 0) sy += ph;
    if (sy > canvas.height) sy -= ph;
    return { x: sx / dpr, y: sy / dpr };
  }

  function installDebug(): void {
    if (!session) return;
    const s = session;
    window.__s2debug = {
      staticObjects: 0,
      trees: 0,
      granite: 0,
      decorations: 0,
      skipped: 0,
      spriteQuads: 0,
      spriteDrawCalls: 0,
      tick: 0,
      paused: false,
      speed: 1,
      inventory: s.inventory,
      counters: { ...s.counters },
      settlers: 0,
      flags: 0,
      buildings: 0,
      roads: 0,
      hqNode: hqNode(),
      nodeOf: (x, y) => s.geom.index(x, y),
      flagNodeOf: (node) => s.geom.neighbour(node, 'SE'),
      flagIdAt: (node) => s.flagIdAt(node),
      canBuild: (node, type) =>
        s.canBuild(node, type as Parameters<GameSession['placeBuilding']>[1]),
      canFlag: (node) => s.canFlag(node),
      nodeToScreen,
      placeFlag: (node) => s.placeFlag(node),
      placeBuilding: (node, type) =>
        s.placeBuilding(node, type as Parameters<GameSession['placeBuilding']>[1]),
      buildRoad: (path) => s.buildRoad(path),
      suggestRoad: (a, b) => s.suggestRoad(a, b),
      setSpeed: (sp) => setSpeed(sp as Speed),
      setPaused: (p) => setPaused(p),
    };
    rebuildStatics();
  }

  // --- HUD controls ---------------------------------------------------------

  const zoomLabel = (): string => `Zoom ${camera.zoom.toFixed(camera.zoom % 1 === 0 ? 0 : 2)}x`;
  zoomButton.addEventListener('click', () => {
    camera.toggleZoom(canvas.width, canvas.height);
    zoomButton.textContent = zoomLabel();
  });

  function setPaused(paused: boolean): void {
    if (session) session.paused = paused;
    pauseButton.textContent = paused ? 'Resume' : 'Pause';
  }
  pauseButton.addEventListener('click', () => setPaused(!(session?.paused ?? false)));

  function setSpeed(speed: Speed): void {
    if (session) session.speed = speed;
    speedButtons.forEach((btn, i) => btn.classList.toggle('active', SPEEDS[i] === speed));
  }
  speedButtons.forEach((btn, i) => btn.addEventListener('click', () => setSpeed(SPEEDS[i])));

  mapSelect.addEventListener('change', () => {
    const entry = index.find((m) => m.name === mapSelect.value);
    if (entry) void switchMap(entry);
  });

  // --- Camera controls (wheel zoom, drag, arrows) ---------------------------

  let draggedFar = false;
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

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let dragTotal = 0;
  canvas.addEventListener('pointerdown', (ev) => {
    dragging = true;
    dragTotal = 0;
    draggedFar = false;
    lastX = ev.clientX;
    lastY = ev.clientY;
    canvas.classList.add('dragging');
    canvas.setPointerCapture(ev.pointerId);
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!dragging) return;
    const dpr = window.devicePixelRatio || 1;
    dragTotal += Math.abs(lastX - ev.clientX) + Math.abs(lastY - ev.clientY);
    if (dragTotal > 6) draggedFar = true;
    camera.panScreen((lastX - ev.clientX) * dpr, (lastY - ev.clientY) * dpr);
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
    if (panKeys.includes(ev.key)) {
      held.add(ev.key);
      ev.preventDefault();
    } else if (ev.key === 'z' || ev.key === 'Z') {
      camera.toggleZoom(canvas.width, canvas.height);
      zoomButton.textContent = zoomLabel();
    } else if (ev.key === ' ') {
      setPaused(!(session?.paused ?? false));
      ev.preventDefault();
    }
  });
  window.addEventListener('keyup', (ev) => held.delete(ev.key));
  window.addEventListener('blur', () => held.clear());

  // --- Interaction ----------------------------------------------------------

  new Interaction({
    canvas,
    root,
    session: () => {
      if (!session) throw new Error('no session');
      return session;
    },
    camera: () => camera,
    onStatus: (text) => {
      status.textContent = text;
    },
    suppressClick: () => draggedFar,
  });

  // --- Render loop ----------------------------------------------------------

  let frames = 0;
  let fpsWindowStart = performance.now();
  let lastFrame = performance.now();
  function frame(now: number): void {
    const dt = Math.min(100, now - lastFrame);
    lastFrame = now;

    if (held.size > 0) {
      const dist = (KEY_PAN_SPEED * dt) / 1000;
      let dx = 0;
      let dy = 0;
      if (held.has('ArrowLeft')) dx -= dist;
      if (held.has('ArrowRight')) dx += dist;
      if (held.has('ArrowUp')) dy -= dist;
      if (held.has('ArrowDown')) dy += dist;
      camera.panWorld(dx, dy);
    }

    let alpha = 0;
    if (session) alpha = session.update(dt);
    if (session?.staticsDirty) rebuildStatics();

    renderer.resize();
    renderer.render(camera);
    if (session) roads.render(camera, roadSegments(session.world, session.geom));

    const waveFrame = Math.floor(now / ANIM_FRAME_MS);
    const walkFrame = Math.floor(now / WALK_FRAME_MS);
    const dynamics =
      session && carrier ? buildDynamics(session.world, session.geom, carrier, {
        waveFrame,
        walkFrame,
        alpha,
      }) : [];
    const stats = sprites.render(camera, waveFrame, dynamics);
    minimap.draw(camera, canvas.width, canvas.height);

    updateHud(stats.quads, stats.drawCalls);

    frames++;
    if (now - fpsWindowStart >= 500) {
      fps.textContent = `${Math.round((frames * 1000) / (now - fpsWindowStart))} fps`;
      frames = 0;
      fpsWindowStart = now;
    }
    requestAnimationFrame(frame);
  }

  function countLive<T>(store: { items: (T | null)[] }): number {
    let n = 0;
    for (const it of store.items) if (it) n++;
    return n;
  }

  function updateHud(quads: number, drawCalls: number): void {
    if (!session) return;
    const inv = session.inventory;
    resources.textContent = `Trunk ${inv.trunk}  Plank ${inv.plank}  Stone ${inv.stone}`;
    tickLabel.textContent = `tick ${session.world.tick}`;
    const dbg = window.__s2debug;
    if (dbg) {
      dbg.spriteQuads = quads;
      dbg.spriteDrawCalls = drawCalls;
      dbg.tick = session.world.tick;
      dbg.paused = session.paused;
      dbg.speed = session.speed;
      dbg.inventory = inv;
      dbg.counters = { ...session.counters };
      dbg.settlers = countLive(session.world.settlers);
      dbg.flags = countLive(session.world.flags);
      dbg.buildings = countLive(session.world.buildings);
      dbg.roads = countLive(session.world.roads);
      dbg.hqNode = hqNode();
    }
  }

  const query = new URLSearchParams(window.location.search).get('map');
  setSpeed(1);
  await switchMap(pickMap(index, query));
  requestAnimationFrame(frame);
}

void boot();
