/** Why does an AI seat never build? Prints the planner's view of one player. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAiState, runAi } from '../src/ai/index';
import { canPlaceBuilding } from '../src/commands';
import {
  createWorld,
  rulesForLandscape,
  tickWorld,
  worldGeometry,
  type MapJson,
} from '../src/index';
import { hqNodeOf } from '../src/ai/sites';
import { storeLive } from '../src/world';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const mapName = process.argv[2] ?? 'maps3_omap10';
const who = Number(process.argv[3] ?? 3);
const map = JSON.parse(
  readFileSync(resolve(HERE, `../../app/public/assets/maps/${mapName}.json`), 'utf8'),
) as MapJson;
const world = createWorld(map, { seed: 7, players: map.players });
const rules = rulesForLandscape(map.terrain ?? 0);
const geom = worldGeometry(world);
const ais = [];
for (let p = 1; p < world.players.length; p++) ais.push(createAiState(p, { seed: 1234 }));
for (let i = 0; i < 1500; i++) {
  for (const ai of ais) runAi(world, ai, rules);
  tickWorld(world);
}
const hq = hqNodeOf(world, who);
console.log(
  'player',
  who,
  'hq',
  hq,
  geom.x(hq),
  geom.y(hq),
  'buildings',
  storeLive(world.buildings).filter((b) => b.player === who).length,
  'flags',
  storeLive(world.flags).filter((f) => f.player === who).length,
);
let owned = 0;
for (let n = 0; n < geom.size; n++)
  if ((world.owner[n] & 0x0f) === who + 1 || world.owner[n] === who + 1) owned++;
console.log('owned nodes (raw owner==who+1):', owned);
const counts: Record<string, number> = {};
for (const type of ['woodcutter', 'sawmill', 'quarry', 'guardhouse', 'barracks', 'farm'] as const) {
  let n = 0;
  geom.forEachNodeWithin(hq, 16, (node) => {
    if (geom.distance(hq, node) <= 16 && canPlaceBuilding(world, geom, rules, node, type, who)) n++;
  });
  counts[type] = n;
}
console.log('placeable within 16:', counts);
const t1 = new Set<number>();
let water = 0;
geom.forEachNodeWithin(hq, 9, (node) => {
  t1.add(world.terrain1[node]);
  if ((world.terrain1[node] & 0x3f) === 5) water++;
});
console.log(
  'terrain1 ids within 9:',
  [...t1]
    .map((v) => v.toString(16))
    .sort()
    .join(' '),
);
// Stage probe: which planner stage rejects everything?
import { planNextBuilding } from '../src/ai/planner';
import { pickBuildSite, siteRoadDistance, playerFlagNodes } from '../src/ai/sites';
import { findWalkPath } from '../src/pathfinding';
const st = ais.find((a) => a.playerId === who)!;
console.log('planNextBuilding:', planNextBuilding(world, geom, rules, st));
console.log('maxRoadLength', st.maxRoadLength, 'flags', playerFlagNodes(world, who));
const hqFlag = playerFlagNodes(world, who)[0];
let cands = 0,
  roadOk = 0,
  walkOk = 0;
geom.forEachNodeWithin(hq, 16, (node) => {
  if (geom.distance(hq, node) > 16 || !canPlaceBuilding(world, geom, rules, node, 'sawmill', who))
    return;
  cands++;
  const door = geom.neighbour(node, 'SE');
  if (findWalkPath(world, geom, rules, door, hqFlag) !== null) walkOk++;
  if (siteRoadDistance(world, geom, rules, who, node, st.maxRoadLength) >= 0) roadOk++;
});
console.log({
  cands,
  walkOk,
  roadOk,
  sawmillPick: pickBuildSite(
    world,
    geom,
    rules,
    who,
    'sawmill',
    { kind: 'nearHq' },
    hq,
    16,
    st.maxRoadLength,
  ),
});
console.log(
  'hq flag node',
  hqFlag,
  'walkable from hq flag to itself neighbours:',
  geom.neighbours(hqFlag).map((n) => findWalkPath(world, geom, rules, hqFlag, n) !== null),
);
import { hqNodeOf as hqOf } from '../src/ai/sites';
import { terrainId } from '../src/terrain';
for (let p = 0; p < world.players.length; p++) {
  const h = hqOf(world, p);
  if (h < 0) continue;
  const flag = geom.neighbour(h, 'SE');
  const walk = geom
    .neighbours(flag)
    .filter((n) => findWalkPath(world, geom, rules, flag, n) !== null).length;
  const t = (n: number) =>
    `${terrainId(world.terrain1[n]).toString(16)}/${terrainId(world.terrain2[n]).toString(16)}`;
  console.log(
    `P${p} hq=${geom.x(h)},${geom.y(h)} flag=${flag} walkableNb=${walk} flagT=${t(flag)} nb=[${geom.neighbours(flag).map(t).join(' ')}] rulesWalk=${geom
      .neighbours(flag)
      .map((n) => rules.walkable?.(world.terrain1[n]) ?? '?')
      .join(',')}`,
  );
}
