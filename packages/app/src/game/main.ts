/**
 * Game page (P2): load a converted map, run the deterministic engine world in a
 * fixed-tick loop, and render the live economy — HQ, flags, roads-as-flags,
 * buildings, carriers and workers — over the WebGL2 terrain. Keeps the P1 map
 * picker, wheel zoom, drag/arrow scroll, minimap and FPS counter.
 */

import './styles.css';
import {
  Camera,
  PLAYER_COLORS,
  RoadRenderer,
  SpriteRenderer,
  TerrainRenderer,
  TR_H,
  TR_W,
  unpackColor,
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
  borderStoneSegments,
  disconnectedBuildingMarkers,
  garrisonDotSegments,
  signMarkers,
  nodeAnchor,
  nodeMarkerSegments,
  pathSegments,
  roadSegments,
  BUILDING_ARCHIVE,
  BOB_ARCHIVE,
  SHIP_ARCHIVE,
} from './game-render';
import { Interaction } from './interaction';
import { MilitaryPanel } from './military-ui';
import { HarborPanel } from './harbor-ui';
import { SaveMenu } from './save-ui';
import { StatsPanel } from './stats-ui';
import { GoodsPanel } from './inventory-ui';
import { createDropdown } from '../ui/dropdown';
import { AudioEngine, positional } from './audio';
import { CampaignController } from './campaign-ui';
import { chapterById } from '../menu/campaign-data';

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

/**
 * Geologist survey-sign colours by resource kind (RESOURCE.*): coal 3, iron 1,
 * gold 2, granite 4, nothing 0. Each is drawn in its own overlay pass.
 */
const SIGN_COLORS: readonly (readonly [number, readonly [number, number, number, number]])[] = [
  [3, [0.1, 0.1, 0.12, 0.98]], // coal — black
  [1, [0.95, 0.45, 0.1, 0.98]], // iron — orange
  [2, [1.0, 0.85, 0.1, 0.98]], // gold — yellow
  [4, [0.35, 0.6, 1.0, 0.98]], // granite — blue (kept well clear of coal/nothing greys)
  [0, [0.6, 0.6, 0.6, 0.8]], // nothing — grey X
];

/** Legend rows for the geologist signs: [css colour, label], sign-colour order. */
const SIGN_LEGEND: readonly (readonly [string, string])[] = [
  ['rgb(26,26,31)', 'Coal'],
  ['rgb(242,115,26)', 'Iron'],
  ['rgb(255,217,26)', 'Gold'],
  ['rgb(89,153,255)', 'Granite'],
  ['rgb(153,153,153)', 'Nothing (X)'],
];

