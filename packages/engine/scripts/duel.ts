/**
 * Headless duel: player 0 is a "passive human" (basic economy, two guardhouses,
 * never attacks) driven through the same command layer a person uses; every
 * other seat is the computer opponent. Prints how the AI treats that human over
 * time: does it expand toward them, attack, capture, and raze the headquarters?
 *
 *   bun run packages/engine/scripts/duel.ts [mapName] [ticks] [humanMaxMilitary]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAiState, stepAi } from '../src/ai/index';
import { applyCommand } from '../src/commands';
import { createWorld, rulesForLandscape, tickWorld, type MapJson } from '../src/index';
import { buildingDef } from '../src/constants';
import { storeLive } from '../src/world';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const mapName = process.argv[2] ?? 'maps_miss201';
const ticks = Number(process.argv[3] ?? 150000);
const humanMilitary = Number(process.argv[4] ?? 2);
const map = JSON.parse(
  readFileSync(resolve(HERE, `../../app/public/assets/maps/${mapName}.json`), 'utf8'),
) as MapJson;
const world = createWorld(map, { seed: 11, players: map.players });
const rules = rulesForLandscape(map.terrain ?? 0);
const human = createAiState(0, { seed: 99, maxMilitary: humanMilitary });
const ais = [];
for (let p = 1; p < world.players.length; p++) ais.push(createAiState(p, { seed: 1234 + p }));

console.log(`human cap: maxMilitary=${human.maxMilitary}`);
const stats = {
  fights: 0,
  aiAttacksOnHuman: 0,
  humanLosses: 0,
  humanHqRazed: false,
  capturesByAi: 0,
};
const report = (): void => {
  const per = world.players.map((pl) => {
    const mine = storeLive(world.buildings).filter((b) => b.player === pl.index);
    const mil = mine.filter((b) => buildingDef(b.type)?.kind === 'military' && b.occupied).length;
    let land = 0;
    for (let n = 0; n < world.owner.length; n++) if (world.owner[n] === pl.index + 1) land++;
    return `P${pl.index}: bld=${mine.length} mil=${mil} land=${land} reserve=${pl.soldiers.join('/')} hq=${pl.hqBuildingId >= 0 ? 'ok' : 'RAZED'}`;
  });
  console.log(
    `tick ${world.tick}: ${per.join(' | ')} | fights=${stats.fights} aiAttacksOnHuman=${stats.aiAttacksOnHuman} humanLosses=${stats.humanLosses} capturesByAi=${stats.capturesByAi}`,
  );
};

for (let i = 0; i < ticks; i++) {
  // Passive human: same economy, no attacks.
  for (const c of stepAi(world, human, rules).commands)
    if (c.type !== 'attack') applyCommand(world, c);
  for (const ai of ais) for (const c of stepAi(world, ai, rules).commands) applyCommand(world, c);
  for (const e of tickWorld(world, rules)) {
    if (e.type === 'FightStarted') {
      stats.fights++;
      if (e.defenderPlayer === 0 && e.attackerPlayer !== 0) stats.aiAttacksOnHuman++;
    } else if (e.type === 'BuildingCaptured') {
      if (e.fromPlayer === 0) stats.humanLosses++;
      if (e.player !== 0) stats.capturesByAi++;
      if (e.fromPlayer === 0 && e.buildingType === 'headquarters') stats.humanHqRazed = true;
    }
  }
  if ((i + 1) % 25000 === 0) report();
  if (stats.humanHqRazed) {
    report();
    console.log(`HUMAN HEADQUARTERS RAZED at tick ${world.tick}`);
    break;
  }
}
console.log(
  `verdict: ${stats.humanHqRazed ? 'the AI eliminated the passive human' : stats.humanLosses > 0 ? 'the AI took buildings but not the HQ' : stats.aiAttacksOnHuman > 0 ? 'the AI attacked but won nothing' : 'the AI never attacked the human'}`,
);
