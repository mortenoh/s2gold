/** Per-category renderers for the asset inspector. */

import { clear, el } from '../lib/dom';
import { assetUrl, fetchJson } from '../lib/manifest';
import {
  collectStrings,
  isRecord,
  pickArray,
  pickNumber,
  pickString,
  unique,
  type Json,
} from './types';

export interface CategoryRenderer {
  /** Human label shown in the sidebar. */
  label: string;
  /** Render the category payload into the given container. */
  render(container: HTMLElement, payload: Json): Promise<void>;
}

/** Preferred sidebar ordering; extra manifest keys are appended after these. */
export const CATEGORY_ORDER = [
  'graphics',
  'palettes',
  'terrain',
  'fonts',
  'maps',
  'texts',
  'sfx',
  'music',
  'video',
];

function emptyNote(container: HTMLElement, msg: string): void {
  container.append(el('div', { class: 'empty-note', text: msg }));
}

function dumpJson(container: HTMLElement, payload: Json): void {
  container.append(
    el('p', {
      class: 'section-sub',
      text: 'No specialised view for this category. Raw manifest entry:',
    }),
    el('pre', { text: JSON.stringify(payload, null, 2) }),
  );
}

/* ------------------------------------------------------------------ palettes */

function parsePalette(data: Json): [number, number, number][] | null {
  let arr: Json = data;
  if (isRecord(data)) {
    arr = pickArray(data, 'colors', 'palette', 'entries', 'rgb') ?? data;
  }
  if (!Array.isArray(arr)) return null;
  // Flat [r,g,b,r,g,b,...]
  if (typeof arr[0] === 'number') {
    const out: [number, number, number][] = [];
    for (let i = 0; i + 2 < arr.length; i += 3) {
      out.push([Number(arr[i]), Number(arr[i + 1]), Number(arr[i + 2])]);
    }
    return out;
  }
  // Array of [r,g,b] or {r,g,b}
  const out: [number, number, number][] = [];
  for (const c of arr) {
    if (Array.isArray(c) && c.length >= 3) {
      out.push([Number(c[0]), Number(c[1]), Number(c[2])]);
    } else if (isRecord(c)) {
      out.push([
        pickNumber(c, 'r', 'red') ?? 0,
        pickNumber(c, 'g', 'green') ?? 0,
        pickNumber(c, 'b', 'blue') ?? 0,
      ]);
    }
  }
  return out.length ? out : null;
}

function renderSwatchGrid(colors: [number, number, number][]): HTMLElement {
  const grid = el('div', { class: 'pal-grid' });
  for (let i = 0; i < colors.length; i++) {
    const [r, g, b] = colors[i];
    grid.append(
      el('div', {
        class: 'pal-cell',
        title: `#${i} rgb(${r},${g},${b})`,
        attrs: { style: `background: rgb(${r},${g},${b})` },
      }),
    );
  }
  return grid;
}

const palettes: CategoryRenderer = {
  label: 'palettes',
  async render(container, payload) {
    const files = unique(collectStrings(payload, (s) => s.toLowerCase().endsWith('.json')));
    if (files.length === 0) {
      emptyNote(container, 'No palette files listed in the manifest entry.');
      dumpJson(container, payload);
      return;
    }
    for (const file of files) {
      const rel = file.includes('/') ? file : `palettes/${file}`;
      const block = el('div', { class: 'pal-block' });
      block.append(el('h3', { class: 'section-title', text: file }));
      container.append(block);
      const data = await fetchJson(assetUrl(rel));
      const colors = data ? parsePalette(data) : null;
      if (!colors) {
        block.append(el('div', { class: 'empty-note', text: 'Could not parse palette.' }));
        continue;
      }
      block.append(
        el('p', { class: 'section-sub', text: `${colors.length} colors` }),
        renderSwatchGrid(colors),
      );
    }
  },
};

/* --------------------------------------------------------------- image-based */

