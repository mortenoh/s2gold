/**
 * Military system: recruitment, occupation, combat, promotion and catapults.
 * All rules and constants are cited to docs/gameplay-notes/MILITARY.md.
 *
 * Model summary:
 * - Garrisoned soldiers are counts per rank on the building (`Building.garrison`);
 *   coins for promotion live in the building's `inputStock[0]` (its only input),
 *   filled by the ware dispatcher up to `maxGold`.
 * - Idle soldiers waiting in warehouses are counts per rank on the player
 *   (`Player.soldiers`); recruited privates land in rank slot 0.
 * - Walking / fighting soldiers are `Settler` entities (rank/hp on the settler).
 *   A duel is fought entirely on the attacking settler against a "virtual"
 *   defender whose rank/hp are stored on the settler (no defender settler is
 *   spawned) — deterministic and cheap.
 *
 * Determinism: every random draw uses the world RNG (`nextRange`) in a fixed
 * order; recruitment/promotion only draw when there is actual demand, so the
 * pure-economy scenarios never perturb the RNG stream.
 */

import {
  buildingDef,
  CATAPULT,
  FIGHT_DEATH_GF,
  FIGHT_ROUND_GF,
  MAX_MILITARY_RANK,
  MILITARY_ATTACK,
  NUM_SOLDIER_RANKS,
  RECRUITE_GF,
  RECRUITE_RANDOM_GF,
  SOLDIER_HITPOINTS,
  strengthRollBound,
  TICKS,
  UPGRADE_TIME,
  UPGRADE_TIME_RANDOM,
  WARE,
} from '../constants';
import type { EventSink } from '../events';
import type { Geometry } from '../geometry';
import { findWalkPath } from '../pathfinding';
import { nextRange } from '../rng';
import type { TerrainRules } from '../terrain';
import {
  getBuilding,
  storeFree,
  storeLive,
  type Building,
  type Player,
  type Settler,
  type World,
} from '../world';
import { beginWalk, spawnSoldier, stepWalk, walkDone } from './movement';
import { recalcTerritory } from './territory';

// --- Small garrison helpers -----------------------------------------------

/** Total soldiers garrisoned in a building. */
export function garrisonCount(b: Building): number {
  let n = 0;
  for (const c of b.garrison) n += c;
  return n;
}

/** Weakest occupied rank in a pool/garrison array (-1 when empty). */
function weakestRank(counts: number[]): number {
  for (let r = 0; r < counts.length; r++) if (counts[r] > 0) return r;
  return -1;
}

/** Strongest occupied rank in a garrison array (-1 when empty). */
function strongestRank(counts: number[]): number {
  for (let r = counts.length - 1; r >= 0; r--) if (counts[r] > 0) return r;
  return -1;
}

/** True when a building holds a soldier that can still be promoted. */
function hasUpgradeable(b: Building): boolean {
  for (let r = 0; r < MAX_MILITARY_RANK; r++) if (b.garrison[r] > 0) return true;
  return false;
}

/** True when a building type projects territory / can be attacked (military). */
function isMilitary(b: Building): boolean {
  return buildingDef(b.type)?.kind === 'military';
}

/** True when a building can be the target of an attack: a military building or the HQ. */
function isAttackTarget(b: Building): boolean {
  const kind = buildingDef(b.type)?.kind;
  return kind === 'military' || kind === 'hq';
}

/**
 * The pool a building draws its defenders from. A military building fights from
 * its own garrison; an HQ has no garrison of its own and instead defends with
 * the owner's idle reserve (`Player.soldiers`) as its last stand (MILITARY.md §4).
 * Returns the same array shape (counts per rank) either way, so the existing
 * duel machinery operates on it unchanged. Falls back to the garrison when the
 * owning player is somehow missing.
 */
function defenderPool(world: World, b: Building): number[] {
  if (buildingDef(b.type)?.kind === 'hq') {
    const owner = world.players[b.player];
    if (owner) return owner.soldiers;
  }
  return b.garrison;
}

