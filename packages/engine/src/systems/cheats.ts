/**
 * Free-play cheats. With `Player.cheatUnlimited` set, every tick tops the
 * player's stocks up to a floor: each ware in every working warehouse-class
 * building (HQ, storehouses, harbors), the Helper pool, idle privates and
 * donkeys. Nothing is ever taken away, so turning the cheat off just lets
 * the economy drain the surplus naturally. Deterministic (no RNG).
 */

import { JOB, WARE_TYPES } from '../constants';
import { isWarehouseBuilding, storeLive, type World } from '../world';

/** Stock floor per ware and per pool while the cheat is on. */
export const CHEAT_STOCK_FLOOR = 99;
export const CHEAT_HELPER_FLOOR = 99;
export const CHEAT_SOLDIER_FLOOR = 30;
export const CHEAT_DONKEY_FLOOR = 20;

export function runCheats(world: World): void {
  for (const player of world.players) {
    if (!player?.cheatUnlimited) continue;
    for (const b of storeLive(world.buildings)) {
      if (b.player !== player.index || b.state !== 'working' || !isWarehouseBuilding(b)) continue;
      for (const w of WARE_TYPES) {
        if ((b.wareStock[w] ?? 0) < CHEAT_STOCK_FLOOR) b.wareStock[w] = CHEAT_STOCK_FLOOR;
      }
    }
    if (player.workers[JOB.carrier] < CHEAT_HELPER_FLOOR)
      player.workers[JOB.carrier] = CHEAT_HELPER_FLOOR;
    if ((player.soldiers[0] ?? 0) < CHEAT_SOLDIER_FLOOR) player.soldiers[0] = CHEAT_SOLDIER_FLOOR;
    if (player.donkeys < CHEAT_DONKEY_FLOOR) player.donkeys = CHEAT_DONKEY_FLOOR;
  }
}
