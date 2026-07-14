/**
 * Server-session autosave: persist the live world to `/api/sessions/<id>`
 * every 10s, and once more on hide/close (keepalive) so a refresh or tab close
 * captures the latest state. Fire-and-forget: errors (offline, 413 too-large,
 * ...) are ignored. Only ever armed in session mode, so legacy /play games
 * persist nothing here.
 */

/** Arm the periodic + on-hide persistence for a server session. */
export function startSessionPersistence(id: string, snapshot: () => string | null): void {
  const url = `/api/sessions/${id}`;
  window.setInterval(() => {
    const body = snapshot();
    if (!body) return;
    void fetch(url, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body,
    }).catch(() => {
      /* best-effort autosave; ignore transient failures */
    });
  }, 10_000);
  // A refresh/close won't await a normal fetch, so keepalive lets the browser
  // flush the final snapshot after the page is already going away.
  const flush = (): void => {
    const body = snapshot();
    if (!body) return;
    try {
      void fetch(url, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: true,
      });
    } catch {
      /* keepalive may reject an oversized body; nothing to do */
    }
  };
  window.addEventListener('pagehide', flush);
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}
