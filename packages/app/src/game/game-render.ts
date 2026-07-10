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
  isWaterNode,
  resourceAmount,
  resourceType,
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
 * Settler *work*-animation archive (converted DATA/CBOB/ROM_BOBS.LST — the file
 * RttR loads as "rom_bobs" for job actions, distinct from the MBOB building
 * graphics that keep the bare `rom_bobs` name). These are self-contained,
 * single-direction, player-coloured action figures (axe swing, rod cast, scythe,
 * planting) with their tool + head baked into one sprite, drawn with the sprite's
 * native anchor so the figure works *beside* the object rather than centred on it.
 */
export const WORK_ARCHIVE = 'cbob_rom_bobs';

/**
 * Per-job work-animation frame ranges within {@link WORK_ARCHIVE}, as
 * `{ start, frames }` (an inclusive run `start .. start+frames-1`). Each is a
 * single-direction, in-place action loop the figure plays while at its outdoor
 * work spot (engine settler `state === 'working'`).
 *
 * Verified empirically by decoding the converted atlas and compositing
 * anchor-aligned filmstrips (the S2 job outfits confirm each block): woodcutter
 * red cap swinging an axe (16..31), forester green cap kneeling to plant saplings
 * (48..83), fisher casting a rod over the water (108..131), farmer wide-brim hat
 * swinging a scythe (132..159). Jobs absent here keep the walk-cycle fallback.
 */
export const WORK_ANIM: Partial<Readonly<Record<JobType, { start: number; frames: number }>>> = {
  woodcutter: { start: 16, frames: 16 },
  forester: { start: 48, frames: 36 },
  fisher: { start: 108, frames: 24 },
  farmer: { start: 132, frames: 28 },
};

/**
 * {@link WORK_ARCHIVE} sprite index for a job's work animation at animation
 * `frame`, or null when the job has no action frames (caller falls back to the
 * walk cycle). `frame` is taken modulo the loop length, so any monotonically
 * increasing render-clock counter animates it.
 */
