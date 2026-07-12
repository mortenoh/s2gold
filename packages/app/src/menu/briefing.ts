/**
 * Mission briefing ("/campaign/<id>"): the chapter's opening diary entry over a
 * parchment panel on the campaign world map, the objective, and a Start button.
 *
 * The diary text (index 0 of the chapter's converted text bank) is word-wrapped
 * with the original bitmap font and paginated when it runs long. Start derives
 * the computer opponents from the map's real HQ slots (all non-human HQs become
 * Computer) and navigates to `/play/<map>?campaign=<id>[&ai=...]`.
 */

import { clear, el } from '../lib/dom';
import { BitmapFont } from '../ui/font';
import { fontCanvas, fontHeading } from '../ui/widgets';
import { applyBackdrop } from './pics';
import { menuStrings } from './strings';
import { MenuMusic } from './music';
import {
  campaignPathFor,
  chapterById,
  campaignAiSlots,
  isChapterCompleted,
  winConditionText,
  type Chapter,
} from './campaign-data';
import { loadMissionText, wrapMissionText, paginate } from './mission-text';

const GOLD = '#f0c84a';
const CREAM = '#f4ecd0';

/** Backdrop preference: the campaign world map, then setup fallbacks. */
const BRIEFING_PIC_KEYS = ['world', 'setup990', 'setup896', 'setup801'] as const;

/** Wrap width (px) and lines-per-page for the diary text panel. */
const TEXT_WIDTH_PX = 620;
const TEXT_SCALE = 1;
const LINES_PER_PAGE = 12;

export async function renderBriefing(root: HTMLElement, chapterId: number): Promise<void> {
  clear(root);
  root.className = 'menu-screen menu-briefing';

  const music = new MenuMusic();
  music.mount(root);
  await applyBackdrop(root, BRIEFING_PIC_KEYS);

  const chapter = chapterById(chapterId);
  if (!chapter) {
    root.append(
      el(
        'div',
        { class: 'menu-panel', attrs: { 'data-testid': 'briefing-panel' } },
        el('a', { class: 'menu-back', href: '/campaign', text: '← Back to campaign' }),
        el('div', { class: 'menu-note', text: `Unknown chapter "${String(chapterId)}".` }),
      ),
    );
    return;
  }

  const strings = await menuStrings();
  let font: BitmapFont | null = null;
  try {
    font = await BitmapFont.load('font14');
  } catch {
    font = null;
  }

  const panel = el('div', {
    class: 'menu-panel briefing-panel',
    attrs: { 'data-testid': 'briefing-panel', 'data-chapter': String(chapter.id) },
  });

  // Header: back link + chapter title.
  const header = el('div', { class: 'briefing-header' });
  header.append(
    el('a', {
      class: 'menu-back',
      href: campaignPathFor(chapter.id),
      text: '← Campaign',
      attrs: { 'data-testid': 'briefing-back' },
    }),
    font
      ? fontHeading(font, chapter.title, { scale: 2, color: GOLD, testid: 'briefing-title' })
      : el('h1', { text: chapter.title, attrs: { 'data-testid': 'briefing-title' } }),
  );
  panel.append(header);

  if (isChapterCompleted(chapter.id)) {
    panel.append(
      el('div', {
        class: 'briefing-completed',
        attrs: { 'data-testid': 'briefing-completed' },
        text: '✓ Chapter completed — replay available',
      }),
    );
  }

  // Diary text (parchment). Falls back to the objective when the bank is absent.
  const diaryHost = el('div', {
    class: 'briefing-diary',
    attrs: { 'data-testid': 'briefing-diary' },
  });
  panel.append(diaryHost);

  const bank = chapter.textFile ? await loadMissionText(chapter.textFile) : null;
  const diaryRaw = bank?.[0] ?? chapter.objective;
  renderDiary(diaryHost, font, diaryRaw);

  // Objective block: the original first goal line (index 1) plus our English
  // clean-room objective and the checkable win condition.
  const goalLine = bank?.[1];
  const objective = el(
    'div',
    { class: 'briefing-objective', attrs: { 'data-testid': 'briefing-objective' } },
    el('div', { class: 'briefing-objective-title', text: strings.objective }),
    el('div', { class: 'briefing-objective-text', text: chapter.objective }),
    goalLine ? el('div', { class: 'briefing-objective-orig', text: `“${goalLine}”` }) : null,
    el('div', {
      class: 'briefing-objective-win',
      text: `Victory: ${winConditionText(chapter.win)}`,
    }),
  );
  panel.append(objective);

  // Start button.
  const startBtn = el('button', {
    class: 'menu-start-btn',
    type: 'button',
    text: strings.startGame,
    attrs: { 'data-testid': 'briefing-start', 'data-map': chapter.mapName },
  }) as HTMLButtonElement;
  startBtn.addEventListener('click', () => void startChapter(startBtn, chapter));
  panel.append(startBtn);

  root.append(panel);
}

/** Render the diary text with pagination, using the bitmap font when available. */
function renderDiary(host: HTMLElement, font: BitmapFont | null, raw: string): void {
  clear(host);
  if (!font) {
    // Plain-text fallback: paragraphs from the normalised source.
    for (const para of raw.split(/@{2,}/).map((p) => p.replace(/@/g, ' ').trim())) {
      if (para) host.append(el('p', { class: 'briefing-diary-p', text: para }));
    }
    return;
  }

  const lines = wrapMissionText(font, raw, TEXT_WIDTH_PX, TEXT_SCALE);
  const pages = paginate(lines, LINES_PER_PAGE);

  const canvasHost = el('div', { class: 'briefing-diary-canvas' });
  const nav = el('div', { class: 'briefing-diary-nav' });
  const prev = el('button', {
    class: 'briefing-page-btn',
    type: 'button',
    text: '‹ Prev',
    attrs: { 'data-testid': 'briefing-prev' },
  }) as HTMLButtonElement;
  const label = el('span', {
    class: 'briefing-page-label',
    attrs: { 'data-testid': 'briefing-page' },
  });
  const next = el('button', {
    class: 'briefing-page-btn',
    type: 'button',
    text: 'Next ›',
    attrs: { 'data-testid': 'briefing-next' },
  }) as HTMLButtonElement;

  let page = 0;
  const draw = (): void => {
    clear(canvasHost);
    const text = (pages[page] ?? []).join('\n');
    canvasHost.append(fontCanvas(font, text, { scale: TEXT_SCALE, color: CREAM, lineSpacing: 4 }));
    label.textContent = `${page + 1} / ${pages.length}`;
    prev.disabled = page === 0;
    next.disabled = page >= pages.length - 1;
  };
  prev.addEventListener('click', () => {
    if (page > 0) {
      page--;
      draw();
    }
  });
  next.addEventListener('click', () => {
    if (page < pages.length - 1) {
      page++;
      draw();
    }
  });

  host.append(canvasHost);
  if (pages.length > 1) {
    nav.append(prev, label, next);
    host.append(nav);
  }
  draw();
}

/** Derive AI slots from the map, then navigate to the game in campaign mode. */
async function startChapter(btn: HTMLButtonElement, chapter: Chapter): Promise<void> {
  btn.disabled = true;
  const mapFile = `maps/${chapter.mapName}.json`;
  const ai = await campaignAiSlots(mapFile);
  const params = new URLSearchParams();
  params.set('campaign', String(chapter.id));
  if (ai.length > 0) params.set('ai', ai.join(','));
  window.location.assign(`/play/${chapter.mapName}?${params.toString()}`);
}
