/**
 * Game page (P2): load a converted map, run the deterministic engine world in a
 * fixed-tick loop, and render the live economy — HQ, flags, roads-as-flags,
 * buildings, carriers and workers — over the WebGL2 terrain. Keeps the P1 map
 * picker, wheel zoom, drag/arrow scroll, minimap and FPS counter.
 */

import './styles.css';
import {
  Camera,
  DONKEY_ROAD_COLOR,
  PLAYER_COLORS,
  RoadRenderer,
  SpriteRenderer,
  TerrainRenderer,
  TR_H,
  TR_W,
  unpackColor,
  type DynamicSprite,
  type LandscapeSet,
} from '@s2gold/renderer';
import type { Nation } from '@s2gold/engine';
import { clear, el } from '../lib/dom';
import { decodeNations, nationLabel } from '../lib/nations';
import {
  loadMap,
  loadMapIndex,
  loadTerrainAssets,
  pickMap,
  type MapIndexEntry,
} from './map-loader';
import { buildStaticObjects, objectAtlasForLandscape } from './map-objects';
import { loadAtlas } from './sprite-atlas';
import { makeWareIconSet } from './ware-icons';
import { loadBobAtlas } from './bob-atlas';
import { MinimapView } from './minimap-view';
import { installHandCursor } from './cursor';
import { installTooltips } from './tooltip';
import { GameSession, SPEEDS, type Speed } from './session';
import {
  buildDynamics,
  borderStoneSprites,
  depletedMineMarkers,
  disconnectedBuildingMarkers,
  garrisonDotSegments,
  signSprites,
  nodeAnchor,
  nodeMarkerSegments,
  pathSegments,
  roadSegments,
  upgradedRoadSegments,
  BUILDING_ARCHIVE,
  buildingArchiveForLandscape,
  nationBuildingArchive,
  BOB_ARCHIVE,
  SHIP_ARCHIVE,
  WORK_ARCHIVE,
} from './game-render';
import { Interaction } from './interaction';
import { makeBuildIconSet, type BuildIconSet } from './build-icons';
import type { LoadedAtlas } from './sprite-atlas';
import { installCameraInput, isEditableTarget } from './camera-input';
import { installDebugSurface, updateDebugCounters } from './debug-surface';
import { ResourceReadout } from './resource-readout';
import { startSessionPersistence } from './session-persistence';
import { makeToast } from './toasts';
import {
  FPS_LS_KEY,
  readFogPref,
  readVisPref,
  TICK_LS_KEY,
  writeFogPref,
  writeVisPref,
} from './view-prefs';
import { buildAudioControls } from './audio-controls';
import { makeHudIconSet, iconifyHudButton, HUD_ICON, IO_ARCHIVE } from './hud-icons';
import { MilitaryPanel } from './military-ui';
import { HarborPanel } from './harbor-ui';
import { SaveMenu } from './save-ui';
import { StatsPanel } from './stats-ui';
import { GoodsPanel } from './inventory-ui';
import { createDropdown } from '../ui/dropdown';
import { syncHudPanelButton, wireHudPanel } from './hud-panel';
import { AudioEngine, positional } from './audio';
import { CampaignController } from './campaign-ui';
import { chapterById, type Chapter } from '../menu/campaign-data';
import { getSession } from '../lib/sessions';

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
 * Legend rows for the geologist signs: [css gem colour, label]. The swatch colours
 * are sampled from the real sign-tablet gems (mapbobs 600..615) so the legend reads
 * the same as the tablets now drawn on the mountain: iron a reddish ore, gold
 * yellow, coal near-black, granite pale stone; the empty tablet means nothing found.
 */
const SIGN_LEGEND: readonly (readonly [string, string])[] = [
  ['rgb(159,99,71)', 'Iron'],
  ['rgb(230,205,90)', 'Gold'],
  ['rgb(45,45,50)', 'Coal'],
  ['rgb(205,205,198)', 'Granite'],
  ['rgb(150,132,110)', 'Nothing'],
];