function renderImageGrid(container: HTMLElement, files: string[], dirPrefix: string): void {
  if (files.length === 0) {
    emptyNote(container, 'No image files listed in the manifest entry.');
    return;
  }
  const grid = el('div', { class: 'img-grid' });
  for (const file of files) {
    const rel = file.includes('/') ? file : `${dirPrefix}/${file}`;
    const img = el('img', { src: assetUrl(rel), attrs: { loading: 'lazy', alt: file } });
    grid.append(el('div', { class: 'img-tile' }, img, el('div', { class: 'cap', text: file })));
  }
  container.append(grid);
}

const terrain: CategoryRenderer = {
  label: 'terrain',
  async render(container, payload) {
    const files = unique(collectStrings(payload, (s) => s.toLowerCase().endsWith('.png')));
    renderImageGrid(container, files, 'terrain');
    const luts = unique(collectStrings(payload, (s) => s.toLowerCase().endsWith('.json')));
    if (luts.length) {
      container.append(el('p', { class: 'section-sub', text: `Shading LUTs: ${luts.join(', ')}` }));
    }
  },
};

const fonts: CategoryRenderer = {
  label: 'fonts',
  async render(container, payload) {
    // Converter shape: { font11: "fonts/font11.json", ... }; each JSON holds
    // { name, dx, dy, image, width, height, glyphs: { charCode: {x,y,w,h,...} } }.
    const entries = isRecord(payload)
      ? Object.entries(payload).filter((e): e is [string, string] => typeof e[1] === 'string')
      : [];
    if (entries.length === 0) {
      emptyNote(container, 'No fonts listed in the manifest entry.');
      dumpJson(container, payload);
      return;
    }
    for (const [name, jsonPath] of entries) {
      const meta = await fetchJson(assetUrl(jsonPath));
      if (!isRecord(meta)) {
        container.append(el('div', { class: 'empty-note', text: `Could not load ${jsonPath}` }));
        continue;
      }
      const glyphs = isRecord(meta.glyphs) ? Object.entries(meta.glyphs) : [];
      const image = typeof meta.image === 'string' ? meta.image : `${name}.png`;
      const rel = image.includes('/') ? image : `fonts/${image}`;
      const block = el('div', { class: 'atlas-block' });
      block.append(
        el('h3', { class: 'section-title', text: name }),
        el('p', {
          class: 'section-sub',
          text: `spacing dx=${String(meta.dx)} dy=${String(meta.dy)}, ${glyphs.length} glyphs — ${rel}`,
        }),
      );
      const img = new Image();
      img.src = assetUrl(rel);
      img.className = 'pixelated checker';
      img.style.imageRendering = 'pixelated';
      await img.decode().catch(() => undefined);
      // Draw at 2x with glyph boxes so small fonts are inspectable.
      const canvas = el('canvas') as HTMLCanvasElement;
      canvas.width = img.naturalWidth * 2;
      canvas.height = img.naturalHeight * 2;
      canvas.style.maxWidth = '100%';
      const ctx = canvas.getContext('2d');
      if (ctx && img.naturalWidth > 0) {
        ctx.imageSmoothingEnabled = false;
        ctx.scale(2, 2);
        ctx.fillStyle = '#334';
        ctx.fillRect(0, 0, img.naturalWidth, img.naturalHeight);
        ctx.drawImage(img, 0, 0);
        ctx.strokeStyle = 'rgba(120,160,255,0.5)';
        ctx.lineWidth = 0.5;
        for (const [, g] of glyphs) {
          if (!isRecord(g)) continue;
          const x = pickNumber(g, 'x') ?? 0;
          const y = pickNumber(g, 'y') ?? 0;
          const w = pickNumber(g, 'w') ?? 0;
          const h = pickNumber(g, 'h') ?? 0;
          ctx.strokeRect(x + 0.25, y + 0.25, w - 0.5, h - 0.5);
        }
        block.append(canvas);
      } else {
        block.append(el('div', { class: 'empty-note', text: `Missing image ${rel}` }));
      }
      container.append(block);
    }
  },
};

