/**
 * Engine-agnostic scene description for the sprite/object layer that draws over
 * the terrain.
 *
 * The renderer stays free of game types: the app translates whatever it knows
 * (map object layers now, live units later) into a {@link RenderScene} of plain
 * data. Static objects are anchored to map nodes and are uploaded once per map;
 * dynamic sprites carry their own world position and are supplied every frame.
 */

/** A map-node coordinate (lattice indices, not pixels). */
export interface NodeRef {
  readonly x: number;
  readonly y: number;
}

/**
 * A looping frame animation. The displayed sprite index is
 * `baseIndex + ((tick + phase) % frameCount)`, where `tick` is the global
 * animation counter the app advances at the original's cadence.
 */
export interface SpriteAnimation {
  /** Sprite index of animation frame 0. */
  readonly baseIndex: number;
  /** Number of frames in the loop (e.g. 8 for a waving tree). */
  readonly frameCount: number;
  /** Per-object phase offset so neighbours wave out of step. */
  readonly phase: number;
}

/**
 * A map-anchored object (tree, granite, decoration). Uploaded once per map and
 * culled/animated per frame. `spriteIndex` is the still frame; when
 * `animation` is present the drawn frame is computed from the global tick.
 */
export interface StaticObject {
  /** Lattice node this object sits on. */
  readonly node: NodeRef;
  /** Graphics archive the sprite indices refer to (e.g. "mapbobs"). */
  readonly archive: string;
  /** Sprite index for a still object (ignored when `animation` is set). */
  readonly spriteIndex: number;
  /** Optional shadow sprite index drawn under the object. */
  readonly shadowIndex?: number;
  /** Optional looping animation. */
  readonly animation?: SpriteAnimation;
}

/**
 * A freely positioned sprite (a moving settler, a ware, a flag). Carries its
 * own world-pixel anchor and is supplied fresh each frame.
 */
export interface DynamicSprite {
  /** Anchor world-x in pixels (node/hotspot position). */
  readonly worldX: number;
  /** Anchor world-y in pixels. */
  readonly worldY: number;
  /** Graphics archive the sprite index refers to. */
  readonly archive: string;
  /** Sprite index. */
  readonly spriteIndex: number;
  /** Optional shadow sprite index drawn under the sprite. */
  readonly shadowIndex?: number;
  /** Player number (0..) for player-colour tinting; omitted = no tint. */
  readonly player?: number;
}

/** The full per-frame scene consumed by the sprite renderer. */
export interface RenderScene {
  readonly objects: readonly StaticObject[];
  readonly dynamics: readonly DynamicSprite[];
}

/** One sprite rectangle inside an atlas page (matches the atlas.json schema). */
export interface AtlasSprite {
  /** Atlas page index (0-based). */
  readonly atlas: number;
  /** Left pixel in the atlas page. */
  readonly x: number;
  /** Top pixel in the atlas page. */
  readonly y: number;
  /** Width in pixels. */
  readonly w: number;
  /** Height in pixels. */
  readonly h: number;
  /** Hotspot x offset: draw so `screenX = anchorX - nx`. */
  readonly nx: number;
  /** Hotspot y offset: draw so `screenY = anchorY - ny`. */
  readonly ny: number;
  /** Bitmap kind: "rle" | "player" | "shadow" | "raw". */
  readonly kind: string;
}

/** Parsed atlas metadata (the `atlas.json` next to the atlas PNGs). */
export interface SpriteAtlasMeta {
  /** Archive name, e.g. "mapbobs". */
  readonly archive: string;
  /** Atlas page filenames, index-aligned with {@link AtlasSprite.atlas}. */
  readonly atlases: readonly string[];
  /** Sprite index -> rectangle. Keys are the original archive item indices. */
  readonly sprites: ReadonlyMap<number, AtlasSprite>;
  /** Player-colour mask sprite indices, when the archive ships them. */
  readonly pmasks: readonly number[];
}

/**
 * Default player colours as packed 0xRRGGBB values. Derived from the pal5
 * player-colour band (indices 128-131: blue, yellow, red, purple) plus the
 * documented extra Settlers II player hues. Used to tint player-coloured
 * sprites via the pmask second-texture lookup. The mapbobs archive ships no
 * pmasks, so map objects (trees/granite) are never tinted; this table is for
 * the later unit/building sprite layers.
 */
export const PLAYER_COLORS: readonly number[] = [
  0x2848d8, // 0 blue
  0xe8c820, // 1 yellow
  0xc81818, // 2 red
  0xa018a0, // 3 purple
  0x18a0a0, // 4 cyan
  0xe87818, // 5 orange
  0x38a038, // 6 green
  0x585858, // 7 grey
];

/** Unpack a packed 0xRRGGBB colour into normalised [r, g, b] in 0..1. */
export function unpackColor(rgb: number): [number, number, number] {
  return [((rgb >> 16) & 0xff) / 255, ((rgb >> 8) & 0xff) / 255, (rgb & 0xff) / 255];
}
