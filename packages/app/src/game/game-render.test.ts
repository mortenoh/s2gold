import {
  JOB,
  JOB_TYPES,
  makeResource,
  RESOURCE,
  type Building,
  type Settler,
  type World,
} from '@s2gold/engine';
import { describe, expect, it } from 'vitest';
import {
  borderStoneSprites,
  BUILDING_ARCHIVE,
  WINTER_BUILDING_ARCHIVE,
  buildingArchiveForLandscape,
  HELPER_BOB_ID,
  JOB_BOB_ID,
  roadSegments,
  signSizeOffset,
  signSprites,
  WORK_ANIM,
  workerIsIndoors,
  workSprite,
} from './game-render';

/** jobs.bob has 93 job entries; a job id must land inside that range. */
const JOBS_BOB_JOB_COUNT = 93;

describe('JOB_BOB_ID', () => {
  it('maps every civilian job so none can render as a headless body', () => {
    for (const job of JOB_TYPES) {
      // The carrier uses the carrier BOB (with a ware) or the Helper overlay
      // (empty) rather than a profession overlay, so it is intentionally absent.
      if (job === JOB.carrier) {
        expect(JOB_BOB_ID[job]).toBeUndefined();
        continue;
      }
      expect(JOB_BOB_ID[job], `missing jobs.bob id for ${job}`).toBeTypeOf('number');
    }
  });

  it('keeps every id in jobs.bob bounds (each overlay carries a head)', () => {
    for (const id of Object.values(JOB_BOB_ID)) {
      expect(id).toBeGreaterThanOrEqual(0);
      expect(id).toBeLessThan(JOBS_BOB_JOB_COUNT);
      expect(Number.isInteger(id)).toBe(true);
    }
  });

  it('uses the visually-verified ids for the outdoor economy jobs', () => {
    // Confirmed by rendering body+overlay per job from the converted jobs.bob.
    expect(JOB_BOB_ID.woodcutter).toBe(5); // red cap + axe
    expect(JOB_BOB_ID.sawmiller).toBe(6); // saw
    expect(JOB_BOB_ID.stonemason).toBe(7); // purple cap + pickaxe
    expect(JOB_BOB_ID.forester).toBe(8); // green cap + shovel
    expect(JOB_BOB_ID.farmer).toBe(9); // scythe
    expect(JOB_BOB_ID.fisher).toBe(12); // fishing rod
    expect(JOB_BOB_ID.builder).toBe(23); // hammer
  });

  it('exposes the Helper overlay as the empty-carrier head source', () => {
    expect(HELPER_BOB_ID).toBe(0);
  });
});

/**
 * Minimal world for border-stone tests: a 1-row lattice where the given nodes are
 * open water (both terrain layers = 0x05) and the rest are land (0x00). heightMap
 * is flat so nodeAnchor never divides by an undefined elevation.
 */
function waterWorld(size: number, waterNodes: readonly number[]): World {
  const terrain = new Uint8Array(size); // 0x00 land everywhere
  for (const n of waterNodes) terrain[n] = 0x05; // navigable water
  return {
    width: size,
    height: 1,
    terrain1: terrain,
    terrain2: terrain,
    heightMap: new Uint8Array(size),
  } as unknown as World;
}

describe('borderStoneSprites', () => {
  it('draws the real nation-archive boundary stone (0/1), not a sign tablet', () => {
    const world = waterWorld(4, []);
    const stones = borderStoneSprites(world, [0, 1, 2], 2);
    expect(stones).toHaveLength(3);
    for (const s of stones) {
      // Nation archive (rom_z), so its player-colour cap tints via the same pmask
      // path as the flags — not the mapbobs 612 sign tablet the old code used.
      expect(s.archive).toBe(BUILDING_ARCHIVE);
      expect(s.spriteIndex).toBe(0); // player-coloured standing stone
      expect(s.spriteIndex).not.toBe(612); // 612 is a geologist sign tablet
      expect(s.shadowIndex).toBe(1);
      expect(s.player).toBe(2); // carries the owner so its pmask cap tints per player
    }
  });

  it('skips open-water frontier nodes (no stone floating on the sea)', () => {
    const world = waterWorld(4, [1, 3]);
    const stones = borderStoneSprites(world, [0, 1, 2, 3], 0);
    expect(stones).toHaveLength(2); // only the two land nodes 0 and 2
  });

  it('skips nodes hidden by fog (visibility !== 2)', () => {
    const world = waterWorld(3, []);
    const vis = new Uint8Array([2, 0, 1]); // only node 0 currently visible
    const stones = borderStoneSprites(world, [0, 1, 2], 0, vis);
    expect(stones).toHaveLength(1);
  });

  it('draws border stones from the winter nation archive when given one', () => {
    const world = waterWorld(3, []);
    const stones = borderStoneSprites(world, [0, 1, 2], 1, null, WINTER_BUILDING_ARCHIVE);
    expect(stones).toHaveLength(3);
    for (const s of stones) {
      expect(s.archive).toBe(WINTER_BUILDING_ARCHIVE);
      expect(s.spriteIndex).toBe(0); // parity: same standing-stone index as rom_z
      expect(s.shadowIndex).toBe(1);
    }
  });
});

