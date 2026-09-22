/* Reproduce the reported bug: «PAGE STAYS FIXED + CONTENT CONTINUES BELOW
 * THE USABLE CONTENT BOUNDARY».
 *
 * Method: fill a page to near-capacity with Persian text, then keep typing in
 * several shapes (plain paragraph, Enter-separated, heading, bullet list,
 * long wrapped line). After EVERY step measure the REAL sheet:
 *     overhang = max(child bottom) − wrap.clientHeight   (layout px)
 * The guard tolerates 4px. Any overhang > 4px = the bug reproduced.
 * Guard stats (window.__pnGuardStats) prove which path handled each step.
 */
import { chromium } from 'playwright-core';

const VITE = process.argv[2] ?? 'http://localhost:5199';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));

await page.goto(VITE + '/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.fill('input[type="email"]', 'demo@pernote.local');
await page.fill('input[type="password"]', 'demo1234');
await page.click('button[type="submit"]');
await sleep(1500);
await page.goto(VITE + '/editor/new', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('.document-pages .pn-editor', { timeout: 30000 });
await sleep(2500);
await page.evaluate(() => { window.__layoutDebug = true; });

await page.evaluate(() => { document.querySelector('.document-pages .pn-editor').focus(); });
await page.keyboard.press('Control+a');
await page.keyboard.type('شروع');

/* real-geometry probes (zoom-adjusted layout px) */
const geo = () => page.evaluate(() => {
  const wrap = document.querySelector('.document-pages .pn-editor-wrap');
  const pm = wrap.querySelector('.ProseMirror');
  const zoom = parseFloat(getComputedStyle(wrap).zoom || getComputedStyle(document.querySelector('.page-paper')).zoom || '1') || 1;
  const wRect = wrap.getBoundingClientRect();
  let bottom = 0, lastTag = '';
  pm.querySelectorAll(':scope > *').forEach((c) => {
    const r = c.getBoundingClientRect();
    const b = (r.bottom - wRect.top) / zoom;
    if (b > bottom) { bottom = b; lastTag = c.tagName; }
  });
  const stats = { ...window.__pnGuardStats };
  return {
    limit: Math.round(wrap.clientHeight),
    contentBottom: Math.round(bottom),
    overhang: Math.round(bottom - wrap.clientHeight),
    lastTag,
    sheets: Array.from(document.querySelectorAll('.document-pages .page-paper')).map((el) => {
      const z = parseFloat(getComputedStyle(el).zoom || '1') || 1;
      return { w: Math.round(el.getBoundingClientRect().width / z), h: Math.round(el.getBoundingClientRect().height / z) };
    }),
    stats,
  };
});

const free = (g) => g.limit - g.contentBottom;

/* fill to < 140px headroom with realistic Persian lines */
for (let i = 0; i < 300; i++) {
  await page.keyboard.type('خط آزمون سرریز برای صفحهٔ ثابت شمارهٔ ');
  await page.keyboard.type(String(i));
  await page.keyboard.press('Enter');
  const g = await geo();
  if (free(g) < 140) { console.log(`filled after ${i + 1} lines, free=${free(g)}px`); break; }
}

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(ok ? 'PASS' : 'FAIL', '-', name, detail ? `(${detail})` : ''); };

/* ── phase 1: keep typing Enter-separated paragraphs past the boundary ── */
let worst = 0;
for (let i = 0; i < 8; i++) {
  await page.keyboard.type('متن اضافه‌ای که نباید پایین صفحه رندر شود ');
  await page.keyboard.type(String(i));
  await page.keyboard.press('Enter');
  const g = await geo();
  worst = Math.max(worst, g.overhang);
  if (g.overhang > 4) { console.log(`  step ${i}: overhang=${g.overhang}px lastTag=${g.lastTag} stats=${JSON.stringify(g.stats)}`); }
}
const g1 = await geo();
check('P1 paragraphs: no content below usable boundary', g1.overhang <= 4, `overhang=${g1.overhang}px worstDuring=${worst}px`);

/* ── phase 2: HEADING as the last block (bigger fonts/margins) ── */
await page.keyboard.press('Control+Alt+2');
await page.keyboard.type('سرتیتر انتهای صفحه');
await page.keyboard.press('Enter');
const g2 = await geo();
check('P2 heading at the end: no overflow', g2.overhang <= 4, `overhang=${g2.overhang}px lastTag=${g2.lastTag}`);

/* ── phase 3: BULLET LIST as the last block ── */
await page.keyboard.press('Control+Shift+8');
for (let i = 0; i < 6; i++) {
  await page.keyboard.type('فهرست نقطه‌ای نزدیک مرز پایین ');
  await page.keyboard.press('Enter');
}
const g3 = await geo();
check('P3 bullet list at the end: no overflow', g3.overhang <= 4, `overhang=${g3.overhang}px lastTag=${g3.lastTag}`);

/* ── phase 4: one long WRAPPED line, no Enter (word-wrap at the limit) ── */
await page.keyboard.press('Control+Shift+8'); // back to paragraph? toggle list off
for (let i = 0; i < 12; i++) {
  await page.keyboard.type('جملهٔ بلند پیوسته بدون اینتر برای آزمون شکست سطر در مرز ');
  const g4 = await geo();
  if (g4.overhang > 4) { console.log(`  wrap step ${i}: overhang=${g4.overhang}px`); break; }
}
const g4 = await geo();
check('P4 wrapped line: no overflow', g4.overhang <= 4, `overhang=${g4.overhang}px`);

/* ── sheet invariants throughout ── */
const gs = await geo();
check('A4 sheets still exactly 794x1123', gs.sheets.every((s) => s.w === 794 && s.h === 1123), JSON.stringify(gs.sheets));
check('still exactly 1 page (no auto page)', gs.sheets.length === 1, `n=${gs.sheets.length}`);

console.log('FINAL GUARD STATS:', JSON.stringify(gs.stats));
console.log(`==== ${results.filter((r) => r.ok).length}/${results.length} passed ====`);
await browser.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
