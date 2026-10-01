/**
 * NAV VERIFY — sidebar thumbnail → editor page switch:
 *   1. create 3 pages (sidebar «صفحه جدید» → pick قاب‌دار in the picker)
 *   2. type a distinct marker into each page
 *   3. click thumbnail 3 → the editor must switch to p3: typing lands there
 *      AND the workspace scrolls the sheet into view.
 * Run: node client/scripts/nav-verify.mjs
 */
import { chromium } from 'playwright-core';

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5199';
const API = 'http://localhost:4000';

async function apiLogin() {
  const r = await fetch(`${API}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@pernote.local', password: 'demo1234' }),
  });
  if (!r.ok) throw new Error(`login failed: ${r.status}`);
  return (await r.json()).token;
}
async function apiCreateNote(token, title) {
  const r = await fetch(`${API}/api/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title }),
  });
  if (!r.ok) throw new Error(`create failed: ${r.status} ${await r.text()}`);
  const j = await r.json();
  return j.note._id || j.note.id;
}

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
  if (!ok) failures++;
};

const run = async () => {
  const token = await apiLogin();
  const noteId = await apiCreateNote(token, 'NAV-VERIFY');
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));
  await page.goto(CLIENT_URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => localStorage.setItem('pn_token', t), token);
  await page.goto(`${CLIENT_URL}/editor/${noteId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ProseMirror', { timeout: 30000 });
  await page.waitForTimeout(1500);

  const addPageViaSidebar = async () => {
    await page.locator('button.pn-pages-add-btn').first().click();
    await page.waitForTimeout(300);
    // the floating type picker opens — pick «قاب‌دار» (framed)
    await page.getByRole('button', { name: /قاب‌دار/ }).first().click();
    await page.waitForTimeout(900);
  };

  // page 1 marker
  await page.evaluate(() => { Object.values(window.__pn.editors)[0].commands.focus('end'); });
  await page.keyboard.type('PAGE-ONE-MARKER');
  await page.waitForTimeout(300);

  await addPageViaSidebar();
  await page.evaluate(() => { Object.values(window.__pn.editors)[0].commands.focus('end'); });
  await page.keyboard.type('PAGE-TWO-MARKER');
  await page.waitForTimeout(400);

  await addPageViaSidebar();
  await page.evaluate(() => { Object.values(window.__pn.editors)[0].commands.focus('end'); });
  await page.keyboard.type('PAGE-THREE-MARKER');
  await page.waitForTimeout(600);

  const editors = await page.evaluate(() => ({
    ids: Object.keys(window.__pn.editors),
    texts: Object.values(window.__pn.editors).map((e) => e.state.doc.textContent.slice(0, 40)),
  }));
  console.log('editors:', JSON.stringify(editors));
  check('3 pages exist', editors.ids.length === 3, `found ${editors.ids.length}`);

  // park the workspace on page 1
  await page.evaluate(() => { document.querySelector('.pn-editor-scroll')?.scrollTo({ top: 0 }); });
  await page.waitForTimeout(500);
  const preScroll = await page.evaluate(() => document.querySelector('.pn-editor-scroll')?.scrollTop ?? 0);

  // ── click the LAST thumbnail ────────────────────────────────────────────
  const thumbs = page.locator('.pn-page-thumb');
  const n = await thumbs.count();
  console.log('thumbnails:', n);
  await thumbs.nth(n - 1).click();
  await page.waitForTimeout(1500); // smooth scroll (60ms delay + smooth) + effects

  const postScroll = await page.evaluate(() => document.querySelector('.pn-editor-scroll')?.scrollTop ?? 0);
  console.log('workspace scrollTop:', preScroll, '→', postScroll);
  check('workspace scrolled toward the target page', postScroll > preScroll, `${preScroll} → ${postScroll}`);

  // the real proof: type NOW — text must land on the LAST page
  await page.keyboard.type(' AFTER-NAV-TYPING');
  await page.waitForTimeout(600);
  const markerCheck = await page.evaluate(() => {
    const out = {};
    for (const [pid, ed] of Object.entries(window.__pn.editors)) out[pid] = ed.state.doc.textContent.slice(0, 60);
    return out;
  });
  console.log('page contents:', JSON.stringify(markerCheck, null, 1));
  const pids = Object.keys(markerCheck);
  const lastPid = pids[pids.length - 1];
  check('typing after nav lands on the TARGET (3rd) page',
    Boolean(lastPid) && markerCheck[lastPid].includes('AFTER-NAV-TYPING') && markerCheck[lastPid].includes('PAGE-THREE-MARKER'),
    JSON.stringify(markerCheck));

  // ── also navigate BACK to page 1 via its thumbnail ──────────────────────
  await thumbs.nth(0).click();
  await page.waitForTimeout(1500);
  await page.keyboard.type(' BACK-TO-ONE');
  await page.waitForTimeout(600);
  const backCheck = await page.evaluate(() => {
    const out = {};
    for (const [pid, ed] of Object.entries(window.__pn.editors)) out[pid] = ed.state.doc.textContent.slice(0, 80);
    return out;
  });
  console.log('after back-nav:', JSON.stringify(backCheck, null, 1));
  const firstPid = pids[0];
  check('navigating back to page 1 puts the caret there',
    Boolean(firstPid) && backCheck[firstPid].includes('BACK-TO-ONE'),
    JSON.stringify(backCheck));

  await browser.close();
  console.log(failures === 0 ? '\nALL CHECKS PASSED ✅' : `\n${failures} CHECK(S) FAILED ❌`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((err) => { console.error('ERROR:', err.message); process.exit(2); });
