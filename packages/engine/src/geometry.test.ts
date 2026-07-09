import { describe, expect, it } from 'vitest';
import { Geometry } from './geometry';

describe('Geometry neighbours', () => {
  const g = new Geometry(8, 8);

  it('computes odd-row neighbours (parity shift right)', () => {
    const n = g.index(3, 3); // odd row
    expect(g.neighbour(n, 'E')).toBe(g.index(4, 3));
    expect(g.neighbour(n, 'W')).toBe(g.index(2, 3));
    expect(g.neighbour(n, 'SE')).toBe(g.index(4, 4));
    expect(g.neighbour(n, 'SW')).toBe(g.index(3, 4));
    expect(g.neighbour(n, 'NE')).toBe(g.index(4, 2));
    expect(g.neighbour(n, 'NW')).toBe(g.index(3, 2));
  });

  it('computes even-row neighbours (no shift)', () => {
    const n = g.index(3, 2); // even row
    expect(g.neighbour(n, 'SE')).toBe(g.index(3, 3));
    expect(g.neighbour(n, 'SW')).toBe(g.index(2, 3));
    expect(g.neighbour(n, 'NE')).toBe(g.index(3, 1));
    expect(g.neighbour(n, 'NW')).toBe(g.index(2, 1));
  });

  it('wraps neighbours across both torus edges', () => {
    const corner = g.index(0, 0);
    expect(g.neighbour(corner, 'W')).toBe(g.index(7, 0));
    expect(g.neighbour(corner, 'NW')).toBe(g.index(7, 7));
    expect(g.neighbour(corner, 'NE')).toBe(g.index(0, 7));
  });
});

describe('Geometry distance', () => {
  const g = new Geometry(8, 8);

  it('is zero to self and one to each neighbour', () => {
    const n = g.index(3, 3);
    expect(g.distance(n, n)).toBe(0);
    for (const m of g.neighbours(n)) expect(g.distance(n, m)).toBe(1);
  });

  it('takes the short way around the torus', () => {
    expect(g.distance(g.index(0, 0), g.index(7, 0))).toBe(1); // wrap in x
    expect(g.distance(g.index(0, 0), g.index(0, 7))).toBe(1); // wrap in y (SW/SE chain)
  });

  it('matches breadth-first search on a small torus', () => {
    const from = g.index(2, 5);
    const dist = new Map<number, number>([[from, 0]]);
    const queue = [from];
    while (queue.length) {
      const cur = queue.shift() as number;
      for (const nb of g.neighbours(cur)) {
        if (!dist.has(nb)) {
          dist.set(nb, (dist.get(cur) as number) + 1);
          queue.push(nb);
        }
      }
    }
    for (const [node, d] of dist) expect(g.distance(from, node)).toBe(d);
  });
});

describe('Geometry triangles', () => {
  it('returns exactly six triangles that all touch the node', () => {
    const g = new Geometry(7, 6);
    for (let n = 0; n < g.size; n++) {
      const tris = g.trianglesAround(n);
      expect(tris).toHaveLength(6);
      for (const { node, layer } of tris) {
        const verts =
          layer === 1
            ? [node, g.neighbour(node, 'SW'), g.neighbour(node, 'SE')]
            : [node, g.neighbour(node, 'SE'), g.neighbour(node, 'E')];
        expect(verts).toContain(n);
      }
    }
  });
});

describe('Geometry lineWalk', () => {
  it('reaches the target with adjacent steps', () => {
    const g = new Geometry(12, 12);
    const from = g.index(1, 1);
    const to = g.index(9, 8);
    const path = g.lineWalk(from, to);
    expect(path[path.length - 1]).toBe(to);
    let prev = from;
    for (const step of path) {
      expect(g.neighbours(prev)).toContain(step);
      prev = step;
    }
  });
});