/* ---------------------------------------------------------------- graphics */

interface Sprite {
  x: number;
  y: number;
  w: number;
  h: number;
  nx?: number;
  ny?: number;
  kind?: string;
  page: number;
  index: number;
  raw: Json;
}

function normalizeSprites(atlas: Json): Sprite[] {
  let arr: Json[];
  let keys: string[] | null = null;
  const declared = isRecord(atlas) ? atlas['sprites'] : undefined;
  if (Array.isArray(atlas)) {
    arr = atlas;
  } else if (isRecord(declared) && !Array.isArray(declared)) {
    keys = Object.keys(declared);
    arr = keys.map((k) => declared[k]);
  } else {
    arr = pickArray(atlas, 'sprites', 'frames', 'items', 'bitmaps') ?? [];
  }
  const out: Sprite[] = [];
  arr.forEach((s, i) => {
    const x = pickNumber(s, 'x', 'left', 'sx');
    const y = pickNumber(s, 'y', 'top', 'sy');
    const w = pickNumber(s, 'w', 'width');
    const h = pickNumber(s, 'h', 'height');
    if (x === undefined || y === undefined || w === undefined || h === undefined) return;
    out.push({
      x,
      y,
      w,
      h,
      nx: pickNumber(s, 'nx', 'anchorX', 'originX'),
      ny: pickNumber(s, 'ny', 'anchorY', 'originY'),
      kind: pickString(s, 'kind', 'type'),
      page: pickNumber(s, 'page', 'atlas', 'atlasIndex', 'sheet') ?? 0,
      index: pickNumber(s, 'index', 'id') ?? (keys ? Number(keys[i]) : i),
      raw: s,
    });
  });
  return out;
}

function atlasPageFiles(archive: string, atlas: Json, sprites: Sprite[]): string[] {
  const declared = isRecord(atlas)
    ? collectStrings(pickArray(atlas, 'pages', 'images', 'atlases', 'textures') ?? [], (s) =>
        s.toLowerCase().endsWith('.png'),
      )
    : [];
  if (declared.length)
    return declared.map((f) => (f.includes('/') ? f : `graphics/${archive}/${f}`));
  const maxPage = sprites.reduce((m, s) => Math.max(m, s.page), 0);
  const files: string[] = [];
  for (let p = 0; p <= maxPage; p++) files.push(`graphics/${archive}/atlas_${p}.png`);
  return files;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function describeSprite(s: Sprite): string {
  const parts = [
    `#${s.index}`,
    `${s.w}x${s.h}`,
    `@(${s.x},${s.y})`,
    s.nx !== undefined || s.ny !== undefined ? `anchor(${s.nx ?? 0},${s.ny ?? 0})` : '',
    s.kind ? `kind=${s.kind}` : '',
  ].filter(Boolean);
  return parts.join('  ');
}

async function renderAtlasPage(
  container: HTMLElement,
  pageIndex: number,
  file: string,
  sprites: Sprite[],
  hasPageField: boolean,
  detail: HTMLElement,
  tooltip: HTMLElement,
): Promise<void> {
  const img = await loadImage(assetUrl(file));
  if (!img) {
    container.append(el('div', { class: 'empty-note', text: `Missing atlas image: ${file}` }));
    return;
  }
  const pageSprites = hasPageField ? sprites.filter((s) => s.page === pageIndex) : sprites;

  const wrap = el('div', { class: 'atlas-canvas-wrap' });
  const canvas = el('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  wrap.append(canvas);
  container.append(
    el('p', {
      class: 'section-sub',
      text: `${file} — ${img.naturalWidth}x${img.naturalHeight}, ${pageSprites.length} sprites`,
    }),
    wrap,
  );

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const draw = (highlight: Sprite | null): void => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    ctx.lineWidth = 1;
    for (const s of pageSprites) {
      ctx.strokeStyle = s === highlight ? 'rgba(217,164,65,0.95)' : 'rgba(111,179,210,0.55)';
      ctx.strokeRect(s.x + 0.5, s.y + 0.5, s.w - 1, s.h - 1);
    }
    if (highlight) {
      ctx.fillStyle = 'rgba(217,164,65,0.18)';
      ctx.fillRect(highlight.x, highlight.y, highlight.w, highlight.h);
    }
  };
  draw(null);

  const spriteAt = (px: number, py: number): Sprite | null => {
    for (let i = pageSprites.length - 1; i >= 0; i--) {
      const s = pageSprites[i];
      if (px >= s.x && px < s.x + s.w && py >= s.y && py < s.y + s.h) return s;
    }
    return null;
  };

  canvas.addEventListener('mousemove', (ev) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const px = (ev.clientX - rect.left) * scaleX;
    const py = (ev.clientY - rect.top) * scaleY;
    const hit = spriteAt(px, py);
    draw(hit);
    if (hit) {
      tooltip.textContent = describeSprite(hit);
      tooltip.style.display = 'block';
      tooltip.style.left = `${ev.clientX + 14}px`;
      tooltip.style.top = `${ev.clientY + 14}px`;
    } else {
      tooltip.style.display = 'none';
    }
  });
  canvas.addEventListener('mouseleave', () => {
    tooltip.style.display = 'none';
    draw(null);
  });
  canvas.addEventListener('click', (ev) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const hit = spriteAt((ev.clientX - rect.left) * scaleX, (ev.clientY - rect.top) * scaleY);
    detail.textContent = hit
      ? `Selected sprite ${describeSprite(hit)} — raw: ${JSON.stringify(hit.raw)}`
      : '';
  });
}

