/**
 * Scenario harness: a scripted P2 economy on a real map, shared by the
 * determinism test, the scenario test, and the scripts/simulate.ts CLI.
 *
 * It places a woodcutter (near trees), a sawmill (near the HQ), and a quarry
 * (near granite), wiring each to the HQ flag with a road, then lets the caller
 * drive ticks. All choices are deterministic (fixed scan order), so the same map
 * and seed always produce the same command script.
 */

import { applyCommand, canPlaceBuilding } from './commands';
import { BUILDING, isGraniteType, isTreeType, RADIUS, type BuildingType } from './constants';
import { Geometry } from './geometry';
import { findWalkPath } from './pathfinding';
import { GREENLAND_RULES } from './terrain';
import { createWorld, type MapJson, type World } from './world';
import { tickWorld } from './index';

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Encode bytes to base64 (portable; mirrors the decoder in world.ts). */
export function encodeBase64(bytes: number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] & 0xff;
    const b1 = i + 1 < bytes.length ? bytes[i + 1] & 0xff : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] & 0xff : 0;
    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64_ALPHABET[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? B64_ALPHABET[b2 & 63] : '=';
  }
  return out;
}

/**
 * Build a synthetic flat all-meadow map for unit tests: buildable everywhere, no
 * objects, one HQ. Terrain id 0x08 (meadow) fills texture1/texture2.
 */
export function makeFlatMap(
  width: number,
  height: number,
  hqX = 1,
  hqY = 1,
  extraHqs: Array<{ x: number; y: number }> = [],
): MapJson {
  const size = width * height;
  const meadow = new Array<number>(size).fill(0x08);
  const zero = new Array<number>(size).fill(0);
  const layers: Record<string, string> = {
    texture1: encodeBase64(meadow),
    texture2: encodeBase64(meadow),
    height: encodeBase64(zero),
    object_type: encodeBase64(zero),
    object_index: encodeBase64(zero),
    resources: encodeBase64(zero),
    owner: encodeBase64(zero),
  };
  // Player 0's HQ plus any additional players' HQs (index 1..), so a 2-player
  // fixture gives each player real territory to place flags/roads/buildings in.
  const hqXs = [hqX, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff];
  const hqYs = [hqY, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff];
  extraHqs.forEach((h, i) => {
    hqXs[i + 1] = h.x;
    hqYs[i + 1] = h.y;
  });
  return {
    title: 'flat',
    width,
    height,
    terrain: 0,
    players: 1,
    hq_x: hqXs,
    hq_y: hqYs,
    encoding: 'base64',
    layers,
  };
}

/**
 * Two-island fixture for the P7 seafaring suite: a single connected body of
 * navigable water (terrain id 0x05) with two rectangular meadow islands, so a
 * ship can sail all the way around either island and between them. Harbors sit on
 * the WEST coast of each island (water to the west, land to the SE) so the door
 * flag — always the SE neighbour — lands on buildable ground.
 *
 * Layout (24x14): island A cols 4..8, island B cols 15..19, both rows 4..9;
 * everything else water. HQ on island A at (6,6). Coordinates the tests use are
 * exported as {@link TWO_ISLAND}.
 */
export const TWO_ISLAND = {
  width: 24,
  height: 14,
  hq: { x: 6, y: 6 },
  /** West-coast harbor spot on island A (water at (3,6), land SE door (4,7)). */
  harborA: { x: 4, y: 6 },
  /** West-coast harbor spot on island B (water at (14,6), land SE door (15,7)). */
  harborB: { x: 15, y: 6 },
  /** A second island-A coastal building spot for the shipyard. */
  shipyardA: { x: 4, y: 8 },
  /** An island-B land node for a road-connected consumer/storehouse. */
  consumerB: { x: 17, y: 6 },
} as const;

/** Build the {@link TWO_ISLAND} map (all water, two meadow islands, one HQ). */
export function makeTwoIslandMap(): MapJson {
  const { width, height } = TWO_ISLAND;
  const size = width * height;
  const WATER = 0x05;
  const MEADOW = 0x08;
  const t1 = new Array<number>(size).fill(WATER);
  const t2 = new Array<number>(size).fill(WATER);
  const zero = new Array<number>(size).fill(0);
  const setLand = (x0: number, x1: number, y0: number, y1: number): void => {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * width + x;
        t1[i] = MEADOW;
        t2[i] = MEADOW;
      }
    }
  };
  setLand(4, 8, 4, 9); // island A
  setLand(15, 19, 4, 9); // island B
  const layers: Record<string, string> = {
    texture1: encodeBase64(t1),
    texture2: encodeBase64(t2),
    height: encodeBase64(zero),
    object_type: encodeBase64(zero),
    object_index: encodeBase64(zero),
    resources: encodeBase64(zero),
    owner: encodeBase64(zero),
  };
  return {
    title: 'two-island',
    width,
    height,
    terrain: 0,
    players: 1,
    hq_x: [TWO_ISLAND.hq.x, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff],
    hq_y: [TWO_ISLAND.hq.y, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff],
    encoding: 'base64',
    layers,
  };
}

/** Nodes chosen for the demo buildings. */
export interface DemoLayout {
  hqNode: number;
  woodcutter: number;
  sawmill: number;
  quarry: number;
}

