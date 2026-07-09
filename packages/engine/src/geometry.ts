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
    return DIRECTIONS.map((d) => this.neighbour(node, d));
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

  /** Hex-cube coordinate of a node (odd-r layout: odd rows shifted right). */
  private cube(x: number, y: number): [number, number, number] {
    const q = x - (y - (y & 1)) / 2;
    const r = y;
    return [q, -q - r, r];
  }

  /** Shortest lattice-step distance between two nodes across the torus. */
  distance(a: number, b: number): number {
    const ax = this.x(a);
    const ay = this.y(a);
    const bx = this.x(b);
    const by = this.y(b);
    let best = Infinity;
    for (const dx of [-this.width, 0, this.width]) {
      for (const dy of [-this.height, 0, this.height]) {
        const ca = this.cube(ax, ay);
        const cb = this.cube(bx + dx, by + dy);
        const d = (Math.abs(ca[0] - cb[0]) + Math.abs(ca[1] - cb[1]) + Math.abs(ca[2] - cb[2])) / 2;
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
