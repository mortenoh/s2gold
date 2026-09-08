/**
 * AI tool doctrine: point the metalworks at the tools idle buildings are
 * waiting for. The HQ starts with two pick-axes, so the third mine (and every
 * smelter without a crucible, forester without a shovel, ...) sits unstaffed
 * until a tool arrives; a metalworks cycling evenly through twelve tools takes
 * ages to make the right one. Each cycle the AI lists the tools its unstaffed
 * buildings need and puts them at the head of the cycle list.
 */

import { buildingDef, JOB_TOOL, TOOL_WARES, type WareType } from '../constants';
import type { CommandInput } from '../commands';
import { storeLive, warehouseTotals, type World } from '../world';

/** The tool-priority command for this cycle, or null when nothing changes. */
export function planTools(world: World, player: number): CommandInput | null {
  const pl = world.players[player];
  if (!pl) return null;
  const stock = warehouseTotals(world, player);
  const needed = new Set<WareType>();
  for (const b of storeLive(world.buildings)) {
    if (b.player !== player || b.state !== 'working' || b.staffed) continue;
    const job = buildingDef(b.type)?.worker;
    const tool = job ? JOB_TOOL[job] : null;
    if (tool && (stock[tool] ?? 0) <= 0) needed.add(tool);
  }
  const wanted: WareType[] = [];
  // Needed tools first (twice, so they dominate the cycle), then the rest.
  for (const t of [...needed].sort()) wanted.push(t, t);
  for (const t of TOOL_WARES) wanted.push(t);
  if (sameList(wanted, pl.toolPriority)) return null;
  return { player, type: 'setToolPriority', tools: wanted };
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
