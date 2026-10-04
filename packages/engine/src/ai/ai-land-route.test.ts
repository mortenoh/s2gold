import { planSeafaring } from './seafaring';
import { existsSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import {
  createWorld,
  worldGeometry,
  GREENLAND_RULES,
  createAiState,
  stepAi,
  runAi,
  tickWorld,
  applyCommand,
  rulesForLandscape,
  type MapJson,
} from '../index';
import { makeFlatMap, encodeBase64, makeExpansionIslandMap } from '../harness';
import { approachDistances, ownedNodeNearest, pickBuildSite } from './sites';

it('expands along land when the torus shortcut to the enemy crosses an ocean', () => {
  const map = makeFlatMap(64, 64, 20, 12, [{ x: 20, y: 50 }]);
  const terrain = new Array<number>(64 * 64).fill(8);
  for (let y = 0; y < 64; y++)
    if (y < 5 || y > 59) for (let x = 0; x < 64; x++) terrain[y * 64 + x] = 5;
  map.layers.texture1 = map.layers.texture2 = encodeBase64(terrain);
  const world = createWorld(map, { seed: 1, players: 2 });
  const geom = worldGeometry(world);
  const enemy = geom.index(20, 12);
  const hq = geom.index(20, 50);
  const center = ownedNodeNearest(world, geom, 1, enemy, GREENLAND_RULES);
  const node = pickBuildSite(
    world,
    geom,
    GREENLAND_RULES,
    1,
    'guardhouse',
    { kind: 'frontier', enemyNode: enemy },
    center,
    24,
    14,
  );
  expect(node).toBeGreaterThanOrEqual(0);
  expect(Math.floor(node / 64)).toBeLessThan(50);
  const distances = approachDistances(world, geom, GREENLAND_RULES, enemy);
  expect(distances[node]).toBeLessThan(distances[hq]);
});

it('coastal expansion respects the configured military cap', () => {
  const world = createWorld(makeExpansionIslandMap(), { seed: 1, players: 1 });
  const geom = worldGeometry(world);
  const normal = planSeafaring(world, geom, GREENLAND_RULES, createAiState(0));
  expect(normal?.type).toBe('placeBuilding');
  const capped = planSeafaring(world, geom, GREENLAND_RULES, createAiState(0, { maxMilitary: 0 }));
  expect(capped).toBeNull();
});

const CHAPTER_II = new URL('../../../app/public/assets/maps/maps_miss201.json', import.meta.url);
it.skipIf(!existsSync(CHAPTER_II))(
  'chapter II AI reaches and attacks the passive human over land',
  () => {
    const map = JSON.parse(readFileSync(CHAPTER_II, 'utf8')) as MapJson;
    const world = createWorld(map, { seed: 11, players: map.players });
    const human = createAiState(0, { seed: 99, maxMilitary: 2 });
    const ai = createAiState(1, { seed: 1235 });
    const rules = rulesForLandscape(map.terrain ?? 0);
    let attacked = false;
    for (let i = 0; i < 30000 && !attacked; i++) {
      for (const c of stepAi(world, human, rules).commands)
        if (c.type !== 'attack') applyCommand(world, c);
      runAi(world, ai, rules);
      for (const e of tickWorld(world, rules))
        if (e.type === 'FightStarted' && e.defenderPlayer === 0) attacked = true;
    }
    expect(attacked).toBe(true);
  },
  60000,
);
