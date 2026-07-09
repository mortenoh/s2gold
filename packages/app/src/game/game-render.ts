/**
 * Map live engine state onto the renderer's engine-agnostic {@link DynamicSprite}
 * list each frame. This module owns the clean-room sprite-index mappings that
 * were researched from the converted Roman building/flag archive (`rom_z`) and
 * the carrier BOB (`carrier`); the engine and renderer stay free of them.
 *
 * Building sprites (rom_z, FACTS from the nation-file layout, stride 5 per
 * BuildingType id verified by rendering the atlas):
 *   building(type)  = 250 + 5 * id      shadow = +1
 *   site skeleton   = 252 + 5 * id      shadow = +3     door = +4
 *   ids: headquarters 0, quarry 19, woodcutter 17, forester 20, sawmill 33.
 * Flags (rom_z): 8 waving frames at 100..107, shadows 110..117 (player-colored).
 * Carrier wares (carrier BOB job/GoodType id): trunk 22, plank 23, stone 24.
 * BOB direction slots line up with the engine's E/SE/SW/W/NW/NE order directly
 * (see bobDir below; verified in-game against travel direction).
 */

import {
  BUILDING_DEFS,
  buildingDef,
  DIRECTIONS,
  TICKS,
  type Building,
  type BuildingType,
  type Geometry,
  type JobType,
  type Settler,
  type Ship,
  type WareType,
  type World,
} from '@s2gold/engine';
import { nodeWorldPos, type DynamicSprite, type RoadSegment } from '@s2gold/renderer';
import type { BobAtlas } from './bob-atlas';

/** Archive keys the sprite renderer indexes these layers by. */
export const BUILDING_ARCHIVE = 'rom_z';
export const BOB_ARCHIVE = 'carrier';
/** Ship-sprite archive (converted BOOT_Z.LST): the big sailing ship + shadows. */
export const SHIP_ARCHIVE = 'boot_z';

/**
 * Ship sprites (boot_z / converted BOOT_Z.LST, clean-room FACTS verified by
 * rendering the archive's atlas): item indices 0..23 are twelve ship bodies at
 * the EVEN indices (kind "rle") each paired with its drop-shadow at the next ODD
 * index (kind "shadow"). The twelve bodies are six sailing directions, two
 * sail-animation frames each (direction-major: a direction's two frames are
 * adjacent pairs — (0,2), (4,6), ... (20,22)). Indices >=24 are the shipyard's
 * build stages and full-screen sea pictures, unused here.
 *
 * The engine-direction -> body-base map was read off the rendered atlas by the
 * bow heading of each frame (E points right, W left, S toward the camera, the
 * N* headings show the stern): E->8, SE->4, SW->0, W->12, NW->16, NE->20. A
 * frame's shadow is body+1; its second animation frame is body+2 (shadow +3).
 * Engine DIRECTIONS order is [E, SE, SW, W, NW, NE] = index 0..5.
 */
const SHIP_DIR_BASE: readonly number[] = [8, 4, 0, 12, 16, 20];
/** Idle/docked ships face SE (engine dir 1): a pleasant 3/4 view toward camera. */
const SHIP_IDLE_DIR = 1;
/** Sail-animation frames per direction (the two adjacent body sprites). */
const SHIP_ANIM_FRAMES = 2;

/**
 * s25 BuildingType id per engine building name (drives the rom_z sprite index
 * via the stride-5 rule: sprite = 250 + 5 * id). Derived from the engine's
 * {@link BUILDING_DEFS} so every economy building (farm, mill, bakery, well,
 * mines, smelter, mint, ...) gets its sprite automatically as the table grows;
 * verified visually for the P4 economy set. Unknown/future building kinds map to
 * `undefined` and are skipped defensively by {@link buildingSprite}.
 */
export const BUILDING_TYPE_ID: Readonly<Record<BuildingType, number>> = Object.fromEntries(
  Object.entries(BUILDING_DEFS).map(([type, def]) => [type, def.id]),
);

const FLAG_SPRITE_BASE = 100;
const FLAG_SHADOW_BASE = 110;
const FLAG_FRAMES = 8;
const BOB_WALK_FRAMES = 8;

