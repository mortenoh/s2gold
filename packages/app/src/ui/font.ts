/**
 * Bitmap font renderer for the original Settlers II fonts.
 *
 * The pipeline converts each FNT into `fonts/<name>.json` (glyph metrics) plus
 * `fonts/<name>.png` (a single-row atlas of white glyphs on transparency). This
 * module loads that pair and draws strings onto a 2D canvas with per-glyph
 * widths, `nx/ny` bearings and an integer pixel scale. Because the source
 * glyphs are pure white, an arbitrary tint is applied by compositing the atlas
 * through a solid fill (`source-in`), cached per colour.
 *
 * The measurement half ({@link measureText}) is pure and DOM-free so it can be
 * unit-tested without a canvas; the class wraps it for drawing.
 */

import { assetUrl } from '../lib/manifest';

/** One glyph's placement in the atlas plus its draw-time bearing. */
export interface FontGlyph {
  x: number;
  y: number;
  w: number;
  h: number;
  nx: number;
  ny: number;
}

/** DOM-free font description (everything {@link measureText} needs). */
export interface FontMetrics {
  readonly name: string;
  /** Nominal cell advance from the FNT header (informational). */
  readonly dx: number;
  /** Line height from the FNT header. */
  readonly dy: number;
  readonly glyphs: Readonly<Record<number, FontGlyph>>;
}

/** Options shared by measuring and drawing. */
export interface TextOptions {
  /** Integer pixel scale (>=1). Fractional values are floored. Default 1. */
  scale?: number;
  /** Extra pixels between glyphs, in unscaled units. Default 0. */
  letterSpacing?: number;
  /** Extra pixels between lines, in unscaled units. Default 0. */
  lineSpacing?: number;
}

/** Draw-only options. */
export interface DrawOptions extends TextOptions {
  /** CSS colour to tint the (white) glyphs. Omit / white for no tint. */
  color?: string;
}

/** Result of {@link measureText}: dimensions in scaled (device) pixels. */
export interface TextLayout {
  readonly width: number;
  readonly height: number;
  readonly lines: number;
}

/** Raw JSON shape emitted by the font converter. */
interface FontJson {
  name: string;
  dx: number;
  dy: number;
  image: string;
  width: number;
  height: number;
  glyphs: Record<string, FontGlyph>;
}

/** Resolve a glyph, falling back to '?' then space so drawing never throws. */
export function glyphFor(metrics: FontMetrics, code: number): FontGlyph | undefined {
  return metrics.glyphs[code] ?? metrics.glyphs[63] ?? metrics.glyphs[32];
}

/**
 * Measure a (possibly multi-line) string. Width is the widest line; height is
 * `lines * dy + gaps`, all multiplied by the integer scale. Trailing
 * letter-spacing is not counted so a single glyph measures exactly its width.
 */
export function measureText(metrics: FontMetrics, text: string, opts: TextOptions = {}): TextLayout {
  const scale = Math.max(1, Math.floor(opts.scale ?? 1));
  const letterSpacing = opts.letterSpacing ?? 0;
  const lineSpacing = opts.lineSpacing ?? 0;

  let widest = 0;
  let lineWidth = 0;
  let lineGlyphs = 0;
  let lines = 1;

  const flush = (): void => {
    const trimmed = lineGlyphs > 0 ? lineWidth - letterSpacing : 0;
    widest = Math.max(widest, trimmed);
  };

  for (const ch of text) {
    if (ch === '\n') {
      flush();
      lineWidth = 0;
      lineGlyphs = 0;
      lines += 1;
      continue;
    }
    const g = glyphFor(metrics, ch.codePointAt(0) ?? 32);
    if (!g) continue;
    lineWidth += g.w + letterSpacing;
    lineGlyphs += 1;
  }
  flush();

  const height = lines * metrics.dy + (lines - 1) * lineSpacing;
  return { width: widest * scale, height: height * scale, lines };
}

/** Parse a converter JSON blob into DOM-free {@link FontMetrics}. */
export function metricsFromJson(json: FontJson): FontMetrics {
  const glyphs: Record<number, FontGlyph> = {};
  for (const [code, g] of Object.entries(json.glyphs)) {
    glyphs[Number(code)] = {
      x: g.x,
      y: g.y,
      w: g.w,
      h: g.h,
      nx: g.nx ?? 0,
      ny: g.ny ?? 0,
    };
  }
  return { name: json.name, dx: json.dx, dy: json.dy, glyphs };
}

