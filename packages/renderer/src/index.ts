/**
 * @s2gold/renderer — WebGL2 terrain renderer for the S2 triangular map torus.
 *
 * Public API: build a {@link TerrainRenderer} on a canvas, `load()` it with
 * engine-agnostic {@link TerrainMapData} plus the landscape's terrain atlas
 * image, then `render(camera)` each frame. Sprites and the palette-exact
 * gouraud lighting path land in later phases per docs/PLAN.md workstream C.
 */

export const RENDERER_VERSION = '0.1.0';

/** Returns the renderer package version. */
export function version(): string {
  return RENDERER_VERSION;
}

export {
  ATLAS_SIZE,
  FALLBACK_RECT,
  HEIGHT_FACTOR,
  TERRAIN_ID_MASK,
  TERRAIN_RECTS,
  TR_H,
  TR_W,
  minimapColor,
  rectForTexture,
  texTypeForTexture,
  type AtlasRect,
  type LandscapeSet,
  type TexType,
} from './terrain-data';

export { validateMapData, type TerrainMapData } from './map-data';

export {
  mapPixelHeight,
  mapPixelWidth,
  neighbourE,
  neighbourSE,
  neighbourSW,
  nodeWorldPos,
  wrapNode,
  type LatticePoint,
} from './geometry';

export { buildTerrainMesh, FLOATS_PER_VERTEX, type TerrainMesh } from './mesh';

export { Camera, wrap, type ZoomLevel } from './camera';

export { TerrainRenderer, type TerrainRendererOptions } from './renderer';

export { buildMinimapPixels, heightBrightness } from './minimap';

export {
  PLAYER_COLORS,
  unpackColor,
  type AtlasSprite,
  type DynamicSprite,
  type NodeRef,
  type RenderScene,
  type SpriteAnimation,
  type SpriteAtlasMeta,
  type StaticObject,
} from './scene';

export { SpriteRenderer, type AtlasPage, type SpriteDrawStats } from './sprites';
