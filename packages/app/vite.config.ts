import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Clean URLs in dev, matching the FastAPI server's production routes:
 * /play and /play/<map> serve game.html, /inspector serves inspector.html.
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
        }
        next();
      });
    },
  };
}

export default defineConfig({
  root: import.meta.dirname,
  plugins: [cleanUrls()],
  server: {
    port: 5199,
    strictPort: true,
  },
  preview: {
    port: 5199,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        inspector: resolve(import.meta.dirname, 'inspector.html'),
        game: resolve(import.meta.dirname, 'game.html'),
      },
    },
  },
});
