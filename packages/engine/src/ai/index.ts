/**
 * Deterministic computer opponent (P6).
 *
 * The AI is a per-player decision function. It reads world state (and its own
 * private RNG for cadence jitter), and returns normal engine {@link CommandInput}s
 * — it never touches world state except through the command layer, so it can only
 * ever do what a human player could and can never corrupt the tick.
 *
 * Enabling it (the app hook): create one {@link AiState} per computer player and
 * call {@link runAi} once per frame, just before `tickWorld`:
 *
 * ```ts
 * const ai = createAiState(1);              // player 1 is the computer
 * // game loop:
 * runAi(world, ai);                          // issues this frame's AI commands
 * tickWorld(world);                          // commands execute at tick start
 * ```
 *
 * `runAi` applies the commands; {@link stepAi} is the underlying pure step
 * (returns the commands without applying them) for tests and alternative wiring.
 *
 * Determinism: `AiState` is seeded independently of the world RNG and evolves only
 * from world state + that seed, so two AI-enabled runs of the same map + seed
 * produce byte-identical command streams and identical world hashes.
 */

import { applyCommand, type CommandInput } from '../commands';
import { Geometry } from '../geometry';
import { nextRange, seedRng } from '../rng';
import { GREENLAND_RULES, type TerrainRules } from '../terrain';
import { buildingDef } from '../constants';
import { storeLive, type World } from '../world';
import { planCoins, pickAttackTarget } from './military';
import { planNextBuilding } from './planner';
import { countUnconnected, planRoads } from './roads';
import { planTools } from './tools';
import { planSeafaring } from './seafaring';
import { enemyReferenceNode, mineExhausted } from './sites';
import type { AiOptions, AiState } from './types';

export type { AiOptions, AiState } from './types';
export { pickBuildSite, enemyReferenceNode, hqNodeOf } from './sites';
export type { SiteBias } from './sites';
export { pickAttackTarget, planCoins } from './military';
export { planNextBuilding, militaryCount } from './planner';
export { planRoads, flagsConnectedToHq, unconnectedBuildings, countUnconnected } from './roads';
export { planSeafaring } from './seafaring';

/** Default base cadence (ticks) between AI decision cycles. */
const DEFAULT_INTERVAL = 12;
/** Default road-length budget (lattice steps) per connection. */
const DEFAULT_MAX_ROAD = 14;
/** Default cap on frontier military buildings. */
/**
 * Military building cap. The original AI keeps pushing its border until it
 * meets a rival, so the cap is generous: at 4 (the old value) the computer
 * stopped after a ring of guardhouses and never reached anyone on maps larger
 * than a starter island, so fights rarely happened.
 */
const DEFAULT_MAX_MILITARY = 20;
/** Max concurrent construction sites the AI keeps open (throttles material spend). */
const MAX_CONCURRENT_SITES = 2;
/** Default independent RNG seed base (mixed with playerId). */
const DEFAULT_SEED = 0x5e77;

/** Count non-HQ construction sites currently owned by `player`. */
function mySiteCount(world: World, player: number): number {
  let n = 0;
  for (const b of storeLive(world.buildings)) {
    if (b.player !== player || b.state !== 'site') continue;
    if (buildingDef(b.type)?.kind === 'hq') continue;
    n++;
  }
  return n;
}

/** Create fresh AI state for `playerId`. Deterministic from `options.seed`. */
export function createAiState(playerId: number, options: AiOptions = {}): AiState {
  const seed = (options.seed ?? DEFAULT_SEED) >>> 0;
  return {
    playerId,
    rng: seedRng(seed, playerId + 1),
    decideInterval: Math.max(1, options.decideInterval ?? DEFAULT_INTERVAL),
    nextDecisionTick: 0,
    maxRoadLength: Math.max(1, options.maxRoadLength ?? DEFAULT_MAX_ROAD),
    maxMilitary: Math.max(0, options.maxMilitary ?? DEFAULT_MAX_MILITARY),
    roadAttempts: {},
    goalRetryTick: {},
    coinsSet: {},
  };
}

/**
 * Pure AI step: compute this cycle's commands from world state (does not mutate
 * the world). Returns the (possibly empty) command list and the evolved state.
 * A cycle only fires every `decideInterval` (+ jitter) ticks.
 */
export function stepAi(
  world: World,
  state: AiState,
  rules: TerrainRules = GREENLAND_RULES,
): { commands: CommandInput[]; state: AiState } {
  const commands: CommandInput[] = [];
  const player = world.players[state.playerId];
  if (!player || player.hqBuildingId < 0) return { commands, state };
  if (world.tick < state.nextDecisionTick) return { commands, state };
  state.nextDecisionTick =
    world.tick + state.decideInterval + nextRange(state.rng, state.decideInterval);

  const geom = new Geometry(world.width, world.height);

  // 1. Road maintenance: reconnect any stranded building (bounded, self-healing).
  for (const c of planRoads(world, geom, rules, state)) commands.push(c);
  // 1a. Exhausted mines are razed so the plan raises a fresh one on ore that
  //     is still there (a human would do the same; a dead mine otherwise
  //     satisfies its plan goal forever). One per cycle keeps this cheap.
  for (const b of storeLive(world.buildings)) {
    if (b.player === state.playerId && mineExhausted(world, geom, b)) {
      commands.push({ player: state.playerId, type: 'demolish', node: b.node });
      break;
    }
  }
  // 1b. Tools: aim the metalworks at what idle buildings are waiting for.
  const tools = planTools(world, state.playerId);
  if (tools) commands.push(tools);

  // 2. Construction: place the next planned building, but only when construction
  //    is not backed up — cap concurrent sites so the HQ's finite board/stone
  //    stock (and the sawmill's plank output) can actually finish buildings
  //    instead of being spread thin across dozens of starving sites; and keep the
  //    road network ahead of the buildings.
  const sites = mySiteCount(world, player.index);
  if (sites < MAX_CONCURRENT_SITES && countUnconnected(world, player.index) <= 1) {
    const build = planNextBuilding(world, geom, rules, state);
    if (build) {
      commands.push(build);
    } else {
      // Land expansion is exhausted this cycle (no military/economy site is
      // road-connectable within budget): try to grow over water instead. Gated
      // by the same construction throttle so a founded harbor/shipyard counts as
      // this cycle's one placement, and only when the land planner yields — so
      // seafaring is a strict fallback, never competing with land growth.
      const sea = planSeafaring(world, geom, rules, state);
      if (sea) commands.push(sea);
    }
  }

  // 3. Military: frontline coin doctrine, then attack the weakest reachable enemy.
  const enemyNode = enemyReferenceNode(world, geom, state.playerId);
  for (const c of planCoins(world, geom, state, enemyNode)) commands.push(c);
  const attack = pickAttackTarget(world, geom, rules, state.playerId);
  if (attack) {
    commands.push({
      player: state.playerId,
      type: 'attack',
      targetBuildingId: attack.targetBuildingId,
      soldiers: attack.soldiers,
    });
  }

  return { commands, state };
}

/**
 * Convenience wiring: run one AI step and apply its commands to the world
 * (validated by the command layer). Returns the issued commands. Call once per
 * frame before `tickWorld`.
 */
export function runAi(
  world: World,
  state: AiState,
  rules: TerrainRules = GREENLAND_RULES,
): CommandInput[] {
  const { commands } = stepAi(world, state, rules);
  for (const c of commands) applyCommand(world, c);
  return commands;
}