/**
 * A loaded bitmap font: metrics + atlas image, with tinted-atlas caching. Draw
 * strings with {@link draw} onto an existing context, or bake a right-sized
 * standalone canvas with {@link render} (handy for DOM buttons).
 */
export class BitmapFont {
  readonly metrics: FontMetrics;
  private readonly atlas: CanvasImageSource;
  private readonly tintCache = new Map<string, HTMLCanvasElement>();

  constructor(metrics: FontMetrics, atlas: CanvasImageSource) {
    this.metrics = metrics;
    this.atlas = atlas;
  }

  /** Fetch `fonts/<name>.json` + its PNG and build a ready-to-draw font. */
  static async load(name: string): Promise<BitmapFont> {
    const res = await fetch(assetUrl(`fonts/${name}.json`), { cache: 'force-cache' });
    if (!res.ok) throw new Error(`font ${name}: HTTP ${String(res.status)}`);
    const json = (await res.json()) as FontJson;
    const image = json.image.includes('/') ? json.image : `fonts/${json.image}`;
    const img = new Image();
    img.src = assetUrl(image);
    await img.decode();
    return new BitmapFont(metricsFromJson(json), img);
  }

  get dy(): number {
    return this.metrics.dy;
  }

  /** Measure `text` in scaled pixels. */
  measure(text: string, opts: TextOptions = {}): TextLayout {
    return measureText(this.metrics, text, opts);
  }

  /**
   * Draw `text` with its top-left at (x, y). Newlines advance by the line
   * height. A `color` tints the white glyphs; otherwise the atlas is used as-is.
   */
  draw(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, opts: DrawOptions = {}): void {
    const scale = Math.max(1, Math.floor(opts.scale ?? 1));
    const letterSpacing = opts.letterSpacing ?? 0;
    const lineSpacing = opts.lineSpacing ?? 0;
    const source = this.sourceFor(opts.color);
    const prevSmoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;

    let penX = x;
    let penY = y;
    for (const ch of text) {
      if (ch === '\n') {
        penX = x;
        penY += (this.metrics.dy + lineSpacing) * scale;
        continue;
      }
      const g = glyphFor(this.metrics, ch.codePointAt(0) ?? 32);
      if (!g) continue;
      if (g.w > 0 && g.h > 0) {
        ctx.drawImage(
          source,
          g.x,
          g.y,
          g.w,
          g.h,
          penX + g.nx * scale,
          penY + g.ny * scale,
          g.w * scale,
          g.h * scale,
        );
      }
      penX += (g.w + letterSpacing) * scale;
    }
    ctx.imageSmoothingEnabled = prevSmoothing;
  }

  /** Render `text` onto a fresh, tightly-sized canvas (for DOM composition). */
  render(text: string, opts: DrawOptions = {}): HTMLCanvasElement {
    const layout = this.measure(text, opts);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, layout.width);
    canvas.height = Math.max(1, layout.height);
    const ctx = canvas.getContext('2d');
    if (ctx) this.draw(ctx, text, 0, 0, opts);
    return canvas;
  }

  /** The atlas image, or a cached tinted copy for `color`. */
  private sourceFor(color?: string): CanvasImageSource {
    if (!color || color.toLowerCase() === '#ffffff' || color.toLowerCase() === 'white') {
      return this.atlas;
    }
    const cached = this.tintCache.get(color);
    if (cached) return cached;

    const w = this.imageWidth();
    const h = this.imageHeight();
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.atlas, 0, 0);
      // Keep the glyph alpha, replace RGB with the tint.
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
    }
    this.tintCache.set(color, canvas);
    return canvas;
  }

  private imageWidth(): number {
    const a = this.atlas as { width?: number; naturalWidth?: number };
    return a.naturalWidth ?? a.width ?? 0;
  }

  private imageHeight(): number {
    const a = this.atlas as { height?: number; naturalHeight?: number };
    return a.naturalHeight ?? a.height ?? 0;
  }
}
