/**
 * Terrain mesh builder: one interleaved vertex buffer with every triangle of
 * the map, drawn in a single call against the 256x256 palette-index atlas.
 *
 * Vertex layout (6 floats): x, y (world px), u, v (normalized atlas), s (the
 * gouraud LUT row coordinate derived from the node's shading byte, neutral
 * 64), f (fog brightness multiplier, remodulated by the renderer). Each node
 * contributes 6 vertices (RSU + LSD triangle). Triangles at the south/east
 * edges reference unwrapped neighbour positions past the map edge while
 * sampling attributes from the wrapped nodes, so tiling the mesh at the torus
 * period renders a seamless wrap.
 *
 * Lighting is palette-exact: the fragment shader interpolates the shade
 * coordinate across each triangle (that is the gouraud) and resolves it
 * through the GOU5/6/7 LUT to a shaded palette index.
 */

import type { TerrainMapData } from './map-data';
import { validateMapData } from './map-data';
import {
  neighbourE,
  neighbourSE,
  neighbourSW,
  nodeWorldPos,
  wrapNode,
  type LatticePoint,
} from './geometry';
import {
  ATLAS_SIZE,
  rectForTexture,
  texTypeForTexture,
  type AtlasRect,
  type TexType,
} from './terrain-data';

/** Floats per vertex: x, y, u, v, shade row, fog multiplier. */
export const FLOATS_PER_VERTEX = 6;

/** A built terrain mesh ready for upload to a GPU buffer. */
export interface TerrainMesh {
  /** Interleaved vertex data (FLOATS_PER_VERTEX floats per vertex). */
  readonly vertices: Float32Array;
  /** Number of vertices (always a multiple of 3). */
  readonly vertexCount: number;
  /**
   * Wrapped source node index each vertex samples its attributes from
   * (`vertexCount` entries). Lets the renderer remodulate per-vertex brightness
   * by a per-node factor — e.g. fog of war — without rebuilding the mesh.
   */
  readonly nodeOfVertex: Uint32Array;
}

interface UvTriangle {
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
  readonly cx: number;
  readonly cy: number;
}

/** Half-pixel-inset rect edges used for all UV computations. */
function insetRect(rect: AtlasRect): {
  left: number;
  top: number;
  right: number;
  bottom: number;
  mx: number;
  my: number;
} {
  const [x, y, w, h] = rect;
  const left = x + 0.5;
  const top = y + 0.5;
  const right = x + w - 0.5;
  const bottom = y + h - 0.5;
  return { left, top, right, bottom, mx: (left + right) / 2, my: (top + bottom) / 2 };
}

/**
 * UVs for the RSU (apex-up) triangle in world order [node, SW, SE].
 * Layout facts per RttR TerrainDesc::GetRSUTriangle.
 */
function rsuUvs(rect: AtlasRect, type: TexType): UvTriangle {
  const r = insetRect(rect);
  switch (type) {
    case 'stacked':
      return { ax: r.mx, ay: r.top, bx: r.left, by: r.my, cx: r.right, cy: r.my };
    case 'rotated':
      return { ax: r.left, ay: r.my, bx: r.right, by: r.my, cx: r.mx, cy: r.top };
    case 'overlapped':
      return { ax: r.mx, ay: r.top, bx: r.left, by: r.bottom, cx: r.right, cy: r.bottom };
  }
}

/**
 * UVs for the LSD/USD (apex-down) triangle in world order [node, SE, E].
 * Layout facts per RttR TerrainDesc::GetUSDTriangle.
 */
function lsdUvs(rect: AtlasRect, type: TexType): UvTriangle {
  const r = insetRect(rect);
  switch (type) {
    case 'stacked':
      return { ax: r.left, ay: r.my, bx: r.mx, by: r.bottom, cx: r.right, cy: r.my };
    case 'rotated':
      return { ax: r.mx, ay: r.bottom, bx: r.right, by: r.my, cx: r.left, cy: r.my };
    case 'overlapped':
      return { ax: r.left, ay: r.top, bx: r.mx, by: r.bottom, cx: r.right, cy: r.top };
  }
}

/** Build the full terrain mesh for a map. */
export function buildTerrainMesh(map: TerrainMapData): TerrainMesh {
  validateMapData(map);
  const { width, height } = map;
  const nodeCount = width * height;
  const vertexCount = nodeCount * 6;
  const vertices = new Float32Array(vertexCount * FLOATS_PER_VERTEX);
  const nodeOfVertex = new Uint32Array(vertexCount);

  const nodeIndex = (pt: LatticePoint): number => pt.y * width + pt.x;

  let o = 0;
  let vi = 0;
  const emit = (pt: LatticePoint, u: number, v: number): void => {
    const wrapped = wrapNode(pt, width, height);
    const idx = nodeIndex(wrapped);
    nodeOfVertex[vi++] = idx;
    const pos = nodeWorldPos(pt, map.heightLayer[idx] ?? 0);
    vertices[o++] = pos.x;
    vertices[o++] = pos.y;
    vertices[o++] = u / ATLAS_SIZE;
    vertices[o++] = v / ATLAS_SIZE;
    // Gouraud LUT row coordinate: the raw shading byte (neutral 64) mapped to
    // the row's texel centre in the 256-row table.
    vertices[o++] = ((map.shading[idx] ?? 64) + 0.5) / 256;
    // Fog multiplier lane; setFog() remodulates this per node.
    vertices[o++] = 1;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const p: LatticePoint = { x, y };
      const se = neighbourSE(x, y);
      const sw = neighbourSW(x, y);
      const e = neighbourE(x, y);

      const t1 = map.texture1[idx] ?? 0;
      const uv1 = rsuUvs(rectForTexture(t1), texTypeForTexture(t1));
      emit(p, uv1.ax, uv1.ay);
      emit(sw, uv1.bx, uv1.by);
      emit(se, uv1.cx, uv1.cy);

      const t2 = map.texture2[idx] ?? 0;
      const uv2 = lsdUvs(rectForTexture(t2), texTypeForTexture(t2));
      emit(p, uv2.ax, uv2.ay);
      emit(se, uv2.bx, uv2.by);
      emit(e, uv2.cx, uv2.cy);
    }
  }

  return { vertices, vertexCount, nodeOfVertex };
}
