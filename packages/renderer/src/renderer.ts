/**
 * WebGL2 terrain renderer.
 *
 * Uploads the whole map as one static vertex buffer and draws it with a single
 * program against the terrain atlas texture. The torus wrap is handled by
 * drawing the mesh once per map-tile offset that intersects the viewport (at
 * most a few draws), translating via a uniform.
 */

import type { TerrainMapData } from './map-data';
import { buildTerrainMesh, FLOATS_PER_VERTEX } from './mesh';
import { HEIGHT_FACTOR, TR_H, TR_W } from './terrain-data';
import { mapPixelHeight, mapPixelWidth } from './geometry';
import type { Camera } from './camera';

const VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 aPos;
layout(location = 1) in vec2 aUv;
layout(location = 2) in float aShade;
layout(location = 3) in float aFog;

uniform vec2 uTranslate; // world-px offset (tile offset minus camera)
uniform vec2 uScale;     // 2 * zoom / canvas size

out vec2 vUv;
out float vShade;
out float vFog;

void main() {
  vec2 world = aPos + uTranslate;
  float clipX = world.x * uScale.x - 1.0;
  float clipY = 1.0 - world.y * uScale.y;
  // Terrain sits at the far plane (0.99) so roads and sprites — which map into
  // [0, 0.98] by screen depth — always draw over the ground (see roads/sprites).
  gl_Position = vec4(clipX, clipY, 0.99, 1.0);
  vUv = aUv;
  vShade = aShade;
  vFog = aFog;
}
`;

// Palette-exact pipeline: the atlas holds raw palette INDICES (R8); the
// interpolated per-vertex shade row picks the shaded index from the gouraud
// LUT (GOU5/6/7.DAT, 256 rows x 256 columns), and the palette texture maps it
// to RGB. Water/lava animate by rotating their palette slots (CRNG), so the
// palette texture is the only thing that changes per animation step.
const FRAGMENT_SHADER = `#version 300 es
precision mediump float;

uniform sampler2D uAtlasIdx; // R8 palette indices
uniform sampler2D uGouraud;  // 256x256 LUT: (index, shade row) -> shaded index
uniform sampler2D uPalette;  // 256x1 RGBA palette (animated)
// 1 when drawing border bands: their edge strips use palette index 0 as
// transparency (winter base terrain uses 0 as a real color, so no global key).
uniform float uKeyZero;

in vec2 vUv;
in float vShade;
in float vFog;
out vec4 outColor;