/** BOB archive keys registered once for the settler layers. */
const JOBS_ARCHIVE = 'jobs';

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
  /** Live ship count (all players). */
  ships: number;
  /** Live working-harbor count for the local player. */
  harbors: number;
  /** Audio engine counters for e2e (context state + sfx buffer/voice tallies). */
  audio: {
    contextState: string;
    sfxRequested: number;
    buffersLoaded: number;
    sfxPlayed: number;
    voices: number;
    muted: boolean;
    musicPlaying: boolean;
  };
  /** HQ building node id for player 0 (-1 when none). */
  hqNode: number;
  /** Number of players seeded in the current world. */
  players: number;
  /** Number of players driven by the computer opponent. */
  aiPlayers: number;
  /** Live building count for a player (HQ + sites + working). */
  buildingsOf(player: number): number;
  /** Toggle fog of war (default on for a new game). */
  setFog(on: boolean): void;
  /** Owning player of a node (-1 = neutral). */
  ownerOf(node: number): number;
  /** Building id at a node, or -1. */
  buildingIdAt(node: number): number;
  /** Total garrisoned soldiers at a military building node (-1 when not military). */
  militaryTroops(node: number): number;
  /** How many soldiers the local player could send against a target building. */
  attackableSoldiers(targetBuildingId: number): number;
  /** Cheat: place a fully-built, unoccupied military building for a player. */
  debugSpawnMilitary(player: number, node: number, type: string): number;
  /** Order up to `soldiers` attackers at an enemy military building. */
  attack(targetBuildingId: number, soldiers: number): void;
  /** Toggle coin delivery to one of the local player's military buildings. */
  toggleCoins(buildingId: number, enabled: boolean): void;
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
  /** Current road-build preview state (null when not in road mode). */
  roadPreview(): { node: number; valid: boolean; hasPath: boolean } | null;
  // Seafaring (P7).
  /** Queue a prepareExpedition command at one of the local player's harbors. */
  prepareExpedition(harborId: number): void;
  /** Queue a startExpedition command toward a coastal target spot. */
  startExpedition(harborId: number, targetSpot: number): void;
  /** Cheat: found a fully-working harbor for a player at a coastal node (-1 fail). */
  debugSpawnHarbor(player: number, node: number): number;
  /** Cheat: dock an idle ship of a player at a harbor (-1 fail). */
  debugSpawnShip(player: number, harborId: number): number;
  /** Cheat: grant a player an expedition kit worth of boards/stones + a builder. */
  debugGrantExpeditionSupplies(player: number): void;
  /** Whether the docks of two coastal nodes are joined by an all-water route. */
  debugWaterConnected(nodeA: number, nodeB: number): boolean;
  /** The local player's working-harbor building id at a node, or -1. */
  harborIdAt(node: number): number;
  /** True when a ready expedition is prepared at a harbor. */
  expeditionReady(harborId: number): boolean;
  /** Live ships as {id, node, state} (all players). */
  shipStates(): { id: number; node: number; state: string }[];
  /** Center the camera on a lattice node (test helper for off-screen picking). */
  centerNode(node: number): void;
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
  // Non-null alias usable inside nested functions (control-flow narrowing of
  // `root` does not carry into nested function bodies).
  const gameRoot: HTMLElement = root;

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
  const mapSelect = createDropdown([], '', (name) => {
    const entry = index.find((m) => m.name === name);
    if (entry) void switchMap(entry);
  }, { 'data-testid': 'map-select' });
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
  const menuButton = el('button', {
    text: 'Menu',
    attrs: { 'data-testid': 'menu-toggle', type: 'button', title: 'Save / load (F5 / F9)' },
  });
  const fogButton = el('button', {
    text: 'Fog: on',
    attrs: { 'data-testid': 'fog-toggle', type: 'button', title: 'Toggle fog of war' },
  });
  // The fog toggle is a view preference, persisted like the audio prefs so it
  // survives a reload or loading a save (the save file holds only game state).
  const FOG_LS_KEY = 's2gold.view.fog';
  const readFogPref = (): boolean => {
    try {
      return localStorage.getItem(FOG_LS_KEY) !== '0';
    } catch {
      return true;
    }
  };
  const writeFogPref = (on: boolean): void => {
    try {
      localStorage.setItem(FOG_LS_KEY, on ? '1' : '0');
    } catch {
      /* storage may be unavailable (private mode) — ignore. */
    }
  };
  const statsButton = el('button', {
    text: 'Stats',
    attrs: { 'data-testid': 'stats-toggle', type: 'button', title: 'In-game statistics' },
  });
  const goodsButton = el('button', {
    text: 'Goods',
    attrs: { 'data-testid': 'goods-toggle', type: 'button', title: 'Full goods inventory' },
  });
  // Long, transient hints (road mode etc.) float in their own toast below the
  // bar so the top bar never has to wrap to make room for them.
  const status = el('div', { class: 'status-toast', attrs: { 'data-testid': 'build-status' } });
  status.hidden = true;
  const minimapCanvas = el('canvas', { attrs: { 'data-testid': 'minimap' } });

  const speedButtons = SPEEDS.map((s) =>
    el('button', { text: `${s}x`, attrs: { 'data-testid': `speed-${s}`, type: 'button' } }),
  );

  // One page-lived audio engine (survives map switches); unlocked on first
  // gesture per the browser autoplay policy. The music element is attached to
  // the DOM (hidden) so it participates in the page like a normal player.
  const audio = new AudioEngine();
  audio.music.element.hidden = true;
  root.append(audio.music.element);

  // --- Audio HUD controls (mute + SFX volume + music on/off + music volume) --
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
  const audioControls = el(
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

  // Autoplay policy: the AudioContext and music can only start after a gesture.
  // unlock() is idempotent, so leaving these attached costs nothing.
  const unlockAudio = (): void => audio.unlock();
  window.addEventListener('pointerdown', unlockAudio);
  window.addEventListener('keydown', unlockAudio);

  mapSelect.setOptions(
    index.map((entry) => ({
      value: entry.name,
      label: `${entry.title || entry.name} (${entry.width}x${entry.height}, ${entry.terrain_name})`,
    })),
  );

  const hudTop = el(
    'div',
    { class: 'hud-top' },
    el('a', { href: '/', text: 's2gold' }),
    mapTitle,
    mapSelect.element,
    zoomButton,
    pauseButton,
    menuButton,
    fogButton,
    statsButton,
    goodsButton,
    ...speedButtons,
    audioControls,
    resources,
    tickLabel,
    fps,
  );
  // Legend for the geologist survey signs, shown only while any sign exists.
  const signLegend = el('div', {
    class: 'sign-legend',
    attrs: { 'data-testid': 'sign-legend' },
  });
  signLegend.append(
    el('div', { class: 'sign-legend-title', text: 'Ore signs' }),
    ...SIGN_LEGEND.map(([color, label]) =>
      el(
        'div',
        { class: 'sign-legend-row' },
        el('span', { class: 'sign-legend-swatch', attrs: { style: `background:${color}` } }),
        el('span', { text: label }),
      ),
    ),
  );
  signLegend.style.display = 'none';

  root.append(
    canvas,
    hudTop,
    status, // transient hint toast, floats below the bar (see .status-toast)
    signLegend,
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
  if (romanAtlas) sprites.registerAtlas(romanAtlas.meta, romanAtlas.pages, romanAtlas.pmaskPages);
  // Ship sprites (boot_z) are nation-independent; register once alongside rom_z.
  const shipAtlas = await loadAtlas(SHIP_ARCHIVE);
  if (shipAtlas) sprites.registerAtlas(shipAtlas.meta, shipAtlas.pages, shipAtlas.pmaskPages);
  const carrier: BobAtlas | null = await loadBobAtlas('carrier', BOB_ARCHIVE);
  if (carrier) sprites.registerAtlas(carrier.meta, carrier.pages, carrier.pmaskPages);
  const jobs: BobAtlas | null = await loadBobAtlas('jobs', JOBS_ARCHIVE);
  if (jobs) sprites.registerAtlas(jobs.meta, jobs.pages, jobs.pmaskPages);

  let camera = new Camera(1, 1);
  let session: GameSession | null = null;
  let landscape: LandscapeSet = 0;
  let objAtlasReady = false;
  // Current map identity (drives per-map save filtering + default save names).
  let currentMap = '';
  let currentMapTitle = '';
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

  async function switchMap(entry: MapIndexEntry, aiPlayers: readonly number[] = []): Promise<void> {
    delete document.body.dataset.mapReady;
    const map = await loadMap(entry);
    const atlas = await loadTerrainImage(map.terrain);
    renderer.resize();
    renderer.load(map.data, atlas);

    landscape = map.terrain;
    const archive = objectAtlasForLandscape(map.terrain);
    if (!sprites.hasAtlas(archive)) {
      const loaded = await loadAtlas(archive);
      if (loaded) sprites.registerAtlas(loaded.meta, loaded.pages, loaded.pmaskPages);
    }
    objAtlasReady = sprites.hasAtlas(archive);

    // Computer opponents: keep only slot indices this map can seat, then seed
    // enough players to cover the highest AI slot (human is always slot 0).
    const ai = aiPlayers.filter((n) => n > 0 && n < entry.players);
    const playerCount = ai.length > 0 ? Math.max(...ai) + 1 : undefined;
    session = new GameSession(map.engineMap, GAME_SEED, playerCount, ai);
    session.fogEnabled = readFogPref();
    sprites.setMap(map.data.width, map.data.height, map.data.heightLayer);
    roads.setMap(map.data.width, map.data.height);
    rebuildStatics();

    camera = new Camera(map.data.width, map.data.height);
    minimap.setMap(map.data, camera.worldSize.w, camera.worldSize.h);
    applyFog();
    refreshTerritory();

    const hqX = map.hqX[0] ?? 0xffff;
    const hqY = map.hqY[0] ?? 0xffff;
    if (hqX !== 0xffff && hqY !== 0xffff) {
      camera.centerOn(hqX * TR_W, hqY * TR_H, canvas.width, canvas.height);
    } else {
      camera.centerOn(camera.worldSize.w / 2, camera.worldSize.h / 2, canvas.width, canvas.height);
    }

    installDebug();

    currentMap = entry.name;
    currentMapTitle = map.title || entry.name;
    mapTitle.textContent = map.title || entry.name;
    mapSelect.setValue(entry.name);
    zoomButton.textContent = zoomLabel();
    document.title = `s2gold — ${map.title || entry.name}`;
    const url = new URL(window.location.href);
    url.searchParams.set('map', entry.name);
    // Keep the URL honest about the active AI config (cleared on a plain switch).
    if (ai.length > 0) url.searchParams.set('ai', ai.join(','));
    else url.searchParams.delete('ai');
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
      ships: 0,
      harbors: 0,
      audio: audio.debug(),
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
      players: s.playerCount,
      aiPlayers: s.aiPlayers.length,
      buildingsOf: (player) => s.buildingsOf(player),
      setFog: (on) => {
        s.setFog(on);
        writeFogPref(on);
        applyFog();
      },
      ownerOf: (node) => s.ownerOf(node),
      buildingIdAt: (node) => s.buildingIdAt(node),
      militaryTroops: (node) => s.militaryAt(node)?.troops ?? -1,
      attackableSoldiers: (targetBuildingId) => s.attackableSoldiers(targetBuildingId),
      debugSpawnMilitary: (player, node, type) =>
        s.debugSpawnMilitary(player, node, type as Parameters<GameSession['placeBuilding']>[1]),
      attack: (targetBuildingId, soldiers) => s.attack(targetBuildingId, soldiers),
      toggleCoins: (buildingId, enabled) => s.toggleCoins(buildingId, enabled),
      roadPreview: () => {
        const rp = interaction.roadPreview;
        return rp ? { node: rp.node, valid: rp.valid, hasPath: rp.path !== null } : null;
      },
      prepareExpedition: (harborId) => s.prepareExpedition(harborId),
      startExpedition: (harborId, targetSpot) => s.startExpedition(harborId, targetSpot),
      debugSpawnHarbor: (player, node) => s.debugSpawnHarbor(player, node),
      debugSpawnShip: (player, harborId) => s.debugSpawnShip(player, harborId),
      debugGrantExpeditionSupplies: (player) => s.debugGrantExpeditionSupplies(player),
      debugWaterConnected: (nodeA, nodeB) => s.debugWaterConnected(nodeA, nodeB),
      harborIdAt: (node) => s.harborAt(node)?.id ?? -1,
      expeditionReady: (harborId) => s.expeditionAt(harborId)?.ready ?? false,
      shipStates: () => s.shipStates(),
      centerNode: (node) => {
        const a = nodeAnchor(s.world, node);
        camera.centerOn(a.x, a.y, canvas.width, canvas.height);
      },
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

  /** Push the session's fog state to the terrain renderer + update the button. */
  function applyFog(): void {
    if (!session) return;
    const vis = session.fogEnabled ? session.visibility : null;
    renderer.setFog(vis);
    sprites.setFog(vis);
    session.fogDirty = false;
    fogButton.textContent = session.fogEnabled ? 'Fog: on' : 'Fog: off';
    fogButton.classList.toggle('active', session.fogEnabled);
  }

  /** Cached per-player border-ring nodes, refreshed only when territory changes. */
  let borderCache: number[][] = [];

  /** Refresh territory-derived overlays (minimap tint + cached border rings). */
  function refreshTerritory(): void {
    if (!session) return;
    minimap.setOwners(session.world.owner, PLAYER_COLORS);
    borderCache = [];
    for (let p = 0; p < session.playerCount; p++) borderCache[p] = session.borders(p);
    session.territoryDirty = false;
  }

  fogButton.addEventListener('click', () => {
    if (!session) return;
    session.setFog(!session.fogEnabled);
    writeFogPref(session.fogEnabled);
    applyFog();
  });

  // Map switching is handled by the dropdown's onChange callback.

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

  const military = new MilitaryPanel({
    root,
    session: () => {
      if (!session) throw new Error('no session');
      return session;
    },
  });

  // The harbor panel hands off to the interaction layer's expedition target-select
  // mode; the two reference each other, so a late-bound ref breaks the cycle.
  let interactionRef: Interaction | null = null;
  const harbor = new HarborPanel({
    root,
    session: () => {
      if (!session) throw new Error('no session');
      return session;
    },
    beginExpeditionTarget: (harborId) => interactionRef?.startExpeditionSelect(harborId),
  });

  const interaction = new Interaction({
    canvas,
    root,
    session: () => {
      if (!session) throw new Error('no session');
      return session;
    },
    camera: () => camera,
    onStatus: (text) => {
      status.textContent = text;
      status.hidden = text.length === 0;
    },
    suppressClick: () => draggedFar,
    openMilitary: (node, x, y) => military.openAt(node, x, y),
    closeMilitary: () => military.close(),
    openHarbor: (node, x, y) => harbor.openAt(node, x, y),
    closeHarbor: () => harbor.close(),
  });
  interactionRef = interaction;

  // --- Save / load ----------------------------------------------------------

  // Brief feedback toast (reuses the .status-toast look, offset below the road
  // hint so the two never overlap). Auto-dismisses; only the latest is shown.
  let saveToastEl: HTMLElement | null = null;
  let saveToastTimer = 0;
  function saveToast(text: string): void {
    if (saveToastEl) saveToastEl.remove();
    const toast = el('div', { class: 'status-toast save-toast', text });
    gameRoot.append(toast);
    saveToastEl = toast;
    window.clearTimeout(saveToastTimer);
    saveToastTimer = window.setTimeout(() => {
      toast.remove();
      if (saveToastEl === toast) saveToastEl = null;
    }, 2200);
  }

  // Seafaring notifications (expedition ready / landed) float as their own toast,
  // slightly higher than the save toast so the two never overlap.
  let seaToastEl: HTMLElement | null = null;
  let seaToastTimer = 0;
  function seaToast(text: string): void {
    if (seaToastEl) seaToastEl.remove();
    const toast = el('div', {
      class: 'status-toast sea-toast',
      text,
      attrs: { 'data-testid': 'sea-toast' },
    });
    gameRoot.append(toast);
    seaToastEl = toast;
    window.clearTimeout(seaToastTimer);
    seaToastTimer = window.setTimeout(() => {
      toast.remove();
      if (seaToastEl === toast) seaToastEl = null;
    }, 3000);
  }

  const saveMenu = new SaveMenu({
    root,
    session: () => session,
    mapName: () => currentMap,
    mapTitle: () => currentMapTitle,
    toast: saveToast,
  });
  menuButton.addEventListener('click', () => saveMenu.toggle());

  // In-game statistics panel (per-player time-series charts).
  const statsPanel = new StatsPanel({ root, session: () => session });
  statsButton.addEventListener('click', () => statsPanel.toggle());
  const goodsPanel = new GoodsPanel({ root, session: () => session });
  goodsButton.addEventListener('click', () => goodsPanel.toggle());
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'F5') {
      ev.preventDefault();
      saveMenu.quicksave();
    } else if (ev.key === 'F9') {
      ev.preventDefault();
      void saveMenu.quickload();
    }
  });

  // --- Render loop ----------------------------------------------------------

  let frames = 0;
  let fpsWindowStart = performance.now();
  let lastFrame = performance.now();
  let prevSaplings = 0;
  // Sea-event toast edge-detection (fire once per new ready/landed event).
  let prevExpReady = 0;
  let prevExpLanded = 0;
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

    // One-shot SFX for this frame's events, positioned from world vs. camera.
    if (session) {
      const cues = session.drainSoundCues();
      if (audio.ready && cues.length > 0) {
        for (const cue of cues) {
          const a = nodeAnchor(session.world, cue.node);
          const p = positional(
            a.x,
            a.y,
            camera.x,
            camera.y,
            camera.zoom,
            canvas.width,
            canvas.height,
            camera.worldSize.w,
            camera.worldSize.h,
          );
          audio.play(cue.id, p);
        }
      }
      // Saplings maturing into trees emit no event; rebuild statics when the
      // sapling count drops so the new full tree appears.
      if (session.world.saplings.length < prevSaplings) session.staticsDirty = true;
      prevSaplings = session.world.saplings.length;

      // Seafaring toasts on the rising edge of the ready/landed counters.
      const c = session.counters;
      if (c.expeditionsReady > prevExpReady) seaToast('Expedition ready to launch');
      if (c.expeditionsLanded > prevExpLanded) seaToast('Expedition landed — new harbor founded');
      prevExpReady = c.expeditionsReady;
      prevExpLanded = c.expeditionsLanded;
    }

    if (session?.staticsDirty) rebuildStatics();
    if (session?.fogDirty) applyFog();
    if (session?.territoryDirty) refreshTerritory();

    renderer.resize();
    renderer.render(camera);
    if (session) {
      const vis = session.fogEnabled ? session.visibility : null;
      roads.render(camera, roadSegments(session.world, session.geom));
      // Territory border stones, drawn in each player's colour over the terrain.
      for (let p = 0; p < session.playerCount; p++) {
        const stones = borderStoneSegments(session.world, borderCache[p] ?? [], vis);
        if (stones.length === 0) continue;
        const [r, g, b] = unpackColor(PLAYER_COLORS[p % PLAYER_COLORS.length] ?? 0xffffff);
        roads.render(camera, stones, [r, g, b, 1]);
      }
    }

    const waveFrame = Math.floor(now / ANIM_FRAME_MS);
    const walkFrame = Math.floor(now / WALK_FRAME_MS);
    const dynamics =
      session && carrier
        ? buildDynamics(
            session.world,
            session.geom,
            { carrier, jobs, objectArchive: objectAtlasForLandscape(landscape) },
            { waveFrame, walkFrame, alpha },
            session.fogEnabled ? session.visibility : null,
          )
        : [];
    const stats = sprites.render(camera, waveFrame, dynamics);
    // Compact garrison markers, above each occupied military building, on top of
    // the sprite layer so they are never hidden by the building.
    if (session) {
      const vis = session.fogEnabled ? session.visibility : null;
      // Overlays drawn on top of everything (onGround=false: no depth test).
      for (let p = 0; p < session.playerCount; p++) {
        const dots = garrisonDotSegments(session.world, p, vis);
        if (dots.length === 0) continue;
        const [r, g, b] = unpackColor(PLAYER_COLORS[p % PLAYER_COLORS.length] ?? 0xffffff);
        roads.render(camera, dots, [r, g, b, 1], false);
      }
      // Warn about own buildings with no road path to a warehouse (they can't
      // receive materials, so a site there never builds). Bright orange "!".
      const disc = disconnectedBuildingMarkers(session.world, session.localPlayer);
      if (disc.length > 0) roads.render(camera, disc, [1.0, 0.55, 0.0, 0.95], false);
      // Geologist survey signs, coloured by the ore found (or a faint X for none).
      // Drawn on-ground (depth-tested) so buildings and trees on the mountain
      // occlude them instead of the signs floating over everything.
      const hasSigns = session.world.signs.length > 0;
      for (const [res, color] of SIGN_COLORS) {
        const marks = signMarkers(session.world, res);
        if (marks.length > 0) roads.render(camera, marks, color, true);
      }
      signLegend.style.display = hasSigns ? 'block' : 'none';
      // Live road-build preview on top: translucent path + an end marker (green
      // when a road can be built to the hovered node, red when it cannot).
      const preview = interaction.roadPreview;
      if (preview && preview.node >= 0) {
        if (preview.valid && preview.path) {
          roads.render(camera, pathSegments(session.world, session.geom, preview.path), [0.5, 0.8, 1.0, 0.5], false);
          roads.render(camera, nodeMarkerSegments(session.world, preview.node), [0.4, 1.0, 0.5, 0.85], false);
        } else {
          roads.render(camera, nodeMarkerSegments(session.world, preview.node), [1.0, 0.3, 0.3, 0.85], false);
        }
      }
    }
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

  /** Right-align a count into a fixed 4-char cell so the bar never reflows. */
  const pad4 = (n: number): string => String(Math.min(n, 9999)).padStart(4, ' ');

  function updateHud(quads: number, drawCalls: number): void {
    if (!session) return;
    const inv = session.inventory;
    // Fixed-width cells (white-space: pre in CSS) keep the bar from reflowing
    // as counts grow.
    // Build materials only (full inventory is the Goods panel). Names follow the
    // original S2 UI: Wood (raw log), Boards (sawn), Stone.
    resources.textContent = `Wood${pad4(inv.trunk)} Boards${pad4(inv.plank)} Stone${pad4(inv.stone)}`;
    tickLabel.textContent = `tick ${String(session.world.tick).padStart(7, ' ')}`;
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
      dbg.ships = countLive(session.world.ships);
      dbg.harbors = session.harbors().length;
      dbg.audio = audio.debug();
      dbg.hqNode = hqNode();
    }
  }

  const params = new URLSearchParams(window.location.search);
  const query = params.get('map');
  // ?ai=1,2 -> computer players in those slots (parsed once for the initial map).
  const aiParam = params.get('ai');
  const aiPlayers = aiParam
    ? aiParam
        .split(',')
        .map((s) => Number.parseInt(s, 10))
        .filter((n) => Number.isInteger(n) && n > 0)
    : [];
  setSpeed(1);
  await switchMap(pickMap(index, query), aiPlayers);

  // Campaign mode (/play/<map>?campaign=<id>): show the Objectives panel and
  // check the chapter's win condition against the live session.
  const campaignParam = params.get('campaign');
  const chapter = campaignParam ? chapterById(Number.parseInt(campaignParam, 10)) : undefined;
  if (chapter) {
    document.title = `s2gold — ${chapter.title}`;
    const campaign = new CampaignController({ root, session: () => session, chapter });
    hudTop.append(campaign.button);
    campaign.start();
  }

  requestAnimationFrame(frame);
}

void boot();