describe('buildingArchiveForLandscape', () => {
  it('uses the summer rom_z archive for greenland and wasteland', () => {
    expect(buildingArchiveForLandscape(0)).toBe(BUILDING_ARCHIVE); // greenland
    expect(buildingArchiveForLandscape(1)).toBe(BUILDING_ARCHIVE); // wasteland
  });

  it('swaps to the winter W* nation archive only for winter maps', () => {
    expect(buildingArchiveForLandscape(2)).toBe(WINTER_BUILDING_ARCHIVE);
    expect(WINTER_BUILDING_ARCHIVE).toBe('wrom_z');
  });
});

/** Minimal world for sign tests: signs on a flat 1-row lattice with per-node ore. */
function signWorld(
  size: number,
  signs: readonly { node: number; res: number; amount: number }[],
  buildings: readonly number[] = [],
): World {
  const resource = new Uint8Array(size);
  for (const s of signs) {
    if (s.res !== RESOURCE.none) resource[s.node] = makeResource(s.res, s.amount);
  }
  const buildingAtNode = new Int32Array(size).fill(-1) as unknown as number[];
  for (const n of buildings) buildingAtNode[n] = 0;
  return {
    width: size,
    height: 1,
    heightMap: new Uint8Array(size),
    resource,
    buildingAtNode,
    signs: signs.map((s) => ({ node: s.node, res: s.res })),
  } as unknown as World;
}

describe('signSprites', () => {
  it('picks the ore triplet by resource kind and sizes it by the current amount', () => {
    const world = signWorld(8, [
      { node: 0, res: RESOURCE.iron, amount: 1 }, // small
      { node: 1, res: RESOURCE.iron, amount: 4 }, // medium
      { node: 2, res: RESOURCE.iron, amount: 7 }, // large
      { node: 3, res: RESOURCE.gold, amount: 2 }, // small
      { node: 4, res: RESOURCE.coal, amount: 5 }, // medium
      { node: 5, res: RESOURCE.granite, amount: 6 }, // large
    ]);
    const s = signSprites(world, 'mapbobs');
    // Iron 600..602 sized small/med/large by amount.
    expect(s[0].spriteIndex).toBe(600);
    expect(s[1].spriteIndex).toBe(601);
    expect(s[2].spriteIndex).toBe(602);
    // Gold base 603, coal base 606 (+1 med), granite base 609 (+2 large).
    expect(s[3].spriteIndex).toBe(603);
    expect(s[4].spriteIndex).toBe(607);
    expect(s[5].spriteIndex).toBe(611);
    for (const d of s) {
      expect(d.archive).toBe('mapbobs');
      expect(d.shadowIndex).toBe(619);
    }
  });

  it('shows the empty tablet (615) for a surveyed node whose ore is mined out', () => {
    // Sign recorded coal, but the deposit has since dropped to 0: current res is
    // nothing, so it must read as the empty tablet, never coal.
    const world = signWorld(2, [{ node: 0, res: RESOURCE.coal, amount: 0 }]);
    const [d] = signSprites(world, 'mapbobs');
    expect(d.spriteIndex).toBe(615);
  });

  it('maps underground water to the single blue tablet (612, never offset)', () => {
    const world = signWorld(2, [{ node: 0, res: RESOURCE.water, amount: 7 }]);
    const [d] = signSprites(world, 'mapbobs');
    expect(d.spriteIndex).toBe(612);
  });

  it('drops a sign once a mine sits on its node', () => {
    const world = signWorld(2, [{ node: 0, res: RESOURCE.coal, amount: 4 }], [0]);
    expect(signSprites(world, 'mapbobs')).toHaveLength(0);
  });

  it('skips signs hidden by fog (visibility !== 2)', () => {
    const world = signWorld(3, [
      { node: 0, res: RESOURCE.iron, amount: 3 },
      { node: 2, res: RESOURCE.iron, amount: 3 },
    ]);
    const vis = new Uint8Array([2, 0, 0]); // only node 0 currently visible
    expect(signSprites(world, 'mapbobs', vis)).toHaveLength(1);
  });
});

