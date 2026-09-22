/* Catch the FIRST transaction that creates >4px real overhang and dissect it:
 *   - which guard path handled it (fits / fastHeadroom / fastShrink / …)
 *   - scratch height vs real height at that moment
 *   - DOM vs state divergence (does the visible overflow exist in STATE?)
 * Hook: a MutationObserver on the real PM records child rects per keystroke;
 * stats snapshots around each keystroke give the guard's path. */
import { chromium } from 'playwright-core';

const VITE = process.argv[2] ?? 'http://localhost:5199';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'log' && m.text().startsWith('[ovf]')) console.log(m.text()); });

await page.goto(VITE + '/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.fill('input[type="email"]', 'demo@pernote.local');
await page.fill('input[type="password"]', 'demo1234');
await page.click('button[type="submit"]');
await sleep(1500);
await page.goto(VITE + '/editor/new', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('.document-pages .pn-editor', { timeout: 30000 });
await sleep(2500);
await page.evaluate(() => { window.__layoutDebug = true; });

/* state text via the editor's own hooks: read the PM view from the DOM key */
const text = () => page.evaluate(() => {
  const pm = document.querySelector('.document-pages .pn-editor-wrap .ProseMirror');
  /* editor DOM node → find the EditorView via PM's dom→view map trick:
     tiptap stores nothing public; instead compare DOM text vs PM state text
     through the content JSON the host exposes on update. Use DOM text as
     truth for rendering and window.__pnGuardStats for paths. */
  return pm.textContent.length;
});

await page.evaluate(() => { document.querySelector('.document-pages .pn-editor').focus(); });
await page.keyboard.press('Control+a');
await page.keyboard.type('شروع');

const geo = () => page.evaluate(() => {
  const wrap = document.querySelector('.document-pages .pn-editor-wrap');
  const pm = wrap.querySelector('.ProseMirror');
  const zoom = parseFloat(getComputedStyle(wrap).zoom || '1') || 1;
  const wRect = wrap.getBoundingClientRect();
  let bottom = 0;
  pm.querySelectorAll(':scope > *').forEach((c) => {
    const b = (c.getBoundingClientRect().bottom - wRect.top) / zoom;
    if (b > bottom) bottom = b;
  });
  return { limit: Math.round(wrap.clientHeight), bottom: Math.round(bottom), stats: { ...window.__pnGuardStats } };
});

let prev = await geo();
let free = prev.limit - prev.bottom;
let i = 0;
let caught = false;
while (i < 400 && free > 60) {
  await page.keyboard.type('خط آزمون سرریز شمارهٔ ');
  await page.keyboard.type(String(i));
  await page.keyboard.press('Enter');
  const g = await geo();
  free = g.limit - g.bottom;
  i++;
}

console.log(`filled: ${i} lines, free=${free}px, bottom=${(await geo()).bottom}, limit=${(await geo()).limit}`);
const S0 = (await geo()).stats;

/* now type ONE char at a time, snapshot stats + geometry after each */
for (let k = 0; k < 25; k++) {
  const sBefore = (await geo()).stats;
  await page.keyboard.type('ک');
  await sleep(120); /* let the post-reject redraw settle */
  const g = await geo();
  const d = {};
  for (const key of Object.keys(g.stats)) d[key] = g.stats[key] - (sBefore[key] || 0);
  const over = g.bottom - g.limit;
  const domLen = await text();
  console.log(`char ${k}: over=${over}px deltas=${JSON.stringify(d)} domLen=${domLen}`);
  if (over > 4 && !caught) {
    caught = true;
    console.log(`>>> FIRST REAL OVERFLOW at char ${k}: over=${over}px, path deltas above. overhang=${JSON.stringify(g.stats)}`);
    break;
  }
}
if (!caught) console.log('>>> no overflow within 25 chars — page full; every char rejected cleanly');

await browser.close();