/** carrier BOB job (GoodType) id for each carried ware. */
export const WARE_JOB: Readonly<Record<WareType, number>> = {
  trunk: 22,
  plank: 23,
  stone: 24,
};

/**
 * JOBS.BOB job id per engine worker job, used to select the profession overlay
 * (clothing/tool) layered over the generic walking body. FACTS from RttR
 * `gameData/JobConsts.cpp` JOB_SPRITE_CONSTS `jobBobId` (Job enum order):
 * Woodchopper=5, Tree-planter(forester)=8, Carpenter(sawmill)=6, Stonemason=7,
 * Builder=23. The generic Helper/carrier (0) uses the carrier BOB instead, so
 * it is intentionally absent here.
 */
export const JOB_BOB_ID: Partial<Readonly<Record<JobType, number>>> = {
  woodcutter: 5,
  forester: 8,
  sawmiller: 6,
  stonemason: 7,
  builder: 23,
};

/** mapbobs sprite index of the pine (species 0) grown tree + its shadow. */
const SAPLING_SPRITE = 200;
const SAPLING_SHADOW = 350;

/** Bundle of the sprite atlases + object archive the dynamic layer draws from. */
export interface RenderAtlases {
  /** Carrier BOB (generic bodies + carried-ware overlays). */
  readonly carrier: BobAtlas;
  /** JOBS.BOB atlas (profession bodies + overlays), or null when unavailable. */
  readonly jobs: BobAtlas | null;
  /** Graphics archive holding the map objects (trees) for the current map. */
  readonly objectArchive: string;
}

/**
 * Resolve the {sprite, shadow} rom_z index for a building in a given state, or
 * null for an unknown building type (a kind the engine grew that we have no
 * sprite id for) so the caller can skip it rather than draw a garbage sprite.
 */
export function buildingSprite(type: BuildingType, state: 'site' | 'working'): {
  sprite: number;
  shadow: number;
} | null {
  const id = BUILDING_TYPE_ID[type];
  if (id === undefined) return null;
  const base = 250 + 5 * id;
  if (state === 'site' && type !== 'headquarters') {
    return { sprite: base + 2, shadow: base + 3 };
  }
  return { sprite: base, shadow: base + 1 };
}

/**
 * BOB direction index (0..5) for an engine direction index (0..5).
 *
 * Verified in-game against travel direction (a woodcutter walking west must
 * face west): the archive's direction slots line up with the engine's
 * E/SE/SW/W/NW/NE order directly. The previous (index + 3) % 6 shift rendered
 * every settler facing 180 degrees away from its travel direction; body and
 * overlay share the axis, so the composite looked coherent but mirrored.
 */
export function bobDir(engineDirIndex: number): number {
  return engineDirIndex;
}

/** World-pixel anchor (ground point) of a node, raised by its elevation. */
export function nodeAnchor(world: World, node: number): { x: number; y: number } {
  const x = node % world.width;
  const y = Math.floor(node / world.width);
  return nodeWorldPos({ x, y }, world.heightMap[node] ?? 0);
}

/** Engine direction index (0..5) stepping from `from` to adjacent `to`, or -1. */
function dirIndexBetween(geom: Geometry, from: number, to: number): number {
  for (let i = 0; i < DIRECTIONS.length; i++) {
    if (geom.neighbour(from, DIRECTIONS[i]) === to) return i;
  }
  return -1;
}

/** Unwrapped lattice point one step in engine direction `dirIndex` from (x,y). */
function unwrappedNeighbour(x: number, y: number, dirIndex: number): { x: number; y: number } {
  const odd = y & 1;
  switch (DIRECTIONS[dirIndex]) {
    case 'E':
      return { x: x + 1, y };
    case 'W':
      return { x: x - 1, y };
    case 'SE':
      return { x: x + odd, y: y + 1 };
    case 'SW':
      return { x: x - 1 + odd, y: y + 1 };
    case 'NE':
      return { x: x + odd, y: y - 1 };
    default: // NW
      return { x: x - 1 + odd, y: y - 1 };
  }
}

