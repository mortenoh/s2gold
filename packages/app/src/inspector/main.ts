import '../styles.css';
import { clear, el } from '../lib/dom';
import { loadManifest, type Manifest } from '../lib/manifest';
import { CATEGORY_ORDER, RENDERERS, fallbackRenderer, type CategoryRenderer } from './categories';
import { unique } from './types';

function orderedCategories(manifest: Manifest): string[] {
  const present = Object.keys(manifest.categories);
  const known = CATEGORY_ORDER.filter((c) => present.includes(c) || c in RENDERERS);
  const extras = present.filter((c) => !CATEGORY_ORDER.includes(c));
  return unique([...known, ...extras]);
}

function rendererFor(name: string): CategoryRenderer {
  return RENDERERS[name] ?? fallbackRenderer(name);
}

async function boot(): Promise<void> {
  const root = document.querySelector<HTMLElement>('#inspector');
  if (!root) return;
  clear(root);

  const manifest = await loadManifest();

  const header = el(
    'header',
    { class: 'inspector-header' },
    el('h1', { text: 's2gold' }),
    el('span', { class: 'meta', text: 'asset inspector' }),
    el('span', { class: 'spacer' }),
    el('a', { href: '/', text: '← title screen' }),
  );
  root.append(header);

  if (!manifest) {
    const main = el('div', { class: 'main', attrs: { 'data-testid': 'no-manifest' } });
    main.append(
      el('h2', { class: 'section-title', text: 'No assets installed' }),
      el('p', { html: 'Could not load <code>/assets/manifest.json</code>.' }),
      el('pre', { text: 'make install INSTALLER=path/to/gog.exe' }),
    );
    // Fill the header row grid gap with an empty sidebar so layout holds.
    root.append(el('nav', { class: 'sidebar' }), main);
    return;
  }

  const categories = orderedCategories(manifest);
  const sidebar = el('nav', { class: 'sidebar' });
  const list = el('ul', { class: 'cat-list', attrs: { 'data-testid': 'category-list' } });
  sidebar.append(list);
  const main = el('div', { class: 'main', attrs: { 'data-testid': 'category-main' } });
  root.append(sidebar, main);

  const selectCategory = async (name: string, item: HTMLElement): Promise<void> => {
    // Selection lives in the URL hash so it survives reloads and is shareable.
    if (window.location.hash.slice(1) !== name) {
      history.replaceState(null, '', `#${name}`);
    }
    list.querySelectorAll('.cat-item.active').forEach((n) => n.classList.remove('active'));
    item.classList.add('active');
    clear(main);
    main.append(
      el('h2', { class: 'section-title', text: name }),
      el('p', { class: 'section-sub', text: rendererFor(name).label }),
    );
    const body = el('div');
    main.append(body);
    try {
      await rendererFor(name).render(body, manifest.categories[name]);
    } catch (err) {
      console.error(`[inspector] renderer for "${name}" failed`, err);
      body.append(
        el('div', {
          class: 'empty-note',
          text: `Failed to render this category: ${String(err)}`,
        }),
      );
    }
  };

  let first: { name: string; item: HTMLElement } | null = null;
  const items = new Map<string, HTMLElement>();
  for (const name of categories) {
    const converted = name in manifest.categories;
    const item = el('li', {
      class: `cat-item${converted ? '' : ' missing'}`,
      dataset: { category: name },
    });
    item.append(
      el('span', { text: name }),
      el('span', { class: 'cat-badge', text: converted ? '' : 'not converted yet' }),
    );
    list.append(item);
    if (converted) {
      items.set(name, item);
      item.addEventListener('click', () => void selectCategory(name, item));
      if (!first) first = { name, item };
    }
  }

  const fromHash = (): { name: string; item: HTMLElement } | null => {
    const name = window.location.hash.slice(1);
    const item = items.get(name);
    return item ? { name, item } : null;
  };
  window.addEventListener('hashchange', () => {
    const target = fromHash();
    if (target) void selectCategory(target.name, target.item);
  });

  const initial = fromHash() ?? first;
  if (initial) {
    await selectCategory(initial.name, initial.item);
  } else {
    main.append(
      el('div', {
        class: 'empty-note',
        text: 'Manifest present, but no categories converted yet.',
      }),
    );
  }
}

void boot();
