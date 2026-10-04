/**
 * Vector menu text: the modern counterpart of {@link BitmapFont}. Cinzel (a
 * Roman inscriptional face) draws headings and menu entries, Alegreya (a book
 * serif) draws running text such as mission briefings. Both are SIL Open Font
 * License fonts bundled through Fontsource, so they load offline.
 *
 * Sizes follow the bitmap font's metrics: `scale` multiplies the original
 * 14 px line, so a screen that asked for `scale: 3` gets text of the same size
 * in either font. Canvases are rendered at the device pixel ratio and sized
 * in CSS pixels, so the text is sharp on retina displays.
 */

import '@fontsource-variable/cinzel/wght.css';
import '@fontsource/alegreya/400.css';
import type { DrawOptions, TextOptions } from './font';

/** Which face a piece of menu text uses. */
export type TextRole = 'display' | 'body';

const FACES: Record<TextRole, { family: string; weight: number; size: number }> = {
  // Cinzel's small-caps lowercase sits low, so it needs a slightly larger em
  // than the body face to match the bitmap font's height.
  display: { family: '"Cinzel Variable", serif', weight: 600, size: 0.8 },
  body: { family: '"Alegreya", serif', weight: 400, size: 0.95 },
};

/** Line height of the original font14, the unit `scale` multiplies. */
const BASE_LINE = 14;

/** CSS font shorthand, letter spacing and scale for a set of options. */
function fontFor(opts: TextOptions & { role?: TextRole }): {
  font: string;
  letterSpacing: number;
  scale: number;
} {
  const face = FACES[opts.role ?? 'display'];
  const scale = Math.max(0.5, opts.scale ?? 1);
  const fontPx = BASE_LINE * scale * face.size;
  return {
    font: `${face.weight} ${fontPx}px ${face.family}`,
    letterSpacing: (opts.letterSpacing ?? 0) * scale,
    scale,
  };
}

export class VectorFont {
  /** Wait until both faces are ready so the first measurement is right. */
  static async load(): Promise<VectorFont> {
    try {
      await Promise.all(
        Object.values(FACES).map((f) => document.fonts.load(`${f.weight} 32px ${f.family}`)),
      );
    } catch {
      // A missing face falls back to the generic serif; text still renders.
    }
    return new VectorFont();
  }

  private measureCtx: CanvasRenderingContext2D | null = null;

  /** Width of the widest line of `text` in CSS pixels. */
  measure(text: string, opts: TextOptions & { role?: TextRole } = {}): { width: number } {
    this.measureCtx ??= document.createElement('canvas').getContext('2d');
    const ctx = this.measureCtx;
    if (!ctx) return { width: 0 };
    const { font, letterSpacing } = fontFor(opts);
    ctx.font = font;
    ctx.letterSpacing = `${letterSpacing}px`;
    return { width: Math.max(0, ...text.split('\n').map((l) => ctx.measureText(l).width)) };
  }

  /** Render `text` onto a canvas sized in CSS pixels (backed at device resolution). */
  render(text: string, opts: DrawOptions & { role?: TextRole } = {}): HTMLCanvasElement {
    const { font, letterSpacing, scale } = fontFor(opts);
    // Display text is mostly capitals; it needs less leading than body text.
    const leading = opts.role === 'body' ? 1.15 : 0.95;
    const lineHeight = (BASE_LINE + (opts.lineSpacing ?? 0)) * scale * leading;
    const lines = text.split('\n');

    const canvas = document.createElement('canvas');
    const probe = canvas.getContext('2d');
    if (!probe) return canvas;
    probe.font = font;
    probe.letterSpacing = `${letterSpacing}px`;
    // A soft shadow keeps light text readable over the painted backdrops.
    const pad = Math.ceil(scale);
    const width = Math.ceil(Math.max(1, ...lines.map((l) => probe.measureText(l).width))) + pad * 2;
    const height = Math.ceil(lineHeight * lines.length) + pad * 2;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.ceil(width * dpr);
    canvas.height = Math.ceil(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.style.imageRendering = 'auto';

    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;
    ctx.scale(dpr, dpr);
    ctx.font = font;
    ctx.letterSpacing = `${letterSpacing}px`;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = opts.color ?? '#ffffff';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    ctx.shadowBlur = scale * 1.5;
    ctx.shadowOffsetY = scale * 0.5;
    lines.forEach((line, i) => {
      ctx.fillText(line, pad, pad + lineHeight * (i + 0.5));
    });
    return canvas;
  }
}
