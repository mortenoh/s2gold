/**
 * Production system (tick phase 3 + the producers' settler steps).
 *
 * Data-driven from {@link BUILDING_DEFS}: each working building is dispatched by
 * its def `kind` — harvesters (woodcutter/quarry/forester/fishery) send an
 * outdoor worker to a map object/resource node; the farm sows and harvests crop
 * fields; generators (well/hunter) produce on a timer with no input; workshops
 * consume input wares then produce an output; mines consume 1 food and decrement
 * a subsurface resource. Missing workers are recruited from a Helper (+ tool).
 */

import {
  BUILDING,
  buildingDef,
  graniteStock,
  isGraniteType,
  isTreeType,
  OBJ_INDEX_MATURE,
  OBJ_INDEX_SAPLING,
  FLAG_WARE_CAPACITY,
  OBJ_TYPE,
  OBJ_TYPE_CROP,
  OBJ_TYPE_SAPLING,
  RESOURCE,
  resourceAmount,
  resourceType,
  SEA,
  TICKS,
  WARE,
  type BuildingDef,
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
  type Player,
  type Settler,
  type World,
} from '../world';
import { beginWalk, spawnSettler, stepWalk, walkDone } from './movement';
import { ensureWorkerAvailable } from './recruit';
import { playerHasDockedHarbor, spawnShip } from './seafaring';
import { isWaterNode } from '../water';

/** A water node adjacent to `node` that still holds fish, or -1. */
function adjacentFish(world: World, geom: Geometry, node: number): number {
  for (const n of geom.neighbours(node)) {
    if (
      isWaterNode(world, n) &&
      resourceType(world.resource[n]) === RESOURCE.fish &&
      resourceAmount(world.resource[n]) > 0
    ) {
      return n;
    }
  }
  return -1;
}

/**
 * Wares a producer never idles for: construction materials, tools, weapons and
 * coins have sinks (sites, recruitment, military) the building input table can't
 * see, so gating them on a stored reserve would wrongly stall those chains.
 */
const ALWAYS_WANTED: ReadonlySet<WareType> = new Set<WareType>([
  WARE.plank,
  WARE.stone,
  WARE.coins,
  WARE.sword,
  WARE.shield,
  WARE.bow,
  WARE.tongs,
  WARE.hammer,
  WARE.axe,
  WARE.saw,
  WARE.pickaxe,
  WARE.shovel,
  WARE.crucible,
  WARE.rodandline,
  WARE.scythe,
  WARE.cleaver,
  WARE.rollingpin,
]);

/**
 * How much of a ware a player may hold (warehouse stock + everything already in
 * transit) before its producers idle. Keeps a working buffer while stopping
 * wells / hunters / etc. from flooding the road network with goods nothing is
 * draining — surplus otherwise saturates every flag and gridlocks unrelated
 * deliveries. In transit is counted so a jam that starves its own consumers (the
 * consumers look hungry, so a stock-only check would keep overproducing) still
 * stops production.
 */
const SURPLUS_RESERVE = 40;

/** Per-player, per-ware count of wares currently in transit (on flags or carried). */
function transitCensus(world: World): Map<number, Record<string, number>> {
  const census = new Map<number, Record<string, number>>();
  for (const w of storeLive(world.wares)) {
    const b = world.buildings.items[w.targetBuildingId];
    const player = b ? b.player : -1;
    if (player < 0) continue;
    const rec = census.get(player) ?? {};
    rec[w.type] = (rec[w.type] ?? 0) + 1;
    census.set(player, rec);
  }
  return census;
}

/**
 * True when it's still worth producing `ware`: the player's stock plus in-transit
 * supply is below the reserve cap. Always-wanted wares (construction materials,
 * tools, weapons, coins — see {@link ALWAYS_WANTED}) never gate.
 */
function wareWanted(player: Player, ware: WareType, transit: Record<string, number>): boolean {
  if (ALWAYS_WANTED.has(ware)) return true;
  const supply = (player.wares[ware] ?? 0) + (transit[ware] ?? 0);
  return supply < SURPLUS_RESERVE;
}

