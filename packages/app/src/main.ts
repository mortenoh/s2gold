/**
 * Menu entry point. The title screen ("/") and free-play setup ("/setup") are
 * served by this single Vite entry (index.html); the Vite dev middleware and
 * the FastAPI server both rewrite "/setup" to it. Which screen renders is
 * decided from the pathname; navigation between them uses ordinary links so
 * each screen is a real, shareable URL.
 */

import './styles.css';
import { renderTitle } from './menu/title';
import { renderSetup } from './menu/setup';
import { renderCampaign } from './menu/campaign';
import { renderBriefing } from './menu/briefing';

async function boot(): Promise<void> {
  const root = document.querySelector<HTMLElement>('#app');
  if (!root) return;

  const path = window.location.pathname;
  try {
    if (path === '/setup' || path.startsWith('/setup/') || path.startsWith('/setup?')) {
      await renderSetup(root);
    } else if (path === '/campaign' || path.startsWith('/campaign?')) {
      await renderCampaign(root);
    } else if (path.startsWith('/campaign/')) {
      // /campaign/<id> -> the chapter briefing. Non-numeric ids render an error
      // panel inside renderBriefing.
      const id = Number.parseInt(path.slice('/campaign/'.length), 10);
      await renderBriefing(root, id);
    } else {
      await renderTitle(root);
    }
  } catch (err) {
    console.error('[s2gold] menu failed to render', err);
    root.textContent = 'Menu failed to load.';
  }
}

void boot();
