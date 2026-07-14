/**
 * The World Campaign globe (as seen in the original's world-campaign screen,
 * docs/reference-study/captures/worldcampaign.png): the converted world map
 * (pics/world.png) keyed over the green marble backdrop (pics/setup990.png),
 * with the selected mission's continent brightened/gold-tinted and marked by a
 * pale X, exactly as the original highlights the current mission's region.
 *
 * The region shapes come from pics/worldmsk.png, a flat-colour mask the same
 * size as world.png with one distinct fill colour per continent and black
 * elsewhere (ocean). The colours below were extracted empirically from the mask
 * (a throwaway PIL script: distinct colours + pixel count + centroid + bbox);
 * each region's continent was then matched by centroid position, and the
 * bright green highlighted continent in the reference capture (upper-centre,
 * mask colour yellow) fixed the anchor -> that is Europe.
 *
 * Region -> chapter correspondence: the real WORLD_CHAPTERS table is eighteen
 * conquest missions on maps3_omap00-17 whose titles ("Island of Hills",
 * "Battle in the Middle", ...) are NOT continent names, so there is no
 * name-based mapping between the nine mask continents and the eighteen
 * missions. The mask is therefore used purely as a *selector UI*: the nine
 * continents map, in a documented narrative order that starts on Europe (to
 * reproduce the reference capture's highlighted region), to the first nine
 * missions (ids 101-109). Missions 110-118 have no continent and are reachable
 * only from the accessible chapter strip below the map. Mask colours that map
 * to no mission are ignored; missions with no colour fall back to the strip.
 */

/** The world map's colour-key (pics/world.png corners sample as (247,0,0)). */
const KEY_R = 247;

/** Squared-distance tolerance for treating a sampled colour as a region hit. */
const MATCH_SQ = 3000;

export interface WorldRegion {
  /** Mission id this continent selects (WORLD_CHAPTERS, 101-109). */
  readonly chapterId: number;
  /** Continent name (documentation / accessible labels). */
  readonly continent: string;
  /** Verified worldmsk.png fill colour, RGB. */
  readonly color: readonly [number, number, number];
  /** Documented mask-space centroid (from the extraction script) used as the
   * X-marker fallback when the mask cannot be re-scanned at runtime. */
  readonly centroid: readonly [number, number];
}

/**
 * The nine mask continents, in the narrative order they map to missions
 * 101-109. RGB + centroid are the verified values from worldmsk.png (512x340):
 *
 *   colour            count  centroid     continent
 *   (255,255,0)       3696   (251, 91)    Europe        -> 101 (reference X here)
 *   (175,115,203)     8153   ( 59, 72)    North America -> 102
 *   ( 67,195,115)     3621   (166, 36)    Greenland     -> 103
 *   (195, 35, 35)    10985   (375, 86)    North Asia    -> 104
 *   (207,175, 75)      813   (477,134)    Japan         -> 105
 *   ( 87, 51, 39)     9055   (374,151)    South Asia    -> 106
 *   ( 39,135, 27)     8866   (246,181)    Africa        -> 107
 *   (  0,143,195)     5599   (119,200)    South America -> 108
 *   (187, 99, 19)     2913   (444,264)    Australia     -> 109
 */
export const WORLD_REGIONS: readonly WorldRegion[] = [
  { chapterId: 101, continent: 'Europe', color: [255, 255, 0], centroid: [251, 91] },
  { chapterId: 102, continent: 'North America', color: [175, 115, 203], centroid: [59, 72] },
  { chapterId: 103, continent: 'Greenland', color: [67, 195, 115], centroid: [166, 36] },
  { chapterId: 104, continent: 'North Asia', color: [195, 35, 35], centroid: [375, 86] },
  { chapterId: 105, continent: 'Japan', color: [207, 175, 75], centroid: [477, 134] },
  { chapterId: 106, continent: 'South Asia', color: [87, 51, 39], centroid: [374, 151] },
  { chapterId: 107, continent: 'Africa', color: [39, 135, 27], centroid: [246, 181] },
  { chapterId: 108, continent: 'South America', color: [0, 143, 195], centroid: [119, 200] },
  { chapterId: 109, continent: 'Australia', color: [187, 99, 19], centroid: [444, 264] },
] as const;

/** True when a world.png pixel is the (247,0,0) transparency key (no anti-alias
 * in the source, so a tight threshold keys it cleanly with no red halo). */
