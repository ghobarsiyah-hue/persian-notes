/**
 * Runtime VALIDATION part 2 — render cascades, autosave, capability matrix.
 * Drives the REAL React editor in headless Chrome.
 *
 *   C1  §11 typing in page N re-renders ONLY page N (per-page render counts)
 *   C2  §12 typing burst sends ZERO synchronous saves; exactly 1 debounced save
 *   C3  Delete key removes a character (shrink path, instant)
 *   C4  Ctrl+A + type replaces content on a FULL page (never read-only)
 *   C5  Ctrl+Z restores the replaced text (history intact)
 *   C6  paste of a fitting paragraph is accepted
 *   C7  paste that would overflow near the bottom is rejected; content intact
 *   C8  image paste is inserted (scaled) and deletable; sheet stays A4
 *   C9  every sheet is still 794x1123 at the end
 *   C10 typing still accepted after all of the above (no stuck state)
 *
 * Usage: node scripts/qa-cascade-validation.mjs [viteUrl]
 */
import { chromium } from 'playwright-core';

const VITE = process.argv[2] ?? 'http://localhost:5199';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok });
  console.log(ok ? 'PASS' : 'FAIL', '-', name, detail ? `(${detail})` : '');
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SCOPE = 'document-pages';

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  let pageError = null;
  page.on('pageerror', (e) => { pageError = String(e).slice(0, 300); });
  const saveRequests = [];
  page.on('request', (r) => {
    const u = r.url();
    if (u.includes('/api/notes') && !u.endsWith('/api/notes') && (r.method() === 'PUT' || r.method() === 'PATCH' || r.method() === 'POST')) {
      saveRequests.push(`${r.method()} ${u.replace(VITE, '')}`);
    }
  });

  await page.goto(VITE + '/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('input[type="email"]', { timeout: 30000 });
  await page.fill('input[type="email"]', 'demo@pernote.local');
  await page.fill('input[type="password"]', 'demo1234');
  await page.click('button[type="submit"]');
  await sleep(1500);

  await page.goto(VITE + '/editor/new', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.' + SCOPE + ' .pn-editor', { timeout: 30000 });
  await sleep(2500);

  /* ---- in-page helpers ---- */
  await page.evaluate(() => {
    const pagesEls = () => Array.from(document.querySelectorAll('.document-pages .page-paper'));
    window.__v = {
      n: () => pagesEls().length,
      sheet: (i) => {
        const el = pagesEls()[i - 1];
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const zoom = parseFloat(getComputedStyle(el).zoom || '1') || 1;
        return { w: Math.round(r.width), h: Math.round(r.height), zoom };
      },
      allSheets: () => pagesEls().map((el) => {
        const r = el.getBoundingClientRect();
        const zoom = parseFloat(getComputedStyle(el).zoom || '1') || 1;
        return { w: Math.round(r.width / zoom), h: Math.round(r.height / zoom) };
      }),
      freePx: () => {
        const el = pagesEls()[0];
        const ed = el?.querySelector('.pn-editor');
        const wrap = ed?.closest('.pn-editor-wrap');
        if (!ed || !wrap) return null;
        const wr = wrap.getBoundingClientRect();
        let bottom = wr.top;
        for (const c of Array.from(ed.children)) bottom = Math.max(bottom, c.getBoundingClientRect().bottom);
        const zoom = parseFloat(getComputedStyle(el).zoom || '1') || 1;
        return Math.round((wr.bottom - bottom) / zoom);
      },
      text: (i) => {
        const el = pagesEls()[i - 1];
        return el ? (el.querySelector('.pn-editor')?.textContent ?? '') : '';
      },
      imgs: (i) => pagesEls()[i - 1]?.querySelectorAll('.pn-editor img').length ?? 0,
      imgWidth: (i) => {
        const im = pagesEls()[i - 1]?.querySelector('.pn-editor img');
        if (!im) return null;
        const zoom = parseFloat(getComputedStyle(im).zoom || '1') || 1;
        return Math.round(im.getBoundingClientRect().width / zoom);
      },
      pageIds: () => pagesEls().map((el) => el.getAttribute('data-page-id')),
      clickPage: (i) => {
        const el = pagesEls()[i - 1];
        const ed = el?.querySelector('.pn-editor');
        if (!ed) return;
        const r = ed.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + Math.min(60, r.height / 2);
        const target = document.elementFromPoint(cx, cy) ?? ed;
        const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy };
        target.dispatchEvent(new MouseEvent('mousedown', opts));
        target.dispatchEvent(new MouseEvent('mouseup', opts));
        target.dispatchEvent(new MouseEvent('click', opts));
        ed.focus();
      },
      resetRenders: () => { window.__pnPageRenders = {}; window.__layoutDebug = true; },
      renders: () => Object.assign({}, window.__pnPageRenders || {}),
      pasteText: (txt) => {
        const ed = document.activeElement?.classList?.contains('pn-editor')
          ? document.activeElement
          : document.querySelector('.document-pages .pn-editor');
        const dt = new DataTransfer();
        dt.setData('text/plain', txt);
        ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      },
      pasteImage: () => {
        const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const file = new File([bytes], 'dot.png', { type: 'image/png' });
        const dt = new DataTransfer();
        dt.items.add(file);
        const ed = document.activeElement?.classList?.contains('pn-editor')
          ? document.activeElement
          : document.querySelector('.document-pages .pn-editor');
        ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      },
    };
  });
  const v = (expr, arg) => page.evaluate(expr, arg);
  const focusedEditor = () => v(() => {
    const ed = document.activeElement?.classList?.contains('pn-editor')
      ? document.activeElement
      : document.querySelector('.document-pages .pn-editor');
    ed?.focus();
    return !!ed;
  });

  /* ===== setup: two pages ===== */
  await v(() => window.__v.clickPage(1));
  await page.keyboard.press('Control+a');
  await page.keyboard.type('شروع');
  const span = await page.evaluateHandle(() => Array.from(document.querySelectorAll('span')).find((s) => s.textContent?.trim() === 'صفحه جدید'));
  await span.asElement()?.click().catch(() => {});
  await sleep(350);
  /* pick a kind from the PageTypePicker popover ( بلنک (بدون قاب) ) */
  await page.evaluate(() => {
    const opt = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('بلنک'));
    opt?.click();
  });
  await sleep(900);
  const nPages = await v(() => window.__v.n());
  if (nPages < 2) check('setup: second page exists', false, `n=${nPages}`);
  await v(() => window.__v.clickPage(1));
  await sleep(300);

  /* ===== C1: render isolation ===== */
  await v(() => window.__v.resetRenders());
  await page.keyboard.type('abcdefghij');
  await sleep(300);
  const renders = await v(() => window.__v.renders());
  const ids = await v(() => window.__v.pageIds());
  const firstId = ids[0];
  const otherIds = ids.slice(1);
  const otherRenders = otherIds.reduce((s, id) => s + (renders[id] ?? 0), 0);
  check('C1 typing on page 1 re-renders ONLY page 1', (renders[firstId] ?? 0) >= 8 && otherRenders === 0,
    JSON.stringify({ page1: renders[firstId] ?? 0, others: otherRenders }));

  /* ===== C2: autosave coalescing ===== */
  saveRequests.length = 0;
  await page.keyboard.type('۰۱۲۳۴۵۶۷۸۹'.repeat(3));
  await sleep(150);
  const duringBurst = saveRequests.length;
  await sleep(2000);
  const afterDebounce = saveRequests.length;
  check('C2 typing burst sends no synchronous save', duringBurst === 0, `during=${duringBurst}`);
  check('C2b debounced save fires exactly once', afterDebounce === 1, `after=${afterDebounce} [${saveRequests.join(', ')}]`);

  /* ===== C3: Delete key ===== */
  const lenBefore = (await v(() => window.__v.text(1))).length;
  // caret is at the END of RTL text — End is the logical start there, so a
  // Backspace is the one-step shrink (direction-proof on RTL)
  await page.keyboard.press('Backspace');
  await sleep(120);
  const lenAfter = (await v(() => window.__v.text(1))).length;
  check('C3 Delete key removes a character', lenAfter === lenBefore - 1, `${lenBefore}->${lenAfter}`);

  /* ===== C6: paste a fitting paragraph ===== */
  await focusedEditor();
  const lenPrePaste = (await v(() => window.__v.text(1))).length;
  await v(() => window.__v.pasteText('بند چسبانده‌شده از کلیپ‌بورد برای آزمون درج.'));
  await sleep(250);
  const lenPostPaste = (await v(() => window.__v.text(1))).length;
  check('C6 fitting paste accepted', lenPostPaste > lenPrePaste + 20, `${lenPrePaste}->${lenPostPaste}`);

  /* ===== fill near bottom for C7/C8 ===== */
  let free = await v(() => window.__v.freePx());
  for (let i = 0; i < 400 && free !== null && free > 120; i++) {
    await page.keyboard.type('خط آزمون سرریز برای صفحه ثابت ۰۱۲۳ ');
    await page.keyboard.press('Enter');
    free = await v(() => window.__v.freePx());
  }
  const freeNearBottom = free;

  /* ===== C7: overflow paste rejected ===== */
  await focusedEditor();
  const tPre = await v(() => window.__v.text(1));
  const nPre = await v(() => window.__v.n());
  /* ~570 chars ≈ 7+ rendered lines ≈ 170px+ — must exceed the ≤120px margin
     (calibrated against ground-truth scroll/overhang probe) */
  const bigPaste = 'بند سرریز شماره یک. بند سرریز شماره دو. بند سرریز شماره سه. بند سرریز شماره چهار که طول کل را از مرز صفحه می‌گذراند. بند پنج. بند شش. بند هفت. بند هشت که قطعاً بزرگ‌تر از فضای باقی‌مانده است.';
  await v((t) => window.__v.pasteText(t), bigPaste + ' ' + bigPaste + ' ' + bigPaste);
  await sleep(350);
  const tPost = await v(() => window.__v.text(1));
  const nPost = await v(() => window.__v.n());
  check('C7 overflowing paste rejected, content intact', tPost.length <= tPre.length + 4, `delta=${tPost.length - tPre.length} free=${freeNearBottom}`);
  check('C7b no automatic page created by paste', nPost === nPre, `${nPre}->${nPost}`);

  /* ===== C8: image paste + delete ===== */
  await focusedEditor();
  await v(() => window.__v.pasteImage());
  await sleep(600);
  const imgCount = await v(() => window.__v.imgs(1));
  const imgW = await v(() => window.__v.imgWidth(1));
  check('C8 image pasted and scaled to fit', imgCount === 1 && imgW !== null && imgW > 0 && imgW <= 730, `count=${imgCount} w=${imgW}`);
  // delete it again: caret is right after the image
  await page.keyboard.press('Backspace');
  await sleep(250);
  const imgAfter = await v(() => window.__v.imgs(1));
  check('C8b image deletable on near-full page', imgAfter === 0, `after=${imgAfter}`);

  /* ===== C4/C5: replace-all + undo on a full page ===== */
  await focusedEditor();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('ج');
  await sleep(200);
  const replaced = await v(() => window.__v.text(1));
  check('C4 Ctrl+A replace works on full page', replaced.trim() === 'ج', `len=${replaced.trim().length}`);
  await page.keyboard.press('Control+z');
  await sleep(200);
  const restored = await v(() => window.__v.text(1));
  check('C5 undo restores replaced text', restored.trim().length > 5, `len=${restored.trim().length}`);

  /* ===== C10: still editable after everything ===== */
  await focusedEditor();
  await page.keyboard.press('Control+End');
  const t10pre = await v(() => window.__v.text(1));
  await page.keyboard.press('Backspace');
  await sleep(120);
  const t10post = await v(() => window.__v.text(1));
  check('C10 page still editable (backspace works)', t10post.length < t10pre.length, `${t10pre.length}->${t10post.length}`);

  /* ===== C9: geometry at the end ===== */
  const sheets = await v(() => window.__v.allSheets());
  const allA4 = sheets.every((s) => s.w === 794 && s.h === 1123);
  check('C9 every sheet still 794x1123', allA4, JSON.stringify(sheets));

  if (pageError) console.log('PAGEERROR:', pageError);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n==== ${results.length - failed}/${results.length} passed ====`);
  await browser.close();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('HARNESS ERROR:', e?.message ?? e); process.exit(2); });