/** Total defenders available to a building (garrison, or reserve for an HQ). */
function defenderCount(world: World, b: Building): number {
  let n = 0;
  for (const c of defenderPool(world, b)) n += c;
  return n;
}

/**
 * True when a live enemy soldier is marching on or fighting at this player's HQ.
 * Derived purely from settler state (no stored flag), so it stays deterministic
 * and needs no serialization. Used to hold the reserve back for HQ defense (§4).
 */
function hqUnderSiege(world: World, player: Player): boolean {
  const hqId = player.hqBuildingId;
  if (hqId < 0) return false;
  for (const s of storeLive(world.settlers)) {
    if (s.rank < 0 || s.player === player.index || s.attackTargetId !== hqId) continue;
    if (s.state === 'soldierMarch' || s.state === 'soldierFight') return true;
  }
  return false;
}

// --- Recruitment (MILITARY.md §6 / CONSTANTS.md §7) ------------------------

/** Unmet garrison demand across a player's military buildings. */
function soldierDemand(world: World, player: Player): number {
  let demand = 0;
  for (const b of storeLive(world.buildings)) {
    if (b.player !== player.index || b.state !== 'working' || !isMilitary(b)) continue;
    const cap = buildingDef(b.type)?.maxTroops ?? 0;
    demand += Math.max(0, cap - garrisonCount(b) - b.incoming);
  }
  return demand;
}

/** Recruit privates from beer+sword+shield+helper on demand (MILITARY.md §6). */
function runRecruitment(world: World, events: EventSink): void {
  for (const player of world.players) {
    if (player.hqBuildingId < 0) {
      player.recruitTimer = -1;
      continue;
    }
    const pool = player.soldiers.reduce((a, b) => a + b, 0);
    const needed = soldierDemand(world, player);
    const canAfford =
      (player.wares[WARE.beer] ?? 0) > 0 &&
      (player.wares[WARE.sword] ?? 0) > 0 &&
      (player.wares[WARE.shield] ?? 0) > 0 &&
      (player.workers.carrier ?? 0) > 0;

    if (player.recruitTimer < 0) {
      // Only start a recruit cycle when garrisons want more than the pool holds.
      if (needed > pool && canAfford) {
        player.recruitTimer = RECRUITE_GF + nextRange(world.rng, RECRUITE_RANDOM_GF);
      }
      continue;
    }
    player.recruitTimer--;
    if (player.recruitTimer <= 0) {
      player.recruitTimer = -1;
      if (canAfford) {
        player.wares[WARE.beer]--;
        player.wares[WARE.sword]--;
        player.wares[WARE.shield]--;
        player.workers.carrier--;
        player.soldiers[0]++;
        events.emit({ type: 'SoldierRecruited', player: player.index });
      }
    }
  }
}

// --- Occupation (MILITARY.md §3) ------------------------------------------

/** Order idle soldiers (weakest first) to walk into understaffed buildings. */
function runOccupation(
  world: World,
  geom: Geometry,
  rules: TerrainRules,
  _events: EventSink,
): void {
  // While a player's HQ is besieged, its idle reserve (Player.soldiers) is the
  // HQ's last-stand defense (§4). Hold that reserve back rather than let the last
  // soldiers stroll off to garrison distant buildings mid-siege; occupation for
  // that player resumes once no attackers remain on the HQ. Only the besieged
  // owner's draws pause — everyone else occupies normally.
  const besieged = world.players.map((p) => hqUnderSiege(world, p));
  for (const b of storeLive(world.buildings)) {
    if (b.state !== 'working' || !isMilitary(b)) continue;
    const player = world.players[b.player];
    if (!player) continue;
    if (besieged[b.player]) continue; // reserve held for HQ defense
    const cap = buildingDef(b.type)?.maxTroops ?? 0;
    let have = garrisonCount(b) + b.incoming;
    while (have < cap) {
      const rank = weakestRank(player.soldiers);
      if (rank < 0) break; // no idle soldiers available
      const hq = player.hqBuildingId >= 0 ? getBuilding(world, player.hqBuildingId) : null;
      const startNode = hq ? hq.node : b.node;
      const s = spawnSoldier(world, rank, b.player, startNode);
      s.state = 'soldierToOccupy';
      s.homeBuildingId = b.id;
      s.targetNode = b.node;
      const path = findWalkPath(world, geom, rules, startNode, b.node);
      if (path) beginWalk(s, path, TICKS.walkPerEdge);
      else s.node = b.node;
      player.soldiers[rank]--;
      b.incoming++;
      have++;
    }
  }
}