export function isKeyColor(r: number, g: number, b: number): boolean {
  return r >= KEY_R - 30 && g <= 40 && b <= 40;
}

function distSq(r: number, g: number, b: number, c: readonly [number, number, number]): number {
  const dr = r - c[0];
  const dg = g - c[1];
  const db = b - c[2];
  return dr * dr + dg * dg + db * db;
}

/**
 * Map a sampled worldmsk.png pixel to its region, or undefined for ocean/edge.
 * Ocean is black (0,0,0); a sample nearer black than any continent, or not
 * within {@link MATCH_SQ} of a continent colour, is treated as no region.
 */
export function regionForColor(
  r: number,
  g: number,
  b: number,
  regions: readonly WorldRegion[] = WORLD_REGIONS,
): WorldRegion | undefined {
  let best: WorldRegion | undefined;
  let bestSq = Infinity;
  for (const region of regions) {
    const d = distSq(r, g, b, region.color);
    if (d < bestSq) {
      bestSq = d;
      best = region;
    }
  }
  if (!best) return undefined;
  const blackSq = r * r + g * g + b * b;
  if (blackSq <= bestSq) return undefined; // closer to ocean than any continent
  if (bestSq > MATCH_SQ) return undefined; // not a clean continent hit
  return best;
}

/** A pixel centroid computed from the mask (per mapped region). */
export interface Centroid {
  readonly x: number;
  readonly y: number;
  readonly count: number;
}

/**
 * Scan a mask's RGBA pixel buffer and return the true pixel centroid of each
 * mapped region, keyed by chapter id. Used to place the X marker exactly on the
 * mask (the documented centroids in {@link WORLD_REGIONS} are the fallback).
 */
export function computeCentroids(
  data: Uint8ClampedArray | number[],
  width: number,
  height: number,
  regions: readonly WorldRegion[] = WORLD_REGIONS,
): Map<number, Centroid> {
  const sums = new Map<number, { sx: number; sy: number; n: number }>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const region = regionForColor(data[i]!, data[i + 1]!, data[i + 2]!, regions);
      if (!region) continue;
      const s = sums.get(region.chapterId) ?? { sx: 0, sy: 0, n: 0 };
      s.sx += x;
      s.sy += y;
      s.n += 1;
      sums.set(region.chapterId, s);
    }
  }
  const out = new Map<number, Centroid>();
  for (const [id, s] of sums) {
    out.set(id, { x: Math.round(s.sx / s.n), y: Math.round(s.sy / s.n), count: s.n });
  }
  return out;
}

// --- Canvas / DOM (browser only) --------------------------------------------

/** Load an <img>, resolving null on error so callers degrade to the strip. */
function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Read an image's RGBA pixels via an offscreen canvas (1:1, no scaling). */
function pixels(img: HTMLImageElement): { data: Uint8ClampedArray; w: number; h: number } | null {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0);
  try {
    return { data: ctx.getImageData(0, 0, w, h).data, w, h };
  } catch {
    return null; // tainted canvas (shouldn't happen for same-origin assets)
  }
}

/** The mounted globe: its DOM plus a selection setter that redraws the map. */
export interface WorldGlobe {
  readonly canvas: HTMLCanvasElement;
  /** Redraw with `chapterId` highlighted (no-op when it has no continent). */
  select(chapterId: number): void;
  /** Report the region under a client point, or undefined (ocean/edge/off). */
  regionAt(clientX: number, clientY: number): WorldRegion | undefined;
}

export interface GlobeCallbacks {
  /** Called when the pointer enters/leaves a region (for cursor + hover tint). */
  onHover(region: WorldRegion | undefined): void;
  /** Called when a region is clicked (caller decides lock handling). */
  onPick(region: WorldRegion): void;
}

/**
 * Build the keyed, highlightable world-map canvas. Returns null when either
 * image (or a 2D context) is unavailable, so the caller falls back to the plain
 * chapter strip. The canvas draws at the mask's native resolution and is
 * CSS-scaled with pixelated rendering to preserve the pixel art.
 */