/** A building's primary produced ware for demand-gating, or null (no output). */
function producedWare(def: BuildingDef): WareType | null {
  return def.outputs.length > 0 ? def.outputs[0] : null;
}

/** Mature any saplings and crop fields whose growth timer has elapsed. */
function runGrowth(world: World): void {
  if (world.saplings.length > 0) {
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
  if (world.cropFields.length > 0) {
    const remaining: Array<{ node: number; matureTick: number }> = [];
    for (const c of world.cropFields) {
      if (world.objectType[c.node] !== OBJ_TYPE_CROP) continue; // harvested / removed
      if (world.tick >= c.matureTick) world.objectIndex[c.node] = OBJ_INDEX_MATURE;
      remaining.push(c);
    }
    world.cropFields = remaining;
  }
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
  geom.forEachNodeWithin(fromNode, radius, (node) => {
    if (!pred(node)) return;
    if (geom.distance(fromNode, node) > radius) return;
    candidates.push(node);
  });
  candidates.sort((a, b) => geom.distance(fromNode, a) - geom.distance(fromNode, b) || a - b);
  for (const node of candidates) {
    const path = findWalkPath(world, geom, rules, fromNode, node);
    if (path) return { node, path };
  }
  return null;
}

/**
 * Nearest subsurface resource node of a given type nibble within radius. Mines
 * search under themselves, so no walk path is required (miner is in-building).
 */
function nearestResource(
  world: World,
  geom: Geometry,
  center: number,
  radius: number,
  resNibble: number,
): number {
  let best = -1;
  let bestDist = Infinity;
  geom.forEachNodeWithin(center, radius, (node) => {
    const byte = world.resource[node];
    if (resourceType(byte) !== resNibble || resourceAmount(byte) <= 0) return;
    const d = geom.distance(center, node);
    if (d > radius) return;
    if (d < bestDist || (d === bestDist && (best < 0 || node < best))) {
      bestDist = d;
      best = node;
    }
  });
  return best;
}

/** Push finished wares from the output queue onto the building's flag while slots remain. */
function placeOutput(world: World, events: EventSink, b: Building): void {
  if (b.outputQueue.length === 0) return;
  const flag = getFlag(world, b.flagId);
  while (b.outputQueue.length > 0 && flag.wares.length < FLAG_WARE_CAPACITY) {
    const outType = b.outputQueue.shift() as WareType;
    const wid = storeAlloc(world.wares, (id) => ({
      id,
      type: outType,
      loc: 'flag' as const,
      locId: flag.id,
      targetBuildingId: -1,
      nextFlag: -1,
    }));
    flag.wares.push(wid);
    events.emit({
      type: 'WareProduced',
      wareId: wid,
      wareType: outType,
      buildingId: b.id,
      player: b.player,
    });
  }
}

/** Ensure a building's per-input stock array matches its def input count. */
function ensureStockSized(b: Building, def: BuildingDef): void {
  while (b.inputStock.length < def.inputs.length) b.inputStock.push(0);
}

/** Recruit + walk in a worker; returns true once the building is staffed. */
function ensureStaffed(
  world: World,
  geom: Geometry,
  rules: TerrainRules,
  events: EventSink,
  b: Building,
  def: BuildingDef,
): boolean {
  if (b.staffed) return true;
  const job = def.worker;
  if (!job) return false;
  const player = world.players[b.player];
  if (!player) return false;

  if (b.workerId < 0) {
    if (!ensureWorkerAvailable(world, events, player, job)) return false;
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

/** Outdoor field-worker loop shared by woodcutter/quarry/forester/fishery. */
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
      if (b.outputQueue.length >= 8) return; // wait for the flag to clear
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

/** True when a forester may plant a sapling / farmer may sow a field at `node`. */
function plantable(world: World, rules: TerrainRules, node: number): boolean {
  if (world.objectType[node] !== OBJ_TYPE.none) return false;
  if (world.flagAtNode[node] >= 0 || world.buildingAtNode[node] >= 0) return false;
  return (
    isBuildableTexture(world.terrain1[node], rules) &&
    isWalkableTexture(world.terrain1[node], rules) &&
    isWalkableTexture(world.terrain2[node], rules)
  );
}

/** True when a node holds a mature, harvestable grain field. */
function harvestableCrop(world: World, node: number): boolean {
  return world.objectType[node] === OBJ_TYPE_CROP && world.objectIndex[node] === OBJ_INDEX_MATURE;
}

/**
 * Farmer field lifecycle: prefer harvesting a mature field within radius, else
 * sow a new one. The action taken on arrival is decided by the node's state, so
 * the worker needs no extra intent field.
 */
function runFarmer(
  world: World,
  geom: Geometry,
  rules: TerrainRules,
  events: EventSink,
  b: Building,
  worker: Settler,
  def: BuildingDef,
): void {
  const radius = def.radius ?? 2;
  switch (worker.state) {
    case 'idle': {
      if (b.outputQueue.length >= 8) return; // wait for the flag to clear
      const target =
        nearestReachable(world, geom, rules, b.node, radius, (n) => harvestableCrop(world, n)) ??
        nearestReachable(world, geom, rules, b.node, radius, (n) => plantable(world, rules, n));
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
        worker.timer = def.workTicks;
        events.emit({
          type: 'WorkStarted',
          kind: 'farming',
          buildingId: b.id,
          node: worker.node,
          player: b.player,
        });
      }
      break;
    }
    case 'working': {
      if (worker.timer > 0) worker.timer--;
      if (worker.timer <= 0) {
        const node = worker.targetNode;
        if (harvestableCrop(world, node)) {
          world.objectType[node] = OBJ_TYPE.none;
          world.objectIndex[node] = 0;
          world.cropFields = world.cropFields.filter((c) => c.node !== node);
          b.outputQueue.push(def.outputs[0]);
          events.emit({ type: 'CropHarvested', node, player: b.player });
        } else if (plantable(world, rules, node)) {
          world.objectType[node] = OBJ_TYPE_CROP;
          world.objectIndex[node] = OBJ_INDEX_SAPLING;
          world.cropFields.push({ node, matureTick: world.tick + TICKS.cropGrow });
          events.emit({ type: 'CropPlanted', node, player: b.player });
        }
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

/** In-building timed producer with no ware input (well -> water, hunter -> meat). */
function runGenerator(events: EventSink, b: Building, def: BuildingDef): void {
  if (b.workTimer > 0) {
    b.workTimer--;
    if (b.workTimer === 0 && def.outputs.length > 0) b.outputQueue.push(def.outputs[0]);
    return;
  }
  if (b.outputQueue.length >= 8) return; // wait for the flag to clear
  b.workTimer = def.workTicks;
  const kind = b.type === BUILDING.hunter ? 'hunting' : 'drawing';
  events.emit({ type: 'WorkStarted', kind, buildingId: b.id, node: b.node, player: b.player });
}

/** Select the ware produced by a workshop this cycle (tool priority / alternation / fixed). */
function selectOutput(b: Building, def: BuildingDef, player: Player): WareType | null {
  if (def.breedsDonkey) return null;
  if (def.producesTool) {
    const list = player.toolPriority.length > 0 ? player.toolPriority : def.outputs;
    if (list.length === 0) return null;
    const out = list[player.toolCycle % list.length];
    player.toolCycle++;
    return out;
  }
  if (def.outputs.length === 0) return null;
  if (def.alternate) {
    const out = def.outputs[b.altToggle % def.outputs.length];
    b.altToggle = (b.altToggle + 1) % def.outputs.length;
    return out;
  }
  return def.outputs[0];
}

/** In-building workshop: consume one of each input, then produce an output. */
function runWorkshop(events: EventSink, b: Building, def: BuildingDef, player: Player): void {
  if (b.workTimer > 0) {
    b.workTimer--;
    if (b.workTimer === 0) {
      const out = selectOutput(b, def, player);
      if (out) {
        b.outputQueue.push(out);
      } else if (def.breedsDonkey) {
        player.donkeys++;
        events.emit({ type: 'DonkeyBred', buildingId: b.id, player: b.player });
      }
    }
    return;
  }
  if (b.outputQueue.length >= 8) return; // finished wares still waiting for the flag
  for (let i = 0; i < def.inputs.length; i++) if ((b.inputStock[i] ?? 0) <= 0) return; // need one of each
  for (let i = 0; i < def.inputs.length; i++) b.inputStock[i]--;
  b.workTimer = def.workTicks;
  events.emit({
    type: 'WorkStarted',
    kind: workshopSound(b.type),
    buildingId: b.id,
    node: b.node,
    player: b.player,
  });
}

/** Rough sound classification for a workshop's WorkStarted event. */
function workshopSound(type: string): string {
  if (type === BUILDING.sawmill) return 'sawing';
  if (type === BUILDING.armory || type === BUILDING.metalworks) return 'hammering';
  if (type === BUILDING.ironsmelter || type === BUILDING.mint) return 'smelting';
  return 'working';
}

/** Mine: consume 1 food (most-stocked), decrement a subsurface resource, produce ore. */
function runMine(
  world: World,
  geom: Geometry,
  events: EventSink,
  b: Building,
  def: BuildingDef,
): void {
  if (b.workTimer > 0) {
    b.workTimer--;
    if (b.workTimer === 0 && def.outputs.length > 0) b.outputQueue.push(def.outputs[0]);
    return;
  }
  if (b.outputQueue.length >= 8) return;
  // Pick the most-stocked food (Fish/Meat/Bread), deterministic tie-break (lowest idx).
  let foodIdx = -1;
  let best = 0;
  for (let i = 0; i < def.inputs.length; i++) {
    const s = b.inputStock[i] ?? 0;
    if (s > best) {
      best = s;
      foodIdx = i;
    }
  }
  if (foodIdx < 0) return; // no food -> idle
  const resNode = nearestResource(world, geom, b.node, def.radius ?? 2, def.resource ?? 0);
  if (resNode < 0) {
    if (world.tick % 50 === 0) {
      events.emit({ type: 'MineDepleted', buildingId: b.id, node: b.node, player: b.player });
    }
    return;
  }
  b.inputStock[foodIdx]--; // consume 1 food
  world.resource[resNode] = world.resource[resNode] - 1; // reserve + decrement the resource
  b.workTimer = def.workTicks;
  events.emit({
    type: 'WorkStarted',
    kind: 'mining',
    buildingId: b.id,
    node: b.node,
    player: b.player,
  });
}

/**
 * Shipyard: accumulate boards, then spend a work cycle building a ship entity,
 * which docks at the player's nearest harbor. The cycle only starts when a harbor
 * exists to receive the ship, so boards are never consumed with nowhere to dock.
 */
function runShipyard(
  world: World,
  geom: Geometry,
  events: EventSink,
  b: Building,
  def: BuildingDef,
): void {
  if (b.workTimer > 0) {
    b.workTimer--;
    if (b.workTimer === 0) spawnShip(world, geom, events, b);
    return;
  }
  if ((b.inputStock[0] ?? 0) < SEA.shipPlankCost) return;
  if (!playerHasDockedHarbor(world, geom, b.player)) return;
  b.inputStock[0] -= SEA.shipPlankCost;
  b.workTimer = def.workTicks;
  events.emit({
    type: 'WorkStarted',
    kind: 'shipbuilding',
    buildingId: b.id,
    node: b.node,
    player: b.player,
  });
}

/** Dispatch a harvester building to the right find/harvest behaviour by type. */
function runHarvesterFor(
  world: World,
  geom: Geometry,
  rules: TerrainRules,
  events: EventSink,
  b: Building,
  worker: Settler,
  def: BuildingDef,
): void {
  const radius = def.radius ?? 6;
  switch (b.type) {
    case BUILDING.woodcutter:
      runHarvester(
        world,
        geom,
        rules,
        b,
        worker,
        () =>
          nearestReachable(world, geom, rules, b.node, radius, (n) =>
            isTreeType(world.objectType[n]),
          ),
        def.workTicks,
        (node) => {
          if (!isTreeType(world.objectType[node])) return false;
          world.objectType[node] = OBJ_TYPE.none;
          world.objectIndex[node] = 0;
          b.outputQueue.push(def.outputs[0]);
          events.emit({ type: 'TreeFelled', node, player: b.player });
          return true;
        },
      );
      break;
    case BUILDING.quarry:
      runHarvester(
        world,
        geom,
        rules,
        b,
        worker,
        () =>
          nearestReachable(
            world,
            geom,
            rules,
            b.node,
            radius,
            (n) => isGraniteType(world.objectType[n]) && graniteStock(world.objectIndex[n]) > 0,
          ),
        def.workTicks,
        (node) => {
          if (!isGraniteType(world.objectType[node])) return false;
          world.objectIndex[node] = Math.max(0, world.objectIndex[node] - 1);
          if (graniteStock(world.objectIndex[node]) <= 0) {
            world.objectType[node] = OBJ_TYPE.none;
            world.objectIndex[node] = 0;
          }
          b.outputQueue.push(def.outputs[0]);
          events.emit({ type: 'StoneMined', node, player: b.player });
          return true;
        },
      );
      break;
    case BUILDING.forester:
      runHarvester(
        world,
        geom,
        rules,
        b,
        worker,
        () =>
          nearestReachable(world, geom, rules, b.node, radius, (n) => plantable(world, rules, n)),
        def.workTicks,
        (node) => {
          if (!plantable(world, rules, node)) return false;
          world.objectType[node] = OBJ_TYPE_SAPLING;
          world.objectIndex[node] = OBJ_INDEX_SAPLING;
          world.saplings.push({ node, matureTick: world.tick + TICKS.treeGrow });
          events.emit({ type: 'TreePlanted', node, player: b.player });
          return true;
        },
      );
      break;
    case BUILDING.fishery:
      // Fish live in water (which the fisher can't walk into), so the fisher
      // stands on reachable shore next to a fish-bearing water node and fishes it.
      runHarvester(
        world,
        geom,
        rules,
        b,
        worker,
        () =>
          nearestReachable(
            world,
            geom,
            rules,
            b.node,
            radius,
            (n) => adjacentFish(world, geom, n) >= 0,
          ),
        def.workTicks,
        (standNode) => {
          const fishNode = adjacentFish(world, geom, standNode);
          if (fishNode < 0) return false;
          world.resource[fishNode] = world.resource[fishNode] - 1;
          b.outputQueue.push(def.outputs[0]);
          return true;
        },
      );
      break;
    default:
      break;
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
  const transit = transitCensus(world);

  for (const b of storeLive(world.buildings)) {
    if (b.state !== 'working') continue;
    const def = buildingDef(b.type);
    if (!def || def.kind === 'hq' || def.kind === 'warehouse') continue;
    ensureStockSized(b, def);
    if (!ensureStaffed(world, geom, rules, events, b, def)) continue;
    const player = world.players[b.player];
    if (!player) continue;
    const worker = b.workerId >= 0 ? world.settlers.items[b.workerId] : null;

    // Demand gate: if the output isn't wanted and the building is between cycles,
    // skip starting a new one — but never freeze a worker already out on a trip,
    // and always drain whatever is already queued (placeOutput). A congested flag
    // leaves queued output, so gate on the work timer (about to restart) rather
    // than an empty queue, or a jammed producer would never idle.
    const ware = producedWare(def);
    if (ware && !wareWanted(player, ware, transit.get(b.player) ?? {})) {
      const betweenCycles =
        def.kind === 'harvester' || def.kind === 'farm'
          ? !worker || worker.state === 'idle'
          : b.workTimer === 0;
      if (betweenCycles) {
        placeOutput(world, events, b);
        continue;
      }
    }

    switch (def.kind) {
      case 'harvester':
        if (worker) runHarvesterFor(world, geom, rules, events, b, worker, def);
        break;
      case 'farm':
        if (worker) runFarmer(world, geom, rules, events, b, worker, def);
        break;
      case 'generator':
        runGenerator(events, b, def);
        break;
      case 'workshop':
        runWorkshop(events, b, def, player);
        break;
      case 'mine':
        runMine(world, geom, events, b, def);
        break;
      case 'shipyard':
        runShipyard(world, geom, events, b, def);
        break;
      case 'special':
        // Lookout tower: staffed for vision only; no production (stub).
        break;
      default:
        break;
    }

    placeOutput(world, events, b);
  }
}
