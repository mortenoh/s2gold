import { describe, expect, it } from 'vitest';
import {
  ATLAS_SIZE,
  buildMinimapPixels,
  buildTerrainMesh,
  Camera,
  FLOATS_PER_VERTEX,
  heightBrightness,
  HEIGHT_FACTOR,
  mapPixelHeight,
  mapPixelWidth,
  minimapColor,
  neighbourE,
  neighbourSE,
  neighbourSW,
  nodeWorldPos,
  rectForTexture,
  RENDERER_VERSION,
  TERRAIN_RECTS,
  texTypeForTexture,
  TR_H,
  TR_W,
  version,
  wrap,
  wrapNode,
  type TerrainMapData,
} from './index';

function makeMap(width = 4, height = 4): TerrainMapData {
  const n = width * height;
  return {
    width,
    height,
    landscape: 0,
    heightLayer: new Uint8Array(n).fill(10),
    texture1: new Uint8Array(n).fill(8), // meadow1
    texture2: new Uint8Array(n).fill(5), // water
    shading: new Uint8Array(n).fill(64),
  };
}

describe('@s2gold/renderer', () => {
  it('exposes a version string', () => {
    expect(version()).toBe(RENDERER_VERSION);
  });
});

describe('terrain data', () => {
  it('maps common terrain ids to documented atlas rects', () => {
    expect(rectForTexture(0x05)).toEqual([193, 49, 53, 54]); // water diamond
    expect(rectForTexture(0x08)).toEqual([48, 96, 32, 31]); // meadow1
    expect(rectForTexture(0x02)).toEqual([0, 0, 32, 31]); // snow
    expect(rectForTexture(0x01)).toEqual([0, 48, 32, 31]); // mountain1
  });

  it('masks off harbor/flag bits before lookup', () => {
    expect(rectForTexture(0x40 | 0x08)).toEqual(rectForTexture(0x08));
    expect(rectForTexture(0x80 | 0x05)).toEqual(rectForTexture(0x05));
  });

  it('falls back for unmapped ids', () => {
    expect(rectForTexture(0x17)).toBeDefined();
    expect(rectForTexture(0x3f)).toBeDefined();
  });

  it('classifies texture sampling types', () => {
    expect(texTypeForTexture(0x05)).toBe('rotated'); // water
    expect(texTypeForTexture(0x10)).toBe('rotated'); // lava
    expect(texTypeForTexture(0x14)).toBe('stacked'); // lava2
    expect(texTypeForTexture(0x08)).toBe('overlapped'); // meadow
  });

  it('provides minimap colors per landscape', () => {
    expect(minimapColor(0x05, 0)).toBe(0x1038a4); // greenland water = blue
    expect(minimapColor(0x02, 0)).toBe(0xffffff); // greenland snow = white
    expect(minimapColor(0x05, 1)).toBe(0x454520); // wasteland moor
    expect(minimapColor(0x02, 2)).toBe(0x00286c); // winter ice floe
  });

  it('keeps every rect inside the atlas', () => {
    for (const [x, y, w, h] of Object.values(TERRAIN_RECTS)) {
      expect(x + w).toBeLessThanOrEqual(ATLAS_SIZE);
      expect(y + h).toBeLessThanOrEqual(ATLAS_SIZE);
    }
  });
});

describe('lattice geometry', () => {
  it('offsets neighbours by row parity', () => {
    // Even row: SE keeps x, SW is x-1.
    expect(neighbourSE(3, 2)).toEqual({ x: 3, y: 3 });
    expect(neighbourSW(3, 2)).toEqual({ x: 2, y: 3 });
    // Odd row: SE is x+1, SW keeps x.
    expect(neighbourSE(3, 3)).toEqual({ x: 4, y: 4 });
    expect(neighbourSW(3, 3)).toEqual({ x: 3, y: 4 });
    expect(neighbourE(3, 3)).toEqual({ x: 4, y: 3 });
  });

  it('positions odd rows half a step right and raises by elevation', () => {
    expect(nodeWorldPos({ x: 2, y: 2 }, 0)).toEqual({ x: 2 * TR_W, y: 2 * TR_H });
    expect(nodeWorldPos({ x: 2, y: 3 }, 0)).toEqual({ x: 2 * TR_W + TR_W / 2, y: 3 * TR_H });
    expect(nodeWorldPos({ x: 0, y: 0 }, 10).y).toBe(-10 * HEIGHT_FACTOR);
  });

  it('wraps lattice coordinates on the torus', () => {
    expect(wrapNode({ x: 4, y: 4 }, 4, 4)).toEqual({ x: 0, y: 0 });
    expect(wrapNode({ x: -1, y: -1 }, 4, 4)).toEqual({ x: 3, y: 3 });
  });

  it('computes map pixel periods', () => {
    expect(mapPixelWidth(64)).toBe(64 * TR_W);
    expect(mapPixelHeight(64)).toBe(64 * TR_H);
  });
});

