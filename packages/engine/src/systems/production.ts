/**
 * Production system (tick phase 3 + the producers' settler steps).
 *
 * Handles worker recruitment for completed buildings, the field-worker state
 * machines (woodcutter felling trees, forester planting, stonemason chipping
 * granite), the sawmill's trunk-to-plank conversion, sapling growth, and pushing
 * finished wares onto each building's flag.
 */

import {
  BUILDING,
  BUILDING_OUTPUT,
  BUILDING_WORKER,
  graniteStock,
  isGraniteType,
  isTreeType,
  OBJ_INDEX_MATURE,
  OBJ_INDEX_SAPLING,
  OBJ_TYPE,
  OBJ_TYPE_SAPLING,
  RADIUS,
  SAWMILL_PLANKS_PER_TRUNK,
  TICKS,
  type WareType,
} from '../constants';
import type { EventSink } from '../events';
import type { Geometry } from '../geometry';
import { findWalkPath } from '../pathfinding';
import { isBuildableTexture, isWalkableTexture, type TerrainRules } from '../terrain';
import {
  getBuilding,
  getFlag,
  storeAlloc,
  storeLive,
  type Building,
  type Settler,
  type World,
} from '../world';
import { beginWalk, spawnSettler, stepWalk, walkDone } from './movement';

/** Mature any saplings whose growth timer has elapsed. */
function runGrowth(world: World): void {
  if (world.saplings.length === 0) return;
  const remaining: Array<{ node: number; matureTick: number }> = [];
  for (const s of world.saplings) {
    if (world.tick >= s.matureTick && world.objectType[s.node] === OBJ_TYPE_SAPLING) {
      world.objectType[s.node] = OBJ_TYPE.treeMin;
      world.objectIndex[s.node] = OBJ_INDEX_MATURE;
    } else if (world.objectType[s.node] === OBJ_TYPE_SAPLING) {
      remaining.push(s);
    }
  }
  world.saplings = remaining;
}

/** Nearest node (by distance then id) matching `pred` and reachable on foot. */
function nearestReachable(
  world: World,
  geom: Geometry,
  rules: TerrainRules,
  fromNode: number,
  radius: number,
  pred: (node: number) => boolean,
): { node: number; path: number[] } | null {
  const candidates: number[] = [];
  for (let node = 0; node < geom.size; node++) {
    if (!pred(node)) continue;
    if (geom.distance(fromNode, node) > radius) continue;
    candidates.push(node);
  }
  candidates.sort((a, b) => geom.distance(fromNode, a) - geom.distance(fromNode, b) || a - b);
  for (const node of candidates) {
    const path = findWalkPath(world, geom, rules, fromNode, node);
    if (path) return { node, path };
  }
  return null;
}

/** Push finished wares onto the building's flag while slots remain. */
function placeOutput(world: World, events: EventSink, b: Building): void {
  const outType = BUILDING_OUTPUT[b.type];
  if (!outType) return;
  const flag = getFlag(world, b.flagId);
  while (b.outputPending > 0 && flag.wares.length < 8) {
    const wid = storeAlloc(world.wares, (id) => ({
      id,
      type: outType as WareType,
      loc: 'flag' as const,
      locId: flag.id,
      targetBuildingId: -1,
      nextFlag: -1,
    }));
    flag.wares.push(wid);
    b.outputPending--;
    events.emit({ type: 'WareProduced', wareId: wid, wareType: outType, buildingId: b.id, player: b.player });
  }
}

/** Recruit + walk in a worker; returns true once the building is staffed. */
function ensureStaffed(
  world: World,
  geom: Geometry,
  rules: TerrainRules,
  events: EventSink,
  b: Building,
): boolean {
  if (b.staffed) return true;
  const job = BUILDING_WORKER[b.type];
  if (!job) return false;
  const player = world.players[b.player];
  if (!player) return false;

  if (b.workerId < 0) {
    if (player.workers[job] <= 0) return false;
    const hq = player.hqBuildingId >= 0 ? getBuilding(world, player.hqBuildingId) : null;
    const startNode = hq ? hq.node : b.node;
    const worker = spawnSettler(world, job, b.player, startNode);
    worker.homeBuildingId = b.id;
    worker.state = 'toBuilding';
    worker.targetNode = b.node;
    const path = findWalkPath(world, geom, rules, startNode, b.node);
    if (path) beginWalk(worker, path, TICKS.walkPerEdge);
    else worker.node = b.node;
    b.workerId = worker.id;
    player.workers[job]--;
    events.emit({ type: 'SettlerSpawned', settlerId: worker.id, job, player: b.player });
    return false;
  }

  const worker = world.settlers.items[b.workerId];
  if (!worker) {
    b.workerId = -1;
    return false;
  }
  if (worker.state === 'toBuilding') {
    const arrived = walkDone(worker) ? true : stepWalk(worker);
    if (arrived && worker.node === b.node) {
      worker.state = 'idle';
      b.staffed = true;
    }
  }
  return b.staffed;
}

