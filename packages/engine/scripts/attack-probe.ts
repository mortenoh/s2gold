/** In the duel setup, why does the AI not attack the human? Source/target reachability dump. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAiState, stepAi } from '../src/ai/index';
import { applyCommand } from '../src/commands';
import { buildingDef, MILITARY_ATTACK } from '../src/constants';
import {
  createWorld,
  rulesForLandscape,
  tickWorld,
  worldGeometry,
  type MapJson,
} from '../src/index';
import { findWalkPath } from '../src/pathfinding';
import { garrisonCount } from '../src/systems/military';
import { storeLive } from '../src/world';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const mapName = process.argv[2] ?? 'maps_miss201';
const ticks = Number(process.argv[3] ?? 60000);
const map = JSON.parse(
  readFileSync(resolve(HERE, `../../app/public/assets/maps/${mapName}.json`), 'utf8'),
) as MapJson;
const world = createWorld(map, { seed: 11, players: map.players });
const rules = rulesForLandscape(map.terrain ?? 0);
const geom = worldGeometry(world);
const human = createAiState(0, { seed: 99, maxMilitary: 2 });
const ais = [];
for (let p = 1; p < world.players.length; p++) ais.push(createAiState(p, { seed: 1234 + p }));
for (let i = 0; i < ticks; i++) {
  for (const c of stepAi(world, human, rules).commands)
    if (c.type !== 'attack') applyCommand(world, c);
  for (const ai of ais) for (const c of stepAi(world, ai, rules).commands) applyCommand(world, c);
  tickWorld(world, rules);
}
const mil = (p: number) =>
  storeLive(world.buildings).filter(
    (b) => b.player === p && buildingDef(b.type)?.kind === 'military' && b.occupied,
  );
const humanTargets = storeLive(world.buildings).filter(
  (b) =>
    b.player === 0 &&
    (buildingDef(b.type)?.kind === 'military' || buildingDef(b.type)?.kind === 'hq') &&
    b.occupied,
);
for (const ai of ais) {
  const sources = mil(ai.playerId).filter((b) => garrisonCount(b) > 1);
  console.log(
    `AI P${ai.playerId}: occupied military=${mil(ai.playerId).length} with surplus=${sources.length} garrisons=${mil(
      ai.playerId,
    )
      .map((b) => garrisonCount(b))
      .join(',')}`,
  );
  let best = Infinity,
    bestPath = Infinity;
  for (const s of sources)
    for (const t of humanTargets) {
      const d = geom.distance(s.node, t.node);
      if (d < best) best = d;
      if (d <= MILITARY_ATTACK.maxRunDistance) {
        const p = findWalkPath(world, geom, rules, s.node, t.node);
        if (p && p.length < bestPath) bestPath = p.length;
      }
    }
  console.log(
    `  nearest human target: lattice=${best} bestPath=${bestPath} (run limit ${MILITARY_ATTACK.maxRunDistance}); human targets=${humanTargets.length} occupiedHumanMil=${mil(0).length}`,
  );
}
