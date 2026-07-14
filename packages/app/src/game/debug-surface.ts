/**
 * The `window.__s2debug` surface: counters + helpers exposed for the Playwright
 * e2e suite (and manual debugging). Installed fresh on every map switch and
 * refreshed once per rendered frame. Everything here is read-only queries or
 * explicitly `debug*`-prefixed cheats used by tests to stage scenarios.
 */

import type { AudioEngine } from './audio';
import type { GameSession } from './session';

/** Debug counters + helpers exposed on window for e2e assertions. */
export interface S2Debug {
  // P1 fields (kept for the P1 gate).
  staticObjects: number;
  trees: number;
  granite: number;
  spriteQuads: number;
  spriteDrawCalls: number;
  // P2 fields.
  tick: number;
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
  /** The chosen nation of a player slot (cosmetic; 'romans' by default). */
  nationOf(player: number): string;
  /**
   * The building/flag/border-stone sprite archive a player's structures actually
   * render from (e.g. 'vik_z' for a Viking on a summer map, 'wrom_z' for a Roman
   * on winter). Reflects the missing-atlas fallback, so tests can assert a
   * non-Roman player really draws from its own people's archive.
   */
  nationArchiveOf(player: number): string;
  /** Live building count for a player (HQ + sites + working). */
  buildingsOf(player: number): number;
  /** Toggle fog of war (default on for a new game). */
  setFog(on: boolean): void;
  /** Total garrisoned soldiers at a military building node (-1 when not military). */
  militaryTroops(node: number): number;
  /** Cheat: place a fully-built, unoccupied military building for a player. */
  debugSpawnMilitary(player: number, node: number, type: string): number;
  /** Node id nearest a map (x, y) lattice coordinate. */
  nodeOf(x: number, y: number): number;
  /** The flag node (SE of a door node) that a building here would use. */
  flagNodeOf(node: number): number;
  /** True when player 0 may place a building of `type` on `node`. */
  canBuild(node: number, type: string): boolean;
  /** True when player 0 may place a flag on `node`. */
  canFlag(node: number): boolean;
  /** Client-space (CSS px) position of a node's ground anchor. */
  nodeToScreen(node: number): { x: number; y: number };
  /** Node path between two flag nodes over walkable ground, or null. */
  suggestRoad(startNode: number, endNode: number): number[] | null;
  /** Current road-build preview state (null when not in road mode). */
  roadPreview(): { node: number; valid: boolean; hasPath: boolean } | null;
  // Seafaring (P7).
  /** Queue a prepareExpedition command at one of the local player's harbors. */
  prepareExpedition(harborId: number): void;
  /** Cheat: found a fully-working harbor for a player at a coastal node (-1 fail). */
  debugSpawnHarbor(player: number, node: number): number;
  /** Whether a node is a valid coastal harbor site, ignoring territory ownership. */
  debugCanPlaceHarbor(node: number): boolean;
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
  /** Center the camera on a lattice node (test helper for off-screen picking). */
  centerNode(node: number): void;
}

declare global {
  interface Window {
    __s2debug?: S2Debug;
  }
}

/** Presentation-layer hooks the debug surface reaches through. */
export interface DebugSurfaceDeps {
  session: GameSession;
  audio: AudioEngine;
  /** HQ building node id for player 0 (-1 when none). */
  hqNode: () => number;
  /** The sprite archive a player's structures render from (with fallbacks). */
  nationArchiveFor: (player: number) => string;
  /** Client-space (CSS px) position of a node's ground anchor. */
  nodeToScreen: (node: number) => { x: number; y: number };
  /** Set fog on the session AND sync the pref + renderers (main wires this). */
  setFog: (on: boolean) => void;
  /** Live road-build preview from the interaction layer. */
  roadPreview: () => { node: number; valid: boolean; hasPath: boolean } | null;
  /** Center the camera on a lattice node. */
  centerNode: (node: number) => void;
}

/** (Re)install `window.__s2debug` for the current session. */
export function installDebugSurface(deps: DebugSurfaceDeps): void {
  const s = deps.session;
  window.__s2debug = {
    staticObjects: 0,
    trees: 0,
    granite: 0,
    spriteQuads: 0,
    spriteDrawCalls: 0,
    tick: 0,
    counters: { ...s.counters },
    settlers: 0,
    flags: 0,
    buildings: 0,
    roads: 0,
    ships: 0,
    harbors: 0,
    audio: deps.audio.debug(),
    hqNode: deps.hqNode(),
    nodeOf: (x, y) => s.geom.index(x, y),
    flagNodeOf: (node) => s.geom.neighbour(node, 'SE'),
    canBuild: (node, type) => s.canBuild(node, type as Parameters<GameSession['placeBuilding']>[1]),
    canFlag: (node) => s.canFlag(node),
    nodeToScreen: deps.nodeToScreen,
    suggestRoad: (a, b) => s.suggestRoad(a, b),
    players: s.playerCount,
    aiPlayers: s.aiPlayers.length,
    nationOf: (player) => s.nationOf(player),
    nationArchiveOf: (player) => deps.nationArchiveFor(player),
    buildingsOf: (player) => s.buildingsOf(player),
    setFog: deps.setFog,
    militaryTroops: (node) => s.militaryAt(node)?.troops ?? -1,
    debugSpawnMilitary: (player, node, type) =>
      s.debugSpawnMilitary(player, node, type as Parameters<GameSession['placeBuilding']>[1]),
    roadPreview: deps.roadPreview,
    prepareExpedition: (harborId) => s.prepareExpedition(harborId),
    debugSpawnHarbor: (player, node) => s.debugSpawnHarbor(player, node),
    debugCanPlaceHarbor: (node) => s.debugCanPlaceHarbor(node),
    debugSpawnShip: (player, harborId) => s.debugSpawnShip(player, harborId),
    debugGrantExpeditionSupplies: (player) => s.debugGrantExpeditionSupplies(player),
    debugWaterConnected: (nodeA, nodeB) => s.debugWaterConnected(nodeA, nodeB),
    harborIdAt: (node) => s.harborAt(node)?.id ?? -1,
    expeditionReady: (harborId) => s.expeditionAt(harborId)?.ready ?? false,
    centerNode: deps.centerNode,
  };
}

function countLive<T>(store: { items: (T | null)[] }): number {
  let n = 0;
  for (const it of store.items) if (it) n++;
  return n;
}

/** Per-frame refresh of the live counters (no-op when no surface installed). */
export function updateDebugCounters(
  session: GameSession,
  audio: AudioEngine,
  hqNode: () => number,
  stats: { quads: number; drawCalls: number },
): void {
  const dbg = window.__s2debug;
  if (!dbg) return;
  dbg.spriteQuads = stats.quads;
  dbg.spriteDrawCalls = stats.drawCalls;
  dbg.tick = session.world.tick;
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
