/**
 * Engine-agnostic map data consumed by the terrain renderer.
 *
 * The renderer needs only the map dimensions, landscape set and four of the 14
 * WLD layers. Layers are row-major `width * height` byte planes, one byte per
 * lattice node, exactly as stored in the original WLD/SWD files.
 */

import type { LandscapeSet } from './terrain-data';

/** Map data required to build and light the terrain mesh. */
export interface TerrainMapData {
  /** Map width in nodes. */
  readonly width: number;
  /** Map height in nodes (rows). */
  readonly height: number;
  /** Landscape set: 0 = greenland, 1 = wasteland, 2 = winter. */
  readonly landscape: LandscapeSet;
  /** Per-node elevation (0..60, neutral around 10). */
  readonly heightLayer: Uint8Array;
  /** Terrain byte of each node's RSU triangle (apex-up, below the node). */
  readonly texture1: Uint8Array;
  /** Terrain byte of each node's LSD triangle (apex-down, right of RSU). */
  readonly texture2: Uint8Array;
  /** Per-node gouraud shading value (0..128, neutral 64). */
  readonly shading: Uint8Array;
}

/** Validate layer sizes and throw with a clear message when they mismatch. */
export function validateMapData(map: TerrainMapData): void {
  const expected = map.width * map.height;
  const layers: readonly [string, Uint8Array][] = [
    ['heightLayer', map.heightLayer],
    ['texture1', map.texture1],
    ['texture2', map.texture2],
    ['shading', map.shading],
  ];
  for (const [name, layer] of layers) {
    if (layer.length !== expected) {
      throw new Error(
        `map layer ${name} has ${layer.length} bytes, expected ${expected} (${map.width}x${map.height})`,
      );
    }
  }
}
