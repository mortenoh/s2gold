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
layout(location = 2) in float aBright;

uniform vec2 uTranslate; // world-px offset (tile offset minus camera)
uniform vec2 uScale;     // 2 * zoom / canvas size

out vec2 vUv;
out float vBright;

void main() {
  vec2 world = aPos + uTranslate;
  float clipX = world.x * uScale.x - 1.0;
  float clipY = 1.0 - world.y * uScale.y;
  gl_Position = vec4(clipX, clipY, 0.0, 1.0);
  vUv = aUv;
  vBright = aBright;
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;

uniform sampler2D uAtlas;

in vec2 vUv;
in float vBright;
out vec4 outColor;

void main() {
  vec4 tex = texture(uAtlas, vUv);
  // P1 lighting approximation: shading byte / 64 as an RGB multiplier. The
  // palette-exact gouraud LUT (GOU*.DAT) lands in a later phase.
  outColor = vec4(clamp(tex.rgb * vBright, 0.0, 1.0), 1.0);
}
`;

/** Maximum on-screen node raise; used as draw-culling margin. */
const MAX_RAISE = 60 * HEIGHT_FACTOR;

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

/** WebGL2 renderer for one loaded map. Engine-agnostic: no game state. */
export class TerrainRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly uTranslate: WebGLUniformLocation;
  private readonly uScale: WebGLUniformLocation;
  private readonly vao: WebGLVertexArrayObject;
  private readonly vbo: WebGLBuffer;
  private readonly texture: WebGLTexture;

  private vertexCount = 0;
  private worldW = 0;
  private worldH = 0;

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
    if (!uTranslate || !uScale) throw new Error('missing shader uniforms');
    this.uTranslate = uTranslate;
    this.uScale = uScale;

    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    const texture = gl.createTexture();
    if (!vao || !vbo || !texture) throw new Error('failed to allocate GL objects');
    this.vao = vao;
    this.vbo = vbo;
    this.texture = texture;

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    const stride = FLOATS_PER_VERTEX * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 8);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 16);
    gl.bindVertexArray(null);

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);
  }

  /** Upload a map mesh and its terrain atlas. Replaces any previous map. */
  load(map: TerrainMapData, atlas: TexImageSource): void {
    const gl = this.gl;
    const mesh = buildTerrainMesh(map);
    this.vertexCount = mesh.vertexCount;
    this.worldW = mapPixelWidth(map.width);
    this.worldH = mapPixelHeight(map.height);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
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

  /** Render the loaded map for the given camera. */
  render(camera: Camera): void {
    const gl = this.gl;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    gl.viewport(0, 0, cw, ch);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.loaded) return;

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
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
        gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
      }
    }

    gl.bindVertexArray(null);
  }

  /** Release all GL resources. */
  dispose(): void {
    const gl = this.gl;
    gl.deleteBuffer(this.vbo);
    gl.deleteVertexArray(this.vao);
    gl.deleteTexture(this.texture);
    gl.deleteProgram(this.program);
    this.vertexCount = 0;
  }
}
