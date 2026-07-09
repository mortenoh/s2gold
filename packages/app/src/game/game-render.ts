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
 * BOB directions are {W,NW,NE,E,SE,SW} = 0..5, so engine dir E/SE/SW/W/NW/NE
 * (index 0..5) maps to BOB dir (index + 3) % 6.
 */

import {
  DIRECTIONS,
  type Building,
  type BuildingType,
  type Geometry,
  type Settler,
  type WareType,
  type World,
} from '@s2gold/engine';
import { nodeWorldPos, type DynamicSprite, type RoadSegment } from '@s2gold/renderer';
import type { BobAtlas } from './bob-atlas';

/** Archive keys the sprite renderer indexes these layers by. */
export const BUILDING_ARCHIVE = 'rom_z';
export const BOB_ARCHIVE = 'carrier';

/** s25 BuildingType id per engine building name (drives the rom_z sprite index). */
export const BUILDING_TYPE_ID: Readonly<Record<BuildingType, number>> = {
  headquarters: 0,
  woodcutter: 17,
  quarry: 19,
  forester: 20,
  sawmill: 33,
};

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

/** Resolve the {sprite, shadow} rom_z index for a building in a given state. */
export function buildingSprite(type: BuildingType, state: 'site' | 'working'): {
  sprite: number;
  shadow: number;
} {
  const base = 250 + 5 * BUILDING_TYPE_ID[type];
  if (state === 'site' && type !== 'headquarters') {
    return { sprite: base + 2, shadow: base + 3 };
  }
  return { sprite: base, shadow: base + 1 };
}

/** BOB direction index (0..5) for an engine direction index (0..5). */
export function bobDir(engineDirIndex: number): number {
  return (engineDirIndex + 3) % 6;
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

/** Interpolated ground anchor + facing for a settler, `alpha` into the tick. */
function settlerAnchor(
  world: World,
  geom: Geometry,
  s: Settler,
  alpha: number,
): { x: number; y: number; dir: number; moving: boolean } {
  const fx = s.node % world.width;
  const fy = Math.floor(s.node / world.width);
  const from = nodeWorldPos({ x: fx, y: fy }, world.heightMap[s.node] ?? 0);
  if (s.pathIndex < s.path.length) {
    const to = s.path[s.pathIndex];
    const dirIndex = dirIndexBetween(geom, s.node, to);
    if (dirIndex >= 0) {
      const np = unwrappedNeighbour(fx, fy, dirIndex);
      const toElev = world.heightMap[geom.index(np.x, np.y)] ?? 0;
      const toPos = nodeWorldPos(np, toElev);
      const denom = Math.max(1, s.ticksPerEdge);
      const frac = Math.min(1, (s.edgeProgress + alpha) / denom);
      return {
        x: from.x + (toPos.x - from.x) * frac,
        y: from.y + (toPos.y - from.y) * frac,
        dir: dirIndex,
        moving: true,
      };
    }
  }
  return { x: from.x, y: from.y, dir: 1 /* SE, faces the camera */, moving: false };
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
  carrier: BobAtlas,
  anim: SceneAnimation,
): DynamicSprite[] {
  const out: DynamicSprite[] = [];

  // Buildings.
  for (const b of world.buildings.items) {
    if (!b) continue;
    const a = nodeAnchor(world, b.node);
    const { sprite, shadow } = buildingSprite(b.type, b.state);
    out.push({
      worldX: a.x,
      worldY: a.y,
      archive: BUILDING_ARCHIVE,
      spriteIndex: sprite,
      shadowIndex: shadow,
      player: b.player,
    });
  }

  // Flags + wares waiting on them.
  for (const f of world.flags.items) {
    if (!f) continue;
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

  // Settlers (carriers + workers).
  for (const s of world.settlers.items) {
    if (!s) continue;
    const pos = settlerAnchor(world, geom, s, anim.alpha);
    const dir = bobDir(pos.dir);
    const step = pos.moving ? (anim.walkFrame + s.id) % BOB_WALK_FRAMES : 0;
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

  return out;
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
    for (let i = 0; i + 1 < road.path.length; i++) {
      const a = road.path[i];
      const b = road.path[i + 1];
      const fx = a % world.width;
      const fy = Math.floor(a / world.width);
      const dir = dirIndexBetween(geom, a, b);
      if (dir < 0) continue;
      const np = unwrappedNeighbour(fx, fy, dir);
      const from = nodeWorldPos({ x: fx, y: fy }, world.heightMap[a] ?? 0);
      const to = nodeWorldPos(np, world.heightMap[geom.index(np.x, np.y)] ?? 0);
      out.push({ x0: from.x, y0: from.y, x1: to.x, y1: to.y });
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