/** Field-worker loop shared by woodcutter and stonemason. */
function runHarvester(
  world: World,
  geom: Geometry,
  rules: TerrainRules,
  b: Building,
  worker: Settler,
  find: () => { node: number; path: number[] } | null,
  workTicks: number,
  harvest: (node: number) => boolean,
): void {
  switch (worker.state) {
    case 'idle': {
      const target = find();
      if (!target) return;
      worker.state = 'toWork';
      worker.targetNode = target.node;
      beginWalk(worker, target.path, TICKS.walkPerEdge);
      break;
    }
    case 'toWork': {
      const arrived = walkDone(worker) ? true : stepWalk(worker);
      if (arrived) {
        worker.state = 'working';
        worker.timer = workTicks;
      }
      break;
    }
    case 'working': {
      if (worker.timer > 0) worker.timer--;
      if (worker.timer <= 0) {
        harvest(worker.targetNode);
        const back = findWalkPath(world, geom, rules, worker.node, b.node);
        worker.state = 'home';
        beginWalk(worker, back ?? [], TICKS.walkPerEdge);
      }
      break;
    }
    case 'home': {
      const arrived = walkDone(worker) ? true : stepWalk(worker);
      if (arrived) worker.state = 'idle';
      break;
    }
    default:
      worker.state = 'idle';
  }
}

/** Run production for one tick. */
export function runProduction(
  world: World,
  geom: Geometry,
  rules: TerrainRules,
  events: EventSink,
): void {
  runGrowth(world);

  for (const b of storeLive(world.buildings)) {
    if (b.state !== 'working' || b.type === BUILDING.headquarters) continue;
    if (!ensureStaffed(world, geom, rules, events, b)) continue;
    const worker = b.workerId >= 0 ? world.settlers.items[b.workerId] : null;

    switch (b.type) {
      case BUILDING.woodcutter:
        if (worker) {
          runHarvester(
            world,
            geom,
            rules,
            b,
            worker,
            () =>
              nearestReachable(world, geom, rules, b.node, RADIUS.woodcutter, (n) =>
                isTreeType(world.objectType[n]),
              ),
            TICKS.woodcutterChop,
            (node) => {
              if (!isTreeType(world.objectType[node])) return false;
              world.objectType[node] = OBJ_TYPE.none;
              world.objectIndex[node] = 0;
              b.outputPending++;
              events.emit({ type: 'TreeFelled', node, player: b.player });
              return true;
            },
          );
        }
        break;

      case BUILDING.quarry:
        if (worker) {
          runHarvester(
            world,
            geom,
            rules,
            b,
            worker,
            () =>
              nearestReachable(world, geom, rules, b.node, RADIUS.quarry, (n) =>
                isGraniteType(world.objectType[n]) && graniteStock(world.objectIndex[n]) > 0,
              ),
            TICKS.quarryWork,
            (node) => {
              if (!isGraniteType(world.objectType[node])) return false;
              world.objectIndex[node] = Math.max(0, world.objectIndex[node] - 1);
              if (graniteStock(world.objectIndex[node]) <= 0) {
                world.objectType[node] = OBJ_TYPE.none;
                world.objectIndex[node] = 0;
              }
              b.outputPending++;
              events.emit({ type: 'StoneMined', node, player: b.player });
              return true;
            },
          );
        }
        break;

      case BUILDING.forester:
        if (worker) {
          runHarvester(
            world,
            geom,
            rules,
            b,
            worker,
            () =>
              nearestReachable(world, geom, rules, b.node, RADIUS.forester, (n) =>
                plantable(world, rules, n),
              ),
            TICKS.foresterPlant,
            (node) => {
              if (!plantable(world, rules, node)) return false;
              world.objectType[node] = OBJ_TYPE_SAPLING;
              world.objectIndex[node] = OBJ_INDEX_SAPLING;
              world.saplings.push({ node, matureTick: world.tick + TICKS.treeGrow });
              events.emit({ type: 'TreePlanted', node, player: b.player });
              return true;
            },
          );
        }
        break;

      case BUILDING.sawmill:
        runSawmill(b);
        break;
    }

    placeOutput(world, events, b);
  }
}

/** True when a forester may plant a sapling at `node`. */
function plantable(world: World, rules: TerrainRules, node: number): boolean {
  if (world.objectType[node] !== OBJ_TYPE.none) return false;
  if (world.flagAtNode[node] >= 0 || world.buildingAtNode[node] >= 0) return false;
  return (
    isBuildableTexture(world.terrain1[node], rules) &&
    isWalkableTexture(world.terrain1[node], rules) &&
    isWalkableTexture(world.terrain2[node], rules)
  );
}

/** Advance a sawmill's trunk-to-plank conversion by one tick. */
function runSawmill(b: Building): void {
  if (b.workTimer > 0) {
    b.workTimer--;
    if (b.workTimer === 0) b.outputPending += SAWMILL_PLANKS_PER_TRUNK;
    return;
  }
  if (b.inputStock > 0) {
    b.inputStock--;
    b.workTimer = TICKS.sawmillWork;
  }
}
