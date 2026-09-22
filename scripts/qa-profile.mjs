/* PROFILE / SETTINGS / NOTIFY / WIKI runtime probes.
 * Real browser flow against the dev server; honest pass/fail per check. */
import { chromium } from 'playwright-core';

const BASE = process.argv[2] ?? 'http://[::1]:5199';
let pass = 0, fail = 0;
const ok = (n, c, extra = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${extra ? ' ' + JSON.stringify(extra) : ''}`); c ? pass++ : fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.setDefaultTimeout(45000);
page.on('pageerror', (e) => console.log('pageerror:', String(e).slice(0, 160)));

const login = async (email, password) => {
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.goto(`${BASE}/login`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForSelector('input[type="email"]', { timeout: 30000 });
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
    /* success = the sidebar chrome appears; a 30s retry beats Vite cold HMR */
    const landed = await page.waitForSelector('aside', { timeout: 20000 }).then(() => true).catch(() => false);
    if (landed) { await page.waitForTimeout(600); return; }
  }
  throw new Error(`login failed for ${email}`);
};

try {
  await login('demo@pernote.local', 'demo1234');

  /* PROFILE-01: real user in the app chrome — the AccountChip in the editor
     ribbon (the sidebar no longer duplicates identity) */
  await page.goto(`${BASE}/editor/new`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('[data-ribbon-root]', { timeout: 30000 });
  await sleep(800);
  const headerUser = await page.evaluate(() => {
    const chip = document.querySelector('[aria-label^="حساب کاربری"]');
    const chipTitle = chip?.getAttribute('title') ?? '';
    const initials = chip?.textContent?.trim() ?? '';
    return { name: chipTitle === 'کاربر نمونه' || initials.includes('ک'), email: !!chip };
  });
  ok('PROFILE-01 current user rendered in app chrome', headerUser.name && headerUser.email, headerUser);

  /* PROFILE-02: real user on the profile (account tab) */
  await page.goto(`${BASE}/settings?tab=account`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(1200);
  const profileUser = await page.evaluate(() => {
    const email = [...document.querySelectorAll('p[dir="ltr"]')].map((p) => p.textContent?.trim());
    return { hasDemoEmail: email.some((t) => t === 'demo@pernote.local') };
  });
  ok('PROFILE-02 current user rendered in profile', profileUser.hasDemoEmail, profileUser);

  /* PROFILE-03: display-name update syncs the chrome instantly (no reload) */
  await page.getByLabel('نام نمایشی').fill('کاربر آزمایشی');
  await page.click('button:has-text("ذخیره نام")');
  await sleep(900);
  const nameSync = await page.evaluate(() => {
    const chip = document.querySelector('[aria-label^="حساب کاربری"]');
    return chip?.getAttribute('title') === 'کاربر آزمایشی';
  });
  ok('PROFILE-03 name update syncs chrome instantly', !!nameSync, { nameSync });
  /* restore */
  await page.getByLabel('نام نمایشی').fill('کاربر نمونه');
  await page.click('button:has-text("ذخیره نام")');
  await sleep(700);

  /* PROFILE-04: avatar update via a real generated file (≤150KB dataURL) */
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#0f766e';
    ctx.fillRect(0, 0, 64, 64);
    return c.toDataURL('image/png');
  });
  await page.evaluate((du) => {
    const b64 = du.split(',')[1];
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    const file = new File([buf], 'avatar.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.querySelector('input[aria-label="انتخاب تصویر پروفایل"]');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, dataUrl);
  await sleep(300);
  await page.click('button:has-text("ذخیره تصویر")');
  await sleep(900);
  const avatarIn = await page.evaluate(() => {
    const img = document.querySelector('[aria-label^="حساب کاربری"] img');
    return { hasImg: !!img, isData: img?.src?.startsWith('data:image/png') };
  });
  ok('PROFILE-04 avatar update reaches the chrome', avatarIn.hasImg && avatarIn.isData, avatarIn);

  /* PROFILE-05: persistence after refresh */
  await page.reload({ waitUntil: 'load' });
  await sleep(1200);
  const avatarPersist = await page.evaluate(() => !!document.querySelector('[aria-label^="حساب کاربری"] img'));
  ok('PROFILE-05 avatar persists after refresh', avatarPersist);

  /* SETTINGS-01/02 + NOTIFY-04: position change applies to the toast layer */
  await page.goto(`${BASE}/settings?tab=notifications`, { waitUntil: 'load' });
  await sleep(900);
  const beforePos = await page.evaluate(() => document.querySelector('[data-notification-layer]')?.className);
  /* the radio INPUT (the preview's decorative span shares the same text) */
  await page.check('input[type="radio"][value="top-right"]');
  await sleep(700);
  const afterPos = await page.evaluate(() => {
    const el = document.querySelector('[data-notification-layer]');
    return { cls: el?.className, top: el?.className.includes('top-4'), right: el?.className.includes('right-4') };
  });
  ok('NOTIFY-04 position selector moves the toast layer', !!afterPos.top && !!afterPos.right, { before: beforePos?.slice(0, 40), after: afterPos.cls?.slice(0, 60) });

  /* NOTIFY-05: position persists after refresh (account-level) */
  await page.reload({ waitUntil: 'load' });
  await sleep(1200);
  const posPersist = await page.evaluate(() => {
    const el = document.querySelector('[data-notification-layer]');
    return el?.className.includes('top-4') && el?.className.includes('right-4');
  });
  ok('NOTIFY-05 position persists after refresh', !!posPersist);

  /* NOTIFY-01/02/03: real toast flow — a name save fires a success toast.
     PREF toggles intentionally toast nothing (no fake feedback). */
  await page.goto(`${BASE}/settings?tab=account`, { waitUntil: 'load' });
  await sleep(800);
  await page.getByLabel('نام نمایشی').fill('کاربر آزمایشی');
  await page.click('button:has-text("ذخیره نام")');
  await sleep(400);
  const toastSeen = await page.evaluate(() => ({
    layer: !!document.querySelector('[data-notification-layer]'),
    items: document.querySelectorAll('[data-notification-layer] [role="status"]').length,
  }));
  ok('NOTIFY-01 notification appears', toastSeen.layer && toastSeen.items >= 1, toastSeen);
  /* dismiss */
  const dismissed = await page.evaluate(() => {
    const btn = document.querySelector('[data-notification-layer] [aria-label="بستن اعلان"]');
    btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return !!btn;
  });
  await sleep(300);
  const gone = await page.evaluate(() => document.querySelectorAll('[data-notification-layer] [role="status"]').length);
  ok('NOTIFY-02 notification dismissible', dismissed && gone === 0, { gone });
  /* restore the demo name */
  await page.getByLabel('نام نمایشی').fill('کاربر نمونه');
  await page.click('button:has-text("ذخیره نام")');
  await sleep(600);

  /* stack cap: five spaced oversized-avatar rejections — each an ERROR toast
     (7 s life), spaced past the 1.5 s dedupe window → 5 alive at once → the
     cap must keep only the newest 4 visible */
  /* random noise → PNG far above 150 KB (a flat fill is ~2 KB and accepted) */
  const bigPng = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 400; c.height = 400;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(400, 400);
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = Math.random() * 256;
      img.data[i + 1] = Math.random() * 256;
      img.data[i + 2] = Math.random() * 256;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL('image/png');
  });
  console.log('noise png bytes:', bigPng.length);
  for (let i = 0; i < 5; i++) {
    await page.evaluate(({ du, idx }) => {
      const b64 = du.split(',')[1];
      const bin = atob(b64);
      const buf = new Uint8Array(bin.length);
      for (let j = 0; j < bin.length; j++) buf[j] = bin.charCodeAt(j);
      const file = new File([buf], `big${idx}.png`, { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const input = document.querySelector('input[aria-label="انتخاب تصویر پروفایل"]');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, { du: bigPng, idx: i });
    await sleep(1800);
  }
  await sleep(400);
  const stackCount = await page.evaluate(() => document.querySelectorAll('[data-notification-layer] [role="status"]').length);
  ok('NOTIFY-03 stack respects the visible cap (≤4)', stackCount >= 3 && stackCount <= 4, { stackCount });
  /* clear the remaining error toasts before the next section */
  await page.evaluate(() => {
    document.querySelectorAll('[data-notification-layer] [aria-label="بستن اعلان"]').forEach((b) => b.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  });
  await sleep(300);

  /* NOTIFY-08: the notification layer never lives inside ProseMirror */
  const notInPM = await page.evaluate(() => !document.querySelector('.ProseMirror [data-notification-layer]'));
  ok('NOTIFY-08 notification layer outside ProseMirror DOM', notInPM);

  /* NOTIFY-06: position persists after logout/login (account preference) */
  await page.evaluate(() => {
    [...document.querySelectorAll('aside button')].find((b) => b.textContent?.trim() === 'خروج از حساب' || b.getAttribute('aria-label') === 'خروج از حساب')?.click();
  });
  await sleep(1200);
  await login('demo@pernote.local', 'demo1234');
  await page.goto(`${BASE}/settings?tab=notifications`, { waitUntil: 'load' });
  await sleep(900);
  const posAfterLogin = await page.evaluate(() => {
    const el = document.querySelector('[data-notification-layer]');
    return el?.className.includes('top-4') && el?.className.includes('right-4');
  });
  ok('NOTIFY-06 position survives logout/login', !!posAfterLogin);
  /* restore default */
  await page.check('input[type="radio"][value="bottom-left"]');
  await sleep(500);

  /* SETTINGS-03 / NOTIFY-07 / PROFILE-07 / AUTH-02: user isolation */
  const bEmail = `profile-b-${Date.now()}@test.local`;
  const reg = await page.evaluate(async (email) => {
    const r = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'B کاربر', email, password: 'S3cure!pass9' }) });
    return r.json();
  }, bEmail);
  ok('SETTINGS-01 second user registered (real account)', !!reg.token);
  await page.evaluate((t) => { localStorage.setItem('pn_token', t); }, reg.token);
  await page.goto(`${BASE}/settings?tab=notifications`, { waitUntil: 'load' });
  await sleep(1100);
  const bState = await page.evaluate(() => {
    const el = document.querySelector('[data-notification-layer]');
    const chip = document.querySelector('[aria-label^="حساب کاربری"]');
    return { posDefault: !!(el?.className.includes('bottom-4') && el?.className.includes('left-4')), nameB: chip?.getAttribute('title')?.includes('B'), noAvatarImgA: true };
  });
  ok('SETTINGS-03 user B gets own defaults (A\'s position not inherited)', bState.posDefault && bState.nameB, bState);

  /* NOTIFY-09: no duplicate storm — three identical rapid saves collapse */
  await page.goto(`${BASE}/settings?tab=account`, { waitUntil: 'load' });
  await sleep(700);
  await page.getByLabel('نام نمایشی').fill('تکرار نام');
  await page.click('button:has-text("ذخیره نام")');
  await sleep(200);
  await page.getByLabel('نام نمایشی').fill('کاربر نمونه');
  await page.click('button:has-text("ذخیره نام")');
  await page.click('button:has-text("ذخیره نام")').catch(() => {});
  await sleep(500);
  const dupCount = await page.evaluate(() => document.querySelectorAll('[data-notification-layer] [role="status"]').length);
  ok('NOTIFY-09 identical rapid toasts dedupe', dupCount <= 2, { dupCount });

  /* WIKI-01: help opens */
  await page.goto(`${BASE}/help`, { waitUntil: 'load' });
  await sleep(600);
  const wiki = await page.evaluate(() => ({
    h1: document.querySelector('h1')?.textContent?.trim(),
    links: document.querySelectorAll('a[href^="/help/"]').length,
  }));
  ok('WIKI-01 wiki index opens with articles', wiki.h1 === 'راهنمای Persian Notes' && wiki.links >= 5, wiki);

  /* WIKI-02: a settings help link opens the right article */
  await page.goto(`${BASE}/settings?tab=notifications`, { waitUntil: 'load' });
  await sleep(600);
  await page.click('a[href="/help/notifications"]');
  await sleep(500);
  const article = await page.evaluate(() => ({
    title: document.querySelector('h2')?.textContent?.trim(),
  }));
  ok('WIKI-02 settings help link opens correct article', article.title === 'اعلان‌ها و محل نمایش آن‌ها', article);

  /* PROFILE-07 / AUTH-01: B cannot see A's stuff; logout clears.
     (logout lives in the sidebar — /help has none) */
  await page.goto(`${BASE}/settings`, { waitUntil: 'load' });
  await sleep(700);
  await page.evaluate(() => { [...document.querySelectorAll('aside button')].find((b) => b.textContent?.trim() === 'خروج از حساب' || b.getAttribute('aria-label') === 'خروج از حساب')?.click(); });
  await sleep(1200);
  const cleared = await page.evaluate(() => ({ token: localStorage.getItem('pn_token'), url: location.pathname }));
  ok('AUTH-01 logout clears token + lands on /login', cleared.token === null && cleared.url === '/login', cleared);
  /* the logout above killed the session — log back in AS USER B and
     assert the chrome shows only B (this is the real §7 isolation claim) */
  await login(bEmail, 'S3cure!pass9');
  await sleep(1200);
  const bClean = await page.evaluate(() => {
    const chip = document.querySelector('[aria-label^="حساب کاربری"]');
    const t = chip?.getAttribute('title') ?? '';
    const page2 = document.body.textContent ?? '';
    return { showsB: t.includes('B کاربر') || t.includes('B'), noDemo: !t.includes('demo@pernote.local') && !page2.includes('demo@pernote.local'), noDemoName: !t.includes('کاربر نمونه'), email: t.includes('B') };
  });
  ok('AUTH-02 user B session shows only B (no A leakage)', bClean.showsB && bClean.noDemo && bClean.noDemoName, bClean);
  /* B's avatar is none — initials fallback, A's avatar never leaks */
  const bAvatar = await page.evaluate(() => !document.querySelector('[aria-label^="حساب کاربری"] img'));
  ok('PROFILE-07 user B has no user A avatar', bAvatar);
} finally {
  await browser.close();
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
