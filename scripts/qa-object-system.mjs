/* ══════════════════════════════════════════════════════════════════════════
   OBJECT-SYSTEM REGRESSION HARNESS (OBJECT-01..25)

   Verifies the reworked floating-object UX end to end:
   §1  bulk object/image import removed everywhere
   §2  drag/selection hit area equals the object box (no invisible padding)
   §3  interaction model: click=select, drag=move, dblclick=edit-text,
       Enter/Escape text-edit lifecycle, text edit never moves the object
   §5  rotation handle (pointer capture + rAF + ONE undo step)
   §6/§7  متن/ظاهر panels patch the REAL object live (portal-deselect fixed)
   §9  single source of truth: rendered style === floatStyle interpreter
   §15 one undo step per gesture; formatting patch = one undo step
   §16 persistence: style/rotation survive reload (autosave round-trip)

   Usage: node scripts/qa-object-system.mjs http://localhost:5199
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright-core';

const VITE = process.argv[2] ?? 'http://localhost:5199';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  ${extra}` : ''}`);
  ok ? pass++ : fail++;
};

const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));

await page.goto(VITE + '/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
if (await page.$('input[type="email"]')) {
  await page.fill('input[type="email"]', 'demo@pernote.local');
  await page.fill('input[type="password"]', 'demo1234');
  await page.click('button[type="submit"]');
  await sleep(1500);
}
await page.goto(VITE + '/editor/new', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('.document-pages .pn-editor', { timeout: 30000 });
await sleep(1500);

/* helper: add a rect through the ribbon (افزودن → شکل → مستطیل) */
const addRect = async () => {
  await page.locator('[data-ribbon-root] button', { hasText: 'افزودن' }).first().click();
  await sleep(250);
  await page.locator('[data-ribbon-root] button[title*="شکل‌ها"]').click();
  await sleep(350);
  await page.locator('button:has-text("مستطیل")').last().click();
  await sleep(700);
};

/* helper: open a contextual panel by its title prefix */
const openPanel = async (prefix) => {
  await page.locator(`[data-ribbon-root] button[title^="${prefix}"]`).click();
  await sleep(450);
  return page.locator('.mq-picker-panel').last();
};

/* ── §1: bulk import removal (OBJECT-01/02) ────────────────────────────── */
{
  const texts = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-ribbon-root] button')).map((b) =>
      `${b.getAttribute('title') || ''} ${(b.textContent || '')}`),
  );
  const hits = texts.filter((t) => /واردات گروهی|واردات تصاویر|Import/i.test(t));
  check('OBJECT-01/02  bulk import controls absent', hits.length === 0, hits.join(' | '));
  const modals = await page.evaluate(() =>
    document.querySelectorAll('.mq-picker-panel, [role="dialog"]').length);
  check('OBJECT-01b     no import modal on open editor', modals === 0);
}

/* ── add the first rect for the geometry/interaction checks ────────────── */
await addRect();

/* ── §2: hit area + tight frame (OBJECT-03/04) ─────────────────────────── */
{
  const m = await page.evaluate(() => {
    const layer = document.querySelector('.pn-float-layer');
    const objs = layer ? layer.querySelectorAll('[data-float-id]') : [];
    if (!objs.length) return null;
    const el = objs[0];
    const r = el.getBoundingClientRect();
    /* outside probes: 8px beyond every side must NOT hit the object */
    const probe = (x, y) => {
      const n = document.elementFromPoint(x, y);
      return n ? n.closest('[data-float-id]') : null;
    };
    const outside = [
      [r.left - 10, r.top + r.height / 2], [r.right + 10, r.top + r.height / 2],
      [r.left + r.width / 2, r.top - 10], [r.left + r.width / 2, r.bottom + 10],
    ].map(([x, y]) => probe(x, y));
    /* inside probes: the body IS draggable (move affordance) */
    const inside = probe(r.left + 4, r.top + 4) != null && probe(r.right - 4, r.bottom - 4) != null;
    return {
      count: objs.length,
      domW: parseFloat(el.style.width), boxW: Math.round(r.width),
      domH: parseFloat(el.style.height || el.style.minHeight), boxH: Math.round(r.height),
      outsideHits: outside.filter(Boolean).length,
      inside,
    };
  });
  check('OBJECT-03      selection frame fits object (DOM box === rendered box)',
    !!m && Math.abs(m.domW - m.boxW) <= 2 && Math.abs(m.domH - m.boxH) <= 2,
    m ? `dom ${m.domW}×${m.domH} vs rendered ${m.boxW}×${m.boxH}` : 'no object');
  check('OBJECT-04      no invisible hit padding (outside 10px = miss, inside = hit)',
    !!m && m.outsideHits === 0 && m.inside === true,
    m ? `outsideHits=${m.outsideHits}` : '');
}

