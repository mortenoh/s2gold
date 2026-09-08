/** Why do the AI seats on a map stall? Per-player building/site/connection summary. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAiState, runAi } from '../src/ai/index';
import { countUnconnected } from '../src/ai/roads';
import {
  createWorld,
  rulesForLandscape,
  tickWorld,
  warehouseTotals,
  worldGeometry,
  type MapJson,
} from '../src/index';
import { storeLive } from '../src/world';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const mapName = process.argv[2] ?? 'maps_miss202';
const ticks = Number(process.argv[3] ?? 6000);
const map = JSON.parse(
  readFileSync(resolve(HERE, `../../app/public/assets/maps/${mapName}.json`), 'utf8'),
) as MapJson;
const world = createWorld(map, { seed: 7, players: map.players });
const rules = rulesForLandscape(map.terrain ?? 0);
const geom = worldGeometry(world);
const ais = [];
for (let p = 1; p < world.players.length; p++) ais.push(createAiState(p, { seed: 1234 }));
const produced: Record<string, number> = {};
let recruited = 0;
for (let i = 0; i < ticks; i++) {
  for (const ai of ais) runAi(world, ai, rules);
  for (const e of tickWorld(world)) {
    if (e.type === 'WareProduced' && e.player === 1)
      produced[e.wareType] = (produced[e.wareType] ?? 0) + 1;
    if (e.type === 'SoldierRecruited' && e.player === 1) recruited++;
  }
}
console.log('P1 produced:', JSON.stringify(produced), 'recruited:', recruited);
for (let p = 0; p < world.players.length; p++) {
  const mine = storeLive(world.buildings).filter((b) => b.player === p);
  const summary = mine
    .map(
      (b) =>
        `${b.type}${b.state === 'site' ? `(site ${b.deliveredBoards}/${b.needBoards}b ${b.deliveredStones}/${b.needStones}s)` : b.staffed ? '' : '(unstaffed)'}`,
    )
    .join(', ');
  const w = warehouseTotals(world, p);
  console.log(
    `P${p}: stone=${w.stone} plank=${w.plank} beer=${w.beer} sword=${w.sword} shield=${w.shield} iron=${w.iron} coal=${w.coal} ore=${w.ironore} grain=${w.grain} water=${w.water} bread=${w.bread} meat=${w.meat} fish=${w.fish} ${mine.length} buildings, unconnected=${countUnconnected(world, p)}, roads=${storeLive(world.roads).filter((r) => r.player === p).length}, helpers=${world.players[p]?.workers.carrier}, soldiers=${world.players[p]?.soldiers.join('/')}`,
  );
  console.log('   ' + summary);
}
// Planner view for the first AI seat: why is nothing placed?
import { planNextBuilding, militaryCount } from '../src/ai/planner';
import { enemyReferenceNode, ownedNodeNearest, pickBuildSite } from '../src/ai/sites';
{
  const st = ais[0]!;
  const p = st.playerId;
  const sites = storeLive(world.buildings)
    .filter((b) => b.player === p && b.state === 'site')
    .map(
      (b) =>
        `${b.type} ${b.deliveredBoards}/${b.needBoards}b ${b.deliveredStones}/${b.needStones}s`,
    );
  const enemy = enemyReferenceNode(world, geom, p);
  const center = ownedNodeNearest(world, geom, p, enemy);
  const pick = pickBuildSite(
    world,
    geom,
    rules,
    p,
    'barracks',
    { kind: 'frontier', enemyNode: enemy },
    center,
    24,
    st.maxRoadLength,
  );
  console.log(
    `P${p} planner: sites=[${sites.join('; ')}] unconnected=${countUnconnected(world, p)} military=${militaryCount(world, p)}/${st.maxMilitary} enemyNode=${enemy} center=${center} barracksPick=${pick} plan=${JSON.stringify(planNextBuilding(world, geom, rules, st))} retry=${JSON.stringify(st.goalRetryTick)}`,
  );
}