void main() {
  float idx = texture(uAtlasIdx, vUv).r * 255.0;
  if (uKeyZero > 0.5 && idx < 0.5) discard;
  float shaded = texture(uGouraud, vec2((idx + 0.5) / 256.0, vShade)).r * 255.0;
  vec3 rgb = texture(uPalette, vec2((shaded + 0.5) / 256.0, 0.5)).rgb;
  outColor = vec4(rgb * vFog, 1.0);
}
`;

/** Maximum on-screen node raise; used as draw-culling margin. */
const MAX_RAISE = 60 * HEIGHT_FACTOR;

/**
 * Brightness multiplier applied to a node's terrain by its fog-of-war state,
 * indexed by the per-node byte passed to {@link TerrainRenderer.setFog}:
 * 0 = unexplored (black), 1 = explored but not currently seen (dim snapshot),
 * 2 = visible (full brightness). Values outside 0..2 are treated as visible.
 */
const FOG_BRIGHTNESS: readonly number[] = [0, 0.4, 1];

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('failed to create shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'unknown error';
    gl.deleteShader(shader);
    throw new Error(`shader compile failed: ${log}`);
  }
  return shader;
}

/** Options for constructing a {@link TerrainRenderer}. */
export interface TerrainRendererOptions {
  /**
   * Keep the drawing buffer readable after present (needed by tests that
   * sample pixels via toDataURL/readPixels). Defaults to true.
   */
  preserveDrawingBuffer?: boolean;
}

/** One CRNG palette-cycling range (inclusive indices, ms per rotation step). */
export interface PaletteCycle {
  readonly low: number;
  readonly high: number;
  readonly msPerStep: number;
}

/** The palette-exact terrain inputs (all from the converted asset pipeline). */
export interface TerrainAssets {
  /** Grayscale palette-index atlas (terrain/texN_indexed.png). */
  readonly indexed: TexImageSource;
  /** 768-byte RGB palette (terrain/texN_pal.json colors). */
  readonly palette: Uint8Array;
  /** 65536-byte gouraud LUT, row-major table[shade * 256 + index]. */
  readonly gouraud: Uint8Array;
  /** Active CRNG cycles (water/lava animation). */
  readonly cycles: readonly PaletteCycle[];
}

/** WebGL2 renderer for one loaded map. Engine-agnostic: no game state. */
export class TerrainRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly uTranslate: WebGLUniformLocation;
  private readonly uScale: WebGLUniformLocation;
  private readonly uKeyZero: WebGLUniformLocation;
  private readonly vao: WebGLVertexArrayObject;
  private readonly vbo: WebGLBuffer;
  private readonly texIndex: WebGLTexture;
  private readonly texGouraud: WebGLTexture;
  private readonly texPalette: WebGLTexture;

  /** Base (unrotated) 256-entry RGBA palette; cycles rotate slots of a copy. */
  private basePalette: Uint8Array = new Uint8Array(0);
  private paletteScratch: Uint8Array = new Uint8Array(256 * 4);
  private cycles: readonly PaletteCycle[] = [];
  /** Last uploaded per-cycle phases; palette re-uploads only on change. */
  private cyclePhases: number[] = [];

  private vertexCount = 0;
  private baseVertexCount = 0;
  private worldW = 0;
  private worldH = 0;
  /** Pristine interleaved vertices (fog-free), kept so fog can remodulate them. */
  private baseVertices: Float32Array = new Float32Array(0);
  /** Wrapped source node per vertex (for per-node fog brightness). */
  private nodeOfVertex: Uint32Array = new Uint32Array(0);
  /** Scratch buffer for the fog-modulated vertex upload. */
  private fogVertices: Float32Array = new Float32Array(0);

  constructor(
    readonly canvas: HTMLCanvasElement,
    options: TerrainRendererOptions = {},
  ) {
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? true,
    });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;

    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (!program) throw new Error('failed to create program');
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`program link failed: ${gl.getProgramInfoLog(program) ?? 'unknown'}`);
    }
    this.program = program;

    const uTranslate = gl.getUniformLocation(program, 'uTranslate');
    const uScale = gl.getUniformLocation(program, 'uScale');
    const uKeyZero = gl.getUniformLocation(program, 'uKeyZero');
    if (!uTranslate || !uScale || !uKeyZero) throw new Error('missing shader uniforms');
    this.uTranslate = uTranslate;
    this.uScale = uScale;
    this.uKeyZero = uKeyZero;

    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    const texIndex = gl.createTexture();
    const texGouraud = gl.createTexture();
    const texPalette = gl.createTexture();
    if (!vao || !vbo || !texIndex || !texGouraud || !texPalette) {
      throw new Error('failed to allocate GL objects');
    }
    this.vao = vao;
    this.vbo = vbo;
    this.texIndex = texIndex;
    this.texGouraud = texGouraud;
    this.texPalette = texPalette;

    // Static sampler bindings: index atlas on unit 0, gouraud LUT on 1,
    // palette on 2.
    gl.useProgram(program);
    gl.uniform1i(gl.getUniformLocation(program, 'uAtlasIdx'), 0);
    gl.uniform1i(gl.getUniformLocation(program, 'uGouraud'), 1);
    gl.uniform1i(gl.getUniformLocation(program, 'uPalette'), 2);
    gl.useProgram(null);

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    const stride = FLOATS_PER_VERTEX * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 8);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 16);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 20);
    gl.bindVertexArray(null);

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);
  }

  /** Upload a map mesh and its terrain assets. Replaces any previous map. */
  load(map: TerrainMapData, assets: TerrainAssets): void {
    const gl = this.gl;
    const mesh = buildTerrainMesh(map);
    this.vertexCount = mesh.vertexCount;
    this.baseVertexCount = mesh.baseVertexCount;
    this.worldW = mapPixelWidth(map.width);
    this.worldH = mapPixelHeight(map.height);
    this.baseVertices = mesh.vertices;
    this.nodeOfVertex = mesh.nodeOfVertex;
    this.fogVertices = new Float32Array(mesh.vertices.length);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    const nearest = (): void => {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    };

    // Palette-index atlas: a grayscale image; keep only the red channel.
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindTexture(gl.TEXTURE_2D, this.texIndex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, assets.indexed);
    nearest();

    // Gouraud LUT: row-major table[shade * 256 + index] -> shaded index.
    if (assets.gouraud.length !== 256 * 256) {
      throw new Error(`gouraud LUT is ${assets.gouraud.length} bytes, expected 65536`);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.texGouraud);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 256, 256, 0, gl.RED, gl.UNSIGNED_BYTE, assets.gouraud);
    nearest();

    // Palette: 768-byte RGB expanded to RGBA; water/lava CRNG cycles rotate
    // slots of a scratch copy per animation step (see render()).
    if (assets.palette.length !== 768) {
      throw new Error(`palette is ${assets.palette.length} bytes, expected 768`);
    }
    this.basePalette = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      this.basePalette[i * 4] = assets.palette[i * 3] ?? 0;
      this.basePalette[i * 4 + 1] = assets.palette[i * 3 + 1] ?? 0;
      this.basePalette[i * 4 + 2] = assets.palette[i * 3 + 2] ?? 0;
      this.basePalette[i * 4 + 3] = 255;
    }
    this.cycles = assets.cycles;
    this.cyclePhases = assets.cycles.map(() => -1);
    gl.bindTexture(gl.TEXTURE_2D, this.texPalette);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      256,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      this.basePalette,
    );
    nearest();
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    this.updatePalette(0);
  }

  /**
   * Rotate the CRNG palette ranges to their phase at `nowMs` and re-upload the
   * palette texture when any phase changed. A cycle of length N shifts its
   * colors one slot toward higher indices every msPerStep.
   */
  private updatePalette(nowMs: number): void {
    if (this.basePalette.length === 0 || this.cycles.length === 0) return;
    let changed = false;
    for (let c = 0; c < this.cycles.length; c++) {
      const cycle = this.cycles[c];
      if (!cycle) continue;
      const len = cycle.high - cycle.low + 1;
      const phase = Math.floor(nowMs / cycle.msPerStep) % len;
      if (phase !== this.cyclePhases[c]) {
        this.cyclePhases[c] = phase;
        changed = true;
      }
    }
    if (!changed) return;
    const out = this.paletteScratch;
    out.set(this.basePalette);
    for (let c = 0; c < this.cycles.length; c++) {
      const cycle = this.cycles[c];
      if (!cycle) continue;
      const len = cycle.high - cycle.low + 1;
      const phase = this.cyclePhases[c] ?? 0;
      for (let j = 0; j < len; j++) {
        const src = (cycle.low + j) * 4;
        const dst = (cycle.low + ((j + phase) % len)) * 4;
        out[dst] = this.basePalette[src] ?? 0;
        out[dst + 1] = this.basePalette[src + 1] ?? 0;
        out[dst + 2] = this.basePalette[src + 2] ?? 0;
      }
    }
    const gl = this.gl;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindTexture(gl.TEXTURE_2D, this.texPalette);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  }

  /**
   * Apply (or clear) fog of war. `fog` is one byte per map node (row-major
   * width*height): 0 unexplored, 1 explored/not-seen, 2 visible (see
   * {@link FOG_BRIGHTNESS}). Pass `null` to restore full brightness. Cheap to
   * call whenever visibility changes (e.g. on TerritoryChanged) — it re-modulates
   * the static mesh's per-vertex brightness and re-uploads the buffer.
   */
  setFog(fog: Uint8Array | null): void {
    if (this.vertexCount === 0) return;
    const gl = this.gl;
    const stride = FLOATS_PER_VERTEX;
    let data: Float32Array;
    if (!fog) {
      data = this.baseVertices;
    } else {
      const base = this.baseVertices;
      const out = this.fogVertices;
      out.set(base);
      for (let v = 0; v < this.vertexCount; v++) {
        const node = this.nodeOfVertex[v] ?? 0;
        const state = fog[node] ?? 2;
        const factor = FOG_BRIGHTNESS[state] ?? 1;
        out[v * stride + 5] = (base[v * stride + 5] ?? 1) * factor;
      }
      data = out;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  /** True when a map has been loaded. */
  get loaded(): boolean {
    return this.vertexCount > 0;
  }

  /**
   * The WebGL2 context backing this renderer's canvas. The sprite layer shares
   * it so both draw into the same drawing buffer. Additive; the terrain API is
   * otherwise unchanged.
   */
  get glContext(): WebGL2RenderingContext {
    return this.gl;
  }

  /**
   * Match the canvas backing-store size to its CSS size * devicePixelRatio.
   * Returns true when the size changed.
   */
  resize(): boolean {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width === w && this.canvas.height === h) return false;
    this.canvas.width = w;
    this.canvas.height = h;
    return true;
  }

  /** Render the loaded map for the given camera; `nowMs` drives water/lava. */
  render(camera: Camera, nowMs = 0): void {
    const gl = this.gl;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    gl.viewport(0, 0, cw, ch);
    // Depth-buffered so roads and sprites occlude by their on-screen position
    // (a road in front of a building draws over it; one behind is hidden). The
    // terrain pass owns clearing depth for the frame; later passes test against it.
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!this.loaded) return;

    this.updatePalette(nowMs);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.texPalette);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texGouraud);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texIndex);
    gl.uniform2f(this.uScale, (2 * camera.zoom) / cw, (2 * camera.zoom) / ch);

    // The mesh spans [0, worldW + TR_W] x [-MAX_RAISE, worldH + TR_H] in world
    // px; draw every tile offset whose padded bounds intersect the viewport.
    const viewW = cw / camera.zoom;
    const viewH = ch / camera.zoom;
    const i0 = Math.floor((camera.x - TR_W) / this.worldW) - 1;
    const i1 = Math.floor((camera.x + viewW) / this.worldW);
    const j0 = Math.floor((camera.y - TR_H) / this.worldH) - 1;
    const j1 = Math.floor((camera.y + viewH + MAX_RAISE) / this.worldH);

    for (let j = j0; j <= j1; j++) {
      const oy = j * this.worldH;
      if (oy + this.worldH + TR_H + MAX_RAISE < camera.y || oy - MAX_RAISE > camera.y + viewH) {
        continue;
      }
      for (let i = i0; i <= i1; i++) {
        const ox = i * this.worldW;
        if (ox + this.worldW + TR_W < camera.x || ox > camera.x + viewW) continue;
        gl.uniform2f(this.uTranslate, ox - camera.x, oy - camera.y);
        gl.uniform1f(this.uKeyZero, 0);
        gl.drawArrays(gl.TRIANGLES, 0, this.baseVertexCount);
        if (this.vertexCount > this.baseVertexCount) {
          gl.uniform1f(this.uKeyZero, 1);
          gl.drawArrays(
            gl.TRIANGLES,
            this.baseVertexCount,
            this.vertexCount - this.baseVertexCount,
          );
        }
      }
    }

    gl.bindVertexArray(null);
  }

  /** Release all GL resources. */
  dispose(): void {
    const gl = this.gl;
    gl.deleteBuffer(this.vbo);
    gl.deleteVertexArray(this.vao);
    gl.deleteTexture(this.texIndex);
    gl.deleteTexture(this.texGouraud);
    gl.deleteTexture(this.texPalette);
    gl.deleteProgram(this.program);
    this.vertexCount = 0;
  }
}
