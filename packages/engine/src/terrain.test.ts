import { describe, expect, it } from 'vitest';
import {
  GREENLAND_RULES,
  WINTER_RULES,
  WASTELAND_RULES,
  rulesForLandscape,
  isBuildableTexture,
  isWalkableTexture,
  terrainId,
} from './terrain';

/**
 * Real texture-id samples taken from the converted maps this feature targets.
 * The converters store the terrain id directly in the low 6 bits with no high
 * flags on these maps, so each raw byte equals its id (verified by decoding the
 * texture1/texture2 layers). We assert classification on these actual ids rather
 * than invented ones so the rules match the shipped map data.
 */

// maps4_map02 "Thor's Island" (terrain=2, winter) — full id set present.
const WINTER_MAP02_IDS = [
  0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0f, 0x12,
] as const;
// maps4_map06 "Cold Times" (terrain=2, winter) — adds steppe (0x0e).
const WINTER_MAP06_IDS = [
  0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x12,
] as const;
// maps2_japan "Japan" (terrain=1, wasteland) — water island, no lava present.
const WASTELAND_JAPAN_IDS = [0x00, 0x01, 0x05, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0f] as const;

describe('rulesForLandscape', () => {
  it('maps landscape ids to their rule tables (0 green, 1 wasteland, 2 winter)', () => {
    expect(rulesForLandscape(0)).toBe(GREENLAND_RULES);
    expect(rulesForLandscape(1)).toBe(WASTELAND_RULES);
    expect(rulesForLandscape(2)).toBe(WINTER_RULES);
  });

  it('falls back to greenland for unknown landscape ids', () => {
    expect(rulesForLandscape(-1)).toBe(GREENLAND_RULES);
    expect(rulesForLandscape(7)).toBe(GREENLAND_RULES);
  });
});

describe('winter terrain rules', () => {
  it('treats ice as unwalkable (the winter-specific hazards)', () => {
    expect(isWalkableTexture(0x04, WINTER_RULES)).toBe(false); // ice 1
    expect(isWalkableTexture(0x07, WINTER_RULES)).toBe(false); // ice 2
    // Ice floes + open water are unwalkable too.
    expect(isWalkableTexture(0x02, WINTER_RULES)).toBe(false); // ice floe
    expect(isWalkableTexture(0x03, WINTER_RULES)).toBe(false); // ice floes
    expect(isWalkableTexture(0x05, WINTER_RULES)).toBe(false); // water
  });

  it('makes the mountain-meadow slot buildable ground (original BQ: flag/hut/castle)', () => {
    expect(isWalkableTexture(0x12, WINTER_RULES)).toBe(true);
    expect(isBuildableTexture(0x12, WINTER_RULES)).toBe(true);
  });

  it('lets settlers walk (but not build) on winter mountains', () => {
    for (const id of [0x01, 0x0b, 0x0c, 0x0d]) {
      expect(isWalkableTexture(id, WINTER_RULES)).toBe(true);
      expect(isBuildableTexture(id, WINTER_RULES)).toBe(false);
    }
  });

  it('makes tundra/taiga/steppe buildable ground', () => {
    for (const id of [0x00, 0x08, 0x09, 0x0a, 0x0e, 0x0f, 0x12]) {
      expect(isBuildableTexture(id, WINTER_RULES)).toBe(true);
      expect(isWalkableTexture(id, WINTER_RULES)).toBe(true);
    }
  });

  it('classifies every id in the real winter maps consistently', () => {
    const impassable = new Set([0x02, 0x03, 0x04, 0x05, 0x07]);
    const buildable = new Set([0x00, 0x08, 0x09, 0x0a, 0x0e, 0x0f, 0x12]);
    for (const ids of [WINTER_MAP02_IDS, WINTER_MAP06_IDS]) {
      for (const raw of ids) {
        const id = terrainId(raw);
        expect(isWalkableTexture(raw, WINTER_RULES)).toBe(!impassable.has(id));
        expect(isBuildableTexture(raw, WINTER_RULES)).toBe(buildable.has(id));
      }
    }
  });
});

describe('wasteland terrain rules', () => {
  it('treats lava as unwalkable, but keeps desert sand and alpine pasture walkable', () => {
    expect(isWalkableTexture(0x10, WASTELAND_RULES)).toBe(false); // flowing lava
    expect(isWalkableTexture(0x11, WASTELAND_RULES)).toBe(false); // lava
    // Alpine pasture (0x12) is green buildable ground here (original BQ: flag/hut/castle).
    expect(isWalkableTexture(0x12, WASTELAND_RULES)).toBe(true);
    expect(isBuildableTexture(0x12, WASTELAND_RULES)).toBe(true);
    // Desert slots are walkable sand in wasteland (unlike winter, where they are ice).
    expect(isWalkableTexture(0x04, WASTELAND_RULES)).toBe(true);
    expect(isWalkableTexture(0x07, WASTELAND_RULES)).toBe(true);
    expect(isBuildableTexture(0x04, WASTELAND_RULES)).toBe(false);
  });

  it('classifies every id in the real wasteland map (Japan) consistently', () => {
    const impassable = new Set([0x05]); // only water is present as a hazard
    const buildable = new Set([0x00, 0x08, 0x09, 0x0a, 0x0f, 0x12]);
    for (const raw of WASTELAND_JAPAN_IDS) {
      const id = terrainId(raw);
      expect(isWalkableTexture(raw, WASTELAND_RULES)).toBe(!impassable.has(id));
      expect(isBuildableTexture(raw, WASTELAND_RULES)).toBe(buildable.has(id));
    }
  });
});

describe('greenland regression + cross-landscape divergence', () => {
  it('keeps greenland desert walkable-but-unbuildable and snow/swamp unwalkable', () => {
    expect(isWalkableTexture(0x04, GREENLAND_RULES)).toBe(true); // desert
    expect(isBuildableTexture(0x04, GREENLAND_RULES)).toBe(false);
    expect(isWalkableTexture(0x02, GREENLAND_RULES)).toBe(false); // snow
    expect(isWalkableTexture(0x03, GREENLAND_RULES)).toBe(false); // swamp
    expect(isWalkableTexture(0x12, GREENLAND_RULES)).toBe(true); // mountain meadow
  });

  it('diverges on the shared slots that change material by landscape', () => {
    // 0x04 (desert/ice): walkable everywhere except winter, where it is ice.
    expect(isWalkableTexture(0x04, GREENLAND_RULES)).toBe(true);
    expect(isWalkableTexture(0x04, WASTELAND_RULES)).toBe(true);
    expect(isWalkableTexture(0x04, WINTER_RULES)).toBe(false);
    // 0x12 (mountain meadow / alpine pasture): green buildable ground in every
    // landscape — the original build-quality layer never marks it a hazard.
    for (const rules of [GREENLAND_RULES, WASTELAND_RULES, WINTER_RULES]) {
      expect(isWalkableTexture(0x12, rules)).toBe(true);
      expect(isBuildableTexture(0x12, rules)).toBe(true);
    }
  });
});
