/**
 * Regression guard for the terrain build-quality fixes, validated against the
 * shipped maps' own `build` layer (the original game's per-node BQ bytes; low 3
 * bits: 0 nothing, 1 flag, 2 hut, 3 house, 4 castle, 5 mine).
 *
 * The converted maps live in packages/app/public/assets/maps and are gitignored,
 * so this suite SKIPS gracefully when they are absent (e.g. CI without locally
 * converted assets). When present it re-derives the aggregate divergence numbers
 * quoted in the fix and asserts they do not regress. The exact numbers are
 * recorded in the bounds below so the guard doubles as documentation.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createWorld, worldGeometry } from './index';
import { terrainBuildable, terrainMineable } from './commands';
import { rulesForLandscape, terrainId } from './terrain';
import { decodeBase64ToBytes, type MapJson } from './world';

const MAPS_DIR = path.resolve(__dirname, '../../app/public/assets/maps');
const BQ_MASK = 0x7;
const BQ_HUT = 2;
const BQ_CASTLE = 4;
const BQ_MINE = 5;

function mapFiles(): string[] {
  if (!fs.existsSync(MAPS_DIR)) return [];
  return fs
    .readdirSync(MAPS_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'index.json')
    .map((f) => path.join(MAPS_DIR, f));
}

const files = mapFiles();
const present = files.length > 0;

// The suite only runs when the (gitignored) converted maps are on disk.
(present ? describe : describe.skip)('terrain build-quality vs the maps build layer', () => {
  it('mine placement (all-6-triangle rule) never rejects an original mine, and halves the false mines', () => {
    let falsePos = 0; // rule allows a mine, build layer says no
    let falseNeg = 0; // build layer says mine, rule forbids
    for (const file of files) {
      const json = JSON.parse(fs.readFileSync(file, 'utf8')) as MapJson;
      const world = createWorld(json, { seed: 1, players: 0 });
      const geom = worldGeometry(world);
      const build = decodeBase64ToBytes(json.layers.build ?? '');
      for (let node = 0; node < geom.size; node++) {
        const original = ((build[node] ?? 0) & BQ_MASK) === BQ_MINE;
        const rule = terrainMineable(world, geom, node);
        if (rule && !original) falsePos++;
        else if (!rule && original) falseNeg++;
      }
    }
    // Verified numbers across the 50 shipped maps (940032 nodes, 77095 original
    // mines): the strict fan rule yields 0 false negatives and 9057 false
    // positives (the old own-layer-only rule had 23906). The residual 9057 is
    // flag/nothing the build layer encodes from height/proximity that terrain ids
    // alone cannot express.
    expect(falseNeg).toBe(0);
    expect(falsePos).toBeLessThanOrEqual(9057);
    expect(falsePos).toBeLessThan(23906); // strictly better than the old rule
  });

  it('greenland 0x06 ("buildable water") is buildable where the original marks it castle', () => {
    let castleNodes = 0; // original castle-buildable 0x06 nodes
    let castleForbidden = 0; // ... that our rule wrongly forbids
    let sawGreenland06 = false;
    for (const file of files) {
      const json = JSON.parse(fs.readFileSync(file, 'utf8')) as MapJson;
      const land = json.terrain ?? 0;
      if (land !== 0) continue; // 0x06 is greenland-only in the shipped maps
      const world = createWorld(json, { seed: 1, players: 0 });
      const geom = worldGeometry(world);
      const rules = rulesForLandscape(land);
      const build = decodeBase64ToBytes(json.layers.build ?? '');
      for (let node = 0; node < geom.size; node++) {
        const id1 = terrainId(world.terrain1[node]);
        const id2 = terrainId(world.terrain2[node]);
        if (id1 !== 0x06 && id2 !== 0x06) continue;
        sawGreenland06 = true;
        const bq = (build[node] ?? 0) & BQ_MASK;
        if (bq >= BQ_HUT && bq <= BQ_CASTLE) {
          castleNodes++;
          if (!terrainBuildable(world, geom, rules, node)) castleForbidden++;
        }
      }
    }
    // maps3_omap00 "Island of Hills" is the only shipped map carrying 0x06 (1862
    // own-layer nodes, 911 of them castle-buildable). Before the fix all 911 were
    // wrongly forbidden; after, every one is buildable.
    if (sawGreenland06) {
      expect(castleNodes).toBeGreaterThan(0);
      expect(castleForbidden).toBe(0);
    }
  });
});
