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

/** Idle Helpers the HQ keeps on hand; drawn on by new roads + worker recruiting. */
const HELPER_BUFFER = 8;
/** Ticks between adding one Helper toward the buffer (HQ population growth). */
const HELPER_GROWTH_TICKS = 40;

/**
 * Population growth: the HQ tops the Helper pool back up to a small buffer over
 * time, so expanding (which spends Helpers on road carriers and new workers)
 * never permanently runs dry — the original keeps producing settlers, and
 * without this a large settlement deadlocks once the fixed starting pool is
 * spent (new roads get no carrier, so the buildings they serve never build).
 */
export function runPopulation(world: World): void {
  if (world.tick % HELPER_GROWTH_TICKS !== 0) return;
  for (const player of world.players) {
    const hq = player.hqBuildingId >= 0 ? world.buildings.items[player.hqBuildingId] : null;
    if (!hq || hq.state !== 'working') continue; // new settlers come from the HQ
    if ((player.workers[JOB.carrier] ?? 0) < HELPER_BUFFER) {
      player.workers[JOB.carrier] = (player.workers[JOB.carrier] ?? 0) + 1;
    }
  }
}

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
