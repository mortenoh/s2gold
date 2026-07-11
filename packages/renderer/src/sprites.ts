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
layout(location = 4) in float aAnchorY; // sprite foot screen y (constant per quad)

uniform vec2 uScale; // 2 * zoom / canvas size

out vec2 vUv;
out vec3 vTint;
out vec2 vMaskUv;

void main() {
  float clipX = aPos.x * uScale.x - 1.0;
  float clipY = 1.0 - aPos.y * uScale.y;
  // Depth from the foot anchor (not the vertex), so the whole billboard occludes
  // at its ground position — a road in front of it draws over, one behind hides.
  // Mapped into [0, 0.98] (in front of terrain's 0.99) with top of screen = far.
  float footClipY = 1.0 - aAnchorY * uScale.y;
  float z = clamp((footClipY + 1.0) * 0.5 * 0.98, 0.0, 0.98);
  gl_Position = vec4(clipX, clipY, z, 1.0);
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
      // The atlas holds the player pixel in the default (blue) ramp at its
      // shade; take the shade's brightness from the strongest channel (the blue
      // ramp's hue, so a dark cap stays visible rather than crushing to black
      // like luminance would) and re-tint it to this player's colour.
      float shade = max(base.r, max(base.g, base.b));
      base = vec4(vTint * shade, base.a);
    }
  } else {
    // Unmasked sprites (map objects, un-tinted units) modulate by the tint so
    // fog of war can darken them; NO_TINT (1,1,1) leaves them unchanged.
    base = vec4(base.rgb * vTint, base.a);
  }
  if (base.a < 0.02) discard;
  outColor = base;
}
`;

/** Floats per vertex: x, y, u, v, tintR, tintG, tintB, maskU, maskV. */
const FLOATS_PER_VERTEX = 10;
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

/** A static object with its base world anchor + node index precomputed once. */
interface PlacedStatic {
  readonly obj: StaticObject;
  readonly worldX: number;
  readonly worldY: number;
  /** Row-major map-node index, for per-node fog lookup. */
  readonly nodeIdx: number;
}

/**
 * Brightness multiplier per fog-of-war state (index = the byte from
 * {@link SpriteRenderer.setFog}): 0 unexplored (culled, not drawn), 1
 * explored/not-seen (dimmed to match the terrain snapshot), 2 visible. Mirrors
 * FOG_BRIGHTNESS in renderer.ts so map objects fade with the terrain under them.
 */
const FOG_SPRITE_BRIGHTNESS: readonly number[] = [0, 0.4, 1];

/** One quad queued for a frame, keyed for depth sort and page grouping. */
interface QuadItem {
  archive: string;
  page: number;
  depth: number;
  /** Sprite foot screen y — the constant depth anchor for the whole billboard. */
  anchorY: number;
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

/**
 * Redraw a mask image onto a transparent canvas of the atlas page's size,
 * anchored top-left, so a pmask packed to smaller bounds samples 1:1 under the
 * atlas uv. Only the alpha channel (player-colour membership) is relied upon, so
 * canvas compositing of the tiny shade bytes is immaterial.
 */
function padToPage(mask: AtlasPage, width: number, height: number): TexImageSource {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return mask;
  ctx.imageSmoothingEnabled = false; // 1:1 copy — keep the mask's hard edges
  ctx.clearRect(0, 0, width, height);
  // AtlasPage is a TexImageSource (loaded as an <img>); narrow to the drawable
  // subset — ImageData, the one non-drawable member, is never used here.
  ctx.drawImage(mask as Exclude<TexImageSource, ImageData>, 0, 0);
  return canvas;
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
  /** Per-node fog state (see setFog); null = fog disabled, everything visible. */
  private fog: Uint8Array | null = null;

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
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, stride, 36);
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
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        // The pmask page is packed to its own (often smaller) bounds but shares
        // the atlas's top-left origin. Masked quads sample it with the atlas uv,
        // so pad it up to the atlas page size — otherwise the mask is stretched
        // and lands on the wrong pixels (settlers go black facing away).
        const src =
          mask.width === page.width && mask.height === page.height
            ? mask
            : padToPage(mask, page.width, page.height);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
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
      placed.push({ obj, worldX: pos.x, worldY: pos.y, nodeIdx: idx });
    }
    placed.sort((a, b) => a.worldY - b.worldY || a.worldX - b.worldX);
    this.statics = placed;
  }

  /**
   * Apply (or clear) fog of war for the static object layer. `fog` is one byte
   * per map node (0 unexplored, 1 explored, 2 visible); pass `null` to disable
   * fog and draw every object at full brightness. Objects on unexplored nodes
   * are culled, explored ones are dimmed to sit under the terrain snapshot.
   */
  setFog(fog: Uint8Array | null): void {
    this.fog = fog;
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
    shade: readonly [number, number, number] = NO_TINT,
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
    // and the archive actually uploaded a pmask page for this atlas. A masked
    // quad carries the player `tint` (applied through the mask); an unmasked one
    // carries `shade` (a brightness multiplier for fog, NO_TINT by default) so a
    // player tint never bleeds onto un-masked sprites like buildings.
    const masked =
      s.pmask === true && tint !== NO_TINT && reg.pmaskTextures[s.atlas] != null;
    out.push({
      tint: masked ? tint : shade,
      archive,
      page: s.atlas,
      depth,
      anchorY: ay,
      x0,
      y0,
      x1,
      y1,
      u0: s.x / tw,
      v0,
      u1: (s.x + s.w) / tw,
      v1,
      masked,
    });
  }

  /** Emit every torus-wrapped quad for one dynamic sprite into `out`. */
  private pushDynamic(
    out: QuadItem[],
    d: DynamicSprite,
    ox: number,
    oy: number,
    viewW: number,
    viewH: number,
  ): void {
    const ax = d.worldX + ox;
    const ay = d.worldY + oy;
    const tint =
      d.player !== undefined
        ? unpackColor(PLAYER_COLORS[d.player % PLAYER_COLORS.length] ?? 0xffffff)
        : NO_TINT;
    const scale = d.scale ?? 1;
    const clipBottom = d.clipBottom ?? 1;
    if (d.shadowIndex !== undefined) {
      this.pushQuad(out, d.archive, d.shadowIndex, ax, ay, viewW, viewH, d.worldY - 0.5, NO_TINT, scale); // prettier-ignore
    }
    this.pushQuad(out, d.archive, d.spriteIndex, ax, ay, viewW, viewH, d.worldY, tint, scale, clipBottom); // prettier-ignore
  }

  /**
   * Render the scene for the given camera. `tick` is the global animation
   * counter; `dynamics` are per-frame moving sprites (units) depth-sorted in with
   * the statics. `overlay` sprites are drawn in a second batched pass *after* the
   * main one, sharing the same depth buffer.
   *
   * Why a second pass: batches flush on every atlas change while walking the
   * depth-sorted quads, so a handful of `overlay` sprites from a different archive
   * sprinkled through the depth range (the per-nation border stones dotted around
   * a frontier ring, interleaving with mapbobs trees) would otherwise split the
   * long mapbobs tree run into dozens of one-quad draw calls. Pulling them into
   * their own pass keeps the main run intact and costs one draw call per overlay
   * archive/page. It is visually correct because sprite occlusion is resolved by
   * the depth buffer (each quad writes depth from its foot anchor) plus the
   * shader's alpha discard — not by draw order: a tree in front still writes the
   * nearer depth and hides the stone, a tree behind fails the depth test, and the
   * stone shows through the tree's transparent pixels. Cross-pass blend order only
   * matters where two *semi-transparent* pixels overlap, negligible for the small,
   * (near-)opaque border stones.
   */
  render(
    camera: Camera,
    tick: number,
    dynamics: readonly DynamicSprite[] = [],
    overlay: readonly DynamicSprite[] = [],
  ): SpriteDrawStats {
    if (this.atlases.size === 0) return { quads: 0, drawCalls: 0 };
    const gl = this.gl;
    const viewW = gl.drawingBufferWidth / camera.zoom;
    const viewH = gl.drawingBufferHeight / camera.zoom;

    const i0 = Math.floor((camera.x - TR_W) / this.worldW) - 1;
    const i1 = Math.floor((camera.x + viewW) / this.worldW) + 1;
    const j0 = Math.floor((camera.y - TR_H) / this.worldH) - 1;
    const j1 = Math.floor((camera.y + viewH + MAX_RAISE) / this.worldH) + 1;

    const items: QuadItem[] = [];
    for (let j = j0; j <= j1; j++) {
      const oy = j * this.worldH - camera.y;
      for (let i = i0; i <= i1; i++) {
        const ox = i * this.worldW - camera.x;
        for (const ps of this.statics) {
          // Fog: cull objects on unexplored land; dim ones in explored-but-unseen
          // land so trees/stones fade with the darkened terrain snapshot. The
          // dimming is a brightness `shade`, not a colour tint, so it applies to
          // these un-masked map sprites without recolouring them.
          let shade = NO_TINT;
          if (this.fog) {
            const state = this.fog[ps.nodeIdx] ?? 2;
            if (state === 0) continue;
            const f = FOG_SPRITE_BRIGHTNESS[state] ?? 1;
            if (f !== 1) shade = [f, f, f];
          }
          const ax = ps.worldX + ox;
          const ay = ps.worldY + oy;
          const anim = ps.obj.animation;
          const spriteIndex = anim
            ? anim.baseIndex + ((tick + anim.phase) % anim.frameCount)
            : ps.obj.spriteIndex;
          if (ps.obj.shadowIndex !== undefined) {
            this.pushQuad(items, ps.obj.archive, ps.obj.shadowIndex, ax, ay, viewW, viewH, ps.worldY - 0.5, NO_TINT, 1, 1, shade); // prettier-ignore
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
            1,
            1,
            shade,
          );
        }
        for (const d of dynamics) this.pushDynamic(items, d, ox, oy, viewW, viewH);
      }
    }

    let stats: SpriteDrawStats = { quads: 0, drawCalls: 0 };
    if (items.length > 0) {
      items.sort((a, b) => a.depth - b.depth || a.page - b.page);
      stats = this.drawItems(items, camera);
    }

    if (overlay.length > 0) {
      const oitems: QuadItem[] = [];
      for (let j = j0; j <= j1; j++) {
        const oy = j * this.worldH - camera.y;
        for (let i = i0; i <= i1; i++) {
          const ox = i * this.worldW - camera.x;
          for (const d of overlay) this.pushDynamic(oitems, d, ox, oy, viewW, viewH);
        }
      }
      if (oitems.length > 0) {
        oitems.sort((a, b) => a.depth - b.depth || a.page - b.page);
        const s2 = this.drawItems(oitems, camera);
        stats = { quads: stats.quads + s2.quads, drawCalls: stats.drawCalls + s2.drawCalls };
      }
    }

    return stats;
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
    // Depth-test against the ground/road pass (a road in front of a building
    // wins); still drawn back-to-front (painter order) so overlapping sprites
    // blend correctly. Transparent pixels are discarded, so they write no depth.
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);

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
      buf[o++] = q.anchorY; // foot depth anchor
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
