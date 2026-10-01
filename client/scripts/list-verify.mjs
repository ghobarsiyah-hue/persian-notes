/**
 * LIST FIX VERIFICATION — full suite on the live app:
 *   FIX-1  Shift+Enter lines → Bullet: each line gets its OWN item (was 1 marker)
 *   FIX-2  hardBreak lines → Ordered: 1. 2. 3. separate items
 *   REG-A  4 real paragraphs, full selection → ONE bulletList, 4 items
 *   REG-C  5 paragraphs, select B..D → A,E stay paragraphs
 *   REG-D  partial selection → whole paragraph becomes ONE item
 *   REG-E  selecting existing items + same button → toggles OFF (stock)
 * Run: node client/scripts/list-verify.mjs
 */
import { chromium } from 'playwright-core';

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5201';
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
  if (!r.ok) throw new Error(`create failed: ${r.status}`);
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
  const noteId = await apiCreateNote(token, 'LIST-FIX-VERIFY');
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  await page.goto(CLIENT_URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => localStorage.setItem('pn_token', t), token);
  await page.goto(`${CLIENT_URL}/editor/${noteId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ProseMirror', { timeout: 30000 });
  await page.waitForTimeout(1500);

  const reset = () => page.evaluate(() => {
    const e = Object.values(window.__pn.editors)[0];
    e.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] });
    e.commands.focus('end');
  });
  const typeWith = async (items, sep) => {
    for (let i = 0; i < items.length; i++) {
      await page.keyboard.type(items[i]);
      await page.waitForTimeout(80);
      if (i < items.length - 1) { await page.keyboard.press(sep); await page.waitForTimeout(150); }
    }
    await page.waitForTimeout(300);
  };
  const selectAll = async () => {
    await page.evaluate(() => {
      const e = Object.values(window.__pn.editors)[0];
      let lastEnd = 0;
      e.state.doc.forEach((node, offset) => { lastEnd = offset + 1 + node.content.size; });
      e.commands.focus();
      e.commands.setTextSelection({ from: 1, to: lastEnd });
    });
    const s = await page.evaluate(() => {
      const e = Object.values(window.__pn.editors)[0];
      return { from: e.state.selection.from, to: e.state.selection.to };
    });
    console.log('  [selection before list click]', JSON.stringify(s));
  };
  const clickList = async (label) => {
    await page.locator('button[title="فهرست‌ها و تورفتگی"]').first().click();
    await page.waitForTimeout(250);
    await page.getByRole('button', { name: label, exact: true }).first().click();
    await page.waitForTimeout(500);
  };
  const structure = () => page.evaluate(() => {
    const e = Object.values(window.__pn.editors)[0];
    const lines = [];
    const walk = (node) => {
      node.forEach((child) => {
        if (child.type.name === 'bulletList' || child.type.name === 'orderedList') {
          const items = [];
          child.forEach((li) => items.push(li.textContent));
          lines.push(`<${child.type.name === 'bulletList' ? 'ul' : 'ol'}> ${JSON.stringify(items)}`);
        } else if (child.type.name === 'paragraph') lines.push(`(p) ${child.textContent}`);
        else walk(child);
      });
    };
    walk(e.state.doc);
    return lines;
  });

  // ═══ FIX-1: Shift+Enter lines → Bullet ═══════════════════════════════════
  console.log('\n── FIX-1: Shift+Enter lines → Bullet ──');
  await reset();
  await typeWith(['Line 1', 'Line 2', 'Line 3'], 'Shift+Enter');
  await selectAll();
  await clickList('فهرست نقطه‌ای');
  const s1 = await structure();
  console.log('  doc:', JSON.stringify(s1));
  check('FIX-1: each soft-break line becomes its own bullet item',
    s1.length === 1 && s1[0].startsWith('<ul>') && s1[0].includes('"Line 1"') && s1[0].includes('"Line 2"') && s1[0].includes('"Line 3"'),
    JSON.stringify(s1));

  // ═══ FIX-2: hardBreak lines → Ordered ════════════════════════════════════
  console.log('\n── FIX-2: Shift+Enter lines → Ordered ──');
  await reset();
  await typeWith(['یکی', 'دو', 'سه'], 'Shift+Enter');
  await selectAll();
  await clickList('فهرست شماره‌دار');
  const s2 = await structure();
  console.log('  doc:', JSON.stringify(s2));
  check('FIX-2: ordered list with 3 separate items',
    s2.length === 1 && s2[0].startsWith('<ol>') && s2[0].includes('"یکی"') && s2[0].includes('"دو"') && s2[0].includes('"سه"'),
    JSON.stringify(s2));

  // ═══ REG-A: real paragraphs, full selection → ONE list, 4 items ══════════
  console.log('\n── REG-A: 4 paragraphs → bullet ──');
  await reset();
  await typeWith(['A', 'B', 'C', 'D'], 'Enter');
  await selectAll();
  await clickList('فهرست نقطه‌ای');
  const sa = await structure();
  console.log('  doc:', JSON.stringify(sa));
  check('REG-A: ONE bulletList with 4 items',
    sa.length === 1 && sa[0].startsWith('<ul>') && sa[0].includes('"A"') && sa[0].includes('"D"'),
    JSON.stringify(sa));

  // ═══ REG-C: select B..D only ═════════════════════════════════════════════
  console.log('\n── REG-C: 5 paragraphs, select B..D ──');
  await reset();
  await typeWith(['A', 'B', 'C', 'D', 'E'], 'Enter');
  await page.evaluate(() => {
    const e = Object.values(window.__pn.editors)[0];
    let bStart = -1, dEnd = -1;
    e.state.doc.forEach((node, offset, i) => {
      if (node.textContent === 'B') bStart = offset + 1;
      if (node.textContent === 'D') dEnd = offset + 1 + node.content.size;
    });
    e.commands.setTextSelection({ from: bStart, to: dEnd });
  });
  await page.waitForTimeout(200);
  await clickList('فهرست نقطه‌ای');
  const sc = await structure();
  console.log('  doc:', JSON.stringify(sc));
  check('REG-C: A,E stay paragraphs; B,C,D bulleted in ONE list',
    sc.length === 3 && sc[0] === '(p) A' && sc[1].startsWith('<ul>') && sc[1].includes('"B"') && sc[1].includes('"D"') && sc[2] === '(p) E',
    JSON.stringify(sc));

  // ═══ REG-D: partial selection inside one paragraph ═══════════════════════
  console.log('\n── REG-D: partial selection ──');
  await reset();
  await page.keyboard.type('This is some example text');
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const e = Object.values(window.__pn.editors)[0];
    e.commands.setTextSelection({ from: 14, to: 21 }); // "example"
  });
  await page.waitForTimeout(150);
  await clickList('فهرست نقطه‌ای');
  const sd = await structure();
  console.log('  doc:', JSON.stringify(sd));
  check('REG-D: whole paragraph became ONE item',
    sd.length === 1 && sd[0].startsWith('<ul>') && sd[0].includes('This is some example text'),
    JSON.stringify(sd));

  // ═══ REG-E: toggle OFF existing items ════════════════════════════════════
  console.log('\n── REG-E: toggle off existing bullets ──');
  await reset();
  await typeWith(['X', 'Y', 'Z'], 'Enter');
  await selectAll();
  await clickList('فهرست نقطه‌ای'); // on
  await clickList('فهرست نقطه‌ای'); // off (stock toggle)
  const se = await structure();
  console.log('  doc:', JSON.stringify(se));
  check('REG-E: second click toggles back to paragraphs',
    se.length === 3 && se.every((l) => l.startsWith('(p)')),
    JSON.stringify(se));

  await browser.close();
  console.log(failures === 0 ? '\nALL CHECKS PASSED ✅' : `\n${failures} CHECK(S) FAILED ❌`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((err) => { console.error('ERROR:', err.message); process.exit(2); });