// --- Soldier stepping (occupy / march / fight) ----------------------------

/** Apply one hit to the attacking settler (armor absorbs it first). */
function hitSettler(s: Settler): void {
  if (s.hasArmor) s.hasArmor = false;
  else s.hp--;
}
/** Apply one hit to the settler's current opponent (armor absorbs it first). */
function hitOpponent(s: Settler): void {
  if (s.oppHasArmor) s.oppHasArmor = false;
  else s.oppHp--;
}

/** Begin a duel between the marching attacker and the building's weakest defender. */
function startDuel(world: World, events: EventSink, s: Settler, b: Building): void {
  const pool = defenderPool(world, b);
  const defRank = weakestRank(pool);
  pool[defRank]--; // the defender comes out to fight (garrison, or HQ reserve)
  s.state = 'soldierFight';
  s.oppRank = defRank;
  s.oppHp = SOLDIER_HITPOINTS[defRank] ?? 3;
  s.oppHasArmor = false;
  s.fightTurn = nextRange(world.rng, 2); // first attacker chosen at random (§5.1)
  s.fightTimer = FIGHT_ROUND_GF;
  const flagNode = s.node;
  events.emit({
    type: 'FightStarted',
    node: flagNode,
    attackerPlayer: s.player,
    attackerRank: s.rank,
    defenderPlayer: b.player,
    defenderRank: defRank,
  });
}

/**
 * Capture (or, for an HQ, raze) an emptied enemy military building. The
 * surviving attacker becomes the first of the new garrison. Recomputes
 * territory and emits the relevant events.
 */
function captureBuilding(
  world: World,
  geom: Geometry,
  events: EventSink,
  b: Building,
  attacker: Settler,
): void {
  const def = buildingDef(b.type);
  const from = b.player;
  const to = attacker.player;

  if (def?.kind === 'hq') {
    // Taking a headquarters razes it (MILITARY.md §4: the HQ is the last stand).
    events.emit({
      type: 'BuildingCaptured',
      buildingId: b.id,
      buildingType: b.type,
      node: b.node,
      fromPlayer: from,
      toPlayer: to,
      burned: true,
    });
    // Remove the building and its marker; the losing player loses its HQ anchor.
    world.buildingAtNode[b.node] = -1;
    world.objectType[b.node] = 0;
    if (world.players[from]) world.players[from].hqBuildingId = -1;
    storeFree(world.buildings, b.id);
    recalcTerritory(world, geom);
    events.emit({ type: 'TerritoryChanged', player: to });
    return;
  }

  // Flip ownership; the attacker garrisons it at its current rank.
  b.player = to;
  b.garrison = new Array<number>(NUM_SOLDIER_RANKS).fill(0);
  b.garrison[attacker.rank]++;
  b.occupied = true;
  b.incoming = 0;
  b.promotionTimer = -1;
  if (b.inputStock.length > 0) b.inputStock[0] = 0; // spilled coins are lost
  const flag = world.flags.items[b.flagId];
  if (flag) flag.player = to;
  events.emit({
    type: 'BuildingCaptured',
    buildingId: b.id,
    buildingType: b.type,
    node: b.node,
    fromPlayer: from,
    toPlayer: to,
    burned: false,
  });
  recalcTerritory(world, geom);
  events.emit({ type: 'TerritoryChanged', player: to });
}

