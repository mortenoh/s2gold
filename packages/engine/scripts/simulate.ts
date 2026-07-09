/**
 * Tiny CLI harness that runs the P2 demo economy and prints a tick-by-tick
 * summary for manual inspection.
 *
 * Run with a TypeScript runner if available, e.g.:
 *   pnpm --filter engine exec tsx scripts/simulate.ts [ticks] [everyN]
 *   node --import tsx packages/engine/scripts/simulate.ts
 *
 * If no TS runner is installed, the same routine is exercised (and its output
 * shown) by src/simulate.example.test.ts under `pnpm --filter engine test`.
 * Falls back to a synthetic flat map when the converted MISS200 map is absent.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tickWorld, type MapJson } from '../src/index';
import { makeFlatMap, setupDemoWorld, worldSummary } from '../src/harness';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const MAP_PATH = resolve(HERE, '../../app/public/assets/maps/maps_miss200.json');

function loadMap(): MapJson {
  try {
    return JSON.parse(readFileSync(MAP_PATH, 'utf8')) as MapJson;
  } catch {
    console.log('(MISS200 map not found — using a synthetic flat map)');
    return makeFlatMap(48, 48, 20, 20);
  }
}

/** Run the demo, invoking `report` with each summary line. */
export function runSimulation(ticks: number, everyN: number, report: (line: string) => void): void {
  const map = loadMap();
  const { world, layout } = setupDemoWorld(map, 2024);
  report(`layout: woodcutter@${layout.woodcutter} sawmill@${layout.sawmill} quarry@${layout.quarry}`);
  report(worldSummary(world));
  for (let i = 1; i <= ticks; i++) {
    tickWorld(world);
    if (i % everyN === 0) report(worldSummary(world));
  }
}

// Execute when run directly (not when imported by the example test).
const invokedDirectly =
  typeof process !== 'undefined' && process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  const ticks = Number(process.argv[2] ?? 2000);
  const everyN = Number(process.argv[3] ?? 100);
  runSimulation(ticks, everyN, (line) => console.log(line));
}