function archiveNames(payload: Json): string[] {
  const declared = pickArray(payload, 'archives', 'sets', 'sprites');
  if (declared && declared.every((x) => typeof x === 'string')) {
    return declared as string[];
  }
  if (isRecord(payload)) {
    const meta = new Set(['version', 'count', 'total', 'dir', 'base']);
    const keys = Object.keys(payload).filter(
      (k) => !meta.has(k) && (isRecord(payload[k]) || typeof payload[k] === 'string'),
    );
    if (keys.length) return keys;
  }
  return [];
}

const graphics: CategoryRenderer = {
  label: 'graphics',
  async render(container, payload) {
    const archives = archiveNames(payload);
    if (archives.length === 0) {
      emptyNote(container, 'No sprite archives listed in the manifest entry.');
      dumpJson(container, payload);
      return;
    }
    const tooltip = el('div', { class: 'atlas-tooltip' });
    document.body.append(tooltip);

    for (const archive of archives) {
      const block = el('div', { class: 'atlas-block' });
      const detail = el('div', { class: 'sprite-detail', text: 'Click a sprite for details.' });
      block.append(el('h3', { class: 'section-title', text: archive }), detail);
      container.append(block);

      const atlas = await fetchJson(assetUrl(`graphics/${archive}/atlas.json`));
      if (!atlas) {
        block.append(el('div', { class: 'empty-note', text: 'Missing atlas.json.' }));
        continue;
      }
      const sprites = normalizeSprites(atlas);
      const hasPageField =
        Array.isArray(atlas) || isRecord(atlas)
          ? sprites.some((s) => s.page > 0) ||
            (isRecord(atlas) && (pickArray(atlas, 'pages', 'images', 'atlases') ?? []).length > 1)
          : false;
      const pageFiles = atlasPageFiles(archive, atlas, sprites);
      for (let p = 0; p < pageFiles.length; p++) {
        await renderAtlasPage(block, p, pageFiles[p], sprites, hasPageField, detail, tooltip);
      }
    }
  },
};

/* ------------------------------------------------------------------- maps */

