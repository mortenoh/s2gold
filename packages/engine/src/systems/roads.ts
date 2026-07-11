/**
 * Road teardown shared by the command layer (flag/road demolition, road
 * splitting) and the military system (building capture). Removing a road must
 * release its carrier and donkey without leaking the ware they may be carrying.
 */

import { FLAG_WARE_CAPACITY } from '../constants';
import { storeFree, storeLive, type Road, type World } from '../world';

/**
 * Release a road's serving carrier back to the free list. A carrier caught
 * mid-carry still holds a live ware token (loc==='carried', locId===carrierId);
 * re-home it onto the first of `dropFlags` with a free slot so dispatch re-routes
 * it, or free the token when every candidate flag is full. Otherwise the token
 * leaks and its targetBuildingId permanently inflates dispatch's en-route count.
 */
export function freeCarrier(world: World, carrierId: number, dropFlags: number[]): void {
  const carrier = world.settlers.items[carrierId];
  if (!carrier) return;
  if (carrier.carryingWareId >= 0) {
    const ware = world.wares.items[carrier.carryingWareId];
    if (ware) {
      const flag = dropFlags
        .map((fid) => (fid >= 0 ? world.flags.items[fid] : null))
        .find((f) => f && f.wares.length < FLAG_WARE_CAPACITY);
      if (flag) {
        ware.loc = 'flag';
        ware.locId = flag.id;
        ware.nextFlag = -1; // dispatch recomputes from the new flag
        flag.wares.push(ware.id);
      } else {
        storeFree(world.wares, carrier.carryingWareId);
      }
    }
    carrier.carryingWareId = -1;
  }
  world.settlers.items[carrierId] = null;
  world.settlers.free.push(carrierId);
}

/**
 * Release an upgraded road's pack donkey when the road is destroyed: re-home any
 * carried ware (like {@link freeCarrier}) and return the donkey to the player's
 * bred-donkey pool so it can serve a future donkey road. Clears road.donkeyId.
 */
export function freeDonkey(world: World, road: Road, dropFlags: number[]): void {
  const donkeyId = road.donkeyId;
  if (donkeyId < 0) return;
  freeCarrier(world, donkeyId, dropFlags);
  road.donkeyId = -1;
  const pl = world.players[road.player];
  if (pl) pl.donkeys++;
}

/**
 * Remove one road, releasing its carrier and donkey. Any carried ware re-homes
 * onto the first of `dropFlags` with room (typically the road's own endpoints).
 */
export function removeRoad(world: World, road: Road, dropFlags: number[]): void {
  if (road.carrierId >= 0) freeCarrier(world, road.carrierId, dropFlags);
  if (road.donkeyId >= 0) freeDonkey(world, road, dropFlags);
  storeFree(world.roads, road.id);
}

/**
 * Cut every road anchored at `flagId` that does NOT belong to `keepPlayer`.
 * Used when a flag changes hands (building capture): the previous owner's
 * roads must not keep feeding wares to the new owner's flag. Carried wares
 * re-home onto each road's surviving far flag.
 */
export function removeForeignRoadsAtFlag(world: World, flagId: number, keepPlayer: number): void {
  for (const road of [...storeLive(world.roads)]) {
    if (road.flagA !== flagId && road.flagB !== flagId) continue;
    if (road.player === keepPlayer) continue;
    const farFlag = road.flagA === flagId ? road.flagB : road.flagA;
    removeRoad(world, road, [farFlag]);
  }
}