/** BOB archive keys registered once for the settler layers. */
const JOBS_ARCHIVE = 'jobs';

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

  // Original pointing-hand cursor over the map (cosmetic; absent without the ui
  // assets, where the CSS falls back to grab). Fire-and-forget: never blocks boot.
  void installHandCursor();
  installTooltips();

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
  // Non-null alias usable inside nested functions (like `gameRoot` for `root`,
  // control-flow narrowing of `index` does not carry into nested bodies).
  const mapIndex: MapIndexEntry[] = index;

  clear(root);
  const canvas = el('canvas', { class: 'game-canvas', attrs: { 'data-testid': 'game-canvas' } });
  const mapSelect = createDropdown(
    [],
    '',
    (name) => {
      const entry = index.find((m) => m.name === name);
      if (entry) void switchMap(entry).catch((err: unknown) => mapSwitchFailed(entry.name, err));
    },
    { 'data-testid': 'map-select' },
  );
  const zoomButton = el('button', {
    text: 'Zoom 1x',
    attrs: { 'data-testid': 'zoom-toggle', type: 'button' },
  });
  const mapTitle = el('span', { class: 'map-title', attrs: { 'data-testid': 'map-title' } });
  // Minimal in-game readout of the local player's chosen people (cosmetic).
  // A follow-up phase maps nations to sprite archives; for now this is the only
  // visible sign of a non-Roman choice.
  const nationLabelEl = el('span', {
    class: 'nation-label',
    attrs: { 'data-testid': 'nation-label' },
  });
  const fps = el('span', { class: 'fps', text: '-- fps', attrs: { 'data-testid': 'fps' } });
  // HUD build-material readout (Wood/Boards/Stone); rebuilt per map switch from
  // the landscape's ware pictographs, falling back to fixed-width text.
  const resources = new ResourceReadout();
  const tickLabel = el('span', { class: 'tick', attrs: { 'data-testid': 'tick-counter' } });
  const pauseButton = el('button', {
    text: 'Pause',
    attrs: { 'data-testid': 'pause-toggle', type: 'button' },
  });
  const menuButton = el('button', {
    text: 'Game',
    attrs: { 'data-testid': 'menu-toggle', type: 'button', title: 'Save / load / exit (F5 / F9)' },
  });
  const fogButton = el('button', {
    text: 'Fog: on',
    attrs: { 'data-testid': 'fog-toggle', type: 'button', title: 'Toggle fog of war' },
  });
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

  // Game speed as a compact dropdown (five buttons crowded the bar). setSpeed
  // is a hoisted function declaration, so referencing it here is safe.
  const speedSelect = createDropdown(
    SPEEDS.map((s) => ({ value: String(s), label: `${s}x` })),
    '1',
    (value) => setSpeed(Number(value) as Speed),
    { 'data-testid': 'speed-select', title: 'Game speed' },
  );
  speedSelect.element.classList.add('speed-select');

  // One page-lived audio engine (survives map switches); unlocked on first
  // gesture per the browser autoplay policy. The music element is attached to
  // the DOM (hidden) so it participates in the page like a normal player.
  const audio = new AudioEngine();
  audio.music.element.hidden = true;
  root.append(audio.music.element);

  // Audio HUD controls (mute + SFX volume + music on/off + music volume).
  const audioControls = buildAudioControls(audio);

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

  // --- Debug-readout visibility (tick counter + FPS) ------------------------
  // Both live in the Settings panel as fog-style toggles and default off; the
  // choice is persisted like the fog pref so it survives a reload.
  let showTick = readVisPref(TICK_LS_KEY);
  let showFps = readVisPref(FPS_LS_KEY);
  // When hidden the elements are removed from layout (not just blanked) so they
  // take no space, and the per-frame text updates are skipped (see the loop).
  const applyTickVis = (): void => {
    tickLabel.hidden = !showTick;
  };
  const applyFpsVis = (): void => {
    fps.hidden = !showFps;
  };
  applyTickVis();
  applyFpsVis();

  // --- Settings panel (seldom-used controls, tucked off the bar) -------------
  const settingsButton = el('button', {
    text: 'Settings',
    attrs: { 'data-testid': 'settings-toggle', type: 'button', title: 'Settings' },
  });
  const tickToggle = el('button', {
    attrs: { 'data-testid': 'tick-toggle', type: 'button', title: 'Show the tick counter' },
  });
  const applyTickToggle = (): void => {
    tickToggle.textContent = showTick ? 'Tick: on' : 'Tick: off';
    tickToggle.classList.toggle('active', showTick);
  };
  applyTickToggle();
  tickToggle.addEventListener('click', () => {
    showTick = !showTick;
    writeVisPref(TICK_LS_KEY, showTick);
    applyTickVis();
    applyTickToggle();
  });
  const fpsToggle = el('button', {
    attrs: { 'data-testid': 'fps-toggle', type: 'button', title: 'Show the FPS counter' },
  });
  const applyFpsToggle = (): void => {
    fpsToggle.textContent = showFps ? 'FPS: on' : 'FPS: off';
    fpsToggle.classList.toggle('active', showFps);
  };
  applyFpsToggle();
  fpsToggle.addEventListener('click', () => {
    showFps = !showFps;
    writeVisPref(FPS_LS_KEY, showFps);
    applyFpsVis();
    applyFpsToggle();
  });
  const settingsPanel = el(
    'div',
    { class: 'settings-panel', attrs: { 'data-testid': 'settings-panel' } },
    el(
      'div',
      { class: 'settings-row' },
      el('span', { class: 'settings-label', text: 'Map' }),
      mapSelect.element,
    ),
    el('div', { class: 'settings-row' }, fogButton, tickToggle, fpsToggle),
    audioControls,
  );
  settingsPanel.hidden = true;
  wireHudPanel(settingsButton, {
    isOpen: () => !settingsPanel.hidden,
    open: () => {
      settingsPanel.hidden = false;
    },
    close: () => {
      settingsPanel.hidden = true;
    },
    element: () => settingsPanel,
  });

  // One compact control bar anchored bottom-center, like the original's icon
  // bar (rather than a full-width top navbar). Resources stay on it for
  // at-a-glance stock; the map title moves here too.
  const hudTop = el(
    'div',
    { class: 'hud-top' },
    el('a', { class: 'hud-brand', href: '/', text: 's2gold' }),
    mapTitle,
    nationLabelEl,
    pauseButton,
    speedSelect.element,
    menuButton,
    statsButton,
    goodsButton,
    zoomButton,
    settingsButton,
    resources.element,
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
    settingsPanel, // floating panel anchored under the Settings button
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

  // Map-independent atlases (Roman buildings/flags, ships, work animations,
  // carrier + jobs BOBs): five independent fetch+decode chains, loaded in
  // parallel; registration order stays deterministic after the join.
  // The io_dat atlas holds the original UI icons; it feeds the HUD button crops
  // only (not the world sprite renderer), so it is loaded here but never
  // registered as a game-sprite archive. Non-fatal when missing.
  const [romanAtlas, shipAtlas, workAtlas, carrier, jobs, ioAtlas] = await Promise.all([
    loadAtlas(BUILDING_ARCHIVE),
    loadAtlas(SHIP_ARCHIVE),
    loadAtlas(WORK_ARCHIVE),
    loadBobAtlas('carrier', BOB_ARCHIVE),
    loadBobAtlas('jobs', JOBS_ARCHIVE),
    loadAtlas(IO_ARCHIVE),
  ]);
  if (romanAtlas) sprites.registerAtlas(romanAtlas.meta, romanAtlas.pages, romanAtlas.pmaskPages);
  if (shipAtlas) sprites.registerAtlas(shipAtlas.meta, shipAtlas.pages, shipAtlas.pmaskPages);
  if (workAtlas) sprites.registerAtlas(workAtlas.meta, workAtlas.pages, workAtlas.pmaskPages);
  if (carrier) sprites.registerAtlas(carrier.meta, carrier.pages, carrier.pmaskPages);
  if (jobs) sprites.registerAtlas(jobs.meta, jobs.pages, jobs.pmaskPages);

  // Put original icon sprites on the bottom HUD bar buttons (falls back to the
  // existing text labels when the io_dat atlas is missing). Done after boot so
  // the atlas is loaded; the buttons keep their testids, handlers and titles.
  const ioIcons = makeHudIconSet(ioAtlas);
  iconifyHudButton(pauseButton, ioIcons, HUD_ICON.pause);
  iconifyHudButton(menuButton, ioIcons, HUD_ICON.game);
  iconifyHudButton(statsButton, ioIcons, HUD_ICON.stats);
  iconifyHudButton(goodsButton, ioIcons, HUD_ICON.goods);
  iconifyHudButton(zoomButton, ioIcons, HUD_ICON.zoom);
  iconifyHudButton(settingsButton, ioIcons, HUD_ICON.settings);

  let camera = new Camera(1, 1);
  let session: GameSession | null = null;
  let landscape: LandscapeSet = 0;
  // Decoded building/flag/border-stone atlases by archive name, kept so the build
  // menu can crop the LOCAL player's nation buildings (registerAtlas only feeds
  // the GL renderer; the menu needs the raw LoadedAtlas). Seeded with the Roman
  // summer archive loaded at boot.
  const nationAtlasCache = new Map<string, LoadedAtlas>();
  // Decoded landscape object atlases (map00/01/02), kept for the HUD ware
  // pictographs (the GL renderer keeps its own registered copy).
  const objectAtlasCache = new Map<string, LoadedAtlas>();
  // Per-player building/flag/border-stone archive resolver for the active map.
  // Each player's structures render from their own nation's archive; a nation
  // whose atlas failed to load falls back to the season-appropriate Roman archive
  // (and finally the always-registered summer rom_z): wrong-people beats invisible.
  // Replaced on every switchMap once the session's nations are known.
  let nationArchiveFor: (player: number) => string = () => BUILDING_ARCHIVE;
  // Build-menu icons cropped from the local player's nation atlas; rebuilt per
  // map switch (the local nation can change via ?nations=). Read through a getter
  // by the interaction layer so the menu always reflects the current nation.
  let buildIcons: BuildIconSet | null = null;
  // Seed the build-icon atlas cache with the Roman summer archive loaded at boot;
  // switchMap adds each present nation's atlas as it is loaded and rebuilds the
  // menu icons from the local player's nation. Until then the menu is Roman.
  if (romanAtlas) {
    nationAtlasCache.set(BUILDING_ARCHIVE, romanAtlas);
    buildIcons = makeBuildIconSet(romanAtlas);
  }
  let objAtlasReady = false;
  // Current map identity (drives per-map save filtering + default save names).
  let currentMap = '';
  let currentMapTitle = '';
  // Live campaign tracking (set when the page booted with ?campaign=).
  let activeCampaign: CampaignController | null = null;
  let activeChapterMap = '';
  // Session mode (/game/<map>/<id>): the clean URL is authoritative and its
  // world is server-persisted. Set before booting the session so switchMap
  // leaves the pathname untouched (no legacy ?map=/?ai= rewrite).
  let sessionMode = false;
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
    }
  }

  // Monotonic switch generation: an in-flight switchMap that has been
  // superseded by a newer one must abandon before touching shared state, or
  // the last-resolving fetch would win over the user's latest selection.
  let switchGen = 0;

  /** A failed map switch must not be silent: toast + keep the HUD honest. */
  function mapSwitchFailed(name: string, err: unknown): void {
    console.error(`map switch to ${name} failed`, err);
    saveToast(`Failed to load map ${name}`);
    if (currentMap) {
      mapSelect.setValue(currentMap);
      document.body.dataset.mapReady = currentMap;
    }
  }

  async function switchMap(
    entry: MapIndexEntry,
    aiPlayers: readonly number[] = [],
    nations: readonly Nation[] = [],
  ): Promise<void> {
    const gen = ++switchGen;
    delete document.body.dataset.mapReady;
    const map = await loadMap(entry);
    const atlas = await loadTerrainAssets(map.terrain);
    if (gen !== switchGen) return; // superseded by a newer switch
    renderer.resize();
    renderer.load(map.data, atlas);

    landscape = map.terrain;
    const archive = objectAtlasForLandscape(map.terrain);
    let objAtlas = objectAtlasCache.get(archive) ?? null;
    if (!objAtlas) {
      objAtlas = await loadAtlas(archive);
      if (gen !== switchGen) return;
      if (objAtlas) {
        objectAtlasCache.set(archive, objAtlas);
        if (!sprites.hasAtlas(archive)) {
          sprites.registerAtlas(objAtlas.meta, objAtlas.pages, objAtlas.pmaskPages);
        }
      }
    }
    objAtlasReady = sprites.hasAtlas(archive);
    // The object archive also carries the original's small ware pictographs
    // (2200 + GoodType id); dress the HUD resource readout with them. Falls
    // back to the text readout when the atlas (or a sprite) is missing.
    resources.build(makeWareIconSet(objAtlas));

    // Computer opponents: keep only slot indices this map can seat, then seed
    // enough players to cover the highest AI slot (human is always slot 0).
    const ai = aiPlayers.filter((n) => n > 0 && n < entry.players);
    const playerCount = ai.length > 0 ? Math.max(...ai) + 1 : undefined;
    // Nations are slot-indexed (may be empty = all Roman); createWorld defaults
    // any short/omitted slot to romans, so passing the parsed array as-is is safe.
    session = new GameSession(map.engineMap, GAME_SEED, playerCount, ai, nations);
    session.fogEnabled = readFogPref();

    // Per-nation building/flag/border-stone archives. Load ONLY the archives the
    // players present actually need (their nations + the current season's variant),
    // in parallel, non-fatal — never all eight peoples' atlases. A Viking player on
    // a winter map pulls wvik_z; greenland/wasteland pull vik_z. Each player's
    // structures then draw from their own people's archive.
    const ns = session;
    const wantedArchives = new Set<string>();
    for (let p = 0; p < ns.playerCount; p++) {
      wantedArchives.add(nationBuildingArchive(ns.nationOf(p), map.terrain));
    }
    // Also ensure the season-appropriate Roman archive is available as the shared
    // fallback (rom_z is always registered at boot; wrom_z is loaded here on winter).
    wantedArchives.add(buildingArchiveForLandscape(map.terrain));
    const toLoad = [...wantedArchives].filter((a) => !sprites.hasAtlas(a));
    if (toLoad.length > 0) {
      const loaded = await Promise.all(toLoad.map((a) => loadAtlas(a)));
      if (gen !== switchGen) return; // superseded by a newer switch
      for (let i = 0; i < toLoad.length; i++) {
        const la = loaded[i];
        if (!la) {
          console.warn(`missing sprite archive ${toLoad[i]}; falling back to Roman`);
          continue;
        }
        sprites.registerAtlas(la.meta, la.pages, la.pmaskPages);
        nationAtlasCache.set(toLoad[i], la);
      }
    }
    // Resolver: owner's nation archive when registered, else the season Roman
    // archive, else the always-present summer rom_z. Reads session live so it stays
    // correct across this switch's lifetime.
    const romanSeason = buildingArchiveForLandscape(map.terrain);
    nationArchiveFor = (player) => {
      const wanted = nationBuildingArchive(ns.nationOf(player), landscape);
      if (sprites.hasAtlas(wanted)) return wanted;
      return sprites.hasAtlas(romanSeason) ? romanSeason : BUILDING_ARCHIVE;
    };
    // Build-menu icons preview the LOCAL player's own buildings: crop from their
    // nation atlas (season-appropriate), falling back to whatever the resolver
    // picked when their atlas is missing.
    const localArchive = nationArchiveFor(ns.localPlayer);
    buildIcons = makeBuildIconSet(nationAtlasCache.get(localArchive) ?? null);

    // Show the local player's people (cosmetic label only for this phase).
    nationLabelEl.textContent = nationLabel(session.localNation);
    overlayTick = -1; // new world: drop per-tick overlay caches
    // A fresh session runs at 1x unpaused: sync the HUD controls to it.
    setSpeed(1);
    setPaused(false);
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
    setHudLabel(zoomButton, zoomLabel());
    document.title = `s2gold — ${map.title || entry.name}`;
    // Leaving the chapter's map ends campaign tracking: the win condition
    // must not be satisfiable (and progress recorded) on a different map.
    let leftChapter = false;
    if (activeCampaign && entry.name !== activeChapterMap) {
      activeCampaign.dispose();
      activeCampaign.button.remove();
      activeCampaign = null;
      leftChapter = true;
    }
    // Session mode owns the clean /game/<map>/<id> URL, so never rewrite it to
    // legacy query params; legacy /play mode keeps its ?map=/?ai=/?campaign=.
    if (!sessionMode) {
      const url = new URL(window.location.href);
      // On the clean /play/<map> route the map lives in the path, so keep it there
      // (and switch it in place) rather than duplicating it as a redundant ?map=
      // query. The legacy root route still uses ?map=.
      if (url.pathname.startsWith('/play/')) {
        url.pathname = `/play/${entry.name}`;
        url.searchParams.delete('map');
      } else {
        url.searchParams.set('map', entry.name);
      }
      // Keep the URL honest about the active AI config (cleared on a plain switch).
      if (ai.length > 0) url.searchParams.set('ai', ai.join(','));
      else url.searchParams.delete('ai');
      if (leftChapter) url.searchParams.delete('campaign');
      window.history.replaceState(null, '', url);
    }
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
    installDebugSurface({
      session: s,
      audio,
      hqNode,
      nationArchiveFor: (player) => nationArchiveFor(player),
      nodeToScreen,
      setFog: (on) => {
        s.setFog(on);
        writeFogPref(on);
        applyFog();
      },
      roadPreview: () => {
        const rp = interaction.roadPreview;
        return rp ? { node: rp.node, valid: rp.valid, hasPath: rp.path !== null } : null;
      },
      centerNode: (node) => {
        const a = nodeAnchor(s.world, node);
        camera.centerOn(a.x, a.y, canvas.width, canvas.height);
      },
    });
    rebuildStatics();
  }

  // --- HUD controls ---------------------------------------------------------

  // Update an (icon-or-text) HUD button's label: writes the hidden `.hud-btn-label`
  // span when iconified (leaving the icon intact) or the button text otherwise,
  // and keeps aria-label in sync. Text stays in textContent for the e2e asserts.
  const setHudLabel = (button: HTMLElement, text: string): void => {
    const label = button.querySelector<HTMLElement>('.hud-btn-label');
    if (label) label.textContent = text;
    else button.textContent = text;
    button.setAttribute('aria-label', text);
  };

  const zoomLabel = (): string => `Zoom ${camera.zoom.toFixed(camera.zoom % 1 === 0 ? 0 : 2)}x`;
  zoomButton.addEventListener('click', () => {
    camera.toggleZoom(canvas.width, canvas.height);
    setHudLabel(zoomButton, zoomLabel());
  });

  function setPaused(paused: boolean): void {
    if (session) session.paused = paused;
    setHudLabel(pauseButton, paused ? 'Resume' : 'Pause');
    // The pause button has no panel, so mark it active while paused to keep the
    // toggled state visible now that it is icon-only.
    pauseButton.classList.toggle('active', paused);
  }
  pauseButton.addEventListener('click', () => setPaused(!(session?.paused ?? false)));

  function setSpeed(speed: Speed): void {
    if (session) session.speed = speed;
    // Programmatic changes (__s2debug, initial setSpeed(1)) must show too.
    speedSelect.setValue(String(speed));
  }

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

  const cameraInput = installCameraInput({
    canvas,
    camera: () => camera,
    onZoomChanged: () => setHudLabel(zoomButton, zoomLabel()),
    onTogglePause: () => setPaused(!(session?.paused ?? false)),
  });

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
    // Build-menu building icons cropped from the local player's nation atlas
    // (rebuilt per map switch); null when the atlas is missing, and the menu falls
    // back to text rows. Read through a getter so a nation change is picked up.
    buildIcons: () => buildIcons,
    onStatus: (text) => {
      status.textContent = text;
      status.hidden = text.length === 0;
    },
    suppressClick: () => cameraInput.draggedFar(),
    openMilitary: (node, x, y) => military.openAt(node, x, y),
    closeMilitary: () => military.close(),
    openHarbor: (node, x, y) => harbor.openAt(node, x, y),
    closeHarbor: () => harbor.close(),
    openWarehouse: (node) => {
      const title = session?.warehouseTitleAt(node) ?? null;
      if (!title) return false;
      // Open the inventory over the clicked building, not anchored to the HUD
      // Goods button. nodeToScreen is canvas-relative; offset by the canvas rect.
      const s = nodeToScreen(node);
      const rect = canvas.getBoundingClientRect();
      // Pass the clicked node so the panel shows THIS warehouse's own stock,
      // not the player-wide sum (the HUD Goods button path passes no node).
      goodsPanel.open(title, { x: rect.left + s.x, y: rect.top + s.y }, node);
      return true;
    },
  });
  interactionRef = interaction;

  // --- Save / load ----------------------------------------------------------

  // Brief feedback toast (reuses the .status-toast look, offset below the road
  // hint so the two never overlap). Auto-dismisses; only the latest is shown.
  const saveToast = makeToast(gameRoot, { className: 'save-toast', ms: 2200 });

  // Seafaring notifications (expedition ready / landed) float as their own toast,
  // slightly higher than the save toast so the two never overlap.
  const seaToast = makeToast(gameRoot, { className: 'sea-toast', ms: 3000, testid: 'sea-toast' });

  // Menu/Stats/Goods share the anchored-panel mechanics with Settings. The
  // panels can also close themselves (close button, load-and-close), so they
  // report visibility back to keep the bar buttons in sync.
  const saveMenu = new SaveMenu({
    root,
    session: () => session,
    mapName: () => currentMap,
    mapTitle: () => currentMapTitle,
    toast: saveToast,
    onVisibility: (open) => syncHudPanelButton(menuButton, open),
    onLoaded: resyncAfterLoad,
  });

  /**
   * Re-sync presentation state after a world snapshot is loaded into the live
   * session (from the Save/Load panel or a restored server session). The loaded
   * world may share the cached tick number, so force an overlay rebuild;
   * restored counters are history, not fresh events, so sync the toast edge
   * detectors to avoid phantom sea toasts; and redraw the stats charts.
   */
  function resyncAfterLoad(): void {
    overlayTick = -1;
    if (session) {
      prevExpReady = session.counters.expeditionsReady;
      prevExpLanded = session.counters.expeditionsLanded;
    }
    statsPanel.invalidate();
  }
  // WebGL context loss (GPU reset, driver update, background eviction): the
  // GL resources are gone and nothing rebuilds them, so without handling this
  // the canvas silently freezes while the sim keeps running. Quicksave, tell
  // the user, and reload once the browser restores the context.
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault(); // allow the browser to restore the context
    if (session) {
      session.paused = true;
      saveMenu.quicksave();
    }
    saveToast('Graphics context lost - reloading when restored...');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    window.location.reload();
  });

  wireHudPanel(menuButton, {
    isOpen: () => saveMenu.isOpen,
    open: () => saveMenu.open(),
    close: () => saveMenu.close(),
    element: () => saveMenu.element,
  });

  // In-game statistics panel (per-player time-series charts).
  const statsPanel = new StatsPanel({
    root,
    session: () => session,
    onVisibility: (open) => syncHudPanelButton(statsButton, open),
  });
  wireHudPanel(statsButton, {
    isOpen: () => statsPanel.isOpen,
    open: () => statsPanel.open(),
    close: () => statsPanel.close(),
    element: () => statsPanel.element,
  });
  const goodsPanel = new GoodsPanel({
    root,
    session: () => session,
    onVisibility: (open) => syncHudPanelButton(goodsButton, open),
  });
  wireHudPanel(goodsButton, {
    isOpen: () => goodsPanel.isOpen,
    open: () => goodsPanel.open(),
    close: () => goodsPanel.close(),
    element: () => goodsPanel.element,
  });
  // In the desktop shell (Tauri) the F and Q keys go through the app's native
  // commands: WKWebView does not support the HTML Fullscreen API here, and only
  // the shell can quit the process. Browsers use the web equivalents.
  const tauri = (window as { __TAURI__?: { core: { invoke: (cmd: string) => Promise<unknown> } } })
    .__TAURI__;
  const plainKey = (ev: KeyboardEvent): boolean =>
    !ev.metaKey && !ev.ctrlKey && !ev.altKey && !isEditableTarget(ev.target);
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'F5') {
      ev.preventDefault();
      saveMenu.quicksave();
    } else if (ev.key === 'F9') {
      ev.preventDefault();
      void saveMenu.quickload();
    } else if ((ev.key === 'f' || ev.key === 'F') && plainKey(ev)) {
      ev.preventDefault();
      if (tauri) void tauri.core.invoke('toggle_fullscreen');
      else if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen();
    } else if ((ev.key === 'q' || ev.key === 'Q') && plainKey(ev)) {
      ev.preventDefault();
      // The live world persists via session autosave, so quitting is safe.
      if (tauri) void tauri.core.invoke('quit');
      else window.close(); // no-op in a user-opened browser tab
    }
  });

  // --- Render loop ----------------------------------------------------------

  // Derived world overlays (road segments, disconnected/depleted markers)
  // change only when the simulation ticks; cache them per tick so paused and
  // high-fps frames stop rebuilding segment arrays and re-running the
  // road-graph flood fill every frame.
  let overlayTick = -1;
  let cachedRoadSegs: ReturnType<typeof roadSegments> = [];
  let cachedUpgradedSegs: ReturnType<typeof upgradedRoadSegments> = [];
  let cachedDisc: ReturnType<typeof disconnectedBuildingMarkers> = [];
  let cachedDry: ReturnType<typeof depletedMineMarkers> = [];
  function refreshOverlays(): void {
    if (!session) return;
    if (session.world.tick === overlayTick) return;
    overlayTick = session.world.tick;
    cachedRoadSegs = roadSegments(session.world, session.geom);
    cachedUpgradedSegs = upgradedRoadSegments(session.world, session.geom);
    cachedDisc = disconnectedBuildingMarkers(session.world, session.localPlayer);
    cachedDry = depletedMineMarkers(session.world, session.geom, session.localPlayer);
  }

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

    cameraInput.panHeld(dt);

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
    renderer.render(camera, now);
    if (session) {
      refreshOverlays();
      roads.render(camera, cachedRoadSegs);
      // Upgraded (donkey) roads: repaint their edges in the darker paved colour,
      // a touch wider, on top of the base dirt pass.
      if (cachedUpgradedSegs.length > 0) {
        roads.render(camera, cachedUpgradedSegs, DONKEY_ROAD_COLOR, true, 4.5);
      }
    }

    const waveFrame = Math.floor(now / ANIM_FRAME_MS);
    const walkFrame = Math.floor(now / WALK_FRAME_MS);
    const dynamics: DynamicSprite[] =
      session && carrier
        ? buildDynamics(
            session.world,
            session.geom,
            {
              carrier,
              jobs,
              nationArchiveFor,
              objectArchive: objectAtlasForLandscape(landscape),
              workAvailable: sprites.hasAtlas(WORK_ARCHIVE),
            },
            { waveFrame, walkFrame, alpha },
            session.fogEnabled ? session.visibility : null,
          )
        : [];
    // Territory border stones + geologist survey signs: real sprites drawn with a
    // depth test (a tree in front occludes them) instead of overprinting as flat
    // overlays. Both are fog-aware. Signs are mapbobs, so they batch with the tree
    // statics; border stones are nation-archive and would, sprinkled around the
    // frontier ring, split the mapbobs run into a draw call per stone — so they
    // ride the renderer's separate `overlay` pass (still depth-tested, one batch).
    // Each player's frontier uses THEIR nation's boundary-stone sprite.
    const borderStones: DynamicSprite[] = [];
    if (session) {
      const vis = session.fogEnabled ? session.visibility : null;
      const objectArchive = objectAtlasForLandscape(landscape);
      for (let p = 0; p < session.playerCount; p++) {
        for (const s of borderStoneSprites(
          session.world,
          borderCache[p] ?? [],
          p,
          vis,
          nationArchiveFor(p),
        )) {
          borderStones.push(s);
        }
      }
      for (const s of signSprites(session.world, objectArchive, vis)) dynamics.push(s);
    }
    const stats = sprites.render(camera, waveFrame, dynamics, borderStones);
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
      if (cachedDisc.length > 0) roads.render(camera, cachedDisc, [1.0, 0.55, 0.0, 0.95], false);
      // Exhausted mines: a red bar so the player knows to rebuild on fresh ore.
      if (cachedDry.length > 0) roads.render(camera, cachedDry, [1.0, 0.2, 0.2, 0.95], false);
      // Geologist survey signs are drawn as real sign-tablet sprites in the dynamic
      // pass above (depth-sorted with the terrain); here we only toggle the legend.
      signLegend.style.display = session.world.signs.length > 0 ? 'block' : 'none';
      // Live road-build preview on top: translucent path + an end marker (green
      // when a road can be built to the hovered node, red when it cannot).
      const preview = interaction.roadPreview;
      if (preview && preview.node >= 0) {
        if (preview.valid && preview.path) {
          roads.render(
            camera,
            pathSegments(session.world, session.geom, preview.path),
            [0.5, 0.8, 1.0, 0.5],
            false,
          );
          roads.render(
            camera,
            nodeMarkerSegments(session.world, preview.node),
            [0.4, 1.0, 0.5, 0.85],
            false,
          );
        } else {
          roads.render(
            camera,
            nodeMarkerSegments(session.world, preview.node),
            [1.0, 0.3, 0.3, 0.85],
            false,
          );
        }
      }
    }
    minimap.draw(camera, canvas.width, canvas.height);

    updateHud(stats.quads, stats.drawCalls);
    // Keep the open floating panels tracking live state (no-ops while closed).
    goodsPanel.update();
    statsPanel.update();

    frames++;
    if (now - fpsWindowStart >= 500) {
      if (showFps) fps.textContent = `${Math.round((frames * 1000) / (now - fpsWindowStart))} fps`;
      frames = 0;
      fpsWindowStart = now;
    }
    requestAnimationFrame(frame);
  }

  function updateHud(quads: number, drawCalls: number): void {
    if (!session) return;
    // Build materials only (full inventory is the Goods panel).
    resources.update(session.inventory);
    if (showTick) tickLabel.textContent = `tick ${String(session.world.tick).padStart(7, ' ')}`;
    updateDebugCounters(session, audio, hqNode, { quads, drawCalls });
  }

  /** Wire the Objectives panel + win-condition tracking for a chapter. */
  function startCampaign(chapter: Chapter): void {
    document.title = `s2gold — ${chapter.title}`;
    const campaign = new CampaignController({ root: gameRoot, session: () => session, chapter });
    activeCampaign = campaign;
    activeChapterMap = chapter.mapName;
    // Insert before the (optional, default-hidden) tick/FPS readouts so the
    // campaign button stays with the main controls rather than trailing them.
    hudTop.insertBefore(campaign.button, tickLabel);
    campaign.start();
  }

  /**
   * Session mode (/game/<map>/<id>): fetch the server session and boot its map,
   * computer opponents and campaign, restoring the live world snapshot when one
   * has been saved. Arms auto-persistence for the rest of the page's life.
   */
  async function bootSession(id: string): Promise<void> {
    sessionMode = true;
    const remote = await getSession(id);
    if (!remote) {
      showMessage(
        gameRoot,
        'game-map-load-failed',
        'Failed to load the saved game (session not found or the server is offline).<br />' +
          'Return to the <a href="/">title screen</a> and start a new game.',
      );
      return;
    }
    const ai = Array.isArray(remote.ai)
      ? remote.ai.filter((n) => Number.isInteger(n) && n > 0)
      : [];
    // Session nations are stored as slot-indexed codes (null on legacy sessions
    // = all Roman); decodeNations turns a code list back into a nation array.
    const nations = decodeNations(Array.isArray(remote.nations) ? remote.nations.join(',') : null);
    setSpeed(1);
    try {
      // pickMap resolves the entry from remote.map (the /game pathname does not
      // match its /play route, so the second arg is used as the wanted name).
      await switchMap(pickMap(mapIndex, remote.map), ai, nations);
    } catch (err) {
      console.error('initial map load failed', err);
      showMessage(
        gameRoot,
        'game-map-load-failed',
        'Failed to load the map (missing or corrupt converted assets).<br />' +
          'Check the asset pipeline output, then reload.',
      );
      return;
    }
    // Restore the saved world snapshot (if any) via the same in-place swap the
    // Save/Load panel uses, then re-sync presentation state. A bad/incompatible
    // snapshot leaves the fresh map running rather than aborting the boot.
    if (remote.data && session) {
      try {
        session.loadWorld(remote.data);
        resyncAfterLoad();
      } catch (err) {
        console.error('failed to restore session world; continuing on the fresh map', err);
      }
    }
    const chapter = remote.campaign != null ? chapterById(remote.campaign) : undefined;
    if (chapter) startCampaign(chapter);
    startSessionPersistence(id, () =>
      session ? JSON.stringify({ tick: session.world.tick, data: session.serialize() }) : null,
    );
  }

  // Session mode is selected purely by the pathname; the legacy query-param
  // boot below is left entirely unchanged and handles every other case.
  const sessionMatch = /^\/game\/([^/]+)\/([0-9a-f]{6,64})$/.exec(window.location.pathname);
  if (sessionMatch) {
    await bootSession(sessionMatch[2]);
    requestAnimationFrame(frame);
    return;
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
  // ?nations=rom,vik,... -> slot-indexed nations (absent = all Roman; old URLs stay valid).
  const nations = decodeNations(params.get('nations'));
  setSpeed(1);
  try {
    await switchMap(pickMap(index, query), aiPlayers, nations);
  } catch (err) {
    console.error('initial map load failed', err);
    showMessage(
      gameRoot,
      'game-map-load-failed',
      'Failed to load the map (missing or corrupt converted assets).<br />' +
        'Check the asset pipeline output, then reload.',
    );
    return;
  }

  // Resume last game (title menu): load the newest save for this map.
  if (params.get('resume') === '1') void saveMenu.quickload();

  // Campaign mode (/play/<map>?campaign=<id>): show the Objectives panel and
  // check the chapter's win condition against the live session.
  const campaignParam = params.get('campaign');
  const chapter = campaignParam ? chapterById(Number.parseInt(campaignParam, 10)) : undefined;
  if (chapter) startCampaign(chapter);

  requestAnimationFrame(frame);
}

// Guard on `document` so the module can be imported in a non-DOM test env
// (unit tests exercise the exported helpers without running the game).
if (typeof document !== 'undefined') void boot();