/**
 * Send a surviving attacker that can't garrison the captured building back to
 * its home military building (reusing the occupy walk). If home is gone or
 * already full it rejoins the player's idle soldier pool instead of vanishing.
 */
function sendSoldierHome(world: World, geom: Geometry, rules: TerrainRules, s: Settler): void {
  const home = s.homeBuildingId >= 0 ? world.buildings.items[s.homeBuildingId] : null;
  if (home && home.player === s.player && isMilitary(home)) {
    const cap = buildingDef(home.type)?.maxTroops ?? 0;
    if (garrisonCount(home) + home.incoming < cap) {
      s.state = 'soldierToOccupy';
      s.targetNode = home.node;
      const path = findWalkPath(world, geom, rules, s.node, home.node);
      if (path) beginWalk(s, path, TICKS.walkPerEdge);
      else s.node = home.node;
      home.incoming++;
      return;
    }
  }
  // No home to return to (razed / full): rejoin the idle soldier pool.
  const owner = world.players[s.player];
  if (owner) owner.soldiers[s.rank]++;
  storeFree(world.settlers, s.id);
}

/** A soldier walking in to garrison: on arrival, join the garrison. */
function stepOccupy(world: World, geom: Geometry, events: EventSink, s: Settler): void {
  const arrived = walkDone(s) ? true : stepWalk(s);
  if (!arrived) return;
  const b = world.buildings.items[s.homeBuildingId];
  if (!b || b.player !== s.player || !isMilitary(b)) {
    // Building gone or captured while walking: rejoin the idle pool rather
    // than vanish.
    if (b && b.incoming > 0) b.incoming--;
    const owner = world.players[s.player];
    if (owner) owner.soldiers[s.rank]++;
    storeFree(world.settlers, s.id);
    return;
  }
  b.garrison[s.rank]++;
  if (b.incoming > 0) b.incoming--;
  const firstOccupant = !b.occupied;
  b.occupied = true;
  events.emit({
    type: 'MilitaryOccupied',
    buildingId: b.id,
    rank: s.rank,
    player: s.player,
    firstOccupant,
  });
  if (firstOccupant) {
    recalcTerritory(world, geom);
    events.emit({ type: 'TerritoryChanged', player: s.player });
  }
  storeFree(world.settlers, s.id);
}

/** True when any soldier is mid-duel at (attacking) a given building. */
function fightOngoing(world: World, buildingId: number): boolean {
  for (const s of storeLive(world.settlers)) {
    if (s.state === 'soldierFight' && s.attackTargetId === buildingId) return true;
  }
  return false;
}

/**
 * A soldier marching to an attack target. On arrival it starts a duel if the
 * building still has defenders; otherwise it waits at the flag (staying in the
 * arrived `soldierMarch` state) — the actual capture is resolved centrally once
 * no duels remain, so defenders currently out fighting are never skipped.
 */
function stepMarch(
  world: World,
  geom: Geometry,
  rules: TerrainRules,
  events: EventSink,
  s: Settler,
): void {
  const arrived = walkDone(s) ? true : stepWalk(s);
  if (!arrived) return;
  const b = world.buildings.items[s.attackTargetId];
  if (!b) {
    // Target vanished (demolished mid-march): walk home instead of being
    // deleted, or the defender could erase whole armies by razing the hut.
    sendSoldierHome(world, geom, rules, s);
    return;
  }
  if (b.player === s.player) {
    // Already ours (captured before we arrived): reinforce up to capacity,
    // otherwise walk back home.
    if (isMilitary(b)) {
      const cap = buildingDef(b.type)?.maxTroops ?? 0;
      if (garrisonCount(b) < cap) {
        b.garrison[s.rank]++;
        b.occupied = true;
        storeFree(world.settlers, s.id);
      } else {
        sendSoldierHome(world, geom, rules, s);
      }
      return;
    }
    sendSoldierHome(world, geom, rules, s);
    return;
  }
  if (defenderCount(world, b) > 0) startDuel(world, events, s, b);
  // else: wait at the flag; resolveCaptures() finishes the job this tick.
}