/** First node matching `pred` within `maxDist` of `from`, reachable on foot. */
function findBuildSpot(
  world: World,
  geom: Geometry,
  from: number,
  avoid: number[],
  pred: (node: number) => boolean,
): number {
  const size = geom.size;
  const ranked: number[] = [];
  for (let n = 0; n < size; n++) {
    if (!pred(n)) continue;
    if (avoid.some((a) => geom.distance(a, n) < 4)) continue;
    if (!canPlaceBuilding(world, geom, GREENLAND_RULES, n, BUILDING.woodcutter)) continue;
    ranked.push(n);
  }
  ranked.sort((a, b) => geom.distance(from, a) - geom.distance(from, b) || a - b);
  for (const n of ranked) {
    const flagNode = geom.neighbour(n, 'SE');
    if (findWalkPath(world, geom, GREENLAND_RULES, geom.neighbour(from, 'SE'), flagNode)) return n;
  }
  return -1;
}

/** Collect nodes whose object matches a predicate. */
function objectsMatching(world: World, pred: (n: number) => boolean): number[] {
  const out: number[] = [];
  for (let n = 0; n < world.objectType.length; n++) if (pred(n)) out.push(n);
  return out;
}

/** Choose demo building nodes deterministically. */
export function planDemo(world: World): DemoLayout {
  const geom = new Geometry(world.width, world.height);
  const hqNode = world.buildings.items[world.players[0].hqBuildingId]!.node;
  const trees = objectsMatching(world, (n) => isTreeType(world.objectType[n]));
  const granites = objectsMatching(world, (n) => isGraniteType(world.objectType[n]));

  const woodcutter = findBuildSpot(world, geom, hqNode, [hqNode], (n) =>
    trees.some((t) => geom.distance(n, t) <= RADIUS.woodcutter - 1),
  );
  const sawmill = findBuildSpot(world, geom, hqNode, [hqNode, woodcutter], () => true);
  const quarry = findBuildSpot(world, geom, hqNode, [hqNode, woodcutter, sawmill], (n) =>
    granites.some((g) => geom.distance(n, g) <= RADIUS.quarry - 1),
  );
  return { hqNode, woodcutter, sawmill, quarry };
}

function place(world: World, node: number, type: BuildingType, tick: number): void {
  if (node < 0) return;
  applyCommand(world, { tick, player: 0, type: 'placeBuilding', node, buildingType: type });
}

function connect(world: World, geom: Geometry, fromFlagNode: number, buildingNode: number, tick: number): void {
  if (buildingNode < 0) return;
  const toFlagNode = geom.neighbour(buildingNode, 'SE');
  const walk = findWalkPath(world, geom, GREENLAND_RULES, fromFlagNode, toFlagNode);
  if (!walk) return;
  applyCommand(world, { tick, player: 0, type: 'buildRoad', path: [fromFlagNode, ...walk] });
}

/**
 * Build a fully wired demo world: create it, place the three buildings, tick
 * once so their flags exist, connect roads, tick once so roads exist. Returns
 * the world (at tick 2) plus the chosen layout.
 */
export function setupDemoWorld(map: MapJson, seed: number): { world: World; layout: DemoLayout } {
  const world = createWorld(map, { seed, players: 1 });
  const geom = new Geometry(world.width, world.height);
  const layout = planDemo(world);

  place(world, layout.woodcutter, BUILDING.woodcutter, 0);
  place(world, layout.sawmill, BUILDING.sawmill, 0);
  place(world, layout.quarry, BUILDING.quarry, 0);
  tickWorld(world); // execute placements -> building flags exist

  const hqFlagNode = geom.neighbour(layout.hqNode, 'SE');
  connect(world, geom, hqFlagNode, layout.woodcutter, world.tick);
  connect(world, geom, hqFlagNode, layout.sawmill, world.tick);
  connect(world, geom, hqFlagNode, layout.quarry, world.tick);
  tickWorld(world); // execute roads

  return { world, layout };
}

/** A compact one-line summary of world state for manual inspection. */
export function worldSummary(world: World): string {
  let sites = 0;
  let working = 0;
  for (const b of world.buildings.items) {
    if (!b) continue;
    if (b.state === 'site') sites++;
    else working++;
  }
  const jobs: Record<string, number> = {};
  let waresInTransit = 0;
  for (const s of world.settlers.items) {
    if (!s) continue;
    jobs[s.job] = (jobs[s.job] ?? 0) + 1;
  }
  for (const w of world.wares.items) {
    if (w && (w.loc === 'flag' || w.loc === 'carried')) waresInTransit++;
  }
  const inv = world.players[0]?.wares ?? { trunk: 0, plank: 0, stone: 0 };
  const jobStr = Object.entries(jobs)
    .map(([j, n]) => `${j}:${n}`)
    .join(' ');
  return (
    `t=${String(world.tick).padStart(4, ' ')} ` +
    `bldg(work/site)=${working}/${sites} ` +
    `settlers[${jobStr}] ` +
    `transit=${waresInTransit} ` +
    `HQ{trunk:${inv.trunk},plank:${inv.plank},stone:${inv.stone}}`
  );
}
