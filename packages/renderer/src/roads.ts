/**
 * Road overlay: draws the player's road network as flat coloured segments on
 * top of the terrain and beneath the sprite layer. Engine-agnostic and additive
 * — it shares the terrain's GL context but touches none of the terrain state.
 *
 * The original game lays a tiled dirt/cobble texture along each road edge; for
 * P2 a solid tapered quad per edge reads clearly and keeps the renderer simple.
 * Segments are supplied in world pixels each frame (the app resolves node
 * anchors); the torus wrap is handled exactly like the terrain and sprites by
 * re-emitting each segment at every map-tile offset that meets the viewport.
 */

import type { Camera } from './camera';
import { TR_H, TR_W } from './terrain-data';

/** Default committed-road colour (opaque dirt path). */
const DIRT_COLOR: readonly [number, number, number, number] = [0.72, 0.6, 0.42, 1.0];

/**
 * Upgraded (donkey) road colour: a darker, cooler cobbled path drawn over the
 * dirt pass so a road that earned its pack donkey reads as the paved variant the
 * original game swaps in. Pair it with a slightly larger `halfWidth` for a road
 * that looks visibly heavier-trafficked.
 */
export const DONKEY_ROAD_COLOR: readonly [number, number, number, number] = [0.46, 0.42, 0.38, 1.0];

/** A road edge as two world-pixel endpoints (a node-to-node step). */
export interface RoadSegment {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

const VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 aPos; // world px relative to camera top-left
uniform vec2 uScale;               // 2 * zoom / canvas size
uniform float uZ;                  // <0 = derive depth from screen y; else this constant z
void main() {
  float clipX = aPos.x * uScale.x - 1.0;
  float clipY = 1.0 - aPos.y * uScale.y;
  // Ground roads take a screen-y depth (top of screen = far) into [0, 0.98] so a
  // road occludes buildings behind it and is occluded by those in front; overlays
  // pass a fixed uZ (0, nearest) so they always sit on top.
  float z = uZ < 0.0 ? clamp((clipY + 1.0) * 0.5 * 0.98, 0.0, 0.98) : uZ;
  gl_Position = vec4(clipX, clipY, z, 1.0);
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;
uniform vec4 uColor;
out vec4 outColor;
void main() { outColor = uColor; }
`;

/** Half-width of a drawn road in world pixels. */
const ROAD_HALF_WIDTH = 3.5;
const FLOATS_PER_VERTEX = 2;
const VERTS_PER_QUAD = 6;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('failed to create road shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'unknown error';
    gl.deleteShader(shader);
    throw new Error(`road shader compile failed: ${log}`);
  }
  return shader;
}

/** WebGL2 flat-quad renderer for road edges, sharing the terrain context. */
export class RoadRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly uScale: WebGLUniformLocation;
  private readonly uColor: WebGLUniformLocation;
  private readonly uZ: WebGLUniformLocation;
  private readonly vao: WebGLVertexArrayObject;
  private readonly vbo: WebGLBuffer;

  private worldW = 0;
  private worldH = 0;
  private scratch = new Float32Array(0);

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (!program) throw new Error('failed to create road program');
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`road program link failed: ${gl.getProgramInfoLog(program) ?? 'unknown'}`);
    }
    this.program = program;
    const uScale = gl.getUniformLocation(program, 'uScale');
    const uColor = gl.getUniformLocation(program, 'uColor');
    const uZ = gl.getUniformLocation(program, 'uZ');
    if (!uScale || !uColor || !uZ) throw new Error('missing road uniforms');
    this.uScale = uScale;
    this.uColor = uColor;
    this.uZ = uZ;

    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    if (!vao || !vbo) throw new Error('failed to allocate road GL objects');
    this.vao = vao;
    this.vbo = vbo;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, FLOATS_PER_VERTEX * 4, 0);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  /** Set the map dimensions for torus-wrap replication. */
  setMap(width: number, height: number): void {
    this.worldW = width * TR_W;
    this.worldH = height * TR_H;
  }

  /**
   * Draw road segments for the current camera. `color` (rgba, 0..1) overrides
   * the default dirt path — pass a translucent colour to draw a build preview
   * or marker over the committed roads (blending is already enabled).
   */
  render(
    camera: Camera,
    segments: readonly RoadSegment[],
    color: readonly [number, number, number, number] = DIRT_COLOR,
    onGround = true,
    halfWidth: number = ROAD_HALF_WIDTH,
  ): void {
    if (segments.length === 0 || this.worldW === 0) return;
    const gl = this.gl;
    const cw = gl.drawingBufferWidth;
    const ch = gl.drawingBufferHeight;
    const viewW = cw / camera.zoom;
    const viewH = ch / camera.zoom;

    const i0 = Math.floor((camera.x - TR_W) / this.worldW) - 1;
    const i1 = Math.floor((camera.x + viewW) / this.worldW) + 1;
    const j0 = Math.floor((camera.y - TR_H) / this.worldH) - 1;
    const j1 = Math.floor((camera.y + viewH + TR_H) / this.worldH) + 1;

    const needed = segments.length * (i1 - i0 + 1) * (j1 - j0 + 1) * VERTS_PER_QUAD * FLOATS_PER_VERTEX;
    if (this.scratch.length < needed) this.scratch = new Float32Array(needed);
    const buf = this.scratch;
    let o = 0;
    let quads = 0;

    for (let j = j0; j <= j1; j++) {
      const oy = j * this.worldH - camera.y;
      for (let i = i0; i <= i1; i++) {
        const ox = i * this.worldW - camera.x;
        for (const s of segments) {
          const ax = s.x0 + ox;
          const ay = s.y0 + oy;
          const bx = s.x1 + ox;
          const by = s.y1 + oy;
          // Cull segments whose bounding box misses the viewport.
          const minx = Math.min(ax, bx);
          const maxx = Math.max(ax, bx);
          const miny = Math.min(ay, by);
          const maxy = Math.max(ay, by);
          if (maxx < -TR_W || minx > viewW + TR_W || maxy < -TR_H || miny > viewH + TR_H) continue;
          o = this.writeSegment(buf, o, ax, ay, bx, by, halfWidth);
          quads++;
        }
      }
    }
    if (quads === 0) return;

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniform2f(this.uScale, (2 * camera.zoom) / cw, (2 * camera.zoom) / ch);
    gl.uniform4f(this.uColor, color[0], color[1], color[2], color[3]);
    // Ground roads take a screen-y depth and test/write it; overlays (markers,
    // preview, garrison) sit on top: no depth test, fixed near z, no depth write.
    gl.uniform1f(this.uZ, onGround ? -1 : 0);
    if (onGround) {
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
    } else {
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, buf.subarray(0, o), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, quads * VERTS_PER_QUAD);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  private writeSegment(
    buf: Float32Array,
    start: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
    halfWidth: number = ROAD_HALF_WIDTH,
  ): number {
    let dx = bx - ax;
    let dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    // Perpendicular, scaled to half-width.
    const px = -dy * halfWidth;
    const py = dx * halfWidth;
    let o = start;
    const push = (x: number, y: number): void => {
      buf[o++] = x;
      buf[o++] = y;
    };
    push(ax + px, ay + py);
    push(ax - px, ay - py);
    push(bx + px, by + py);
    push(bx + px, by + py);
    push(ax - px, ay - py);
    push(bx - px, by - py);
    return o;
  }

  /** Release all GL resources owned by this renderer. */
  dispose(): void {
    const gl = this.gl;
    gl.deleteBuffer(this.vbo);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
  }
}