/** A soldier in a duel: resolve one round every FIGHT_ROUND_GF ticks (§5). */
function stepFight(
  world: World,
  geom: Geometry,
  rules: TerrainRules,
  events: EventSink,
  s: Settler,
): void {
  if (s.fightTimer > 0) {
    s.fightTimer--;
    if (s.fightTimer > 0) return;
  }
  const b = world.buildings.items[s.attackTargetId];
  if (!b || b.player === s.player) {
    // Target lost / became ours mid-fight: stop fighting and walk home
    // (the soldier must not simply vanish).
    sendSoldierHome(world, geom, rules, s);
    return;
  }

  // Both soldiers roll (fixed draw order: attacker settler, then opponent).
  const sRoll = nextRange(world.rng, strengthRollBound(s.rank));
  const oRoll = nextRange(world.rng, strengthRollBound(s.oppRank));
  // The acting attacker of this round lands a hit iff its roll is strictly
  // greater (§5.3). fightTurn 0 = the settler acts; 1 = the opponent acts.
  if (s.fightTurn === 0) {
    if (sRoll > oRoll) hitOpponent(s);
  } else if (oRoll > sRoll) {
    hitSettler(s);
  }

  if (s.oppHp <= 0) {
    // Defender died; the attacker wins this duel.
    events.emit({ type: 'SoldierDied', node: s.node, player: b.player, rank: s.oppRank });
    if (defenderCount(world, b) > 0) {
      startDuel(world, events, s, b); // next defender comes out
      s.fightTimer = FIGHT_DEATH_GF; // brief death-sequence pause (§5.5)
    } else {
      // No defenders left: revert to waiting; resolveCaptures() takes the flag
      // once all duels here have finished.
      s.state = 'soldierMarch';
      s.oppRank = -1;
      s.oppHp = 0;
    }
    return;
  }
  if (s.hp <= 0) {
    // Attacker died; the surviving defender returns to its pool (garrison, or
    // the HQ's reserve).
    events.emit({ type: 'SoldierDied', node: s.node, player: s.player, rank: s.rank });
    defenderPool(world, b)[s.oppRank]++;
    storeFree(world.settlers, s.id);
    return;
  }
  // Neither died: swap the acting side and time the next round.
  s.fightTurn = 1 - s.fightTurn;
  s.fightTimer = FIGHT_ROUND_GF;
}

/**
 * Resolve captures: for every attacked enemy building with no defenders left and
 * no duel still running, the waiting attackers (arrived, idle at its flag) take
 * it — the lowest-id attacker captures and garrisons it, and the rest join the
 * new garrison (MILITARY.md §4: nearby attackers join the capture).
 */
function resolveCaptures(
  world: World,
  geom: Geometry,
  rules: TerrainRules,
  events: EventSink,
): void {
  // Group waiting attackers (arrived marchers) by target building, id order.
  const waiting = new Map<number, number[]>();
  for (const s of storeLive(world.settlers)) {
    if (s.state !== 'soldierMarch' || s.rank < 0) continue;
    if (!walkDone(s)) continue; // still en route
    const b = world.buildings.items[s.attackTargetId];
    if (!b || b.player === s.player || defenderCount(world, b) > 0) continue;
    if (fightOngoing(world, b.id)) continue; // defenders still out fighting
    const list = waiting.get(b.id) ?? [];
    list.push(s.id);
    waiting.set(b.id, list);
  }
  for (const [buildingId, attackerIds] of waiting) {
    const b = world.buildings.items[buildingId];
    if (!b) continue;
    attackerIds.sort((a, c) => a - c);
    const first = world.settlers.items[attackerIds[0]];
    if (!first) continue;
    const isHq = buildingDef(b.type)?.kind === 'hq';
    const capturer = first.player;
    captureBuilding(world, geom, events, b, first);
    storeFree(world.settlers, first.id);
    // Remaining attackers reinforce the freshly captured building up to its
    // capacity; any excess (or all of them, when the HQ was razed) walk home.
    const survived = !isHq && !!world.buildings.items[buildingId];
    const cap = survived ? (buildingDef(b.type)?.maxTroops ?? 0) : 0;
    for (let i = 1; i < attackerIds.length; i++) {
      const s = world.settlers.items[attackerIds[i]];
      if (!s) continue;
      // A rival attacker (other player) does not merge into the capturer's
      // garrison: it stays waiting and duels the new owner next tick.
      if (s.player !== capturer) continue;
      if (survived && garrisonCount(b) < cap) {
        b.garrison[s.rank]++;
        storeFree(world.settlers, s.id);
      } else {
        sendSoldierHome(world, geom, rules, s);
      }
    }
  }
}