const maps: CategoryRenderer = {
  label: 'maps',
  async render(container, payload) {
    let index: Json = await fetchJson(assetUrl('maps/index.json'));
    if (!index) {
      index = pickArray(payload, 'maps', 'entries', 'index') ?? payload;
    }
    const entries = Array.isArray(index)
      ? index
      : (pickArray(index, 'maps', 'entries', 'index') ?? []);
    if (entries.length === 0) {
      emptyNote(container, 'No maps found (maps/index.json missing or empty).');
      return;
    }
    const table = el('table', { class: 'data' });
    table.append(
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', { text: 'title' }),
          el('th', { text: 'file' }),
          el('th', { text: 'size' }),
          el('th', { text: 'players' }),
        ),
      ),
    );
    const tbody = el('tbody');
    for (const e of entries) {
      const title = pickString(e, 'title', 'name') ?? '(untitled)';
      const file = pickString(e, 'file', 'path', 'id') ?? '';
      const w = pickNumber(e, 'width', 'w');
      const h = pickNumber(e, 'height', 'h');
      const sizeStr = pickString(e, 'size') ?? (w && h ? `${w}x${h}` : '?');
      const players = pickNumber(e, 'players', 'numPlayers', 'playerCount');
      tbody.append(
        el(
          'tr',
          {},
          el('td', { text: title }),
          el('td', { text: file }),
          el('td', { text: sizeStr }),
          el('td', { text: players !== undefined ? String(players) : '?' }),
        ),
      );
    }
    table.append(tbody);
    container.append(el('p', { class: 'section-sub', text: `${entries.length} maps` }), table);
  },
};

/* ---------------------------------------------------------------- audio */

function audioRenderer(category: string, label: string): CategoryRenderer {
  return {
    label,
    async render(container, payload) {
      let index: Json = await fetchJson(assetUrl(`${category}/index.json`));
      if (!index) index = pickArray(payload, category, 'entries', 'index') ?? payload;
      let entries = Array.isArray(index)
        ? index
        : (pickArray(index, category, 'entries', 'index', 'tracks', 'sounds', 'items') ?? []);
      if (entries.length === 0 && isRecord(index)) {
        // Converter emits {name: {file, duration}} records keyed by entry name.
        entries = Object.entries(index)
          .filter(([, v]) => isRecord(v))
          .map(([k, v]) => ({ name: k, ...(v as Record<string, Json>) }));
      }
      if (entries.length === 0) {
        emptyNote(container, `No ${category} entries (index.json missing or empty).`);
        return;
      }
      container.append(el('p', { class: 'section-sub', text: `${entries.length} entries` }));
      for (const e of entries) {
        const name = pickString(e, 'name', 'id', 'title', 'file') ?? '(unnamed)';
        const file = pickString(e, 'file', 'path', 'src') ?? (typeof e === 'string' ? e : '');
        if (!file) continue;
        const rel = file.includes('/') ? file : `${category}/${file}`;
        const audio = el('audio', { attrs: { controls: '', preload: 'none', src: assetUrl(rel) } });
        container.append(
          el(
            'div',
            { class: 'entry-row' },
            el('span', { class: 'name', text: name }),
            audio,
            el('span', { class: 'sub', text: file }),
          ),
        );
      }
    },
  };
}

/* ---------------------------------------------------------------- texts */

interface TextFile {
  lang: string;
  name: string;
  rel: string;
}

