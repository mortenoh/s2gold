/**
 * Triangular-lattice geometry for the S2 map torus.
 *
 * Nodes live on a grid where every odd row is shifted half a horizontal step
 * (TR_W / 2) to the right. The map wraps in both axes. Each node (x, y) owns
 * two triangles:
 *
 * - RSU (apex-up), texture1: vertices node, SW neighbour, SE neighbour.
 * - LSD/USD (apex-down), texture2: vertices node, SE neighbour, E neighbour.
 *
 * Neighbour column offsets depend on row parity (facts per the settlers2.net
 * map documentation, cross-checked with RttR MapGeometry):
 *
 *              even row   odd row
 *   East       x+1        x+1
 *   SouthEast  x          x+1     (y+1)
 *   SouthWest  x-1        x       (y+1)
 */

import { HEIGHT_FACTOR, TR_H, TR_W } from './terrain-data';

/** An unwrapped lattice coordinate (may lie outside the map bounds). */
export interface LatticePoint {
  readonly x: number;
  readonly y: number;
}

/** East neighbour of (x, y), unwrapped. */
export function neighbourE(x: number, y: number): LatticePoint {
  return { x: x + 1, y };
}

/** South-east neighbour of (x, y), unwrapped. */
export function neighbourSE(x: number, y: number): LatticePoint {
  return { x: x + (y & 1), y: y + 1 };
}

/** South-west neighbour of (x, y), unwrapped. */
export function neighbourSW(x: number, y: number): LatticePoint {
  return { x: x - 1 + (y & 1), y: y + 1 };
}

/** Wrap an unwrapped lattice coordinate into map bounds (torus). */
export function wrapNode(pt: LatticePoint, width: number, height: number): LatticePoint {
  return { x: ((pt.x % width) + width) % width, y: ((pt.y % height) + height) % height };
}

/**
 * World-pixel position of an unwrapped lattice point, given the elevation of
 * the (wrapped) node it refers to. Odd rows shift right by half a step and
 * elevation raises the node on screen.
 */
export function nodeWorldPos(pt: LatticePoint, elevation: number): { x: number; y: number } {
  return {
    x: pt.x * TR_W + (pt.y & 1 ? TR_W / 2 : 0),
    y: pt.y * TR_H - elevation * HEIGHT_FACTOR,
  };
}

/** World-pixel width of one full map tile (the torus period in x). */
export function mapPixelWidth(width: number): number {
  return width * TR_W;
}

/** World-pixel height of one full map tile (the torus period in y). */
export function mapPixelHeight(height: number): number {
  return height * TR_H;
}