/** Step every soldier settler this tick, then resolve any pending captures. */
function runSoldiers(world: World, geom: Geometry, rules: TerrainRules, events: EventSink): void {
  // Snapshot ids so freeing / capture mutations don't disturb iteration.
  const ids: number[] = [];
  for (const s of storeLive(world.settlers)) if (s.rank >= 0) ids.push(s.id);
  for (const id of ids) {
    const s = world.settlers.items[id];
    if (!s) continue;
    switch (s.state) {
      case 'soldierToOccupy':
        stepOccupy(world, geom, events, s);
        break;
      case 'soldierMarch':
        stepMarch(world, geom, rules, events, s);
        break;
      case 'soldierFight':
        stepFight(world, geom, rules, events, s);
        break;
      default:
        break;
    }
  }
  resolveCaptures(world, geom, rules, events);
}

// --- Promotion (MILITARY.md §6) -------------------------------------------

/** Consume a coin to promote a wave of soldiers (one per rank tier) (§6). */
function runPromotion(world: World, events: EventSink): void {
  for (const b of storeLive(world.buildings)) {
    if (!isMilitary(b) || !b.occupied) continue;
    const coins = b.inputStock[0] ?? 0;
    if (b.promotionTimer < 0) {
      if (coins > 0 && hasUpgradeable(b)) {
        b.promotionTimer = UPGRADE_TIME + nextRange(world.rng, UPGRADE_TIME_RANDOM);
      }
      continue;
    }
    b.promotionTimer--;
    if (b.promotionTimer > 0) continue;
    b.promotionTimer = -1;
    if ((b.inputStock[0] ?? 0) <= 0 || !hasUpgradeable(b)) continue;
    // Promote one soldier per originally-populated rank tier, weakest upward, so
    // a single wave can raise several soldiers by one rank each (§6). Snapshot
    // first so a promoted soldier is not promoted twice in the same wave.
    const snapshot = b.garrison.slice();
    let count = 0;
    for (let r = 0; r < MAX_MILITARY_RANK; r++) {
      if (snapshot[r] > 0) {
        b.garrison[r]--;
        b.garrison[r + 1]++;
        count++;
      }
    }
    b.inputStock[0]--; // one coin consumed per promotion event (§6)
    events.emit({ type: 'SoldierPromoted', buildingId: b.id, player: b.player, count });
  }
}

// --- Catapult (MILITARY.md §7) --------------------------------------------

/** Kill one soldier (weakest, armor absorbing) in a building; true if a kill landed. */
function catapultKill(events: EventSink, target: Building): void {
  const rank = weakestRank(target.garrison);
  if (rank < 0) return;
  target.garrison[rank]--;
  events.emit({ type: 'SoldierDied', node: target.node, player: target.player, rank });
}