describe('mesh builder', () => {
  it('emits 6 vertices per node with the interleaved layout', () => {
    const map = makeMap(4, 4);
    const mesh = buildTerrainMesh(map);
    expect(mesh.vertexCount).toBe(4 * 4 * 6);
    expect(mesh.vertices.length).toBe(mesh.vertexCount * FLOATS_PER_VERTEX);
  });

  it('keeps UVs normalized and brightness neutral at shading 64', () => {
    const mesh = buildTerrainMesh(makeMap(2, 2));
    for (let v = 0; v < mesh.vertexCount; v++) {
      const o = v * FLOATS_PER_VERTEX;
      expect(mesh.vertices[o + 2]).toBeGreaterThanOrEqual(0);
      expect(mesh.vertices[o + 2]).toBeLessThanOrEqual(1);
      expect(mesh.vertices[o + 3]).toBeGreaterThanOrEqual(0);
      expect(mesh.vertices[o + 3]).toBeLessThanOrEqual(1);
      expect(mesh.vertices[o + 4]).toBe(1);
    }
  });

  it('extends edge triangles past the map bounds for seamless tiling', () => {
    const map = makeMap(4, 4);
    const mesh = buildTerrainMesh(map);
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let v = 0; v < mesh.vertexCount; v++) {
      const o = v * FLOATS_PER_VERTEX;
      maxX = Math.max(maxX, mesh.vertices[o] ?? 0);
      maxY = Math.max(maxY, mesh.vertices[o + 1] ?? 0);
    }
    // Last column's LSD east vertex sits at x = width * TR_W (+ odd-row shift).
    expect(maxX).toBeGreaterThanOrEqual(mapPixelWidth(4));
    // Last row's south neighbours sit at y = height * TR_H minus the raise.
    expect(maxY).toBeGreaterThanOrEqual(mapPixelHeight(4) - 10 * HEIGHT_FACTOR);
  });

  it('rejects mismatched layer sizes', () => {
    const bad = { ...makeMap(4, 4), shading: new Uint8Array(3) };
    expect(() => buildTerrainMesh(bad)).toThrow(/shading/);
  });
});

describe('camera', () => {
  it('wraps pan across the torus in both directions', () => {
    const cam = new Camera(64, 64);
    cam.panWorld(-10, -10);
    expect(cam.x).toBe(64 * TR_W - 10);
    expect(cam.y).toBe(64 * TR_H - 10);
    cam.panWorld(20, 20);
    expect(cam.x).toBe(10);
    expect(cam.y).toBe(10);
  });

  it('halves pan distance at 2x zoom for screen-space drags', () => {
    const cam = new Camera(64, 64);
    cam.zoom = 2;
    cam.panScreen(20, 0);
    expect(cam.x).toBe(10);
  });

  it('keeps the view center when toggling zoom', () => {
    const cam = new Camera(64, 64);
    cam.centerOn(500, 300, 800, 600);
    cam.toggleZoom(800, 600);
    expect(cam.zoom).toBe(2);
    expect(cam.x + 800 / cam.zoom / 2).toBeCloseTo(500);
    expect(cam.y + 600 / cam.zoom / 2).toBeCloseTo(300);
  });

  it('wrap() maps any value into [0, period)', () => {
    expect(wrap(-1, 10)).toBe(9);
    expect(wrap(10, 10)).toBe(0);
    expect(wrap(25, 10)).toBe(5);
  });
});

describe('minimap', () => {
  it('builds one RGBA pixel per node', () => {
    const map = makeMap(4, 4);
    const pixels = buildMinimapPixels(map);
    expect(pixels.length).toBe(4 * 4 * 4);
    // meadow1 on greenland is a green tone; alpha opaque.
    expect(pixels[3]).toBe(255);
    expect(pixels[1]).toBeGreaterThan(pixels[0] ?? 0); // green channel dominates red
  });

  it('modulates color by elevation', () => {
    expect(heightBrightness(10)).toBe(1);
    expect(heightBrightness(30)).toBeGreaterThan(1);
    expect(heightBrightness(0)).toBeLessThan(1);
    expect(heightBrightness(200)).toBeLessThanOrEqual(1.5);
  });
});
