/** Why do the AI seats on a map stall? Per-player building/site/connection summary. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAiState, runAi } from '../src/ai/index';
import { countUnconnected } from '../src/ai/roads';
import { createWorld, rulesForLandscape, tickWorld, worldGeometry, type MapJson } from '../src/index';
import { storeLive } from '../src/world';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const mapName = process.argv[2] ?? 'maps_miss202';
const ticks = Number(process.argv[3] ?? 6000);
const map = JSON.parse(readFileSync(resolve(HERE, `../../app/public/assets/maps/${mapName}.json`), 'utf8')) as MapJson;
const world = createWorld(map, { seed: 7, players: map.players });
const rules = rulesForLandscape(map.terrain ?? 0);
const geom = worldGeometry(world);
const ais = [];
for (let p = 1; p < world.players.length; p++) ais.push(createAiState(p, { seed: 1234 }));
for (let i = 0; i < ticks; i++) { for (const ai of ais) runAi(world, ai, rules); tickWorld(world); }
for (let p = 0; p < world.players.length; p++) {
  const mine = storeLive(world.buildings).filter((b) => b.player === p);
  const summary = mine.map((b) => `${b.type}${b.state === 'site' ? `(site ${b.deliveredBoards}/${b.needBoards}b ${b.deliveredStones}/${b.needStones}s)` : b.staffed ? '' : '(unstaffed)'}`).join(', ');
  console.log(`P${p}: ${mine.length} buildings, unconnected=${countUnconnected(world, p)}, roads=${storeLive(world.roads).filter((r) => r.player === p).length}, helpers=${world.players[p]?.workers.carrier}, soldiers=${world.players[p]?.soldiers.join('/')}`);
  console.log('   ' + summary);
}
