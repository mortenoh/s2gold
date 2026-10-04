/** Boot every installed map, run its AIs, and verify save/replay continuity.
 * bun run packages/engine/scripts/verify-maps.ts [ticks=1000] */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import {
  createWorld,
  createAiState,
  runAi,
  tickWorld,
  rulesForLandscape,
  serializeWorld,
  deserializeWorld,
  hashWorld,
  type MapJson,
  type World,
  type AiState,
} from '../src/index';
const maps = new URL('../../app/public/assets/maps/', import.meta.url);
const index = JSON.parse(readFileSync(new URL('index.json', maps), 'utf8')) as {
  maps: Array<{ name: string }>;
};
const ticks = Number(process.argv[2] ?? 1000);
assert(Number.isInteger(ticks) && ticks > 0);
for (const entry of index.maps) {
  const map = JSON.parse(readFileSync(new URL(`${entry.name}.json`, maps), 'utf8')) as MapJson;
  const world = createWorld(map, { seed: 29, players: map.players });
  const rules = rulesForLandscape(map.terrain ?? 0);
  const ais = world.players.slice(1).map((p) => createAiState(p.index, { seed: 31 }));
  const run = (w: World, states: AiState[], count: number): void => {
    for (let i = 0; i < count; i++) {
      for (const ai of states) runAi(w, ai, rules);
      tickWorld(w, rules);
    }
  };
  run(world, ais, ticks);
  const restored = deserializeWorld(serializeWorld(world));
  const restoredAis = structuredClone(ais);
  run(world, ais, 200);
  run(restored, restoredAis, 200);
  assert.equal(hashWorld(restored), hashWorld(world), `${entry.name}: replay diverged`);
  for (const b of world.buildings.items)
    if (b) {
      assert(
        b.inputStock.every((n) => Number.isInteger(n) && n >= 0),
        `${entry.name}: negative input stock`,
      );
      assert(
        Object.values(b.wareStock).every((n) => Number.isInteger(n) && n >= 0),
        `${entry.name}: negative warehouse stock`,
      );
    }
  for (const animal of world.animals.items)
    if (animal) assert(animal.node >= 0 && animal.node < world.width * world.height);
  console.log(
    `${entry.name}: ${world.tick} ticks, ${world.animals.items.filter(Boolean).length} animals, replay OK`,
  );
}
console.log(`${index.maps.length} maps passed`);