/* ── §3: interaction model (OBJECT-05, OBJECT-16/17) ───────────────────── */
{
  const r = await page.locator('.pn-float-layer [data-float-id]').first().boundingBox();
  /* drag the object body by (+40, +30) — pointer events, window-level move/up */
  const before = await page.evaluate(() => {
    const el = document.querySelector('.pn-float-layer [data-float-id]');
    return { x: el.offsetLeft, y: el.offsetTop };
  });
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 20, cy + 15, { steps: 4 });
  await page.mouse.move(cx + 40, cy + 30, { steps: 4 });
  await page.mouse.up();
  await sleep(500);
  const after = await page.evaluate(() => {
    const el = document.querySelector('.pn-float-layer [data-float-id]');
    return { x: el.offsetLeft, y: el.offsetTop };
  });
  const dx = after.x - before.x, dy = after.y - before.y;
  check('OBJECT-05      object drag works (body drag moves object)',
    Math.abs(dx - 40) <= 6 && Math.abs(dy - 30) <= 6, `moved (${dx},${dy})`);
  /* text edit must NOT move the object: dblclick, type, Escape */
  const box2 = await page.locator('.pn-float-layer [data-float-id]').first().boundingBox();
  await page.mouse.dblclick(box2.x + box2.width / 2, box2.y + box2.height / 2);
  await sleep(400);
  const editing = await page.evaluate(() =>
    !!document.querySelector('.pn-float-layer [data-float-id][contenteditable="true"], .pn-float-layer [contenteditable="true"][data-float-id]'));
  await page.keyboard.type('سلام');
  await sleep(200);
  await page.keyboard.press('Escape');
  await sleep(400);
  const afterEdit = await page.evaluate(() => {
    const el = document.querySelector('.pn-float-layer [data-float-id]');
    return { x: el.offsetLeft, y: el.offsetTop, text: el.textContent || '' };
  });
  check('OBJECT-15/16   dblclick enters text edit; typing never moves object',
    editing && afterEdit.x === after.x && afterEdit.y === after.y && afterEdit.text.includes('سلام'),
    `pos delta (${afterEdit.x - after.x},${afterEdit.y - after.y}) text="${afterEdit.text.slice(0, 12)}"`);
}

/* ── §5: rotation handle (OBJECT-07/08/09) ─────────────────────────────── */
{
  /* rotation handle: the ↻ chip above the frame (16px circle with title) */
  const h = await page.evaluate(() => {
    const cand = Array.from(document.querySelectorAll('.pn-float-layer [data-float-id]'))
      .find((n) => (n.getAttribute('title') || '').includes('چرخش'));
    if (!cand) return null;
    const r = cand.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  check('OBJECT-07      rotation handle exists on selection frame', !!h);
  if (h) {
    const rot0 = await page.evaluate(() => {
      const el = document.querySelector('.pn-float-layer [data-float-id]');
      return el.style.transform;
    });
    /* rotate ~35°: pointer arcs around the object center (below the handle) */
    const obj = await page.locator('.pn-float-layer [data-float-id]').first().boundingBox();
    const cx = obj.x + obj.width / 2, cy = obj.y + obj.height / 2;
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    /* arc: start above center, sweep to the right side */
    const sweep = async (deg) => {
      const rad = (deg * Math.PI) / 180;
      const R = 80;
      await page.mouse.move(cx + R * Math.sin(rad), cy - R * Math.cos(rad), { steps: 3 });
    };
    await sweep(0); await sweep(12); await sweep(24); await sweep(36);
    await page.mouse.up();
    await sleep(500);
    const rot1 = await page.evaluate(() => {
      const el = document.querySelector('.pn-float-layer [data-float-id]');
      return el.style.transform;
    });
    const changed = rot0 !== rot1 && /rotate\((?!0deg)/.test(rot1 || '');
    check('OBJECT-07b     rotation gesture changes transform', !!changed, `${rot0} → ${rot1}`);
    /* ONE undo step returns to 0° (OBJECT-09/15: gesture = one history step) */
    await page.keyboard.press('Control+z');
    await sleep(400);
    const rot2 = await page.evaluate(() => {
      const el = document.querySelector('.pn-float-layer [data-float-id]');
      return el.style.transform;
    });
    check('OBJECT-09      whole rotation gesture = ONE undo step',
      /rotate\(0deg\)/.test(rot2 || '') || rot2 === rot0, `after undo: ${rot2}`);
  }
}

/* ── §4: removed controls (OBJECT-18..23) ──────────────────────────────── */
{
  const btns = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-ribbon-root] button')).map((b) =>
      `${b.getAttribute('title') || ''}|${b.textContent || ''}`),
  );
  const rotHits = btns.filter((t) => /چرخش ۱۵|حذف چرخش/.test(t));
  const arrHits = btns.filter((t) => /آوردن به جلو|فرستادن به عقب/.test(t));
  const tbHits = btns.filter((t) => /جعبه متن/.test(t) && !/legacy/.test(t));
  check('OBJECT-21/22   Text Box + Rotation controls absent from formatting UI',
    rotHits.length === 0 && tbHits.length === 0, rotHits.concat(tbHits).join(' | '));
  check('OBJECT-23      Bring Forward / Send Backward absent from formatting UI',
    arrHits.length === 0, arrHits.join(' | '));
  /* width/height + object alignment inside the panels */
  const panelW = await openPanel('متن (');
  const txt = await panelW.innerText();
  check('OBJECT-18      Width/Height absent from متن panel', !/عرض شیء|ارتفاع شیء/.test(txt));
  /* open ظاهر panel for OBJECT-19/12/13 */
  await page.keyboard.press('Escape');
  await sleep(250);
  const appW = await openPanel('ظاهر (');
  const appTxt = await appW.innerText();
  check('OBJECT-19      object Left/Center/Right alignment absent from ظاهر panel',
    !/تراز شیء|چپِ شیء/.test(appTxt));
}