/** The lattice-mover fields settlers and ships share (node + edge progress). */
interface MoverLike {
  node: number;
  path: readonly number[];
  pathIndex: number;
  edgeProgress: number;
  ticksPerEdge: number;
}

/**
 * Interpolated ground anchor + facing for any lattice mover (settler or ship),
 * `alpha` into the current tick. Idle movers face `idleDir` (default SE, toward
 * the camera). Shared so ships glide between water nodes exactly like settlers.
 */
function moverAnchor(
  world: World,
  geom: Geometry,
  m: MoverLike,
  alpha: number,
  idleDir = 1,
): { x: number; y: number; dir: number; moving: boolean } {
  const fx = m.node % world.width;
  const fy = Math.floor(m.node / world.width);
  const from = nodeWorldPos({ x: fx, y: fy }, world.heightMap[m.node] ?? 0);
  if (m.pathIndex < m.path.length) {
    const to = m.path[m.pathIndex];
    const dirIndex = dirIndexBetween(geom, m.node, to);
    if (dirIndex >= 0) {
      const np = unwrappedNeighbour(fx, fy, dirIndex);
      const toElev = world.heightMap[geom.index(np.x, np.y)] ?? 0;
      const toPos = nodeWorldPos(np, toElev);
      const denom = Math.max(1, m.ticksPerEdge);
      const frac = Math.min(1, (m.edgeProgress + alpha) / denom);
      return {
        x: from.x + (toPos.x - from.x) * frac,
        y: from.y + (toPos.y - from.y) * frac,
        dir: dirIndex,
        moving: true,
      };
    }
  }
  return { x: from.x, y: from.y, dir: idleDir, moving: false };
}

/** Interpolated ground anchor + facing for a settler, `alpha` into the tick. */
function settlerAnchor(
  world: World,
  geom: Geometry,
  s: Settler,
  alpha: number,
): { x: number; y: number; dir: number; moving: boolean } {
  return moverAnchor(world, geom, s, alpha);
}

/** Options controlling the animation phase of the built scene. */
export interface SceneAnimation {
  /** Slow wave frame (flags); advanced at the original wind cadence. */
  readonly waveFrame: number;
  /** Faster walk-cycle frame for moving settlers. */
  readonly walkFrame: number;
  /** Sub-tick interpolation fraction in [0, 1). */
  readonly alpha: number;
}

/**
 * Translate the whole live world into a per-frame dynamic sprite list:
 * buildings (finished + construction sites), flags with their waiting wares,
 * and settlers (carriers with their carried ware, workers walking).
 */
