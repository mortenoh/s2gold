import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Clean URLs in dev, matching the Rust server's production routes:
 * /play and /play/<map> serve game.html, /game/<map>/<session-id> (and the
 * shorter /game, /game/<map>) also serve game.html, /inspector serves
 * inspector.html, /setup serves the menu entry (index.html) which routes on the
 * pathname.
 */
function cleanUrls(): Plugin {
  return {
    name: 's2gold-clean-urls',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url ?? '';
        if (url === '/inspector' || url.startsWith('/inspector?')) {
          req.url = '/inspector.html';
        } else if (url === '/play' || url.startsWith('/play/') || url.startsWith('/play?')) {
          req.url = '/game.html';
        } else if (url === '/game' || url.startsWith('/game/') || url.startsWith('/game?')) {
          req.url = '/game.html';
        } else if (url === '/setup' || url.startsWith('/setup/') || url.startsWith('/setup?')) {
          req.url = '/index.html';
        } else if (
          url === '/options' ||
          url.startsWith('/options?') ||
          url === '/credits' ||
          url.startsWith('/credits?') ||
          url === '/campaign' ||
          url.startsWith('/campaign/') ||
          url.startsWith('/campaign?')
        ) {
          req.url = '/index.html';
        }
        next();
      });
    },
  };
}

/**
 * Proxy the save-game API to the Rust server so both dev and preview hit the
 * same `/api/*` routes the production server serves. Only `/api` is forwarded;
 * everything else is served by Vite. When the API server is down the proxy
 * fails the request (ECONNREFUSED) and the UI degrades to "saves unavailable".
 */
const apiProxy = {
  '/api': {
    target: 'http://127.0.0.1:8000',
    changeOrigin: true,
  },
} as const;

export default defineConfig({
  root: import.meta.dirname,
  plugins: [cleanUrls()],
  server: {
    port: 5199,
    strictPort: true,
    proxy: apiProxy,
  },
  preview: {
    port: 5199,
    strictPort: true,
    proxy: apiProxy,
  },
  build: {
    target: 'es2022',
    // Keep build chunks off /assets, which the Rust server reserves for the
    // converted game art (public/assets). Emitting to dist/app/ avoids the mount
    // collision that otherwise 404s the app bundle in production.
    assetsDir: 'app',
    // Never copy public/ (the ~75 MB converted asset tree) into dist: the
    // server mounts /assets separately, and a stale dist/assets snapshot would
    // silently shadow it whenever the real assets dir is missing.
    copyPublicDir: false,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        inspector: resolve(import.meta.dirname, 'inspector.html'),
        game: resolve(import.meta.dirname, 'game.html'),
      },
    },
  },
});
