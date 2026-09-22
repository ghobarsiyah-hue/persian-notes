/**
 * Caret-follow probe — types Persian until page 2 appears, then reports
 * where DOM focus and PM selection ended up (page + position + focus).
 */
import { chromium } from 'playwright-core';

const VITE = process.argv[2] ?? 'http://localhost:5174';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const watchdog = setTimeout(() => {
  console.log('WATCHDOG: 110s elapsed — aborting');
  process.exit(3);
}, 110_000);

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
});
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('console', (msg) => {
    const t = msg.text();
    if (t.startsWith('[PAGE]')) console.log(t);
  });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));

  console.log('step: login');
  await page.goto(`${VITE}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('input[type="email"]', { timeout: 20000 });
  await page.fill('input[type="email"]', 'demo@pernote.local');
  await page.fill('input[type="password"]', 'demo1234');
  await page.click('button[type="submit"]');
  try {
    await page.waitForSelector('.document-pages .page-paper .pn-editor', { timeout: 25000 });
  } catch {
    await page.goto(`${VITE}/editor/new`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('.document-pages .page-paper .pn-editor', { timeout: 25000 });
  }
  await sleep(2500);
  const page2 = page;
  page2.setDefaultTimeout(8000);
  console.log('step: editor mounted');

  /* Focus the real page-1 editor via elementFromPoint (sidebar thumbs excluded) */
  await page.evaluate(() => {
    window.__layoutDebug = true;
    const el = document.querySelector('.document-pages .page-paper .pn-editor');
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + 40;
    const target = document.elementFromPoint(cx, cy) ?? el;
    for (const type of ['mousedown', 'mouseup', 'click']) {
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
    }
    el.focus();
  });
  await sleep(300);

  const LINE = 'تایپ پیوسته برای عبور از انتهای برگه اول. ';
  let typed = 0;
  console.log('step: typing');
  for (let i = 0; i < 80; i++) {
    const t0 = Date.now();
    try {
      await page.keyboard.type(LINE, { delay: 5 });
      typed += LINE.length;
    } catch (e) {
      console.log(`  ! type failed at i=${i}: ${e.message.split('\n')[0]}`);
      break;
    }
    if (i % 5 === 4) {
      try {
        const st = await page.evaluate(() => ({
          pages: document.querySelectorAll('.document-pages .page-paper').length,
          landed: Array.from(document.querySelectorAll('.document-pages .page-paper .pn-editor')).reduce((s, e) => s + e.textContent.length, 0),
          focused: document.activeElement?.className?.slice(0, 40) ?? null,
        }));
        console.log(`  i=${i} sent~${typed} landed=${st.landed} pages=${st.pages} focus=${st.focused} (${Date.now() - t0}ms)`);
        if (st.pages >= 2) break;
      } catch (e) {
        console.log(`  ! evaluate failed at i=${i}: ${e.message.split('\n')[0]}`);
        break;
      }
    }
    await sleep(30);
  }
  await sleep(2500);
  console.log('step: reading state');

  const state = await page.evaluate((typedLen) => {
    const papers = Array.from(document.querySelectorAll('.document-pages .page-paper'));
    const ae = document.activeElement;
    const isEditor = !!ae?.classList?.contains('pn-editor');
    const focusPaper = ae?.closest?.('.page-paper');
    const focusIdx = focusPaper ? papers.indexOf(focusPaper) + 1 : null;
    const items = Array.from(document.querySelectorAll('.pn-page-item'));
    const activeItem = items.find((e) => e.className.includes('active'));
    const activeId = activeItem?.getAttribute('data-page-id') ?? null;
    const activeIdx = activeId
      ? papers.findIndex((p) => p.getAttribute('data-page-id') === activeId) + 1
      : null;
    const sels = papers.map((p, i) => {
      const ed = p.querySelector('.pn-editor')?.editor;
      return ed
        ? { page: i + 1, from: ed.state.selection.from, to: ed.state.selection.to, focused: ed.isFocused, len: ed.state.doc.textContent.length }
        : { page: i + 1, noEditor: true };
    });
    return {
      pages: papers.length,
      activeElement: { tag: ae?.tagName ?? null, isEditor },
      focusIdx, activeIdx,
      sels,
      landedTotal: papers.reduce((s, p) => s + (p.querySelector('.pn-editor')?.textContent?.length ?? 0), 0),
      typedLen,
    };
  }, typed);
  console.log(JSON.stringify(state, null, 2));
} finally {
  clearTimeout(watchdog);
  await browser.close().catch(() => {});
}