export async function mountWorldGlobe(
  worldUrl: string,
  maskUrl: string,
  initialChapter: number,
  cb: GlobeCallbacks,
): Promise<WorldGlobe | null> {
  const [worldImg, maskImg] = await Promise.all([loadImage(worldUrl), loadImage(maskUrl)]);
  if (!worldImg || !maskImg) return null;
  const world = pixels(worldImg);
  const mask = pixels(maskImg);
  if (!world || !mask || world.w !== mask.w || world.h !== mask.h) return null;

  const { w, h } = world;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.className = 'world-map-canvas';
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const centroids = computeCentroids(mask.data, w, h);
  let selected = initialChapter;
  let hovered: WorldRegion | undefined;

  const colorFor = (id: number): readonly [number, number, number] | undefined =>
    WORLD_REGIONS.find((r) => r.chapterId === id)?.color;

  const draw = (): void => {
    const out = ctx.createImageData(w, h);
    const src = world.data;
    const msk = mask.data;
    const o = out.data;
    const selColor = colorFor(selected);
    const hovColor = hovered ? hovered.color : undefined;
    for (let i = 0; i < src.length; i += 4) {
      const r = src[i]!;
      const g = src[i + 1]!;
      const b = src[i + 2]!;
      if (isKeyColor(r, g, b)) {
        o[i + 3] = 0; // key -> transparent (green backdrop shows through)
        continue;
      }
      let R = r;
      let G = g;
      let B = b;
      const mr = msk[i]!;
      const mg = msk[i + 1]!;
      const mb = msk[i + 2]!;
      if (selColor && distSq(mr, mg, mb, selColor) < MATCH_SQ) {
        // Selected continent: brighten and push toward gold.
        R = Math.min(255, r * 1.2 + 62);
        G = Math.min(255, g * 1.14 + 46);
        B = Math.min(255, b * 0.95 + 6);
      } else if (hovColor && distSq(mr, mg, mb, hovColor) < MATCH_SQ) {
        // Hovered continent: a subtle brighten only.
        R = Math.min(255, r * 1.12 + 22);
        G = Math.min(255, g * 1.1 + 18);
        B = Math.min(255, b * 1.05 + 10);
      }
      o[i] = R;
      o[i + 1] = G;
      o[i + 2] = B;
      o[i + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
    drawMarker();
  };

  const drawMarker = (): void => {
    const c = centroids.get(selected);
    const region = WORLD_REGIONS.find((r) => r.chapterId === selected);
    if (!region) return; // selected mission has no continent
    const cx = c?.x ?? region.centroid[0];
    const cy = c?.y ?? region.centroid[1];
    const arm = 11;
    ctx.save();
    ctx.lineCap = 'round';
    // Dark outline then pale core, tilted like the original marker.
    ctx.strokeStyle = 'rgba(48, 20, 24, 0.85)';
    ctx.lineWidth = 6;
    stroke(cx, cy, arm);
    ctx.strokeStyle = '#f3dede';
    ctx.lineWidth = 3;
    stroke(cx, cy, arm);
    ctx.restore();
  };

  const stroke = (cx: number, cy: number, arm: number): void => {
    ctx.beginPath();
    ctx.moveTo(cx - arm, cy - arm);
    ctx.lineTo(cx + arm, cy + arm);
    ctx.moveTo(cx + arm, cy - arm);
    ctx.lineTo(cx - arm, cy + arm);
    ctx.stroke();
  };

  const maskAt = (clientX: number, clientY: number): WorldRegion | undefined => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return undefined;
    const x = Math.floor(((clientX - rect.left) / rect.width) * w);
    const y = Math.floor(((clientY - rect.top) / rect.height) * h);
    if (x < 0 || y < 0 || x >= w || y >= h) return undefined;
    const i = (y * w + x) * 4;
    return regionForColor(mask.data[i]!, mask.data[i + 1]!, mask.data[i + 2]!);
  };

  canvas.addEventListener('mousemove', (e) => {
    const region = maskAt(e.clientX, e.clientY);
    if ((region?.chapterId ?? 0) !== (hovered?.chapterId ?? 0)) {
      hovered = region;
      cb.onHover(region);
      draw();
    }
  });
  canvas.addEventListener('mouseleave', () => {
    if (hovered) {
      hovered = undefined;
      cb.onHover(undefined);
      draw();
    }
  });
  canvas.addEventListener('click', (e) => {
    const region = maskAt(e.clientX, e.clientY);
    if (region) cb.onPick(region);
  });

  draw();

  return {
    canvas,
    select(chapterId: number): void {
      selected = chapterId;
      draw();
    },
    regionAt: maskAt,
  };
}
