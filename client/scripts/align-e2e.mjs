/**
 * Real-browser E2E probe for the alignment bug.
 * Flow: login → create/open note → type 3 paragraphs → highlight part of P2
 *       → click وسط‌چین / راست‌چین / چپ‌چین from the Ribbon alignment menu
 *       → read the live ProseMirror doc + rendered text-align of each <p>.
 * Run: node client/scripts/align-e2e.mjs  (dev servers must be running)
 */
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5201';
const API = 'http://localhost:4000';

async function apiLogin() {
  const r = await fetch(`${API}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@pernote.local', password: 'demo1234' }),
  });
  if (!r.ok) throw new Error(`login failed: ${r.status}`);
  const j = await r.json();
  return j.token;
}

async function apiCreateNote(token) {
  const r = await fetch(`${API}/api/notes`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title: 'E2E-ALIGN-TEST' }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`create note failed: ${r.status} ${t.slice(0, 200)}`);
  }
  const j = await r.json();
  return j.note; // { note: Note } wrapper
}

const run = async () => {
  const token = await apiLogin();
  const note = await apiCreateNote(token);
  const noteId = note._id || note.id;
  console.log('note created:', noteId);

  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));

  // inject token, then go to the editor route directly
  await page.goto(CLIENT_URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => localStorage.setItem('pn_token', t), token);
  await page.goto(`${CLIENT_URL}/editor/${noteId}`, { waitUntil: 'domcontentloaded' });

  // wait for a ProseMirror editor to mount
  await page.waitForSelector('.ProseMirror', { timeout: 30000 });
  await page.waitForTimeout(1500);

  // — focus the REAL page editor through the project's QA hook, then type —
  const focused = await page.evaluate(() => {
    const ed = window.__pn?.editors && Object.values(window.__pn.editors)[0];
    if (!ed) return false;
    ed.commands.focus('end');
    return true;
  });
  if (!focused) throw new Error('could not focus page editor');
  await page.waitForTimeout(300);
  // type P1, then split paragraphs via the editor's own Enter command
  // (keyboard Enter is swallowed by the pagination guard in headless mode)
  await page.keyboard.type('Paragraph 1');
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const ed = Object.values(window.__pn.editors)[0];
    ed.commands.enter();
  });
  await page.waitForTimeout(200);
  await page.keyboard.type('Paragraph 2');
  await page.waitForTimeout(200);
  // select the typed word "Paragraph 2" via keyboard (Shift+Home from caret)
  await page.keyboard.down('Shift');
  await page.keyboard.press('Home');
  await page.keyboard.up('Shift');
  await page.waitForTimeout(200);
  await page.keyboard.press('ArrowRight'); // collapse back — stay inside P2
  await page.waitForTimeout(100);
  // split P3 via the editor command
  await page.evaluate(() => {
    const ed = Object.values(window.__pn.editors)[0];
    ed.commands.enter();
  });
  await page.waitForTimeout(200);
  await page.keyboard.type('Paragraph 3');
  await page.waitForTimeout(600);

  const readDoc = () => page.evaluate(() => {
    const ed = window.__pn?.editors && Object.values(window.__pn.editors)[0];
    if (!ed) return null;
    const doc = ed.state.doc;
    const out = [];
    doc.forEach((n) => out.push({ t: n.type.name, align: n.attrs.textAlign ?? null, text: n.textContent }));
    return out;
  });

  let doc = await readDoc();
  console.log('initial doc:', JSON.stringify(doc));

  // — select text INSIDE P2 via PM coordinates (not DOM click — RTL page
  //    geometry makes raw clicks land in the wrong paragraph in headless) —
  await page.evaluate(() => {
    const ed = Object.values(window.__pn.editors)[0];
    // find P2 (text 'Paragraph 2') start position
    let p2start = -1;
    ed.state.doc.forEach((node, offset, i) => {
      if (node.textContent === 'Paragraph 2') p2start = offset + 1;
    });
    if (p2start < 0) throw new Error('P2 not found');
    // select chars 0..9 of P2 ("Paragraph ") — TipTap's own command
    ed.commands.focus();
    ed.commands.setTextSelection({ from: p2start, to: p2start + 9 });
  });
  const sel = await page.evaluate(() => {
    const ed = Object.values(window.__pn.editors)[0];
    return { from: ed.state.selection.from, to: ed.state.selection.to, anchorText: ed.state.doc.textBetween(ed.state.selection.from, ed.state.selection.to) };
  });
  console.log('selection before align:', JSON.stringify(sel));
  if (sel.to <= sel.from) throw new Error('no real selection before clicking align — test harness bug');

  // — open the ribbon alignment menu (هم‌ترازی) and click وسط‌چین —
  const alignMenuBtn = page.locator('button[title="جهت‌دهی پاراگراف"]').first();
  await alignMenuBtn.click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'وسط‌چین', exact: true }).first().click();
  await page.waitForTimeout(500);

  doc = await readDoc();
  console.log('after CENTER:', JSON.stringify(doc));

  // rendered text-align per paragraph
  const rendered = await page.evaluate(() => {
    const ed = window.__pn?.editors && Object.values(window.__pn.editors)[0];
    const dom = ed.view.dom;
    return Array.from(dom.querySelectorAll(':scope > p')).map((p) => p.style.textAlign || '(inherit)');
  });
  console.log('rendered text-align:', JSON.stringify(rendered));

  await page.screenshot({ path: '/tmp/align-after-center.png', fullPage: false });

  // — RIGHT alignment on the same P2 range —
  await page.evaluate(() => {
    const ed = Object.values(window.__pn.editors)[0];
    let p2start = -1;
    ed.state.doc.forEach((node, offset, i) => {
      if (node.textContent === 'Paragraph 2') p2start = offset + 1;
    });
    ed.commands.focus();
    ed.commands.setTextSelection({ from: p2start, to: p2start + 9 });
  });
  const alignMenuBtn2 = page.locator('button[title="جهت‌دهی پاراگراف"]').first();
  await alignMenuBtn2.click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'راست‌چین', exact: true }).first().click();
  await page.waitForTimeout(400);
  console.log('after RIGHT:', JSON.stringify(await readDoc()));

  // ── Scenario 2: COLLAPSED CARET (no highlight) inside P2 → left ─────────
  await page.evaluate(() => {
    const ed = Object.values(window.__pn.editors)[0];
    let p2start = -1;
    ed.state.doc.forEach((node, offset, i) => {
      if (node.textContent === 'Paragraph 2') p2start = offset + 5;
    });
    ed.commands.focus();
    ed.commands.setTextSelection(p2start); // caret only — NO selection
  });
  const caretSel = await page.evaluate(() => {
    const ed = Object.values(window.__pn.editors)[0];
    return { from: ed.state.selection.from, to: ed.state.selection.to };
  });
  console.log('caret (collapsed) selection:', JSON.stringify(caretSel));
  const alignMenuBtn3 = page.locator('button[title="جهت‌دهی پاراگراف"]').first();
  await alignMenuBtn3.click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'چپ‌چین', exact: true }).first().click();
  await page.waitForTimeout(400);
  const docCaret = await readDoc();
  console.log('after LEFT (collapsed caret):', JSON.stringify(docCaret));

  // ── Scenario 3: select across P2+P3 via PM range → center ────────────────
  await page.evaluate(() => {
    const ed = Object.values(window.__pn.editors)[0];
    let p2start = -1, p3end = -1;
    ed.state.doc.forEach((node, offset, i) => {
      if (node.textContent === 'Paragraph 2') p2start = offset + 1;
      if (node.textContent === 'Paragraph 3') p3end = offset + 1 + node.content.size;
    });
    ed.commands.focus();
    ed.commands.setTextSelection({ from: p2start, to: p3end });
  });
  const selSpan = await page.evaluate(() => {
    const ed = Object.values(window.__pn.editors)[0];
    return { from: ed.state.selection.from, to: ed.state.selection.to };
  });
  console.log('span selection P2..P3:', JSON.stringify(selSpan));
  const alignMenuBtn4 = page.locator('button[title="جهت‌دهی پاراگراف"]').first();
  await alignMenuBtn4.click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'وسط‌چین', exact: true }).first().click();
  await page.waitForTimeout(400);
  const docSpan = await readDoc();
  console.log('after CENTER across P2..P3:', JSON.stringify(docSpan));

  await browser.close();

  // — assertions —
  const p1Unchanged = doc && doc[0].align === null;
  const p3Unchanged = doc && doc[2].align === null;
  const p2Centered = doc && doc[1].align === 'center';
  console.log(`\n[Scenario 1 — highlight P2]`);
  console.log(`P1 align=${doc?.[0]?.align} (expect null) -> ${p1Unchanged ? 'OK' : 'FAIL'}`);
  console.log(`P2 align=${doc?.[1]?.align} (expect center) -> ${p2Centered ? 'OK' : 'FAIL'}`);
  console.log(`P3 align=${doc?.[2]?.align} (expect null) -> ${p3Unchanged ? 'OK' : 'FAIL'}`);

  const s2ok = docCaret && docCaret[0].align === null && docCaret[1].align === 'left' && docCaret[2].align === null;
  console.log(`\n[Scenario 2 — collapsed caret in P2 → LEFT]`);
  console.log(JSON.stringify(docCaret));
  console.log(`P1=null, P2=left, P3=null -> ${s2ok ? 'OK' : 'FAIL'}`);

  const s3ok = docSpan && docSpan[0].align === null && docSpan[1].align === 'center' && docSpan[2].align === 'center';
  console.log(`\n[Scenario 3 — span P2..P3 → CENTER]`);
  console.log(JSON.stringify(docSpan));
  console.log(`P1=null, P2=center, P3=center -> ${s3ok ? 'OK' : 'FAIL'}`);

  if (!p1Unchanged || !p2Centered || !p3Unchanged || !s2ok || !s3ok) {
    console.log('\nE2E RESULT: FAIL');
    process.exit(1);
  }
  console.log('\nE2E RESULT: PASS — all 3 scenarios scoped to selection');
  process.exit(0);
};

/** select the last typed word with shift+arrows (helper kept for fallback) */
async function keyboardSelectWord(page) {
  // no-op placeholder; real selection happens via dblclick below
}

run().catch((e) => { console.error('E2E ERROR:', e.message); process.exit(2); });