export function buildDynamics(
  world: World,
  geom: Geometry,
  atlases: RenderAtlases,
  anim: SceneAnimation,
  visibility: Uint8Array | null = null,
): DynamicSprite[] {
  const { carrier, jobs, objectArchive } = atlases;
  const out: DynamicSprite[] = [];
  // Fog: a dynamic on a node that is not currently visible is hidden (explored
  // land keeps only its darkened terrain snapshot; unexplored is black). The
  // local player's own territory is always visible, so own units/buildings stay.
  const hidden = (node: number): boolean => visibility !== null && visibility[node] !== 2;

  // Buildings (finished buildings, and construction sites that reveal the
  // finished building bottom-up over their skeleton as the build progresses).
  for (const b of world.buildings.items) {
    if (!b) continue;
    if (hidden(b.node)) continue;
    const a = nodeAnchor(world, b.node);
    if (b.state === 'site' && b.type !== 'headquarters') {
      const site = buildingSprite(b.type, 'site');
      if (!site) continue; // unknown building kind: skip rather than draw garbage
      out.push({
        worldX: a.x,
        worldY: a.y,
        archive: BUILDING_ARCHIVE,
        spriteIndex: site.sprite,
        shadowIndex: site.shadow,
        player: b.player,
      });
      const done = buildingSprite(b.type, 'working');
      const reveal = b.buildTicks > 0 ? Math.max(0, Math.min(1, b.buildProgress / b.buildTicks)) : 0;
      if (done && reveal > 0.02) {
        out.push({
          worldX: a.x,
          worldY: a.y + 0.01, // draw just after the skeleton at the same depth
          archive: BUILDING_ARCHIVE,
          spriteIndex: done.sprite,
          clipBottom: reveal,
          player: b.player,
        });
      }
      continue;
    }
    const finished = buildingSprite(b.type, b.state);
    if (!finished) continue; // unknown building kind: skip
    const { sprite, shadow } = finished;
    out.push({
      worldX: a.x,
      worldY: a.y,
      archive: BUILDING_ARCHIVE,
      spriteIndex: sprite,
      shadowIndex: shadow,
      player: b.player,
    });
  }

  // Forester saplings maturing into trees: grow a small pine from seedling to
  // near-full size via scale; the engine swaps it for a full static tree on
  // maturation (see main's sapling-count watch that rebuilds statics).
  for (const sap of world.saplings) {
    if (hidden(sap.node)) continue;
    const anchor = nodeAnchor(world, sap.node);
    const remaining = sap.matureTick - world.tick;
    const progress = Math.max(0, Math.min(1, 1 - remaining / TICKS.treeGrow));
    out.push({
      worldX: anchor.x,
      worldY: anchor.y,
      archive: objectArchive,
      spriteIndex: SAPLING_SPRITE,
      shadowIndex: SAPLING_SHADOW,
      scale: 0.25 + 0.65 * progress,
    });
  }

  // Flags + wares waiting on them.
  for (const f of world.flags.items) {
    if (!f) continue;
    if (hidden(f.node)) continue;
    const a = nodeAnchor(world, f.node);
    const frame = anim.waveFrame % FLAG_FRAMES;
    out.push({
      worldX: a.x,
      worldY: a.y,
      archive: BUILDING_ARCHIVE,
      spriteIndex: FLAG_SPRITE_BASE + frame,
      shadowIndex: FLAG_SHADOW_BASE + frame,
      player: f.player,
    });
    for (let i = 0; i < f.wares.length; i++) {
      const ware = world.wares.items[f.wares[i]];
      if (!ware) continue;
      const overlay = wareOverlay(carrier, ware.type, 3 /* east */);
      if (overlay < 0) continue;
      const col = i % 4;
      const row = Math.floor(i / 4);
      out.push({
        worldX: a.x + 12 + (col - 1.5) * 6,
        worldY: a.y - 2 - row * 6,
        archive: BOB_ARCHIVE,
        spriteIndex: overlay,
      });
    }
  }

  // Settlers. Workers walking to/from their site render the generic body plus
  // their JOBS.BOB profession overlay (axe, saw, shovel, pickaxe, hammer);
  // carriers keep the carrier body and draw the ware they carry.
  for (const s of world.settlers.items) {
    if (!s) continue;
    if (hidden(s.node)) continue;
    const pos = settlerAnchor(world, geom, s, anim.alpha);
    const dir = bobDir(pos.dir);
    const step = pos.moving ? (anim.walkFrame + s.id) % BOB_WALK_FRAMES : 0;
    const jobBob = JOB_BOB_ID[s.job];

    // A duel is fought on the attacking soldier alone (the defender is virtual);
    // draw a mirrored opponent body beside it so a fight reads as two soldiers
    // facing each other (MILITARY.md §5). The opponent takes the defender's
    // player colour, looked up from the building under attack.
    if (s.rank >= 0 && s.state === 'soldierFight') {
      const target = world.buildings.items[s.attackTargetId];
      const oppDir = (dir + 3) % 6; // faces back toward the attacker
      const oppBody = carrier.bodyTable[0]?.[oppDir]?.[0];
      if (oppBody !== undefined) {
        out.push({
          worldX: pos.x + 10,
          worldY: pos.y,
          archive: BOB_ARCHIVE,
          spriteIndex: oppBody,
          player: target?.player ?? s.player,
        });
      }
    }

    if (jobs && jobBob !== undefined) {
      const body = jobs.bodyTable[0]?.[dir]?.[step];
      if (body === undefined) continue;
      out.push({
        worldX: pos.x,
        worldY: pos.y,
        archive: jobs.archive,
        spriteIndex: body,
        player: s.player,
      });
      const link = jobs.links[jobBob]?.[step]?.[0]?.[dir];
      if (link !== undefined) {
        out.push({
          worldX: pos.x,
          worldY: pos.y + 0.01, // ware/tool overlay just in front of the body
          archive: jobs.archive,
          spriteIndex: jobs.overlayBase + link,
        });
      }
      continue;
    }

    const bodyKey = carrier.bodyTable[0]?.[dir]?.[step];
    if (bodyKey === undefined) continue;
    out.push({
      worldX: pos.x,
      worldY: pos.y,
      archive: BOB_ARCHIVE,
      spriteIndex: bodyKey,
      player: s.player,
    });
    if (s.carryingWareId >= 0) {
      const ware = world.wares.items[s.carryingWareId];
      if (ware) {
        const overlay = wareOverlay(carrier, ware.type, dir, step);
        if (overlay >= 0) {
          // Nudge depth just past the body so the ware draws in front.
          out.push({
            worldX: pos.x,
            worldY: pos.y + 0.01,
            archive: BOB_ARCHIVE,
            spriteIndex: overlay,
          });
        }
      }
    }
  }

  // Ships gliding over the water lattice (same interpolation as settlers). A
  // moving ship animates its two sail frames and faces its travel direction; an
  // idle/docked ship shows a still 3/4 view. Ships are always drawn (never
  // fogged): the player's own fleet stays visible even out on open sea.
  for (const sh of world.ships.items) {
    if (!sh) continue;
    shipSprite(world, geom, sh, anim, out);
  }

  return out;
}

