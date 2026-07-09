/**
 * WebGL2 sprite batch renderer for the object layer.
 *
 * Shares the terrain's canvas + GL context (the app passes the context obtained
 * from {@link TerrainRenderer.glContext}). Draws screen-space quads anchored at
 * world-node positions, culled to the viewport and depth-ordered by world y
 * (painter's order), with the torus wrap handled exactly like the terrain: an
 * object near the seam is emitted for every map-tile offset that intersects the
 * viewport, so it appears on both sides.
 *
 * Batching: visible quads are globally depth-sorted, then flushed in runs of
 * the same atlas page so a scene backed by a single-page atlas (mapbobs) costs
 * one `drawArrays` call regardless of object count.
 *
 * Player colour: the fragment shader supports a second (pmask) texture lookup
 * where the R channel encodes the light/dark shade and non-zero alpha marks the
 * player-coloured pixels; those pixels are replaced by `tint * shade`. The
 * mapbobs archive ships no pmasks, so map objects are never tinted, but the
 * path is live for the later unit/building layers that do.
 */

import type { Camera } from './camera';
import { nodeWorldPos } from './geometry';
import { HEIGHT_FACTOR, TR_H, TR_W } from './terrain-data';
import {
  PLAYER_COLORS,
  unpackColor,
  type DynamicSprite,
  type SpriteAtlasMeta,
  type StaticObject,
} from './scene';

const VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 aPos;     // world px relative to camera top-left
layout(location = 1) in vec2 aUv;      // atlas uv (normalized)
layout(location = 2) in vec3 aTint;    // player tint rgb
layout(location = 3) in vec2 aMaskUv;  // pmask uv, (<0) = no mask

uniform vec2 uScale; // 2 * zoom / canvas size

out vec2 vUv;
out vec3 vTint;
out vec2 vMaskUv;