export function workSprite(job: JobType, frame: number): number | null {
  const a = WORK_ANIM[job];
  if (!a) return null;
  return a.start + (((frame % a.frames) + a.frames) % a.frames);
}

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
 * (clothing + head + tool) layered over the generic *headless* walking body.
 * FACTS from RttR `gameData/JobConsts.cpp` JOB_SPRITE_CONSTS `jobBobId`.
 *
 * The seven outdoor economy jobs were verified visually against the converted
 * jobs.bob (rendered body+overlay per job): woodcutter 5 (red cap + axe),
 * sawmiller 6 (saw), stonemason 7 (purple cap + pickaxe), forester 8 (green cap
 * + shovel), farmer 9 (scythe), fisher 12 (rod), builder 23 (hammer). The
 * remaining civilian ids are the RttR JOB_SPRITE_CONSTS constants; each is
 * bounds-checked (< jobs.bob's 93 job entries) and every entry renders a head,
 * so no civilian ever draws headless. The generic Helper overlay (0) — used for
 * empty-handed carriers, the wellman and any unmapped civilian — lives in
 * {@link HELPER_BOB_ID}; the carrier job itself uses the carrier BOB when it is
 * actually carrying a ware, so it is intentionally absent here.
 */
export const JOB_BOB_ID: Partial<Readonly<Record<JobType, number>>> = {
  builder: 23,
  woodcutter: 5,
  forester: 8,
  sawmiller: 6,
  stonemason: 7,
  fisher: 12,
  hunter: 13,
  farmer: 9,
  miller: 10,
  baker: 11,
  butcher: 14,
  miner: 3,
  brewer: 18,
  pigbreeder: 16,
  donkeybreeder: 15,
  ironfounder: 20,
  minter: 21,
  metalworker: 22,
  armorer: 19,
  wellman: 0,
  scout: 35,
  shipwright: 24,
  geologist: 4,
};

/**
 * JOBS.BOB job id of the generic Helper figure (plain clothes + head, no tool).
 * The BOB body sprites are headless torsos — the head only ever ships in an
 * overlay — and the carrier BOB has no bare-head overlay (all 34 of its job
 * overlays carry a good). So an empty-handed carrier borrows the Helper overlay
 * from jobs.bob to get its head back, exactly as the original composes it.
 */
export const HELPER_BOB_ID = 0;

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
  /**
   * Whether the {@link WORK_ARCHIVE} work-animation atlas is registered. When
   * false, working figures fall back to the walk-cycle-in-place placeholder.
   */
  readonly workAvailable: boolean;
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

/**
 * True when a civilian worker is currently *inside* its workplace and so should
 * not be drawn: the engine leaves an idle harvester/workshop worker parked on
 * its building's node, which would otherwise render a figure on the building.
 * A worker walking in/out (toBuilding/toWork/working/home) has a different state
 * and stays visible.
 */
export function workerIsIndoors(world: World, s: Settler): boolean {
  if (s.rank >= 0 || s.state !== 'idle' || s.homeBuildingId < 0) return false;
  const home = world.buildings.items[s.homeBuildingId];
  return !!home && home.node === s.node;
}

/**
 * Push one jobs.bob figure (headless body + profession/head overlay) into the
 * scene. The overlay carries the head, so every jobs.bob figure has one; when a
 * cell has no overlay the head would be missing, but jobs.bob links resolve for
 * every animation cell, so this only ever happens for an out-of-range job id.
 */
function pushJobFigure(
  out: DynamicSprite[],
  jobs: BobAtlas,
  jobBob: number,
  dir: number,
  step: number,
  x: number,
  y: number,
  player: number,
): void {
  const body = jobs.bodyTable[0]?.[dir]?.[step];
  if (body === undefined) return;
  out.push({ worldX: x, worldY: y, archive: jobs.archive, spriteIndex: body, player });
  const link = jobs.links[jobBob]?.[step]?.[0]?.[dir];
  if (link !== undefined) {
    out.push({
      worldX: x,
      worldY: y + 0.01, // head/tool overlay just in front of the body
      archive: jobs.archive,
      spriteIndex: jobs.overlayBase + link,
    });
  }
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
  const { carrier, jobs, objectArchive, workAvailable } = atlases;
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

  // Settlers. Workers walking to/from their site render the generic *headless*
  // body plus their JOBS.BOB profession overlay (which carries the head + tool);
  // carriers keep the carrier body and draw the ware they carry (its overlay
  // also carries the head). An empty-handed carrier borrows the Helper overlay
  // so it is not a headless torso.
  for (const s of world.settlers.items) {
    if (!s) continue;
    if (hidden(s.node)) continue;
    // A civilian resting inside its workplace is not shown: the engine parks an
    // idle harvester/workshop worker on its building node, and drawing it would
    // stick a figure on the building's wall/roof. Outdoor states
    // (toBuilding/toWork/working/home) still render at ground level.
    if (workerIsIndoors(world, s)) continue;

    const pos = settlerAnchor(world, geom, s, anim.alpha);
    const dir = bobDir(pos.dir);
    // Animate the walk cycle while travelling and while working: a stationary
    // worker at its work spot cycles the same 8 overlay steps on the render
    // clock so the tool bobs (chopping/fishing/sowing read as active). Idle
    // figures hold step 0. Never keyed off sim state beyond reading `state`.
    const animating = pos.moving || s.state === 'working';
    const step = animating ? (anim.walkFrame + s.id) % BOB_WALK_FRAMES : 0;
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

    // Real work animation at the outdoor work spot: a stationary worker running
    // its action timer (state 'working') plays the authentic single-direction
    // CBOB loop (axe swing / rod cast / scythe / planting) drawn with the
    // sprite's native anchor, so it works *beside* the tree/field instead of the
    // walk-cycle-in-place placeholder standing on top of it. Player-coloured like
    // the other dynamics via the sprite's pmask. Offsetting by settler id keeps a
    // crew from swinging in lockstep. Jobs without action frames, and workers
    // walking to/from the spot, fall through to the walk cycle below.
    if (workAvailable && s.state === 'working') {
      const wi = workSprite(s.job, anim.walkFrame + s.id);
      if (wi !== null) {
        out.push({
          worldX: pos.x,
          worldY: pos.y,
          archive: WORK_ARCHIVE,
          spriteIndex: wi,
          player: s.player,
        });
        continue;
      }
    }

    // Mapped civilian profession: jobs.bob body + profession overlay (head+tool).
    if (jobs && jobBob !== undefined) {
      pushJobFigure(out, jobs, jobBob, dir, step, pos.x, pos.y, s.player);
      continue;
    }

    // Carrier hauling a ware: carrier body + the ware overlay (which has a head).
    if (s.carryingWareId >= 0) {
      const bodyKey = carrier.bodyTable[0]?.[dir]?.[step];
      if (bodyKey === undefined) continue;
      out.push({
        worldX: pos.x,
        worldY: pos.y,
        archive: BOB_ARCHIVE,
        spriteIndex: bodyKey,
        player: s.player,
      });
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
      continue;
    }

    // Empty-handed civilian (idle/travelling carrier, wellman, any unmapped
    // job): draw the Helper figure so it keeps its head. Soldiers have no jobs
    // overlay yet, so they fall back to the bare carrier body (unchanged).
    if (jobs && s.rank < 0) {
      pushJobFigure(out, jobs, HELPER_BOB_ID, dir, step, pos.x, pos.y, s.player);
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
 * mapbobs frontier "boundary stone" bob (a stone tablet on a wooden post with a
 * player-colour gem) + its ground shadow, per landscape object archive. The S2
 * boundary stone is a single player-recoloured image; the `player`-kind bobs sit
 * at consecutive entries — colour groups (red/yellow/black/white) plus the blue
 * default-ramp master and a gem-free neutral stone — in greenland's mapbobs
 * around 600..615 and, offset by +80, in the wasteland/winter atlases
 * (mapbobs0/mapbobs1). The canonical stone whose gem is stored in the default
 * (blue) player ramp is 612 (shadow 619) for greenland and 692 (shadow 699) for
 * wasteland/winter; that is the one the original retints per player, so it is the
 * one we draw.
 *
 * These converted mapbobs sprites carry no per-sprite `pmask` flag (unlike the
 * rom_z flag bobs, which do), so the renderer's player-tint path is inert for
 * them and the gem renders in its baked default-blue for every player. We still
 * pass the owner's `player` on the sprite: it is a harmless no-op today and lights
 * up the correct per-player gem automatically if these archives are ever
 * reconverted with the pmask flag the flag sprites already ship.
 */
const BORDER_STONE_SPRITE: Readonly<Record<string, { sprite: number; shadow: number }>> = {
  mapbobs: { sprite: 612, shadow: 619 }, // greenland
  mapbobs0: { sprite: 692, shadow: 699 }, // wasteland
  mapbobs1: { sprite: 692, shadow: 699 }, // winter
};

/**
 * Border-stone sprites for a territory's frontier ring: the real mapbobs boundary
 * stone at each border node, carrying the owner's `player` (see
 * {@link BORDER_STONE_SPRITE}). Fog-aware: a frontier node that is not currently
 * visible is skipped. Open-water nodes are skipped too — the original runs a
 * coastal border along the land nodes rather than dotting the sea, so a frontier
 * that clips a water tile leaves it bare instead of floating a stone on the waves.
 */
export function borderStoneSprites(
  world: World,
  nodes: readonly number[],
  player: number,
  objectArchive: string,
  visibility: Uint8Array | null = null,
): DynamicSprite[] {
  const idx = BORDER_STONE_SPRITE[objectArchive] ?? BORDER_STONE_SPRITE.mapbobs;
  const out: DynamicSprite[] = [];
  for (const node of nodes) {
    if (visibility !== null && visibility[node] !== 2) continue;
    if (isWaterNode(world, node)) continue;
    const a = nodeAnchor(world, node);
    out.push({
      worldX: a.x,
      worldY: a.y,
      archive: objectArchive,
      spriteIndex: idx.sprite,
      shadowIndex: idx.shadow,
      player,
    });
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

/**
 * Attention markers for `player`'s road-disconnected structures: an exclamation
 * mark above each building whose flag has no road path back to a warehouse, plus
 * a small diamond on every disconnected *flag* that is not a building's own flag.
 * The flag markers matter because the gap is often not at the building itself but
 * at a loose end of its road chain (e.g. a road that dead-ends two tiles short of
 * the network) — highlighting those loose ends shows where a connecting road
 * needs to go. Own land is always visible, so no fog check is needed; warehouses
 * (the supply sources) are never marked.
 */
export function disconnectedBuildingMarkers(world: World, player: number): RoadSegment[] {
  const isWarehouse = (b: Building): boolean => {
    const def = buildingDef(b.type);
    return !!def && (def.kind === 'hq' || def.kind === 'warehouse');
  };
  // Supply sources: the player's working warehouse flags. None => nothing to
  // connect to yet (e.g. HQ destroyed), so mark nothing.
  const sources: number[] = [];
  for (const b of world.buildings.items) {
    if (b && b.player === player && b.state === 'working' && isWarehouse(b)) sources.push(b.flagId);
  }
  if (sources.length === 0) return [];
  // Flag adjacency over the player's roads, then flood-fill from every source.
  const adj = new Map<number, number[]>();
  const link = (a: number, b: number): void => {
    const l = adj.get(a);
    if (l) l.push(b);
    else adj.set(a, [b]);
  };
  for (const r of world.roads.items) {
    if (!r || r.player !== player) continue;
    link(r.flagA, r.flagB);
    link(r.flagB, r.flagA);
  }
  const reached = new Set<number>(sources);
  const stack = [...sources];
  while (stack.length > 0) {
    const f = stack.pop() as number;
    for (const n of adj.get(f) ?? []) {
      if (!reached.has(n)) {
        reached.add(n);
        stack.push(n);
      }
    }
  }
  const out: RoadSegment[] = [];
  const buildingFlags = new Set<number>();
  for (const b of world.buildings.items) {
    if (!b || b.player !== player) continue;
    buildingFlags.add(b.flagId);
    if (isWarehouse(b) || reached.has(b.flagId)) continue;
    // A bright exclamation mark floating above the building: a vertical stem and
    // a dot below it (a tiny cross so a zero-length segment still renders).
    const a = nodeAnchor(world, b.node);
    const top = a.y - 56;
    out.push({ x0: a.x, y0: top, x1: a.x, y1: top + 13 }); // stem
    out.push({ x0: a.x - 1, y0: top + 18, x1: a.x + 1, y1: top + 18 }); // dot
    out.push({ x0: a.x, y0: top + 17, x1: a.x, y1: top + 19 }); // dot
  }
  // A small diamond on each disconnected loose-end flag (skip building flags,
  // already flagged by the "!" above their building).
  for (const f of world.flags.items) {
    if (!f || f.player !== player || reached.has(f.id) || buildingFlags.has(f.id)) continue;
    const a = nodeAnchor(world, f.node);
    const s = 4;
    out.push({ x0: a.x, y0: a.y - s, x1: a.x + s, y1: a.y }); // NE edge
    out.push({ x0: a.x + s, y0: a.y, x1: a.x, y1: a.y + s }); // SE edge
    out.push({ x0: a.x, y0: a.y + s, x1: a.x - s, y1: a.y }); // SW edge
    out.push({ x0: a.x - s, y0: a.y, x1: a.x, y1: a.y - s }); // NW edge
  }
  return out;
}

/** Current resource kind at a surveyed node: its ore if any is left, else 0. */
export function currentSignRes(world: World, node: number): number {
  return resourceAmount(world.resource[node]) > 0 ? resourceType(world.resource[node]) : 0;
}

/**
 * Geologist survey-sign markers for one resource kind: a small mark on every
 * surveyed mountain node that holds that resource (`res` is a RESOURCE.* value;
 * 0 = nothing). Ore signs are a filled diamond, "nothing" a small X, both in the
 * caller's colour. Draw one call per resource kind (each has its own colour).
 */
export function signMarkers(world: World, res: number): RoadSegment[] {
  const out: RoadSegment[] = [];
  for (const sign of world.signs) {
    // Read the CURRENT resource, not the survey-time snapshot, so a deposit
    // that has since been mined out shows as nothing (X) rather than its old ore.
    if (currentSignRes(world, sign.node) !== res) continue;
    // Once a building (a mine) sits on the spot, drop its sign — it's served its
    // purpose and would otherwise clutter the building.
    if (world.buildingAtNode[sign.node] >= 0) continue;
    const a = nodeAnchor(world, sign.node);
    const cy = a.y - 6; // float just above the ground node
    const s = 4;
    if (res === 0) {
      // Nothing here: a small X.
      out.push({ x0: a.x - s, y0: cy - s, x1: a.x + s, y1: cy + s });
      out.push({ x0: a.x - s, y0: cy + s, x1: a.x + s, y1: cy - s });
    } else {
      // A filled diamond (drawn as edges + an inner cross to read as solid).
      out.push({ x0: a.x, y0: cy - s, x1: a.x + s, y1: cy });
      out.push({ x0: a.x + s, y0: cy, x1: a.x, y1: cy + s });
      out.push({ x0: a.x, y0: cy + s, x1: a.x - s, y1: cy });
      out.push({ x0: a.x - s, y0: cy, x1: a.x, y1: cy - s });
      out.push({ x0: a.x, y0: cy - s, x1: a.x, y1: cy + s });
      out.push({ x0: a.x - s, y0: cy, x1: a.x + s, y1: cy });
    }
  }
  return out;
}

/**
 * Markers for `player`'s mines that have run dry: a working mine with no more of
 * its resource left within reach can never produce again (the local deposit is
 * exhausted), so flag it — drawn as a small red bar above the building — to hint
 * the player to demolish and rebuild on a fresh deposit.
 */
/**
 * True when the working mine at `node` has exhausted its reachable deposit — no
 * more of its resource (with amount > 0) remains within its radius, so it can
 * never produce again. False for non-mines and construction sites.
 */
export function mineDepletedAt(world: World, geom: Geometry, node: number): boolean {
  const bId = world.buildingAtNode[node];
  const b = bId >= 0 ? world.buildings.items[bId] : null;
  if (!b || b.state !== 'working') return false;
  const def = buildingDef(b.type);
  if (!def || def.kind !== 'mine') return false;
  const W = world.width;
  const H = world.height;
  const r = def.radius ?? 2;
  const mx = b.node % W;
  const my = Math.floor(b.node / W);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const n = ((my + dy + H) % H) * W + ((mx + dx + W) % W);
      if (geom.distance(b.node, n) > r) continue;
      if (resourceType(world.resource[n]) === def.resource && resourceAmount(world.resource[n]) > 0) {
        return false; // ore still reachable
      }
    }
  }
  return true;
}

export function depletedMineMarkers(world: World, geom: Geometry, player: number): RoadSegment[] {
  const out: RoadSegment[] = [];
  for (const b of world.buildings.items) {
    if (!b || b.player !== player || !mineDepletedAt(world, geom, b.node)) continue;
    // Exhausted: a short red bar (with a slash) floating above the mine.
    const a = nodeAnchor(world, b.node);
    const top = a.y - 46;
    out.push({ x0: a.x - 6, y0: top, x1: a.x + 6, y1: top });
    out.push({ x0: a.x - 5, y0: top - 4, x1: a.x + 5, y1: top + 4 });
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