/** Append one ship's body + shadow sprites (interpolated) to the scene list. */
function shipSprite(
  world: World,
  geom: Geometry,
  sh: Ship,
  anim: SceneAnimation,
  out: DynamicSprite[],
): void {
  const pos = moverAnchor(world, geom, sh, anim.alpha, SHIP_IDLE_DIR);
  const base = SHIP_DIR_BASE[pos.moving ? pos.dir : SHIP_IDLE_DIR] ?? SHIP_DIR_BASE[SHIP_IDLE_DIR];
  // Roll the sail through its two frames only while under way; docked ships hold
  // frame 0 so wake/idle share the same sprite (a slow cadence reads as sailing).
  const frame = pos.moving ? Math.floor(anim.waveFrame / 2) % SHIP_ANIM_FRAMES : 0;
  const body = base + frame * 2;
  out.push({
    worldX: pos.x,
    worldY: pos.y,
    archive: SHIP_ARCHIVE,
    spriteIndex: body,
    shadowIndex: body + 1,
    player: sh.player,
  });
}

/**
 * Seam-correct world-pixel segments for every road edge in the world. Each
 * consecutive node pair on a road path becomes one segment; the far endpoint is
 * resolved via the step direction so edges across the torus seam stay short.
 */
export function roadSegments(world: World, geom: Geometry): RoadSegment[] {
  const out: RoadSegment[] = [];
  for (const road of world.roads.items) {
    if (!road) continue;
    pathSegments(world, geom, road.path, out);
  }
  return out;
}

/**
 * Seam-correct world-pixel segments for a single node path (each consecutive
 * pair becomes one edge). Reused for committed roads and the live road-build
 * preview. Appends into `out` when given, else returns a fresh array.
 */
export function pathSegments(
  world: World,
  geom: Geometry,
  path: readonly number[],
  out: RoadSegment[] = [],
): RoadSegment[] {
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i];
    const b = path[i + 1];
    const fx = a % world.width;
    const fy = Math.floor(a / world.width);
    const dir = dirIndexBetween(geom, a, b);
    if (dir < 0) continue;
    const np = unwrappedNeighbour(fx, fy, dir);
    const from = nodeWorldPos({ x: fx, y: fy }, world.heightMap[a] ?? 0);
    const to = nodeWorldPos(np, world.heightMap[geom.index(np.x, np.y)] ?? 0);
    out.push({ x0: from.x, y0: from.y, x1: to.x, y1: to.y });
  }
  return out;
}

