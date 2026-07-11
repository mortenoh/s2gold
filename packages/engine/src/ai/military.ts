/**
 * AI military doctrine: attack-target choice and frontline coin policy.
 *
 * Attacks are honest and cautious: the AI only strikes when it has a real soldier
 * surplus (a building holding more than its lone garrison-keeper), and only at an
 * enemy military building it can actually reach on foot within the engine's
 * MAX_ATTACKING_RUN_DISTANCE. Enemy headquarters count as targets too — razing
 * one eliminates the opponent. Among reachable targets it picks the weakest
 * (lowest total garrison strength), nearest, lowest-id — the cheapest capture —
 * mirroring the attack executor's own reachability maths so a returned target is
 * one the command layer will accept.
 */

import { buildingDef, MILITARY_ATTACK } from '../constants';
import type { Geometry } from '../geometry';
import { findWalkPath } from '../pathfinding';
import type { TerrainRules } from '../terrain';
import { storeLive, type Building, type World } from '../world';
import { garrisonCount } from '../systems/military';
import type { CommandInput } from '../commands';
import type { AiState } from './types';

/** True when a building projects territory / can be attacked (military kind). */
function isMilitary(b: Building): boolean {
  return buildingDef(b.type)?.kind === 'military';
}

/** Buildings the attack executor accepts as targets: military buildings and HQs. */
function isAttackable(b: Building): boolean {
  const kind = buildingDef(b.type)?.kind;
  return kind === 'military' || kind === 'hq';
}

/** Total garrison strength of a building: sum of (rank+1) x count. */
function garrisonStrength(b: Building): number {
  let s = 0;
  for (let r = 0; r < b.garrison.length; r++) s += (r + 1) * b.garrison[r];
  return s;
}

/** Occupied military buildings of `player` with a spare soldier to send. */
function attackSources(world: World, player: number): Building[] {
  const out: Building[] = [];
  for (const b of storeLive(world.buildings)) {
    if (b.player === player && isMilitary(b) && b.occupied && garrisonCount(b) > 1) out.push(b);
  }
  return out;
}

/**
 * Choose the weakest reachable enemy military building to attack, and how many
 * soldiers to commit, or null when there is no worthwhile / reachable target.
 * When no enemy military building is reachable, falls back to a reachable enemy
 * headquarters — the finishing move that eliminates the opponent.
 */
export function pickAttackTarget(
  world: World,
  geom: Geometry,
  rules: TerrainRules,
  player: number,
): { targetBuildingId: number; soldiers: number } | null {
  const sources = attackSources(world, player);
  if (sources.length === 0) return null;

  let best = -1;
  let bestStrength = Infinity;
  let bestDist = Infinity;
  let bestHq = -1;
  let bestHqDist = Infinity;
  for (const t of storeLive(world.buildings)) {
    if (t.player === player || !isAttackable(t) || !t.occupied) continue;
    const isHq = !isMilitary(t);
    // HQ defenders live in the player's idle reserve, not the garrison, so an
    // HQ is a valid target even with an empty garrison.
    if (!isHq && garrisonCount(t) <= 0) continue;
    // Reachable if any surplus source has a foot path within the run limit.
    let dist = Infinity;
    for (const s of sources) {
      const path = findWalkPath(world, geom, rules, s.node, t.node);
      if (path && path.length <= MILITARY_ATTACK.maxRunDistance) {
        dist = Math.min(dist, path.length);
      }
    }
    if (dist === Infinity) continue;
    if (isHq) {
      if (dist < bestHqDist || (dist === bestHqDist && (bestHq < 0 || t.id < bestHq))) {
        bestHq = t.id;
        bestHqDist = dist;
      }
      continue;
    }
    const strength = garrisonStrength(t);
    if (
      strength < bestStrength ||
      (strength === bestStrength &&
        (dist < bestDist || (dist === bestDist && (best < 0 || t.id < best))))
    ) {
      best = t.id;
      bestStrength = strength;
      bestDist = dist;
    }
  }
  if (best < 0) best = bestHq;
  if (best < 0) return null;

  // Commit the total surplus (leave one keeper per source), at least one.
  let avail = 0;
  for (const s of sources) avail += Math.max(0, garrisonCount(s) - 1);
  return { targetBuildingId: best, soldiers: Math.max(1, avail) };
}

/**
 * Coin doctrine: concentrate promotion at the frontline. Enable coin delivery on
 * the occupied military building nearest the enemy, disable it on the rest, so
 * scarce coins raise the ranks that will actually fight. Returns only the toggles
 * that change state (tracked in `state.coinsSet` to avoid re-issuing every cycle).
 */
export function planCoins(
  world: World,
  geom: Geometry,
  state: AiState,
  enemyNode: number,
): CommandInput[] {
  const player = state.playerId;
  if (enemyNode < 0) return [];
  const mine: Building[] = [];
  for (const b of storeLive(world.buildings)) {
    if (b.player === player && isMilitary(b) && b.occupied) mine.push(b);
  }
  if (mine.length === 0) return [];
  // Frontline = nearest to the enemy (lowest id tie-break).
  let front = mine[0];
  let frontDist = geom.distance(front.node, enemyNode);
  for (const b of mine) {
    const d = geom.distance(b.node, enemyNode);
    if (d < frontDist || (d === frontDist && b.id < front.id)) {
      front = b;
      frontDist = d;
    }
  }
  const commands: CommandInput[] = [];
  for (const b of mine) {
    const want = b.id === front.id;
    if (state.coinsSet[b.id] === want && b.coinsEnabled === want) continue;
    if (b.coinsEnabled !== want) {
      commands.push({ player, type: 'toggleCoins', buildingId: b.id, enabled: want });
    }
    state.coinsSet[b.id] = want;
  }
  return commands;
}
