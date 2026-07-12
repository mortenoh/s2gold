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
  edgeInfoForTexture,
  edgeStripRect,
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
   * Vertices [0, baseVertexCount) are the base terrain triangles; the rest are
   * border bands, drawn with palette index 0 keyed out (the edge strips use it
   * as transparency, while winter base terrain uses it as a real color).
   */
  readonly baseVertexCount: number;
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

  // --- Terrain borders (edge blending) ---------------------------------------
  //
  // Where two lattice triangles of different edge priority meet, the higher-
  // priority terrain paints its 64x16 edge strip across the shared edge (facts:
  // RttR TerrainRenderer borders + the world lua edge tables). Per node the
  // three boundaries below cover every internal lattice edge exactly once:
  //
  //   RSU(p)|LSD(p)      shared edge [p, SE(p)]
  //   LSD(p)|RSU(E(p))   shared edge [E(p), SE(p)]
  //   RSU(p)|LSD(SW(p))  shared edge [SW(p), SE(p)]
  //
  // A border band is two triangles: the shared edge's endpoints plus each
  // adjacent triangle's centroid, with the strip's top edge mapped along the
  // shared edge and its bottom midpoint at the centroid. Emitted after the
  // base triangles so they paint over them at equal depth.
  const landscape = map.landscape ?? 0;
  const border: number[] = [];
  const borderNodes: number[] = [];

  const posOf = (pt: LatticePoint): { x: number; y: number; node: number } => {
    const wrapped = wrapNode(pt, width, height);
    const node = wrapped.y * width + wrapped.x;
    const pos = nodeWorldPos(pt, map.heightLayer[node] ?? 0);
    return { x: pos.x, y: pos.y, node };
  };

  const emitBorderVertex = (px: number, py: number, node: number, u: number, v: number): void => {
    border.push(px, py, u / ATLAS_SIZE, v / ATLAS_SIZE, ((map.shading[node] ?? 64) + 0.5) / 256, 1);
    borderNodes.push(node);
  };

  const emitBorderBand = (
    a: LatticePoint,
    b: LatticePoint,
    triangles: ReadonlyArray<readonly [LatticePoint, LatticePoint, LatticePoint]>,
    slot: number,
  ): void => {
    const r = insetRect(edgeStripRect(slot));
    const A = posOf(a);
    const B = posOf(b);
    for (const tri of triangles) {
      const p0 = posOf(tri[0]);
      const p1 = posOf(tri[1]);
      const p2 = posOf(tri[2]);
      const cx = (p0.x + p1.x + p2.x) / 3;
      const cy = (p0.y + p1.y + p2.y) / 3;
      emitBorderVertex(A.x, A.y, A.node, r.left, r.top);
      emitBorderVertex(B.x, B.y, B.node, r.right, r.top);
      emitBorderVertex(cx, cy, p0.node, r.mx, r.bottom);
    }
  };

  const boundary = (
    ta: number,
    tb: number,
    a: LatticePoint,
    b: LatticePoint,
    triA: readonly [LatticePoint, LatticePoint, LatticePoint],
    triB: readonly [LatticePoint, LatticePoint, LatticePoint],
  ): void => {
    const ea = edgeInfoForTexture(ta, landscape);
    const eb = edgeInfoForTexture(tb, landscape);
    if (ea.priority === eb.priority) return;
    const winner = ea.priority > eb.priority ? ea : eb;
    if (winner.slot === null) return;
    emitBorderBand(a, b, [triA, triB], winner.slot);
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const p: LatticePoint = { x, y };
      const se = neighbourSE(x, y);
      const sw = neighbourSW(x, y);
      const e = neighbourE(x, y);
      const t1 = map.texture1[idx] ?? 0;
      const t2 = map.texture2[idx] ?? 0;
      const rsu: readonly [LatticePoint, LatticePoint, LatticePoint] = [p, sw, se];
      const lsd: readonly [LatticePoint, LatticePoint, LatticePoint] = [p, se, e];

      // RSU(p) | LSD(p)
      boundary(t1, t2, p, se, rsu, lsd);
      // LSD(p) | RSU(E(p))
      const eIdx = wrapNode(e, width, height);
      const tE1 = map.texture1[eIdx.y * width + eIdx.x] ?? 0;
      const rsuE: readonly [LatticePoint, LatticePoint, LatticePoint] = [
        e,
        neighbourSW(e.x, e.y),
        neighbourSE(e.x, e.y),
      ];
      boundary(t2, tE1, e, se, lsd, rsuE);
      // RSU(p) | LSD(SW(p))
      const swIdx = wrapNode(sw, width, height);
      const tSW2 = map.texture2[swIdx.y * width + swIdx.x] ?? 0;
      const lsdSW: readonly [LatticePoint, LatticePoint, LatticePoint] = [
        sw,
        neighbourSE(sw.x, sw.y),
        neighbourE(sw.x, sw.y),
      ];
      boundary(t1, tSW2, sw, se, rsu, lsdSW);
    }
  }

  if (border.length === 0) {
    return { vertices, vertexCount, baseVertexCount: vertexCount, nodeOfVertex };
  }
  const all = new Float32Array(vertices.length + border.length);
  all.set(vertices);
  all.set(border, vertices.length);
  const allNodes = new Uint32Array(nodeOfVertex.length + borderNodes.length);
  allNodes.set(nodeOfVertex);
  allNodes.set(borderNodes, nodeOfVertex.length);
  return {
    vertices: all,
    vertexCount: vertexCount + borderNodes.length,
    baseVertexCount: vertexCount,
    nodeOfVertex: allNodes,
  };
}
