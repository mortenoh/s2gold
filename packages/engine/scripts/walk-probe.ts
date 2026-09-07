/** Validate node-walkability rules against the maps' own build layer. */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorld, rulesForLandscape, worldGeometry, type MapJson } from '../src/index';
import { isWalkableTexture, terrainId } from '../src/terrain';
import { isWalkableNode } from '../src/walk';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const dir = resolve(HERE, '../../app/public/assets/maps');
const HARD = new Set([0x10, 0x11, 0x14, 0x15, 0x16]); // lava family: unreachable in the original
let fnOld = 0,
  fnNew = 0,
  flagNodes = 0,
  fpNew = 0,
  fpOld = 0,
  zero = 0;
const perMap: string[] = [];
for (const file of readdirSync(dir)
  .filter((f) => f.endsWith('.json') && f !== 'index.json')
  .sort()) {
  const map = JSON.parse(readFileSync(resolve(dir, file), 'utf8')) as MapJson & {
    layers: Record<string, string>;
  };
  const world = createWorld(map, { seed: 1, players: 1 });
  const rules = rulesForLandscape(map.terrain ?? 0);
  const geom = worldGeometry(world);
  const build = Buffer.from(map.layers.build, 'base64');
  let mOld = 0,
    mNew = 0,
    mFlags = 0;
  for (let n = 0; n < geom.size; n++) {
    const bq = build[n] & 0x7; // low 3 bits: 0 nothing, 1 flag, 2 hut, 3 house, 4 castle, 5 mine
    const old =
      isWalkableTexture(world.terrain1[n], rules) && isWalkableTexture(world.terrain2[n], rules);
    const tris = geom
      .trianglesAround(n)
      .map((t) => (t.layer === 1 ? world.terrain1[t.node] : world.terrain2[t.node]));
    const anyHard = tris.some((b) => HARD.has(terrainId(b)));
    const anyWalk = tris.some((b) => isWalkableTexture(b, rules));
    const nu = isWalkableNode(world, geom, n, rules);
    void anyHard;
    void anyWalk;
    if (bq >= 1) {
      flagNodes++;
      mFlags++;
      if (!old) {
        fnOld++;
        mOld++;
      }
      if (!nu) {
        fnNew++;
        mNew++;
      }
    } else {
      zero++;
      if (nu && !old) fpNew++;
      if (old) fpOld++;
    }
  }
  if (mOld || mNew)
    perMap.push(`${file}: flagNodes=${mFlags} unwalkableOld=${mOld} unwalkableNew=${mNew}`);
}
console.log(`flag-or-better nodes=${flagNodes}: engine says unwalkable OLD=${fnOld} NEW=${fnNew}`);
console.log(`build=0 nodes=${zero}: walkable OLD=${fpOld} NEW-only=${fpNew}`);
console.log(perMap.slice(0, 12).join('\n'));
// Which terrain ids surround the remaining false negatives (per landscape)?
for (const file of ['maps2_green.json', 'maps2_nasia.json']) {
  const map = JSON.parse(readFileSync(resolve(dir, file), 'utf8')) as MapJson & {
    layers: Record<string, string>;
  };
  const world = createWorld(map, { seed: 1, players: 1 });
  const rules = rulesForLandscape(map.terrain ?? 0);
  const geom = worldGeometry(world);
  const build = Buffer.from(map.layers.build, 'base64');
  const hist = new Map<string, number>();
  for (let n = 0; n < geom.size; n++) {
    if ((build[n] & 0x7) < 1) continue;
    const tris = geom
      .trianglesAround(n)
      .map((t) => (t.layer === 1 ? world.terrain1[t.node] : world.terrain2[t.node]));
    if (tris.some((b) => isWalkableTexture(b, rules))) continue;
    const key = [...new Set(tris.map((b) => terrainId(b).toString(16)))].sort().join(',');
    hist.set(key, (hist.get(key) ?? 0) + 1);
  }
  console.log(
    file,
    'terrain',
    map.terrain,
    [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
  );
}
// Per terrain id on each landscape: nodes whose six triangles are ALL that id, split by the original's flag verdict.
const byLand = new Map<number, Map<number, [number, number]>>();
for (const file of readdirSync(dir)
  .filter((f) => f.endsWith('.json') && f !== 'index.json')
  .sort()) {
  const map = JSON.parse(readFileSync(resolve(dir, file), 'utf8')) as MapJson & {
    layers: Record<string, string>;
  };
  const world = createWorld(map, { seed: 1, players: 1 });
  const geom = worldGeometry(world);
  const build = Buffer.from(map.layers.build, 'base64');
  const land = map.terrain ?? 0;
  const m = byLand.get(land) ?? new Map<number, [number, number]>();
  byLand.set(land, m);
  for (let n = 0; n < geom.size; n++) {
    const tris = geom
      .trianglesAround(n)
      .map((t) => terrainId(t.layer === 1 ? world.terrain1[t.node] : world.terrain2[t.node]));
    if (!tris.every((id) => id === tris[0])) continue;
    const e = m.get(tris[0]) ?? [0, 0];
    if ((build[n] & 0x7) >= 1) e[0]++;
    else e[1]++;
    m.set(tris[0], e);
  }
}
for (const [land, m] of byLand)
  console.log(
    'landscape',
    land,
    [...m.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([id, [f, z]]) => `${id.toString(16)}:flag=${f}/none=${z}`)
      .join('  '),
  );
