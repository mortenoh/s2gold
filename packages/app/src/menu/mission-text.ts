/**
 * Mission briefing text: load and format the converted per-chapter text banks
 * (`texts/eng/txt_miss_NNN.json`).
 *
 * Each bank is a flat array of ~120 strings. Even indices are diary/narrative
 * paragraphs, odd indices the matching goal lines; index 0 is the opening diary
 * entry shown on the briefing screen and index 1 its first objective. The
 * original text format uses `@` as a line break (`@@`+ marks a paragraph
 * break), which we normalise into plain paragraphs and then word-wrap to a pixel
 * width for the bitmap font (which draws `\n` but does not itself wrap).
 */

import { assetUrl, fetchJson } from '../lib/manifest';
import type { BitmapFont } from '../ui/font';

/** Load a chapter text bank, or null when the asset is absent. */
export async function loadMissionText(file: string): Promise<string[] | null> {
  const raw = await fetchJson<string[]>(assetUrl(file));
  return Array.isArray(raw) ? raw : null;
}

/**
 * Normalise a raw mission string into paragraphs. Runs of two or more `@`
 * become a paragraph boundary; a single `@` (a soft line break in the original)
 * becomes a space so the text reflows cleanly. Empty paragraphs are dropped.
 */
export function toParagraphs(raw: string): string[] {
  return raw
    .split(/@{2,}/)
    .map((p) => p.replace(/@/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0);
}

/**
 * Word-wrap a single paragraph to `maxWidthPx` using the font's own metrics,
 * returning the wrapped lines. Words longer than the width are placed on their
 * own line rather than split.
 */
function wrapParagraph(font: BitmapFont, text: string, maxWidthPx: number, scale: number): string[] {
  const words = text.split(' ').filter((w) => w.length > 0);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && font.measure(candidate, { scale }).width > maxWidthPx) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

/**
 * Wrap a raw mission string into display lines: each paragraph is word-wrapped,
 * and a blank line separates paragraphs. Suitable for feeding to the bitmap
 * font as a single `\n`-joined block (or paginated by {@link paginate}).
 */
export function wrapMissionText(
  font: BitmapFont,
  raw: string,
  maxWidthPx: number,
  scale: number,
): string[] {
  const paragraphs = toParagraphs(raw);
  const lines: string[] = [];
  paragraphs.forEach((para, i) => {
    if (i > 0) lines.push('');
    lines.push(...wrapParagraph(font, para, maxWidthPx, scale));
  });
  return lines;
}

/** Split wrapped lines into pages of at most `linesPerPage` lines each. */
export function paginate(lines: string[], linesPerPage: number): string[][] {
  if (linesPerPage <= 0) return [lines];
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += linesPerPage) {
    pages.push(lines.slice(i, i + linesPerPage));
  }
  return pages.length > 0 ? pages : [[]];
}