/**
 * A small "X" of segments centred on a node's ground anchor, used to mark the
 * hovered road-build destination (drawn via the road renderer with a colour).
 */
export function nodeMarkerSegments(world: World, node: number, size = 7): RoadSegment[] {
  const a = nodeAnchor(world, node);
  return [
    { x0: a.x - size, y0: a.y - size, x1: a.x + size, y1: a.y + size },
    { x0: a.x - size, y0: a.y + size, x1: a.x + size, y1: a.y - size },
  ];
}

/**
 * Small player-coloured posts marking a territory's border ring. The original
 * dots the frontier with little stones in the owner's colour; the exact nation
 * sprite index was not confidently isolated from the converted archive, so these
 * are drawn as compact flat markers (an upright post + base) via the flat-quad
 * overlay in the player colour — a clean-room-safe stand-in. Fog-aware: a border
 * node that is not currently visible is skipped.
 */
export function borderStoneSegments(
  world: World,
  nodes: readonly number[],
  visibility: Uint8Array | null = null,
): RoadSegment[] {
  const out: RoadSegment[] = [];
  for (const node of nodes) {
    if (visibility !== null && visibility[node] !== 2) continue;
    const a = nodeAnchor(world, node);
    // A short vertical post with a small base cross-bar reads as a border stone.
    out.push({ x0: a.x, y0: a.y - 6, x1: a.x, y1: a.y + 1 });
    out.push({ x0: a.x - 3, y0: a.y, x1: a.x + 3, y1: a.y });
  }
  return out;
}

/**
 * Compact garrison markers: a row of small dots above each occupied military
 * building of `player`, one per garrisoned soldier (the original shows little
 * figures at the building). Fog-aware for enemy buildings; own land is always
 * visible. Returned as flat-quad segments to draw in the player colour.
 */
export function garrisonDotSegments(
  world: World,
  player: number,
  visibility: Uint8Array | null = null,
): RoadSegment[] {
  const out: RoadSegment[] = [];
  for (const b of world.buildings.items) {
    if (!b || b.player !== player || !b.occupied) continue;
    const def = buildingDef(b.type);
    if (!def || def.kind !== 'military') continue;
    if (visibility !== null && visibility[b.node] !== 2) continue;
    let troops = 0;
    for (const c of b.garrison) troops += c;
    if (troops <= 0) continue;
    const a = nodeAnchor(world, b.node);
    for (let i = 0; i < troops; i++) {
      const cx = a.x - (troops - 1) * 3 + i * 6;
      const cy = a.y - 40;
      // A tiny 2px cross per soldier.
      out.push({ x0: cx - 2, y0: cy, x1: cx + 2, y1: cy });
      out.push({ x0: cx, y0: cy - 2, x1: cx, y1: cy + 2 });
    }
  }
  return out;
}

/** Resolve the carrier overlay sprite key for a ware type + BOB direction. */
function wareOverlay(carrier: BobAtlas, ware: WareType, dir: number, step = 0): number {
  const job = WARE_JOB[ware];
  const native = carrier.links[job]?.[step]?.[0]?.[dir];
  if (native === undefined) return -1;
  return carrier.overlayBase + native;
}

/**
 * Nearest lattice node to a wrapped world-pixel point (elevation-aware). Used
 * for click picking. Scans all nodes — cheap for P2 map sizes.
 */
export function nodeAtWorld(
  world: World,
  worldX: number,
  worldY: number,
  worldW: number,
  worldH: number,
): number {
  let best = -1;
  let bestD = Infinity;
  const size = world.width * world.height;
  for (let node = 0; node < size; node++) {
    const a = nodeAnchor(world, node);
    let dx = a.x - worldX;
    dx -= Math.round(dx / worldW) * worldW;
    let dy = a.y - worldY;
    dy -= Math.round(dy / worldH) * worldH;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = node;
    }
  }
  return best;
}

/** Convenience: is a building the player-owned headquarters? */
export function isHeadquarters(b: Building): boolean {
  return b.type === 'headquarters';
}