describe('signSizeOffset', () => {
  it('maps deposit amount to small/medium/large', () => {
    expect([1, 2].map(signSizeOffset)).toEqual([0, 0]);
    expect([3, 4, 5].map(signSizeOffset)).toEqual([1, 1, 1]);
    expect([6, 7].map(signSizeOffset)).toEqual([2, 2]);
  });
});

/** Minimal world holding a single building at `buildingNode`. */
function worldWith(buildingNode: number): World {
  const building = { node: buildingNode } as Building;
  return { buildings: { items: [building] } } as unknown as World;
}

/** A civilian worker with the given state, home building and node. */
function worker(over: Partial<Settler>): Settler {
  return { rank: -1, state: 'idle', homeBuildingId: 0, node: 0, ...over } as Settler;
}

describe('workerIsIndoors', () => {
  it('hides a worker idling on its own building node (inside)', () => {
    const world = worldWith(42);
    expect(workerIsIndoors(world, worker({ homeBuildingId: 0, node: 42 }))).toBe(true);
  });

  it('shows a worker out at a work spot (idle but off its building node)', () => {
    const world = worldWith(42);
    expect(workerIsIndoors(world, worker({ homeBuildingId: 0, node: 7 }))).toBe(false);
  });

  it('shows a worker that is currently working (non-idle state)', () => {
    const world = worldWith(42);
    expect(workerIsIndoors(world, worker({ state: 'working', node: 42 }))).toBe(false);
  });

  it('shows an unattached carrier (no home building)', () => {
    const world = worldWith(42);
    expect(workerIsIndoors(world, worker({ homeBuildingId: -1, node: 42 }))).toBe(false);
  });

  it('never hides a soldier', () => {
    const world = worldWith(42);
    expect(workerIsIndoors(world, worker({ rank: 2, node: 42 }))).toBe(false);
  });
});

describe('workSprite', () => {
  it('returns null for jobs without an action animation (walk-cycle fallback)', () => {
    expect(workSprite(JOB.carrier, 0)).toBeNull();
    expect(workSprite(JOB.miner, 3)).toBeNull();
    expect(workSprite(JOB.stonemason, 0)).toBeNull();
  });

  it('maps the verified outdoor jobs to their CBOB frame runs', () => {
    // Frame 0 lands on each block's first frame (empirically verified: woodcutter
    // axe swing, forester planting, fisher rod cast, farmer scythe).
    expect(workSprite(JOB.woodcutter, 0)).toBe(16);
    expect(workSprite(JOB.forester, 0)).toBe(48);
    expect(workSprite(JOB.fisher, 0)).toBe(108);
    expect(workSprite(JOB.farmer, 0)).toBe(132);
  });

  it('loops each run within its own frame range', () => {
    for (const [job, range] of Object.entries(WORK_ANIM)) {
      if (!range) continue;
      for (const frame of [0, 1, range.frames - 1, range.frames, range.frames * 3 + 2]) {
        const idx = workSprite(job, frame);
        expect(idx).not.toBeNull();
        expect(idx).toBeGreaterThanOrEqual(range.start);
        expect(idx).toBeLessThan(range.start + range.frames);
      }
    }
  });

  it('wraps at the loop boundary (frame count returns to the first frame)', () => {
    const wc = WORK_ANIM.woodcutter;
    if (!wc) throw new Error('woodcutter work anim expected');
    expect(workSprite(JOB.woodcutter, wc.frames)).toBe(workSprite(JOB.woodcutter, 0));
    expect(workSprite(JOB.woodcutter, wc.frames - 1)).toBe(wc.start + wc.frames - 1);
  });
});
