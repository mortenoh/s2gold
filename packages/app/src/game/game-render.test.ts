import { JOB, JOB_TYPES, type Building, type Settler, type World } from '@s2gold/engine';
import { describe, expect, it } from 'vitest';
import { HELPER_BOB_ID, JOB_BOB_ID, workerIsIndoors } from './game-render';

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
