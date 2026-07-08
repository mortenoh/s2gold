/** Asset manifest loading and defensive JSON helpers. */

export const ASSETS_BASE = '/assets';

export interface Manifest {
  version: number;
  categories: Record<string, unknown>;
}

/** Build a URL under the assets root, tolerating leading slashes. */
export function assetUrl(rel: string): string {
  return `${ASSETS_BASE}/${rel.replace(/^\/+/, '')}`;
}

/**
 * Fetch and parse JSON. Returns null on any failure (missing file, network,
 * malformed JSON) so callers can degrade gracefully while converters land.
 */
export async function fetchJson<T = unknown>(path: string): Promise<T | null> {
  try {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`[s2gold] failed to load JSON ${path}`, err);
    return null;
  }
}

/** True when a resource exists (HEAD/GET 2xx). Used to probe for optional files. */
export async function resourceExists(path: string): Promise<boolean> {
  try {
    const res = await fetch(path, { method: 'GET', cache: 'no-cache' });
    return res.ok;
  } catch {
    return false;
  }
}

/** Load the top-level asset manifest, or null when assets are not installed. */
export async function loadManifest(): Promise<Manifest | null> {
  const raw = await fetchJson<unknown>(assetUrl('manifest.json'));
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const categories =
    obj.categories && typeof obj.categories === 'object'
      ? (obj.categories as Record<string, unknown>)
      : {};
  const version = typeof obj.version === 'number' ? obj.version : 0;
  return { version, categories };
}
