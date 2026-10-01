/**
 * ساخت جزوه‌ی نمونه — ۸ خط متن؛ خط ۳ چپ‌چین، خط ۵ وسط‌چین
 * (همه‌چیز از طریق UI واقعی: تایپ در ادیتور + کلیک روی منوی هم‌ترازی ریبون)
 * Run: node client/scripts/make-sample-note.mjs
 * پیش‌نیاز: npm run dev (کلاینت روی 5199، API روی 4000)
 */
import { chromium } from 'playwright-core';

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5199';
const API = 'http://localhost:4000';

const LINES = [
  'سلول واحد ساختاری و عملکردی بدن است',
  'اندامک‌ها درون سیتوپلاسما شناور هستند',
  'میتوکندری کارخانه‌ی تولید انرژی سلول است',
  'ریبوزوم‌ها مسئول ساخت پروتئین هستند',
  'غشای سلولی انتقال مواد را کنترل می‌کند',
  'هسته‌ی سلول مرکز فرماندهی است',
  'لیزوزوم‌ها آنزیم‌های گوارشی دارند',
  'سیتوپلاسما محیط درونی سلول را می‌سازد',
];

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
  if (!r.ok) throw new Error(`create note failed: ${r.status} ${await r.text()}`);
  const j = await r.json();
  return j.note._id || j.note.id;
}

const run = async () => {
  const token = await apiLogin();
  const title = 'جزوه‌ی نمونه — آزمون تراز';
  const noteId = await apiCreateNote(token, title);
  console.log('note created:', noteId);

  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));

  await page.goto(CLIENT_URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => localStorage.setItem('pn_token', t), token);
  await page.goto(`${CLIENT_URL}/editor/${noteId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ProseMirror', { timeout: 30000 });
  await page.waitForTimeout(1500);

  // فوکوس روی ادیتور واقعی صفحه (هُک QA پروژه)
  const focused = await page.evaluate(() => {
    const ed = window.__pn?.editors && Object.values(window.__pn.editors)[0];
    if (!ed) return false;
    ed.commands.focus('end');
    return true;
  });
  if (!focused) throw new Error('could not focus page editor');
  await page.waitForTimeout(300);

  // تایپ ۸ خط — Enter از طریق کاماند ادیتور (گارد صفحه‌بندی Enterِ کیبورد را در headless قورت می‌دهد)
  for (let i = 0; i < LINES.length; i++) {
    await page.keyboard.type(LINES[i]);
    await page.waitForTimeout(150);
    if (i < LINES.length - 1) {
      await page.evaluate(() => { Object.values(window.__pn.editors)[0].commands.enter(); });
      await page.waitForTimeout(150);
    }
  }
  await page.waitForTimeout(500);

  const readDoc = () => page.evaluate(() => {
    const ed = Object.values(window.__pn.editors)[0];
    const out = [];
    ed.state.doc.forEach((n) => out.push({ align: n.attrs.textAlign ?? null, text: n.textContent }));
    return out;
  });

  const doc0 = await readDoc();
  console.log('typed lines:', doc0.length, '(expected 8)');

  /** ترازِ یک خط: caret را روی آن خط می‌گذاریم و از منوی ریبون کلیک می‌کنیم */
  const alignLine = async (lineIndex, label) => {
    await page.evaluate((idx) => {
      const ed = Object.values(window.__pn.editors)[0];
      let pos = -1;
      ed.state.doc.forEach((node, offset, i) => { if (i === idx) pos = offset + 1; });
      ed.commands.focus();
      ed.commands.setTextSelection(pos); // caret خالی داخل همان خط
    }, lineIndex);
    await page.waitForTimeout(200);
    await page.locator('button[title="جهت‌دهی پاراگراف"]').first().click();
    await page.waitForTimeout(250);
    await page.getByRole('button', { name: label, exact: true }).first().click();
    await page.waitForTimeout(400);
  };

  // خط ۳ (index 2) چپ‌چین و خط ۵ (index 4) وسط‌چین
  await alignLine(2, 'چپ‌چین');
  await alignLine(4, 'وسط‌چین');

  const docFinal = await readDoc();
  console.log('\nfinal doc:');
  docFinal.forEach((n, i) => console.log(`  خط ${i + 1} [${n.align ?? 'پیش‌فرض'}] ${n.text}`));

  // ذخیره: onUpdate خودش autosave را زده؛ کمی صبر برای debounce
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/sample-note.png' });
  await browser.close();

  // ادعاها
  const ok =
    docFinal.length === 8 &&
    docFinal[2].align === 'left' &&
    docFinal[4].align === 'center' &&
    docFinal.every((n, i) => i !== 2 && i !== 4 ? n.align === null : true);
  console.log(`\nRESULT: ${ok ? 'PASS' : 'FAIL'}`);
  console.log(`OPEN: ${CLIENT_URL}/editor/${noteId}`);
  process.exit(ok ? 0 : 1);
};

run().catch((e) => { console.error('ERROR:', e.message); process.exit(2); });
