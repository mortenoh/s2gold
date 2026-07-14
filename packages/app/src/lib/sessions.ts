/**
 * Server session API client (`/api/sessions`). A session is a server-side
 * record of a running game — its map, computer opponents, optional campaign and
 * the latest world snapshot — giving each new game a refreshable
 * `/game/<map>/<session-id>` URL whose live state survives a reload.
 *
 * Every call is best-effort with a short (~2s) timeout: the plain Vite dev
 * server has no `/api/sessions`, so the callers fall back to the legacy
 * `/play/<map>?...` flow whenever these resolve to null. Mirrors the defensive
 * fetch style of {@link ../game/save-ui} and {@link ./manifest}.
 */

const API_BASE = '/api/sessions';
const REQUEST_TIMEOUT_MS = 2000;

/** Session metadata (no world snapshot); matches the FastAPI SessionMeta model. */
export interface SessionMeta {
  id: string;
  map: string;
  ai: number[];
  /**
   * Per-slot nation codes (`rom`/`vik`/`nub`/`jap`, {@link ./nations}), indexed
   * by player slot. Optional/null on legacy sessions created before nations
   * existed — a null/absent value means an all-Roman game.
   */
  nations: string[] | null;
  campaign: number | null;
  tick: number;
  created_at: string;
  updated_at: string;
}

/** A full session including its opaque world snapshot (null until first save). */
export interface Session extends SessionMeta {
  data: Record<string, unknown> | null;
}

/** POST body for {@link createSession}. */
export interface CreateSessionBody {
  map: string;
  ai: number[];
  /** Per-slot nation codes ({@link SessionMeta.nations}); null = all-Roman. */
  nations: string[] | null;
  campaign: number | null;
}

/**
 * Create a new server session for a game. Returns its id, or null on any
 * failure (non-OK response, network error, or ~2s timeout) so the caller can
 * fall back to the legacy `/play` URL.
 */
export async function createSession(body: CreateSessionBody): Promise<string | null> {
  try {
    const res = await fetch(API_BASE, {
      method: 'POST',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const session = (await res.json()) as { id?: unknown };
    return typeof session.id === 'string' ? session.id : null;
  } catch {
    return null;
  }
}

/** Fetch a session (with its snapshot) by id, or null on any failure / 404. */
export async function getSession(id: string): Promise<Session | null> {
  try {
    const res = await fetch(`${API_BASE}/${id}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as Session;
  } catch {
    return null;
  }
}

/**
 * The newest session (the API returns them newest-updated first), or null when
 * the API is unreachable (e.g. the plain Vite dev server) or has no sessions.
 */
export async function newestSession(): Promise<{ id: string; map: string } | null> {
  try {
    const res = await fetch(API_BASE, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) return null;
    const list = (await res.json()) as { id?: unknown; map?: unknown }[];
    const first = list[0];
    if (first && typeof first.id === 'string' && typeof first.map === 'string') {
      return { id: first.id, map: first.map };
    }
    return null;
  } catch {
    return null;
  }
}