/** Fire ready catapults at a random in-range enemy military building (§7). */
function runCatapults(world: World, geom: Geometry, events: EventSink): void {
  for (const b of storeLive(world.buildings)) {
    if (b.state !== 'working' || buildingDef(b.type)?.kind !== 'catapult') continue;
    if (b.workTimer > 0) {
      b.workTimer--;
      continue;
    }
    if ((b.inputStock[0] ?? 0) <= 0) continue; // no stones -> wait for ammo
    // Candidates: enemy occupied military buildings within distance < range.
    const candidates: number[] = [];
    for (const t of storeLive(world.buildings)) {
      if (t.player === b.player || !isMilitary(t) || !t.occupied) continue;
      if (garrisonCount(t) <= 0) continue;
      if (geom.distance(b.node, t.node) < CATAPULT.range) candidates.push(t.id);
    }
    if (candidates.length === 0) continue;
    b.inputStock[0]--; // consume one stone per shot (§7)
    const target = getBuilding(world, candidates[nextRange(world.rng, candidates.length)]);
    const hit = nextRange(world.rng, 99) < CATAPULT.hitPercent; // 70% (§7)
    if (hit) catapultKill(events, target);
    b.workTimer = CATAPULT.wait; // between-shot wait (original S2 310 GF)
    events.emit({
      type: 'CatapultFired',
      buildingId: b.id,
      targetBuildingId: target.id,
      player: b.player,
      hit,
    });
  }
}

// --- Attack command execution (MILITARY.md §4) ----------------------------

/**
 * Execute an `attack` command: gather up to `soldierCount` attackers from the
 * player's in-range occupied military buildings (nearest first, strongest
 * soldiers first) and march them to the target building's node (MILITARY.md §4).
 */
export function execAttack(
  world: World,
  geom: Geometry,
  rules: TerrainRules,
  _events: EventSink,
  player: number,
  targetBuildingId: number,
  soldierCount: number,
): void {
  const target = world.buildings.items[targetBuildingId];
  if (!target || target.player === player || !isAttackTarget(target) || !target.occupied) return;
  const targetNode = target.node;

  const sources: Array<{ b: Building; dist: number }> = [];
  for (const b of storeLive(world.buildings)) {
    if (b.player !== player || !isMilitary(b) || !b.occupied) continue;
    if (garrisonCount(b) <= 1) continue; // must leave at least 1 as garrison (§4.1)
    sources.push({ b, dist: geom.distance(b.node, targetNode) });
  }
  sources.sort((a, b) => a.dist - b.dist || a.b.id - b.b.id);

  let remaining = soldierCount;
  for (const { b, dist } of sources) {
    if (remaining <= 0) break;
    let sendable = garrisonCount(b) - 1; // full attack strength, leave 1 (§4.1)
    if (dist > MILITARY_ATTACK.baseDistance) {
      sendable -= dist - MILITARY_ATTACK.baseDistance; // farther costs attackers (§4.2)
    }
    if (sendable <= 0) continue;
    const path = findWalkPath(world, geom, rules, b.node, targetNode);
    if (!path || path.length > MILITARY_ATTACK.maxRunDistance) continue; // §4.3
    const take = Math.min(sendable, remaining);
    for (let k = 0; k < take; k++) {
      const rank = strongestRank(b.garrison); // strongest chosen first (§4.4)
      if (rank < 0) break;
      b.garrison[rank]--;
      const s = spawnSoldier(world, rank, player, b.node);
      s.state = 'soldierMarch';
      s.attackTargetId = target.id;
      s.homeBuildingId = b.id;
      s.targetNode = targetNode;
      beginWalk(s, path.slice(), TICKS.walkPerEdge);
      remaining--;
    }
  }
}

// --- Per-tick entry point --------------------------------------------------

/** Run the full military system for one game frame. */
export function runMilitary(
  world: World,
  geom: Geometry,
  rules: TerrainRules,
  events: EventSink,
): void {
  runRecruitment(world, events);
  runOccupation(world, geom, rules, events);
  runSoldiers(world, geom, rules, events);
  runPromotion(world, events);
  runCatapults(world, geom, events);
}