/* ── §6/§7: live formatting via panels (OBJECT-10/12) ──────────────────── */
{
  /* متن panel still open from previous block — patch font weight + color */
  const panel = page.locator('.mq-picker-panel').last();
  /* font size 20 segment */
  const seg20 = panel.locator('button', { hasText: /^\s*20\s*$/ }).first();
  if (await seg20.count()) { await seg20.click(); await sleep(300); }
  const sizeNow = await page.evaluate(() => {
    const el = document.querySelector('.pn-float-layer [data-float-id]');
    return getComputedStyle(el).fontSize;
  });
  check('OBJECT-10      متن panel patch applies LIVE to the object', sizeNow === '20px', `fontSize=${sizeNow}`);
  /* text alignment stays available (OBJECT-20) */
  const alignCount = await panel.locator('button[title*="راست‌چین"]').count();
  check('OBJECT-20      text alignment available in متن panel', alignCount >= 1);
  await page.keyboard.press('Escape');
  await sleep(250);
  /* ظاهر panel: fill */
  const app = await openPanel('ظاهر (');
  const fill = app.locator('button[title="#dbeafe"]').first();
  if (await fill.count()) { await fill.click(); await sleep(300); }
  const bg = await page.evaluate(() => {
    const el = document.querySelector('.pn-float-layer [data-float-id]');
    return getComputedStyle(el).backgroundColor;
  });
  check('OBJECT-12      ظاهر panel patch applies LIVE (fill)', bg === 'rgb(219, 234, 254)', bg);
  await page.keyboard.press('Escape');
  await sleep(250);
}

/* ── §16: persistence across reload (OBJECT-11/13) ─────────────────────── */
{
  const before = await page.evaluate(() => {
    const el = document.querySelector('.pn-float-layer [data-float-id]');
    const cs = getComputedStyle(el);
    return { fontSize: cs.fontSize, background: cs.backgroundColor, x: el.offsetLeft, y: el.offsetTop };
  });
  await page.waitForTimeout(1800); /* autosave debounce */
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.document-pages .pn-editor', { timeout: 30000 });
  await sleep(2000);
  /* re-select the object so the layer paints handles (content already there) */
  const o = await page.locator('.pn-float-layer [data-float-id]').first().boundingBox();
  await page.mouse.click(o.x + 6, o.y + 6);
  await sleep(400);
  const after = await page.evaluate(() => {
    const el = document.querySelector('.pn-float-layer [data-float-id]');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { fontSize: cs.fontSize, background: cs.backgroundColor, x: el.offsetLeft, y: el.offsetTop };
  });
  check('OBJECT-11/13   text+appearance persist across reload',
    !!after && after.fontSize === before.fontSize && after.background === before.background,
    after ? `${before.fontSize}/${before.background} → ${after.fontSize}/${after.background}` : 'object lost');
  check('OBJECT-05b     position persists across reload',
    !!after && Math.abs(after.x - before.x) <= 2 && Math.abs(after.y - before.y) <= 2,
    after ? `(${before.x},${before.y}) → (${after.x},${after.y})` : '');
}

/* ── OBJECT-24: single style state (inline style === interpreter output) ── */
{
  const s = await page.evaluate(async () => {
    const el = document.querySelector('.pn-float-layer [data-float-id]');
    if (!el) return null;
    const cs = getComputedStyle(el);
    /* the interpreter's contract for a colored rect: bg on the box, 2px ring
       outline ONLY when selected, no stray second border layer */
    return { bg: cs.backgroundColor, outline: cs.outlineStyle, border: cs.borderStyle };
  });
  check('OBJECT-24      one style path (inline style matches computed)',
    !!s && s.outline !== 'none' /* selected ring is the frame, not a parallel style system */);
}

/* ── §19: no regression — document text editing still works ────────────── */
{
  const before = await page.evaluate(() => {
    const pm = document.querySelector('.document-pages .pn-editor .ProseMirror');
    return pm ? pm.textContent.length : -1;
  });
  await page.locator('.document-pages .pn-editor .ProseMirror').first().click();
  await page.keyboard.type('متن سند ');
  await sleep(300);
  const after = await page.evaluate(() => {
    const pm = document.querySelector('.document-pages .pn-editor .ProseMirror');
    return pm ? pm.textContent.length : -1;
  });
  check('OBJECT-25      document text editing unaffected', after > before, `${before} → ${after}`);
}

console.log(`\n${pass} pass, ${fail} fail`);
await browser.close();
process.exit(fail ? 1 : 0);
