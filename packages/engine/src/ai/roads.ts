/**
 * Road maintenance for the AI: keep every building wired to the HQ warehouse.
 *
 * A building whose door flag has no path over the road graph back to the HQ flag
 * cannot receive construction material or ship its output, so each decision cycle
 * the AI lays one road from each such flag to the nearest already-connected flag
 * (the HQ flag, or a flag that transitively reaches it). Roads are laid over the
 * walkable terrain path (reusing {@link findWalkPath}); the command layer rejects
 * any that would cross another flag/building, and the AI simply retries against
 * the next-nearest connected flag next cycle, giving up (and demolishing the
 * stranded stub) after a few attempts so it never loops forever.
 */

import type { CommandInput } from '../commands';
import { buildingDef } from '../constants';
import type { Geometry } from '../geometry';
import { buildFlagGraph, findWalkPath } from '../pathfinding';
import type { TerrainRules } from '../terrain';
import { storeLive, type Building, type World } from '../world';
import type { AiState } from './types';

/** Give up connecting a flag after this many distinct attempts. */
export const MAX_ROAD_ATTEMPTS = 5;

/** Flag ids of `player` that reach the HQ flag over the road graph (incl. the HQ flag). */
export function flagsConnectedToHq(world: World, player: number): Set<number> {
  const connected = new Set<number>();
  const p = world.players[player];
  if (!p || p.hqBuildingId < 0) return connected;
  const hq = world.buildings.items[p.hqBuildingId];
  if (!hq) return connected;
  const graph = buildFlagGraph(world, player);
  const start = hq.flagId;
  const stack = [start];
  connected.add(start);
  while (stack.length > 0) {
    const cur = stack.pop() as number;
    for (const edge of graph.adj.get(cur) ?? []) {
      if (!connected.has(edge.flag)) {
        connected.add(edge.flag);
        stack.push(edge.flag);
      }
    }
  }
  return connected;
}

/** Non-HQ buildings of `player` whose flag is not connected to the HQ. */
export function unconnectedBuildings(
  world: World,
  player: number,
  connected: Set<number>,
): Building[] {
  const out: Building[] = [];
  for (const b of storeLive(world.buildings)) {
    if (b.player !== player) continue;
    if (buildingDef(b.type)?.kind === 'hq') continue;
    if (b.flagId < 0) continue;
    if (!connected.has(b.flagId)) out.push(b);
  }
  out.sort((a, b) => a.id - b.id);
  return out;
}

/** Number of unconnected non-HQ buildings of `player`. */
export function countUnconnected(world: World, player: number): number {
  return unconnectedBuildings(world, player, flagsConnectedToHq(world, player)).length;
}

/**
 * Plan road/demolish commands to (re)connect stranded buildings for this cycle.
 * Mutates `state.roadAttempts` to remember progress and self-heal.
 */
export function planRoads(
  world: World,
  geom: Geometry,
  rules: TerrainRules,
  state: AiState,
): CommandInput[] {
  const player = state.playerId;
  const connected = flagsConnectedToHq(world, player);
  const stranded = unconnectedBuildings(world, player, connected);

  // Reset the per-flag attempt counter for any flag that no longer needs a road:
  // it has (re)connected to the HQ, or its stranded building is gone. Otherwise a
  // maxed-out counter lingers on a reused door-flag id (execPlaceBuilding reuses
  // an orphan door flag left by demolish) and demolishes the replacement before a
  // single fresh attempt, and a building that reconnects then is later severed
  // would re-enter already over budget.
  const strandedFlags = new Set(stranded.map((b) => b.flagId));
  for (const key of Object.keys(state.roadAttempts)) {
    if (!strandedFlags.has(Number(key))) delete state.roadAttempts[Number(key)];
  }

  if (stranded.length === 0) return [];

  // Connected flag nodes to aim roads at (sorted per-building by distance).
  const connectedNodes: number[] = [];
  for (const f of storeLive(world.flags)) {
    if (f.player === player && connected.has(f.id)) connectedNodes.push(f.node);
  }
  if (connectedNodes.length === 0) return [];

  const commands: CommandInput[] = [];
  for (const b of stranded) {
    const flag = world.flags.items[b.flagId];
    if (!flag) continue;
    const attempts = state.roadAttempts[b.flagId] ?? 0;
    if (attempts >= MAX_ROAD_ATTEMPTS) {
      // Stranded for good: demolish the stub so the plan can retry elsewhere.
      // Clear the counter so a rebuild reusing this door flag id starts fresh.
      commands.push({ player, type: 'demolish', node: b.node });
      delete state.roadAttempts[b.flagId];
      continue;
    }
    const targets = connectedNodes
      .slice()
      .sort((x, y) => geom.distance(flag.node, x) - geom.distance(flag.node, y) || x - y);
    const target = targets[attempts % targets.length];
    state.roadAttempts[b.flagId] = attempts + 1;
    if (target === flag.node) continue;
    // blockFlags: route around interior flags so the planned road is one that
    // execBuildRoad will accept (it rejects any road crossing another flag); the
    // start and target flag nodes themselves stay valid path endpoints.
    // ownedBy(player): keep every node inside our own territory — execBuildRoad
    // now rejects a road that dips through neutral or enemy land, so a shortcut
    // across it would only burn a road attempt (and eventually demolish a
    // connectable building). Confining the search yields a legal all-owned detour.
    const walk = findWalkPath(world, geom, rules, flag.node, target, true, player);
    if (!walk || walk.length === 0) continue;
    commands.push({ player, type: 'buildRoad', path: [flag.node, ...walk] });
  }
  return commands;
}