void main() {
  float clipX = aPos.x * uScale.x - 1.0;
  float clipY = 1.0 - aPos.y * uScale.y;
  gl_Position = vec4(clipX, clipY, 0.0, 1.0);
  vUv = aUv;
  vTint = aTint;
  vMaskUv = aMaskUv;
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;

uniform sampler2D uAtlas;
uniform sampler2D uPmask;

in vec2 vUv;
in vec3 vTint;
in vec2 vMaskUv;
out vec4 outColor;

void main() {
  vec4 base = texture(uAtlas, vUv);
  if (vMaskUv.x >= 0.0) {
    vec4 m = texture(uPmask, vMaskUv);
    if (m.a > 0.5) {
      // R channel is the player-colour shade; replace pixel with tint * shade.
      base = vec4(vTint * m.r, base.a);
    }
  }
  if (base.a < 0.02) discard;
  outColor = base;
}
`;

/** Floats per vertex: x, y, u, v, tintR, tintG, tintB, maskU, maskV. */
const FLOATS_PER_VERTEX = 9;
const VERTS_PER_QUAD = 6;
/** Max on-screen node raise (matches the terrain cull margin). */
const MAX_RAISE = 60 * HEIGHT_FACTOR;
const NO_TINT: readonly [number, number, number] = [1, 1, 1];

/** An atlas page image that carries its pixel dimensions. */
export type AtlasPage = TexImageSource & { readonly width: number; readonly height: number };

/** Registered atlas: metadata plus one GL texture (and size) per page. */
interface RegisteredAtlas {
  readonly meta: SpriteAtlasMeta;
  readonly textures: readonly WebGLTexture[];
  readonly sizes: readonly (readonly [number, number])[];
  /** Player-colour mask texture per page (index-aligned; null when absent). */
  readonly pmaskTextures: readonly (WebGLTexture | null)[];
}

/** A static object with its base world anchor precomputed once. */
interface PlacedStatic {
  readonly obj: StaticObject;
  readonly worldX: number;
  readonly worldY: number;
}

/** One quad queued for a frame, keyed for depth sort and page grouping. */
interface QuadItem {
  archive: string;
  page: number;
  depth: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  tint: readonly [number, number, number];
  /** When true the quad samples the page's pmask so `tint` recolours it. */
  masked: boolean;
}

/** Counts returned from a {@link SpriteRenderer.render} call for diagnostics. */
export interface SpriteDrawStats {
  /** Quads emitted (sprites + shadows) after culling. */
  readonly quads: number;
  /** GL draw calls issued (one per contiguous same-page run). */
  readonly drawCalls: number;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('failed to create sprite shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'unknown error';
    gl.deleteShader(shader);
    throw new Error(`sprite shader compile failed: ${log}`);
  }
  return shader;
}

/** WebGL2 sprite batch renderer sharing a context with the terrain. */
export class SpriteRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly uScale: WebGLUniformLocation;
  private readonly uAtlas: WebGLUniformLocation;
  private readonly uPmask: WebGLUniformLocation;
  private readonly vao: WebGLVertexArrayObject;
  private readonly vbo: WebGLBuffer;
  private readonly whiteTex: WebGLTexture;

  private readonly atlases = new Map<string, RegisteredAtlas>();
  private statics: PlacedStatic[] = [];
  private worldW = 0;
  private worldH = 0;
  private width = 0;
  private elevation: Uint8Array = new Uint8Array(0);
  private scratch = new Float32Array(0);

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (!program) throw new Error('failed to create sprite program');
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`sprite program link failed: ${gl.getProgramInfoLog(program) ?? 'unknown'}`);
    }
    this.program = program;

    const uScale = gl.getUniformLocation(program, 'uScale');
    const uAtlas = gl.getUniformLocation(program, 'uAtlas');
    const uPmask = gl.getUniformLocation(program, 'uPmask');
    if (!uScale || !uAtlas || !uPmask) throw new Error('missing sprite uniforms');
    this.uScale = uScale;
    this.uAtlas = uAtlas;
    this.uPmask = uPmask;

    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    const whiteTex = gl.createTexture();
    if (!vao || !vbo || !whiteTex) throw new Error('failed to allocate sprite GL objects');
    this.vao = vao;
    this.vbo = vbo;
    this.whiteTex = whiteTex;

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    const stride = FLOATS_PER_VERTEX * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 8);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 16);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 2, gl.FLOAT, false, stride, 28);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    // 1x1 opaque-white fallback bound to the pmask sampler when no mask exists.
    gl.bindTexture(gl.TEXTURE_2D, whiteTex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([255, 255, 255, 255]),
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /**
   * Upload an atlas's pages and remember its metadata by archive name.
   * `pmaskPages` (index-aligned with `pages`) are the player-colour mask images;
   * pass them so player-tinted sprites (`pmask: true`) recolour correctly. Masks
   * use NEAREST sampling so the mask alpha stays crisp.
   */
  registerAtlas(
    meta: SpriteAtlasMeta,
    pages: readonly AtlasPage[],
    pmaskPages: readonly (AtlasPage | null)[] = [],
  ): void {
    const gl = this.gl;
    const textures: WebGLTexture[] = [];
    const sizes: (readonly [number, number])[] = [];
    const pmaskTextures: (WebGLTexture | null)[] = [];
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const tex = gl.createTexture();
      if (!tex || !page) throw new Error('failed to allocate atlas texture');
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, page);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      textures.push(tex);
      sizes.push([page.width, page.height]);

      const mask = pmaskPages[i];
      if (mask) {
        const mtex = gl.createTexture();
        if (!mtex) throw new Error('failed to allocate pmask texture');
        gl.bindTexture(gl.TEXTURE_2D, mtex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mask);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        pmaskTextures.push(mtex);
      } else {
        pmaskTextures.push(null);
      }
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.atlases.set(meta.archive, { meta, textures, sizes, pmaskTextures });
  }

  /** True once an atlas with this archive name has been registered. */
  hasAtlas(archive: string): boolean {
    return this.atlases.has(archive);
  }

  /**
   * Set the map layout used to resolve node anchors and torus wrapping. Pass
   * the per-node elevation plane (row-major width * height) so anchors are
   * raised exactly like the terrain mesh.
   */
  setMap(width: number, height: number, elevation: Uint8Array): void {
    this.width = width;
    this.elevation = elevation;
    this.worldW = width * TR_W;
    this.worldH = height * TR_H;
  }

  /**
   * Replace the static object set. World anchors are precomputed once and the
   * list is kept sorted by depth (world y, then x) for painter's ordering.
   */
  setStaticObjects(objects: readonly StaticObject[]): void {
    const placed: PlacedStatic[] = [];
    for (const obj of objects) {
      const idx = obj.node.y * this.width + obj.node.x;
      const pos = nodeWorldPos(obj.node, this.elevation[idx] ?? 0);
      placed.push({ obj, worldX: pos.x, worldY: pos.y });
    }
    placed.sort((a, b) => a.worldY - b.worldY || a.worldX - b.worldX);
    this.statics = placed;
  }

  /** Number of static objects currently loaded. */
  get staticCount(): number {
    return this.statics.length;
  }

  /**
   * Push a quad for one sprite anchored at (`ax`, `ay`) world px relative to
   * the camera, if it intersects the viewport.
   */
  private pushQuad(
    out: QuadItem[],
    archive: string,
    index: number,
    ax: number,
    ay: number,
    viewW: number,
    viewH: number,
    depth: number,
    tint: readonly [number, number, number],
    scale = 1,
    clipBottom = 1,
  ): void {
    const reg = this.atlases.get(archive);
    const s = reg?.meta.sprites.get(index);
    if (!reg || !s) return;
    const w = s.w * scale;
    const h = s.h * scale;
    const x0 = ax - s.nx * scale;
    let y0 = ay - s.ny * scale;
    const x1 = x0 + w;
    const y1 = y0 + h;
    const size = reg.sizes[s.atlas] ?? [1, 1];
    const tw = size[0];
    const th = size[1];
    let v0 = s.y / th;
    const v1 = (s.y + s.h) / th;
    // Reveal only the bottom `clipBottom` fraction: drop the top edge and its uv.
    if (clipBottom < 1) {
      const keep = Math.max(0, Math.min(1, clipBottom));
      y0 = y1 - h * keep;
      v0 = v1 - (v1 - v0) * keep;
    }
    if (x1 <= 0 || x0 >= viewW || y1 <= 0 || y0 >= viewH) return;
    // Recolour only when this sprite ships a mask, the caller asked for a tint,
    // and the archive actually uploaded a pmask page for this atlas.
    const masked =
      s.pmask === true && tint !== NO_TINT && reg.pmaskTextures[s.atlas] != null;
    out.push({
      archive,
      page: s.atlas,
      depth,
      x0,
      y0,
      x1,
      y1,
      u0: s.x / tw,
      v0,
      u1: (s.x + s.w) / tw,
      v1,
      tint,
      masked,
    });
  }

  /**
   * Render the scene for the given camera. `tick` is the global animation
   * counter; `dynamics` are per-frame moving sprites (units), empty for now.
   */
  render(camera: Camera, tick: number, dynamics: readonly DynamicSprite[] = []): SpriteDrawStats {
    const gl = this.gl;
    const cw = gl.drawingBufferWidth;
    const ch = gl.drawingBufferHeight;
    const viewW = cw / camera.zoom;
    const viewH = ch / camera.zoom;
    if (this.atlases.size === 0) return { quads: 0, drawCalls: 0 };

    const items: QuadItem[] = [];
    const i0 = Math.floor((camera.x - TR_W) / this.worldW) - 1;
    const i1 = Math.floor((camera.x + viewW) / this.worldW) + 1;
    const j0 = Math.floor((camera.y - TR_H) / this.worldH) - 1;
    const j1 = Math.floor((camera.y + viewH + MAX_RAISE) / this.worldH) + 1;

    for (let j = j0; j <= j1; j++) {
      const oy = j * this.worldH - camera.y;
      for (let i = i0; i <= i1; i++) {
        const ox = i * this.worldW - camera.x;
        for (const ps of this.statics) {
          const ax = ps.worldX + ox;
          const ay = ps.worldY + oy;
          const anim = ps.obj.animation;
          const spriteIndex = anim
            ? anim.baseIndex + ((tick + anim.phase) % anim.frameCount)
            : ps.obj.spriteIndex;
          if (ps.obj.shadowIndex !== undefined) {
            this.pushQuad(items, ps.obj.archive, ps.obj.shadowIndex, ax, ay, viewW, viewH, ps.worldY - 0.5, NO_TINT); // prettier-ignore
          }
          this.pushQuad(
            items,
            ps.obj.archive,
            spriteIndex,
            ax,
            ay,
            viewW,
            viewH,
            ps.worldY,
            NO_TINT,
          );
        }
        for (const d of dynamics) {
          const ax = d.worldX + ox;
          const ay = d.worldY + oy;
          const tint =
            d.player !== undefined
              ? unpackColor(PLAYER_COLORS[d.player % PLAYER_COLORS.length] ?? 0xffffff)
              : NO_TINT;
          const scale = d.scale ?? 1;
          const clipBottom = d.clipBottom ?? 1;
          if (d.shadowIndex !== undefined) {
            this.pushQuad(
              items,
              d.archive,
              d.shadowIndex,
              ax,
              ay,
              viewW,
              viewH,
              d.worldY - 0.5,
              NO_TINT,
              scale,
            );
          }
          this.pushQuad(
            items,
            d.archive,
            d.spriteIndex,
            ax,
            ay,
            viewW,
            viewH,
            d.worldY,
            tint,
            scale,
            clipBottom,
          );
        }
      }
    }

    if (items.length === 0) return { quads: 0, drawCalls: 0 };
    items.sort((a, b) => a.depth - b.depth || a.page - b.page);
    return this.drawItems(items, camera);
  }

  private drawItems(items: readonly QuadItem[], camera: Camera): SpriteDrawStats {
    const gl = this.gl;
    const needed = items.length * VERTS_PER_QUAD * FLOATS_PER_VERTEX;
    if (this.scratch.length < needed) this.scratch = new Float32Array(needed);
    const buf = this.scratch;

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniform2f(
      this.uScale,
      (2 * camera.zoom) / gl.drawingBufferWidth,
      (2 * camera.zoom) / gl.drawingBufferHeight,
    );
    gl.uniform1i(this.uAtlas, 0);
    gl.uniform1i(this.uPmask, 1);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    let drawCalls = 0;
    let i = 0;
    // Flush a run whenever the atlas texture (archive+page) changes so painter
    // order is preserved while batching every same-texture run into one call.
    while (i < items.length) {
      const first = items[i];
      if (!first) break;
      const { archive, page } = first;
      let o = 0;
      let count = 0;
      while (i < items.length) {
        const it = items[i];
        if (!it || it.archive !== archive || it.page !== page) break;
        o = this.writeQuad(buf, o, it);
        count++;
        i++;
      }
      const reg = this.atlases.get(archive);
      const tex = reg?.textures[page];
      if (reg && tex && o > 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, buf.subarray(0, o), gl.DYNAMIC_DRAW);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        // Bind this page's player-colour mask (white fallback = no recolour).
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, reg.pmaskTextures[page] ?? this.whiteTex);
        gl.drawArrays(gl.TRIANGLES, 0, count * VERTS_PER_QUAD);
        drawCalls++;
      }
    }

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    return { quads: items.length, drawCalls };
  }

  private writeQuad(buf: Float32Array, start: number, q: QuadItem): number {
    let o = start;
    // The pmask page is aligned 1:1 with the atlas page, so a masked quad reuses
    // its own atlas uv to sample the mask; unmasked quads flag maskU < 0 to skip.
    const push = (x: number, y: number, u: number, v: number): void => {
      buf[o++] = x;
      buf[o++] = y;
      buf[o++] = u;
      buf[o++] = v;
      buf[o++] = q.tint[0];
      buf[o++] = q.tint[1];
      buf[o++] = q.tint[2];
      buf[o++] = q.masked ? u : -1; // maskU
      buf[o++] = q.masked ? v : -1; // maskV
    };
    push(q.x0, q.y0, q.u0, q.v0);
    push(q.x1, q.y0, q.u1, q.v0);
    push(q.x0, q.y1, q.u0, q.v1);
    push(q.x1, q.y0, q.u1, q.v0);
    push(q.x1, q.y1, q.u1, q.v1);
    push(q.x0, q.y1, q.u0, q.v1);
    return o;
  }

  /** Release all GL resources owned by this renderer. */
  dispose(): void {
    const gl = this.gl;
    for (const reg of this.atlases.values()) {
      for (const tex of reg.textures) gl.deleteTexture(tex);
      for (const mtex of reg.pmaskTextures) if (mtex) gl.deleteTexture(mtex);
    }
    this.atlases.clear();
    gl.deleteTexture(this.whiteTex);
    gl.deleteBuffer(this.vbo);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
  }
}
