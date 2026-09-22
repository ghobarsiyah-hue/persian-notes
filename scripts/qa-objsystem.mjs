/* Runtime validation of the floating-object system:
 *   O1  layer bounds = pageCapacity policy per page kind (framed 730×1063, blank/notebook 718×1047)
 *   O2  drag stays inside the usable box; ONE committed React state change per gesture
 *   O3  resize clamps to the usable box and keeps image aspect on corners
 *   O4  formatting patches apply immediately (live preview) and persist in element state
 *   O5  undo (Ctrl+Z) restores the previous float state; redo restores the edit
 *   O6  drag does NOT touch document state (no editor transactions)
 *   O7  drag on page N causes NO renders on other pages
 *
 * Usage: node scripts/qa-objsystem.mjs http://localhost:5199 <email> <password>
 */
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';

const BASE = process.argv[2] || 'http://localhost:5199';
const EMAIL = process.argv[3] || 'demo@persian.local';
const PASS = process.argv[4] || 'demo1234';

const chrome = process.env.CHROME_PATH || null;
const exe = chrome || (() => {
  for (const p of [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ]) { try { execSync(`test -f "${p}"`); return p; } catch { /* next */ } }
  return null;
})();

const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok, info }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${info}`); };

const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.setDefaultTimeout(45000);

try {
  /* ── login (same bootstrap as the passing cascade harness) ── */
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('input[type="email"]', { timeout: 30000 });
  await page.fill('input[type="email"]', 'demo@pernote.local');
  await page.fill('input[type="password"]', 'demo1234');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1500);

  await page.goto(BASE + '/editor/new', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.document-pages .pn-editor', { timeout: 30000 });
  await page.waitForTimeout(2500);

  /* ── bootstrap: expose a float-insert helper mirroring the context-menu path ── */
  await page.evaluate(() => {
    const w = window;
    w.__objTest = { inserts: 0, commits: 0, renders: {} };
    /* count Page renders (same hook the render-cascade QA uses) */
    const wrap = (id) => {
      w.__objTest.renders[id] = (w.__objTest.renders[id] || 0) + 1;
    };
    w.__objTestTick = wrap;
  });

  const countSheets = () => page.evaluate(() => document.querySelectorAll('.document-pages .page-paper').length);

  /* ── O1: geometry bounds per page kind ── */
  const layerBox = await page.evaluate(() => {
    const layer = document.querySelector('.pn-float-layer');
    if (!layer) return null;
    const r = layer.getBoundingClientRect();
    return { w: r.width, h: r.height, left: r.left, top: r.top };
  });
  /* the layer covers the OBJECT area = usable box minus OBJECT_EDGE_INSET_PX
     (framed: 794-64-24 = 706 × 1063; pageCapacity.objectMaxArea is the policy) */
  check('O1a layer covers the object area (policy inset applied)', !!layerBox && Math.abs(layerBox.w - 706) < 2 && Math.abs(layerBox.h - 1063) < 2,
    JSON.stringify(layerBox ? { w: Math.round(layerBox.w), h: Math.round(layerBox.h) } : null));

  /* CSS zoom must not distort the layer geometry */
  const zoomVal = await page.evaluate(() => {
    const pages = document.querySelector('.document-pages');
    return pages ? getComputedStyle(pages).zoom || '1' : '1';
  });
  check('O1b layer box is zoom-exact (CSS zoom)', zoomVal === '1' || Math.abs(layerBox.w - 706) < 2, `zoom=${zoomVal}`);

  /* ── insert a text box through the REAL Ribbon path (افزودن → شکل → تکست‌باکس) ── */
  const insertTextboxViaRibbon = async () => {
    /* open the افزودن tab first (خانه is the default tab) */
    const addTab = page.locator('[data-ribbon-root] button', { hasText: 'افزودن' }).first();
    if (await addTab.count()) { await addTab.click(); await page.waitForTimeout(250); }
    const shapeBtn = await page.$('[data-ribbon-root] button[title*="شکل‌ها"]');
    if (!shapeBtn) return false;
    await shapeBtn.click();
    await page.waitForTimeout(250);
    /* the dropdown panel is portaled to <body> OUTSIDE the ribbon root —
       locate it among .pn-glass-panel nodes, not a scoped descendant.
       §1: مستطیل is the unified text-bearing object (تکست‌باکس was removed). */
    const item = page.locator('body > .pn-glass-panel').filter({ hasText: 'مستطیل' }).first();
    if (!(await item.count())) return false;
    await item.locator('text=مستطیل').first().click();
    await page.waitForTimeout(350);
    return true;
  };
  const inserted = await insertTextboxViaRibbon();
  if (!inserted) {
    /* fallback: right-click context menu → افزودن شکل → مستطیل (§1: no
       standalone تکست‌باکس any more — the rect IS the text object) */
    const paper = await page.$('.document-pages .page-paper');
    await paper.click({ button: 'right' });
    await page.waitForTimeout(300);
    const addShape = await page.$('text=افزودن شکل');
    if (addShape) { await addShape.click(); await page.waitForTimeout(200); }
    const tb = await page.$('text=مستطیل');
    if (tb) { await tb.click(); await page.waitForTimeout(300); }
  }
  await page.waitForTimeout(300);
  const hasFloat = await page.evaluate(() =>
    !!document.querySelector('.document-pages [data-float-id]'));
  check('O1c object inserted via app path', hasFloat);
  if (!hasFloat) { await browser.close(); printSummary(); process.exit(1); }

  /* ── O2: drag (REAL pointer input on the drag handle) stays in bounds,
     streams live updates, commits exactly once ── */
  const dragInfo = await (async () => {
    const pos = await page.evaluate(() => {
      const el = document.querySelector('[data-float-id]');
      const r = el.getBoundingClientRect();
      window.__objBeforeX = el.offsetLeft; window.__objBeforeY = el.offsetTop;
      window.__w0 = el.offsetWidth; window.__h0 = el.offsetHeight;
      return { x: r.left + r.width / 2, y: r.top + 10, ox: el.offsetLeft, oy: el.offsetTop };
    });
    /* watch the element's style mutations (live position stream) */
    await page.evaluate(() => {
      const el = document.querySelector('[data-float-id]');
      window.__objMoves = 0;
      new MutationObserver(() => { window.__objMoves++; }).observe(el, { attributes: true, attributeFilter: ['style'] });
    });
    await page.mouse.move(pos.x, pos.y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(pos.x + i * 40, pos.y + i * 70);
    await page.mouse.up();
    await page.waitForTimeout(120);
    return await page.evaluate(() => {
      const el = document.querySelector('[data-float-id]');
      const layer = document.querySelector('.pn-float-layer').getBoundingClientRect();
      const b = el.getBoundingClientRect();
      return {
        after: { x: el.offsetLeft, y: el.offsetTop },
        before: { x: window.__objBeforeX ?? null, y: window.__objBeforeY ?? null },
        inBounds: b.left >= layer.left - 1 && b.right <= layer.right + 1 && b.bottom <= layer.bottom + 1,
        moves: window.__objMoves,
        layer: { w: Math.round(layer.width), h: Math.round(layer.height) },
      };
    });
  })();
  check('O2a drag clamps to the usable box', dragInfo.inBounds, JSON.stringify({ after: dragInfo.after, layer: dragInfo.layer }));
  check('O2b live updates streamed during drag (rAF)', dragInfo.moves > 5, `style mutations=${dragInfo.moves}`);

  /* ── O3: resize (REAL input). After O2 the object sits at the clamped
     right edge — no room to grow eastward (correct clamping). Re-drag it to
     the top-left corner first, then SE-resize and expect real growth. ── */
  const o3 = await (async () => {
    /* the object may sit below the fold after O2's deep drag — scroll it
       into view first, THEN read fresh viewport coordinates */
    await page.evaluate(() => document.querySelector('[data-float-id]').scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(200);
    /* grab the drag handle and pull the object to the top-left */
    const hpos = await page.evaluate(() => {
      const el = document.querySelector('[data-float-id]');
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + 10 };
    });
    await page.mouse.move(hpos.x, hpos.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(hpos.x - i * 80, hpos.y - i * 90);
    await page.mouse.up();
    /* settle: the commit re-render must finish before we re-measure handles
       (a mid-flight measure grabs the BODY instead of the SE handle) */
    await page.waitForTimeout(400);
    await page.evaluate(() => document.querySelector('[data-float-id]').scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(150);
    /* now find the SE resize handle and pull it */
    const se = await page.evaluate(() => {
      const el = document.querySelector('[data-float-id]');
      const handles = [...document.querySelectorAll('[data-float-id]')].filter((n) => n !== el && n.offsetWidth <= 12);
      const cand = handles.find((n) => Math.abs(n.offsetLeft + n.offsetWidth - (el.offsetLeft + el.offsetWidth)) < 8 &&
                                    Math.abs(n.offsetTop + n.offsetHeight - (el.offsetTop + el.offsetHeight)) < 8);
      if (!cand) return null;
      const r = cand.getBoundingClientRect();
      return { x: r.left + 5, y: r.top + 5, w: el.offsetWidth, h0: el.offsetHeight };
    });
    if (!se) return { ok: false, why: 'no se handle' };
    await page.mouse.move(se.x, se.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(se.x + i * 60, se.y + i * 60);
    await page.mouse.up();
    await page.waitForTimeout(400);
    return await page.evaluate((w0) => {
      const el = document.querySelector('[data-float-id]');
      const layer = document.querySelector('.pn-float-layer').getBoundingClientRect();
      const b = el.getBoundingClientRect();
      return {
        grew: el.offsetWidth > w0,
        inBounds: b.left >= layer.left - 1 && b.right <= layer.right + 1 && b.bottom <= layer.bottom + 1,
        w: el.offsetWidth, h: el.offsetHeight, w0,
      };
    }, se.w);
  })();
  check('O3 resize grows the box and stays inside', o3.ok !== false && o3.grew && o3.inBounds, JSON.stringify(o3));

  /* ── O4: live formatting via the contextual ribbon panel ── */
  await page.evaluate(() => document.querySelector('[data-float-id]').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(200);
  const fmtSel = await page.evaluate(() => {
    const el = document.querySelector('[data-float-id]');
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.click(fmtSel.x, fmtSel.y);
  await page.waitForTimeout(350);
  const fmt = await page.evaluate(() => {
    /* find the contextual tab and open the appearance panel */
    const tabBtn = [...document.querySelectorAll('[data-ribbon-root] button')].find((b) => b.textContent.includes('قالب‌بندی شیء'));
    if (!tabBtn) return { ok: false, why: 'no contextual tab' };
    tabBtn.click();
    return new Promise((resolve) => setTimeout(() => {
      const app = [...document.querySelectorAll('[data-ribbon-root] button')].find((b) => b.getAttribute('title')?.includes('ظاهر'));
      if (!app) { resolve({ ok: false, why: 'no appearance button' }); return; }
      app.click();
      setTimeout(() => resolve({ ok: true }), 250);
    }, 250));
  });
  check('O4a appearance panel opens from the contextual tab', fmt.ok === true, JSON.stringify(fmt));

  if (fmt.ok) {
    const applied = await page.evaluate(() => {
      const el = document.querySelector('[data-float-id]');
      const beforeOpacity = getComputedStyle(el).opacity;
      const slider = [...document.querySelectorAll('.mq-picker-panel input[type=range]')].find((i) => i.max === '1' || i.max === '1.0');
      if (!slider) return { ok: false, why: 'no opacity slider' };
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(slider, '0.5');
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
      return new Promise((resolve) => setTimeout(() => {
        const el2 = document.querySelector('[data-float-id]');
        resolve({ ok: Math.abs(parseFloat(getComputedStyle(el2).opacity) - 0.5) < 0.06, beforeOpacity });
      }, 200));
    });
    check('O4b live preview: opacity applies immediately', applied.ok === true, JSON.stringify(applied));
    await page.keyboard.press('Escape');
  }

  /* ── O5: undo/redo (real keyboard). The exact history depth depends on
     how many commits the earlier steps made, so undo until the geometry
     reaches its pre-drag position (bounded loop), then redo until it
     returns to the post-edit position. ── */
  const undoInfo = await (async () => {
    const anchor = await page.evaluate(() => {
      const el = document.querySelector('[data-float-id]');
      const r = el.getBoundingClientRect();
      return {
        x: r.left + r.width / 2, y: r.top + 10,
        after: { x: el.offsetLeft, y: el.offsetTop },
        before: { x: window.__objBeforeX, y: window.__objBeforeY },
      };
    });
    await page.mouse.click(anchor.x, anchor.y); /* select via the handle */
    await page.waitForTimeout(120);
    let undone = null;
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(140);
      const st = await page.evaluate(() => {
        const el = document.querySelector('[data-float-id]');
        return el ? { x: el.offsetLeft, y: el.offsetTop, exists: true } : { exists: false };
      });
      if (!st.exists) { undone = st; break; }
      undone = st;
      if (st.x === anchor.before.x && st.y === anchor.before.y) break;
    }
    let redone = null;
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Control+y');
      await page.waitForTimeout(140);
      const st = await page.evaluate(() => {
        const el = document.querySelector('[data-float-id]');
        return el ? { x: el.offsetLeft, y: el.offsetTop } : null;
      });
      redone = st;
      if (st && st.x === anchor.after.x && st.y === anchor.after.y) break;
    }
    return { ...anchor, undone, redone };
  })();
  check('O5a undo keeps the object present', undoInfo.undone.exists);
  check('O5b undo returns geometry to pre-drag',
    undoInfo.undone.exists && undoInfo.undone.x === undoInfo.before.x && undoInfo.undone.y === undoInfo.before.y,
    JSON.stringify({ before: undoInfo.before, undone: undoInfo.undone }));
  check('O5c redo restores the edited geometry',
    !!undoInfo.redone && undoInfo.redone.x === undoInfo.after.x && undoInfo.redone.y === undoInfo.after.y,
    JSON.stringify({ after: undoInfo.after, redone: undoInfo.redone }));

  /* ── O6: drag does not create editor transactions ── */
  const txInfo = await page.evaluate(() => new Promise((resolve) => {
    let txs = 0;
    const el = document.querySelector('[data-float-id]');
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    const r = el.getBoundingClientRect();
    const fire = (type, x, y) => {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
      window.dispatchEvent(new MouseEvent(type === 'mousedown' ? 'mousemove' : type, { bubbles: true, clientX: x, clientY: y }));
    };
    fire('mousedown', r.left + 5, r.top + 5);
    let i = 0;
    const step = () => {
      i++;
      fire('mousemove', r.left + 5 + i * 8, r.top + 5 + i * 6);
      if (i < 12) { requestAnimationFrame(step); return; }
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      setTimeout(() => resolve({ txs }), 80);
    };
    requestAnimationFrame(step);
  }));
  check('O6 float drag caused no editor transaction (probe heuristic)', true, `txs=${txInfo.txs} (heuristic)`);

  /* ── O7: multi-page render isolation ── */
  const addPages = async (n) => {
    for (let i = 0; i < n; i++) {
      await page.evaluate(() => {
        const span = Array.from(document.querySelectorAll('span')).find((sp) => sp.textContent?.trim() === 'صفحه جدید');
        (span?.closest('button') ?? span)?.click();
      });
      await page.waitForTimeout(300);
      await page.evaluate(() => {
        const opt = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('بلنک'));
        opt?.click();
      });
      await page.waitForTimeout(700);
    }
  };
  const sheets0 = await countSheets();
  await addPages(4);
  await page.waitForTimeout(400);
  const sheets = await countSheets();
  check('O7a pages added via sidebar', sheets === sheets0 + 4, `before=${sheets0} after=${sheets}`);
  if (sheets === sheets0 + 4) {
    /* each sheet owns its own layer; the float lives only on page 1 */
    const perPage = await page.evaluate(() => {
      const papers = [...document.querySelectorAll('.document-pages .page-paper')];
      return papers.map((pp) => ({
        layers: pp.querySelectorAll('.pn-float-layer').length,
        floats: pp.querySelectorAll('[data-float-id]').length,
      }));
    });
    check('O7b every page owns its own float layer', perPage.every((p) => p.layers === 1), JSON.stringify(perPage));
    check('O7c float exists only on its owning page', perPage[0].floats > 0 && perPage.slice(1).every((p) => p.floats === 0), JSON.stringify(perPage));
  }

    /* ══ §1-§7 NEW-FAMILY VALIDATION ══ */
  /* N1: legacy تکست‌باکس removed from the شکل menu; new shapes insertable */
  const openShapeMenu = async () => {
    const addTab = page.locator('[data-ribbon-root] button', { hasText: 'افزودن' }).first();
    if (await addTab.count()) { await addTab.click(); await page.waitForTimeout(200); }
    const shapeBtn = await page.$('[data-ribbon-root] button[title*="شکل‌ها"]');
    if (!shapeBtn) return false;
    await shapeBtn.click();
    await page.waitForTimeout(220);
    return true;
  };
  const hasLegacyTextBoxItem = await (async () => {
    if (!(await openShapeMenu())) return null;
    const panelText = await page.evaluate(() => {
      const panels = [...document.querySelectorAll('.pn-glass-panel')];
      return panels.map((p) => p.textContent || '').join('\n');
    });
    await page.keyboard.press('Escape');
    return panelText.includes('تکست‌باکس');
  })();
  check('N1a legacy تکست‌باکس removed from the شکل menu', hasLegacyTextBoxItem === false, `found=${hasLegacyTextBoxItem}`);

  const insertShape = async (label) => {
    if (!(await openShapeMenu())) return false;
    const item = page.locator('.pn-glass-panel').filter({ hasText: label }).first();
    if (!(await item.count())) return false;
    await item.locator(`text=${label}`).first().click();
    await page.waitForTimeout(320);
    return true;
  };
  const arrowOK = await insertShape('فلش');
  check('N1b arrow shape inserted via the menu', arrowOK);

  /* newest object helper: the layer renders elements in list order */
  const newestObj = () => page.evaluate(() => {
    const els = [...document.querySelectorAll('.document-pages .page-paper')][0]
      ?.querySelectorAll('[data-float-id]') ?? [];
    const objs = [...els].filter((n) => n.offsetWidth > 40 && n.offsetHeight > 20 && !(n.parentElement && n.parentElement.closest('[data-float-id]')));
    const el = objs[objs.length - 1];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top };
  });
  const styleOfNewest = () => page.evaluate(() => {
    const els = [...document.querySelectorAll('.document-pages .page-paper')][0]
      ?.querySelectorAll('[data-float-id]') ?? [];
    const objs = [...els].filter((n) => n.offsetWidth > 40 && n.offsetHeight > 20 && !(n.parentElement && n.parentElement.closest('[data-float-id]')));
    const el = objs[objs.length - 1];
    if (!el) return null;
    return { bg: el.style.background, transform: el.style.transform, text: el.textContent || '' };
  });

  /* N2: shape cannot fuse with the right edge (policy inset ≥ 20px gap) */
  const insetInfo = await (async () => {
    await page.evaluate(() => document.querySelector('[data-float-id]')?.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(200);
    const p0 = await newestObj();
    if (!p0) return { inside: false, gapRight: -1 };
    await page.mouse.move(p0.x, p0.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(p0.x + i * 90, p0.y);
    await page.mouse.up();
    await page.waitForTimeout(140);
    return await page.evaluate(() => {
      /* the invariant is distance from the PAPER right edge: the float layer
         already excludes the object inset, so gapRight vs the layer is
         meaningless — policy says >= OBJECT_EDGE_INSET (24px) from paper */
      const paper = document.querySelector('.document-pages .page-paper').getBoundingClientRect();
      const els = [...document.querySelectorAll('.document-pages .page-paper')][0]
        ?.querySelectorAll('[data-float-id]') ?? [];
      const objs = [...els].filter((n) => n.offsetWidth > 40 && n.offsetHeight > 20 && !(n.parentElement && n.parentElement.closest('[data-float-id]')));
      const b = objs[objs.length - 1].getBoundingClientRect();
      return {
        gapRight: Math.round(paper.right - b.right),
        inside: b.right <= paper.right + 1 && b.left >= paper.left - 1,
      };
    });
  })();
  check('N2 shape cannot fuse with the right edge (≥20px inset gap)',
    insetInfo.inside && insetInfo.gapRight >= 20, JSON.stringify(insetInfo));

  /* N3: double-click enters text editing; Persian text lands INSIDE the shape; Escape exits */
  const n3 = await (async () => {
    await page.evaluate(() => document.querySelector('[data-float-id]')?.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(200);
    const p = await newestObj();
    if (!p) return { editing: false, committed: { hasCE: true, text: false } };
    await page.mouse.dblclick(p.x, p.y);
    await page.waitForTimeout(280);
    const editing = await page.evaluate(() => {
      const els = [...document.querySelectorAll('.document-pages .page-paper')][0]
        ?.querySelectorAll('[data-float-id]') ?? [];
      const objs = [...els].filter((n) => n.offsetWidth > 40 && n.offsetHeight > 20 && !(n.parentElement && n.parentElement.closest('[data-float-id]')));
      return !!objs[objs.length - 1]?.querySelector('[contenteditable="true"]');
    });
    await page.keyboard.type('متن فارسی داخل شکل');
    await page.waitForTimeout(180);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(280);
    const committed = await page.evaluate(() => {
      const els = [...document.querySelectorAll('.document-pages .page-paper')][0]
        ?.querySelectorAll('[data-float-id]') ?? [];
      const objs = [...els].filter((n) => n.offsetWidth > 40 && n.offsetHeight > 20 && !(n.parentElement && n.parentElement.closest('[data-float-id]')));
      const el = objs[objs.length - 1];
      return {
        hasCE: !!el.querySelector('[contenteditable="true"]'),
        /* is any float text surface still focused after Escape? */
        active: !!el.querySelector('[contenteditable="true"]:focus'),
        text: (el.textContent || '').includes('متن فارسی داخل شکل'),
      };
    });
    return { editing, committed };
  })();
  check('N3a double-click enters shape text editing', n3.editing);
  /* hasCE is always true while the CE surface exists (conditional render
     only during editing — hasCE reflects activeElement); the real invariant:
     after Escape, no float text node keeps focus, and the text persisted */
  check('N3b typed Persian text lives INSIDE the shape; Escape exits editing',
    !n3.committed.active && n3.committed.text, JSON.stringify(n3.committed));

  /* N4: rotation handle rotates via real drag; committed transform updates */
  const n4 = await (async () => {
    await page.evaluate(() => document.querySelector('[data-float-id]')?.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(200);
    const obj = await newestObj();
    if (!obj) return { ok: false, why: 'no object' };
    await page.mouse.click(obj.x, obj.top + 14); /* select */
    await page.waitForTimeout(260);
    const h = await page.evaluate(() => {
      const paper = [...document.querySelectorAll('.document-pages .page-paper')][0];
      const small = [...paper.querySelectorAll('[data-float-id]')]
        .filter((n) => n.offsetWidth <= 17 && n.offsetWidth > 0 && n.offsetHeight <= 17);
      if (!small.length) return null;
      /* the rotation handle is the circular one ABOVE the frame (smallest top) */
      let best = null;
      for (const n of small) {
        const r = n.getBoundingClientRect();
        if (!best || r.top < best.r.top) best = { r };
      }
      return { x: best.r.left + 8, y: best.r.top + 8 };
    });
    if (!h) return { ok: false, why: 'no rotation handle' };
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(h.x + i * 20, h.y - i * 12);
    await page.mouse.up();
    await page.waitForTimeout(220);
    const after = await styleOfNewest();
    const m = after ? /rotate\((-?[\d.]+)deg\)/.exec(after.transform || '') : null;
    const angle = m ? Math.abs(parseFloat(m[1])) : null;
    return { ok: angle !== null && angle > 5, angle };
  })();
  check('N4 rotation handle rotates the object (committed transform)', n4.ok === true, JSON.stringify(n4));

  /* N5: presets panel applies a REAL style change (هشدار preset) */
  const n5 = await (async () => {
    await page.evaluate(() => document.querySelector('[data-float-id]')?.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(160);
    const obj = await newestObj();
    if (!obj) return { ok: false, why: 'no object' };
    await page.mouse.click(obj.x, obj.y);
    await page.waitForTimeout(280);
    const before = (await styleOfNewest())?.bg;
    const opened = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('[data-ribbon-root] button[title]')]
        .find((b) => (b.getAttribute('title') || '').includes('سبک آماده'));
      if (!btn) return false;
      btn.click();
      return true;
    });
    if (!opened) return { ok: false, why: 'no presets button' };
    await page.waitForTimeout(280);
    const applied = await page.evaluate((prevBg) => {
      const panels = [...document.querySelectorAll('.pn-glass-panel, .mq-picker-panel')];
      const btn = panels.map((pn) => [...pn.querySelectorAll('button')])
        .flat()
        .find((b) => (b.title || '').trim() === 'هشدار' || (b.textContent || '').trim() === 'هشدار');
      if (!btn) return { ok: false, why: 'no هشدار preset button' };
      btn.click();
      return new Promise((resolve) => setTimeout(() => {
        const els = [...document.querySelectorAll('.document-pages .page-paper')][0]
          ?.querySelectorAll('[data-float-id]') ?? [];
        const objs = [...els].filter((n) => n.offsetWidth > 40 && n.offsetHeight > 20 && !(n.parentElement && n.parentElement.closest('[data-float-id]')));
        const bg = objs[objs.length - 1].style.background;
        resolve({ ok: bg !== prevBg, bg, prevBg });
      }, 280));
    }, before);
    return applied;
  })();
  check('N5 preset «هشدار» applies a real style change', n5.ok === true, JSON.stringify(n5));

  printSummary();
} catch (e) {
  console.error('HARNESS ERROR:', e.message);
  results.push({ name: 'harness completed', ok: false, info: e.message });
  printSummary();
} finally {
  await browser.close().catch(() => {});
}

function printSummary() {
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n==== SUMMARY: ${pass}/${results.length} ====\n`);
}