function discoverTextFiles(payload: Json): TextFile[] {
  const out: TextFile[] = [];
  const langs = isRecord(payload) ? (payload.langs ?? payload) : payload;
  if (isRecord(langs)) {
    for (const [lang, val] of Object.entries(langs)) {
      if (!Array.isArray(val)) continue;
      // Converter shape: { eng: [{file, name, count}, ...], mission: [...] }
      for (const entry of val) {
        if (isRecord(entry) && typeof entry.file === 'string') {
          const name = typeof entry.name === 'string' ? entry.name : entry.file;
          out.push({ lang, name, rel: entry.file });
          continue;
        }
        if (typeof entry === 'string') {
          const base = entry.replace(/\.json$/i, '');
          out.push({
            lang,
            name: base,
            rel: entry.includes('/') ? entry : `texts/${lang}/${base}.json`,
          });
        }
      }
    }
  }
  // Fallback: any json paths mentioned anywhere, except the index itself.
  if (out.length === 0) {
    for (const p of unique(collectStrings(payload, (s) => s.toLowerCase().endsWith('.json')))) {
      const rel = p.includes('/') ? p : `texts/${p}`;
      if (rel === 'texts/index.json') continue;
      out.push({ lang: '', name: p, rel });
    }
  }
  return out;
}

function parseStrings(data: Json): string[] {
  if (Array.isArray(data)) return data.map((x) => (typeof x === 'string' ? x : JSON.stringify(x)));
  const arr = pickArray(data, 'strings', 'texts', 'entries', 'lines');
  if (arr) return arr.map((x) => (typeof x === 'string' ? x : JSON.stringify(x)));
  if (isRecord(data)) return Object.entries(data).map(([k, v]) => `${k}: ${String(v)}`);
  return [];
}

const texts: CategoryRenderer = {
  label: 'texts',
  async render(container, payload) {
    const index = await fetchJson(assetUrl('texts/index.json'));
    const files = discoverTextFiles(index ?? payload);
    if (files.length === 0) {
      emptyNote(container, 'No text files listed in the manifest entry.');
      dumpJson(container, payload);
      return;
    }
    const browser = el('div', { class: 'text-browser' });
    const list = el('div', { class: 'text-files' });
    const view = el('div', { class: 'text-strings' });
    browser.append(list, view);
    container.append(browser);

    const show = async (f: TextFile, item: HTMLElement): Promise<void> => {
      list.querySelectorAll('.text-file.active').forEach((n) => n.classList.remove('active'));
      item.classList.add('active');
      clear(view);
      const data = await fetchJson(assetUrl(f.rel));
      if (!data) {
        view.append(el('div', { class: 'empty-note', text: `Could not load ${f.rel}` }));
        return;
      }
      const strings = parseStrings(data);
      view.append(el('p', { class: 'section-sub', text: `${strings.length} strings` }));
      strings.forEach((s, i) => {
        view.append(
          el(
            'div',
            { class: 'str' },
            el('span', { class: 'idx', text: String(i) }),
            el('span', { text: s }),
          ),
        );
      });
    };

    files.forEach((f, i) => {
      const item = el('div', {
        class: 'text-file',
        text: f.lang ? `${f.lang}/${f.name}` : f.name,
      });
      item.addEventListener('click', () => void show(f, item));
      list.append(item);
      if (i === 0) void show(f, item);
    });
  },
};

/* ---------------------------------------------------------------- video */

const video: CategoryRenderer = {
  label: 'video',
  async render(container, payload) {
    const files = unique(collectStrings(payload, (s) => /\.(webm|mp4)$/i.test(s)));
    if (files.length === 0) {
      emptyNote(container, 'No video files listed in the manifest entry.');
      return;
    }
    for (const file of files) {
      const rel = file.includes('/') ? file : `video/${file}`;
      const vid = document.createElement('video');
      vid.controls = true;
      vid.preload = 'none';
      vid.src = assetUrl(rel);
      vid.style.maxWidth = '640px';
      container.append(el('p', { class: 'section-sub', text: file }), vid);
    }
  },
};

export const RENDERERS: Record<string, CategoryRenderer> = {
  graphics,
  palettes,
  terrain,
  fonts,
  maps,
  texts,
  sfx: audioRenderer('sfx', 'sfx'),
  music: audioRenderer('music', 'music'),
  video,
};

/** Generic fallback renderer for unknown categories. */
export function fallbackRenderer(name: string): CategoryRenderer {
  return {
    label: name,
    async render(container, payload) {
      dumpJson(container, payload);
    },
  };
}
