/**
 * New-settler recruitment (CONSTANTS.md §7).
 *
 * Civilian jobs are created from a Helper plus the job's tool ware
 * (`Helper + tool -> worker`); jobs with no tool need only a Helper. The engine
 * models the Helper pool as `player.workers[carrier]`, and tools as HQ ware
 * stock. Metalworks replenishes tools, which lets recruitment continue once the
 * starting tool stock runs out.
 */

import { JOB, JOB_TOOL, type JobType } from '../constants';
import type { EventSink } from '../events';
import type { Player, World } from '../world';

/**
 * Ensure the player has at least one idle worker of `job` available, recruiting
 * one from a Helper (+ the job's tool) if the pool is empty. Returns true when a
 * worker is (now) available. The Helper itself (`carrier`) is never recruited.
 */
export function ensureWorkerAvailable(
  _world: World,
  events: EventSink,
  player: Player,
  job: JobType,
): boolean {
  if ((player.workers[job] ?? 0) > 0) return true;
  if (job === JOB.carrier) return false; // Helper pool is not recruited from itself
  const tool = JOB_TOOL[job] ?? null;
  if ((player.workers[JOB.carrier] ?? 0) <= 0) return false; // need a Helper
  if (tool !== null && (player.wares[tool] ?? 0) <= 0) return false; // need the tool
  player.workers[JOB.carrier]--;
  if (tool !== null) player.wares[tool]--;
  player.workers[job] = (player.workers[job] ?? 0) + 1;
  events.emit({ type: 'SettlerRecruited', job, tool, player: player.index });
  return true;
}
