/**
 * Triangular-lattice torus geometry for the engine.
 *
 * Independent implementation of the same rules the renderer uses
 * (packages/renderer/src/geometry.ts): every odd row is shifted half a step to
 * the right, the map wraps in both axes, and each node has six neighbours
 * E / W / NE / NW / SE / SW whose column offsets depend on row parity.
 *
 * A node is addressed either as (x, y) or as a flat index `y * width + x`.
 * Distances use a hex-cube metric that is exact on this lattice (validated
 * against breadth-first search over the torus).
 */

/** The six directions around a node, in a fixed clockwise-ish order. */
export type Direction = 'E' | 'SE' | 'SW' | 'W' | 'NW' | 'NE';
export const DIRECTIONS: readonly Direction[] = ['E', 'SE', 'SW', 'W', 'NW', 'NE'];

/** Immutable lattice dimensions plus derived helpers. */
export class Geometry {
  readonly width: number;
  readonly height: number;

  constructor(width: number, height: number) {
    if (width <= 0 || height <= 0) throw new Error('geometry needs positive dimensions');
    this.width = width;
    this.height = height;
  }

  /** Node count. */
  get size(): number {
    return this.width * this.height;
  }

  /** Flat node index from (x, y); x and y are wrapped into bounds. */
  index(x: number, y: number): number {
    const wx = ((x % this.width) + this.width) % this.width;
    const wy = ((y % this.height) + this.height) % this.height;
    return wy * this.width + wx;
  }

  /** X column of a flat node index. */
  x(node: number): number {
    return node % this.width;
  }

  /** Y row of a flat node index. */
  y(node: number): number {
    return Math.floor(node / this.width);
  }

  /** Neighbour node index in a given direction. */
  neighbour(node: number, dir: Direction): number {
    const x = this.x(node);
    const y = this.y(node);
    const odd = y & 1;
    switch (dir) {
      case 'E':
        return this.index(x + 1, y);
      case 'W':
        return this.index(x - 1, y);
      case 'SE':
        return this.index(x + odd, y + 1);
      case 'SW':
        return this.index(x - 1 + odd, y + 1);
      case 'NE':
        return this.index(x + odd, y - 1);
      case 'NW':
        return this.index(x - 1 + odd, y - 1);
    }
  }

  /** All six neighbour node indices, in {@link DIRECTIONS} order. */
  neighbours(node: number): number[] {
    return this.neighboursInto(node, new Array<number>(6));
  }

  /**
   * All six neighbour node indices written into `out` (length >= 6), in
   * {@link DIRECTIONS} order. Allocation-free variant for hot loops (A*
   * expansion); the returned array is `out` itself, so callers must consume
   * it before the next call with the same scratch.
   */
  neighboursInto(node: number, out: number[]): number[] {
    for (let i = 0; i < 6; i++) out[i] = this.neighbour(node, DIRECTIONS[i]);
    return out;
  }

  /**
   * The six triangles touching a node, as (node, layer) pairs where layer 1 is
   * the up-pointing (RSU / texture1) triangle owned by that node and layer 2 is
   * the down-pointing (USD / texture2) triangle. Derived analytically and
   * validated against brute-force triangle membership for both row parities.
   */
  trianglesAround(node: number): Array<{ node: number; layer: 1 | 2 }> {
    const x = this.x(node);
    const y = this.y(node);
    const odd = (y - 1) & 1;
    const w = this.neighbour(node, 'W');
    const b = this.index(x - odd, y - 1);
    const a = this.index(x + 1 - odd, y - 1);
    return [
      { node, layer: 1 },
      { node, layer: 2 },
      { node: w, layer: 2 },
      { node: b, layer: 1 },
      { node: b, layer: 2 },
      { node: a, layer: 1 },
    ];
  }

  /**
   * Visit every node whose torus distance from `center` can be <= radius, by
   * enumerating the (2r+1)^2 window around it (each lattice step changes x
   * and y by at most 1, so the window is a superset of the disc). Falls back
   * to a full scan when the window would wrap onto itself. Callers must still
   * apply an exact distance check.
   */
  forEachNodeWithin(center: number, radius: number, visit: (node: number) => void): void {
    const span = 2 * radius + 1;
    if (span >= this.width || span >= this.height) {
      for (let node = 0; node < this.size; node++) visit(node);
      return;
    }
    const cx = this.x(center);
    const cy = this.y(center);
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        visit(this.index(cx + dx, cy + dy));
      }
    }
  }

  /** Shortest lattice-step distance between two nodes across the torus. */
  distance(a: number, b: number): number {
    const ax = this.x(a);
    const ay = this.y(a);
    const bx = this.x(b);
    const by = this.y(b);
    // cube(a) is invariant across the nine torus wrap combinations: hoist it
    // and keep everything scalar - this is the innermost primitive of A*,
    // territory recalc, and harvester searches (was 18 array allocs/call).
    const aq = ax - (ay - (ay & 1)) / 2;
    const ar = ay;
    const asum = -aq - ar;
    let best = Infinity;
    for (let i = -1; i <= 1; i++) {
      const x2 = bx + i * this.width;
      for (let j = -1; j <= 1; j++) {
        const y2 = by + j * this.height;
        const bq = x2 - (y2 - (y2 & 1)) / 2;
        const br = y2;
        const bsum = -bq - br;
        const d = (Math.abs(aq - bq) + Math.abs(asum - bsum) + Math.abs(ar - br)) / 2;
        if (d < best) best = d;
      }
    }
    return best;
  }

  /**
   * Direction that steps closest toward `to` from `from` (single step), chosen
   * by the neighbour minimising remaining distance, tie-broken by DIRECTIONS
   * order for determinism. Returns null when already at the target.
   */
  stepToward(from: number, to: number): Direction | null {
    if (from === to) return null;
    let bestDir: Direction = DIRECTIONS[0];
    let bestDist = Infinity;
    for (const dir of DIRECTIONS) {
      const n = this.neighbour(from, dir);
      const d = this.distance(n, to);
      if (d < bestDist) {
        bestDist = d;
        bestDir = dir;
      }
    }
    return bestDir;
  }

  /**
   * Straight-line-ish walk: the deterministic node sequence from `from` to `to`
   * taking one greedy neighbour step at a time (exclusive of `from`, inclusive
   * of `to`). Purely geometric helper; obstacle-aware routing lives in
   * pathfinding.ts.
   */
  lineWalk(from: number, to: number): number[] {
    const out: number[] = [];
    let cur = from;
    let guard = this.size * 2;
    while (cur !== to && guard-- > 0) {
      const dir = this.stepToward(cur, to);
      if (dir === null) break;
      cur = this.neighbour(cur, dir);
      out.push(cur);
    }
    return out;
  }
}
