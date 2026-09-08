/**
 * Headless throughput soak: runs a shipped map with computer opponents in
 * every other seat and prints per-system tick costs, so big-map slowdowns can
 * be attributed. Mirrors tickWorld's system order.
 *
 *   bun run packages/engine/scripts/soak.ts [mapName] [ticks]
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createAiState, runAi } from '../src/ai/index';
import { EventSink } from '../src/events';
import {
  createWorld,
  hashWorld,
  rulesForLandscape,
  worldGeometry,
  type MapJson,
} from '../src/index';
import { runCarriers } from '../src/systems/carriers';
import { runCheats } from '../src/systems/cheats';
import { runConstruction } from '../src/systems/construction';
import { runDispatch } from '../src/systems/dispatch';
import { runGeologists } from '../src/systems/geologist';
import { runMilitary } from '../src/systems/military';
import { runProduction } from '../src/systems/production';
import { runPopulation } from '../src/systems/recruit';
import { runSeafaring } from '../src/systems/seafaring';
import { runDueCommands } from '../src/commands';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const mapName = process.argv[2] ?? 'maps3_omap10';
const ticks = Number(process.argv[3] ?? 3000);
const map = JSON.parse(
  readFileSync(resolve(HERE, `../../app/public/assets/maps/${mapName}.json`), 'utf8'),
) as MapJson;

const world = createWorld(map, { seed: 7, players: map.players });
const rules = rulesForLandscape(map.terrain ?? 0);
const geom = worldGeometry(world);
const ais = [];
for (let p = 1; p < world.players.length; p++) ais.push(createAiState(p, { seed: 1234 }));

const cost: Record<string, number> = {};
const timed = (name: string, fn: () => void): void => {
  const t = performance.now();
  fn();
  cost[name] = (cost[name] ?? 0) + performance.now() - t;
};

let fights = 0,
  captured = 0,
  occupied = 0;
const start = performance.now();
for (let i = 0; i < ticks; i++) {
  timed('ai', () => {
    for (const ai of ais) runAi(world, ai, rules);
  });
  const events = new EventSink();
  timed('commands', () => runDueCommands(world, geom, rules, events));
  timed('cheats', () => runCheats(world));
  timed('population', () => runPopulation(world));
  timed('construction', () => runConstruction(world, geom, events));
  timed('production', () => runProduction(world, geom, rules, events));
  timed('military', () => runMilitary(world, geom, rules, events));
  timed('dispatch', () => runDispatch(world, geom, events));
  timed('carriers', () => runCarriers(world, geom, rules, events));
  timed('geologists', () => runGeologists(world, geom, rules, events));
  timed('seafaring', () => runSeafaring(world, geom, events));
  world.tick++;
  for (const e of events.drain()) {
    if (e.type === 'FightStarted') fights++;
    else if (e.type === 'BuildingCaptured') captured++;
    else if (e.type === 'MilitaryOccupied') occupied++;
  }
  if ((i + 1) % 1000 === 0) {
    const elapsed = performance.now() - start;
    console.log(`tick ${i + 1}: ${((i + 1) / (elapsed / 1000)).toFixed(0)} ticks/s`);
  }
}
const total = performance.now() - start;
let buildings = 0;
for (const b of world.buildings.items) if (b) buildings++;
console.log(
  `${mapName} ${map.width}x${map.height} players=${world.players.length} buildings=${buildings} hash=${hashWorld(world)}`,
);
console.log(`fights=${fights} captured=${captured} militaryOccupied=${occupied}`);
console.log(
  `total ${total.toFixed(0)} ms for ${ticks} ticks = ${(total / ticks).toFixed(3)} ms/tick`,
);
for (const [name, ms] of Object.entries(cost).sort((a, b) => b[1] - a[1])) {
  console.log(
    `  ${name.padEnd(13)} ${ms.toFixed(0).padStart(7)} ms  ${((ms / total) * 100).toFixed(1).padStart(5)}%`,
  );
}
