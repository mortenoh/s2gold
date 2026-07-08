import './styles.css';
import { clear, el } from './lib/dom';
import { loadManifest } from './lib/manifest';

async function boot(): Promise<void> {
  const root = document.querySelector<HTMLElement>('#app');
  if (!root) return;
  clear(root);

  root.append(
    el('h1', { text: 's2gold', attrs: { 'data-testid': 'title' } }),
    el('p', {
      class: 'tagline',
      text: 'The Settlers II Gold — clean-room browser reimplementation',
    }),
  );

  const manifest = await loadManifest();

  if (manifest) {
    const categories = Object.keys(manifest.categories);
    root.append(
      el(
        'div',
        { class: 'card ok', attrs: { 'data-testid': 'assets-ready' } },
        el('p', {
          text: `Assets installed (manifest v${manifest.version}, ${categories.length} categor${
            categories.length === 1 ? 'y' : 'ies'
          }).`,
        }),
        el(
          'p',
          {},
          el('a', { class: 'btn', href: '/game.html', text: 'Play (terrain demo)' }),
          ' ',
          el('a', { class: 'btn', href: '/inspector.html', text: 'Open asset inspector' }),
        ),
      ),
    );
  } else {
    root.append(
      el(
        'div',
        { class: 'card warn', attrs: { 'data-testid': 'assets-missing' } },
        el('p', { html: 'No converted assets found at <code>/assets/manifest.json</code>.' }),
        el('p', { text: 'Run the asset pipeline against your GOG installer, then reload:' }),
        el('pre', { text: 'make install INSTALLER=path/to/gog.exe' }),
        el('p', {
          class: 'sub',
          html:
            'This extracts and converts the game files into ' +
            '<code>packages/app/public/assets/</code> (git-ignored).',
        }),
      ),
    );
  }
}

void boot();
