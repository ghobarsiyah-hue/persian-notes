/**
 * Seed a realistic ~10-page Persian study booklet through the REST API and
 * sanity-check the persisted pagination format:
 *   • pageBreak nodes separate the pages (multi-page storage format)
 *   • the first page's kind lives in doc attrs.pageKind
 *   • every following page's kind lives on the pageBreak before it
 *   • ordered-list `start` attrs stay continuous across page boundaries
 *
 * Usage: node scripts/seed-booklet.mjs [baseUrl] [email]
 */
const BASE = process.argv[2] ?? 'http://localhost:4000';
const EMAIL = process.argv[3] ?? `qa-${Date.now()}@pernote.local`;

/* ── tiny helpers ──────────────────────────────────────────────────── */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg += ': ' + (await res.json())?.error; } catch { /* ignore */ }
    throw new Error(`${path} → ${msg}`);
  }
  return res.json();
}

/* ── Persian text blocks (each paragraph is 3–6 rendered lines at 16px/2lh) ── */
const P = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });
const H = (lvl, t) => ({ type: 'heading', attrs: { level: lvl, textAlign: 'right' }, content: [{ type: 'text', text: t }] });

const LOREM_FA = [
  'فیزیولوژی، علم مطالعهٔ عملکرد اندام‌های بدن است و رابطهٔ مستقیمی با آناتومی دارد. هر بخش از این جزوه بر پایهٔ مفاهیم کلیدی فصل‌های پیشین بنا شده است؛ بنابراین پیشنهاد می‌شود فصل‌ها را به ترتیب مطالعه کنید.',
  'در این فصل با چهار مفهوم بنیادین آشنا می‌شویم: هم‌ایستایی (همئوستاز)، بازخورد منفی و مثبت، انتقال فعال و غیرفعال غشایی، و نقش کانال‌های یونی در پتانسیل غشایی. هر مفهوم با یک مثال بالینی همراه است.',
  'سلول به‌عنوان کوچک‌ترین واحد حیات، محیط درونی خود را با دقت تنظیم می‌کند. غشای پلاسمایی با انتخاب‌پذیری ویژه، عبور مواد را مهار می‌کند و مجموعه‌ای از پمپ‌ها و کانال‌ها تعادل یونی سلول را برقرار می‌سازند.',
  'میتوکندری نیروگاه سلول است؛ در کریستاهای آن زنجیرهٔ انتقال الکترون جای گرفته و گرادیان پروتونی تولید می‌شود. اختلال در عملکرد میتوکندری با بیماری‌های متابولیک متعددی مرتبط شناخته شده است.',
  'شبکهٔ آندوپلاسمی زبر محل سنتز پروتئین‌های ترشحی و غشایی است و شبکهٔ صاف نقش کلیدی در متابولیزم لیپیدها و سم‌زدایی سلول دارد. apparatus گلژی بسته‌های پروتئینی را برچسب‌گذاری و مسیریابی می‌کند.',
  'در مطالعات بالینی نشان داده شده که اختلالات یون‌سدیم، مهم‌ترین علت اختلالات هوشیاری در بیماران بستری است. هیپوناترمی با تورم مغزی و هایپرناترمی با دهیدراتاسیون درون‌سلولی همراه است.',
  'فشار خون شریانی حاصل ضرب برون‌ده قلبی در مقاومت محیطی است. تنظیم آن بر عهدهٔ سیستم عصبی سمپاتیک، سیستم رنین-آنژیوتانسین-آلدوسترون و دیورتیک‌های ناتری است؛ هر سه در این فصل بررسی می‌شوند.',
  'نوار قلب الکتروکاردیوگرام، فعالیت الکتریکی قلب را در صفات مختلف نشان می‌دهد. موج P دپولاریزاسیون دهلیزی، کمپلکس QRS دپولاریزاسیون بطنی و موج T رپولاریزاسیون بطنی را نمایش می‌دهد.',
  'آریتمی‌ها به دو دستهٔ تندضربان و کندضربان تقسیم می‌شوند. فیبریلاسیون دهلیزی شایع‌ترین آریتمی درمان‌پذیر بالینی است و خطر سکتهٔ مغزی آن با داروهای ضدانعقاد کاهش می‌یابد.',
  'توصیهٔ می‌کنیم پیش از امتحان، کادرهای «نکتهٔ مهم» و «مثال بالینی» این جزوه را مرور کنید؛ پرسش‌های پایان فصل نیز بر همین مفاهیم تأکید دارند. موفق باشید!',
];

function para(i) {
  return P(LOREM_FA[i % LOREM_FA.length]);
}
function longParas(n, salt = '') {
  return Array.from({ length: n }, (_, i) => P(`${LOREM_FA[(i * 3 + salt.length) % LOREM_FA.length]}${salt ? ' ' + salt : ''} (بند ${i + 1})`));
}

const pageBreak = (kind, auto) => {
  const attrs = {};
  if (kind) attrs.kind = kind;
  if (auto) attrs.auto = true;
  return Object.keys(attrs).length ? { type: 'pageBreak', attrs } : { type: 'pageBreak' };
};

/* ── build a 10-page document exercising the site's node types ────── */
function buildBookletDoc() {
  const pages = [];

  /* صفحه ۱ — قاب‌دار: تیتر + معرفی + لیست نامرتب */
  pages.push({
    kind: 'framed',
    blocks: [
      { type: 'heading', attrs: { level: 1, textAlign: 'center' }, content: [{ type: 'text', text: 'جزوهٔ فیزیولوژی پایه — دورهٔ مقدماتی' }] },
      P('فهرست مطالب: فصل اول: مبانی سلولی، فصل دوم: فیزیولوژی غشا، فصل سوم: سیستم قلبی-عروقی، فصل چهارم: تنظیم عصبی، فصل پنجم: مرور نهایی و پرسش‌های تشخیصی.'),
      { type: 'bulletList', content: [
        { type: 'listItem', content: [P('هدف کلی: درک مکانیسم‌های پایهٔ تنظیم محیط درونی بدن')] },
        { type: 'listItem', content: [P('پیش‌نیاز: آشنایی مقدماتی با اصطلاحات آناتومی')] },
        { type: 'listItem', content: [P('منابع کمکی: اسلایدهای کلاس و پرسش‌های پایان فصل')] },
      ] },
      ...longParas(2, 'مقدمه'),
    ],
  });

  /* صفحه ۲ — نوت‌بوکی: تیتر + بندهای بلند (خط مرزی صفحه را پودر می‌کند) */
  pages.push({
    kind: 'notebook',
    blocks: [
      H(2, 'فصل اول: مبانی سلولی'),
      ...longParas(4, 'سلول'),
      { type: 'blockquote', content: [P('«هر فرایند زیستی، در نهایت یک فرایند فیزیکوشیمیایی است.» — لویی پاستور')] },
    ],
  });

  /* صفحه ۳ — بلنک: لیست مرتب بلند (تقسیم آیتم‌محور + پیوستگی شماره‌گذاری) */
  pages.push({
    kind: 'blank',
    blocks: [
      H(2, 'گام‌های متابولیزم هوازی (مرتب — حدود ۱۲ آیتم)'),
      { type: 'orderedList', content: [
        'گلیکولیز در سیتوپلاسم و تولید پیرووات',
        'تبدیل پیرووات به استیل‌کوآ در ماتریکس میتوکندری',
        'چرخهٔ کربس و تولید NADH و FADH2',
        'انتقال الکترون در زنجیرهٔ تنفسی',
        'سنتز ATP با ATP سنتاز',
        'مصرف اکسیژن نهایی به‌عنوان پذیرندهٔ الکترون',
        'تولید دی‌اکسید کربن و آب به‌عنوان فراوردهٔ نهایی',
        'تنظیم هورمونی با انسولین و گلوکاگون',
        'نقش کبد در نگهداری ذخیرهٔ گلیکوژن',
        'تبدیل اسیدهای چرب به استیل‌کوآ (بتا-اکسیداسیون)',
        'تشکیل اجسام کتونی در ناشتایی طولانی',
        'بازخورد منفی ATP بر سرعت چرخهٔ کربس',
      ].map((t) => ({ type: 'listItem', content: [P(t)] })) },
      ...longParas(2, 'متابولیزم'),
    ],
  });

  /* صفحه ۴ — قاب‌دار: جدول سرستون‌دار (تکرار هدر در صفحهٔ بعد) */
  pages.push({
    kind: 'framed',
    blocks: [
      H(2, 'فصل دوم: جدول مقایسهٔ غشاها'),
      { type: 'paragraph', content: [{ type: 'text', text: 'جدول زیر ویژگی‌های انتقال غشایی را مقایسه می‌کند (در نمای چاپی سرستون در ادامهٔ صفحه تکرار می‌شود):' }] },
      { type: 'table', content: [
        { type: 'tableRow', content: [
          { type: 'tableHeader', attrs: { colspan: 1, rowspan: 1, colwidth: [180] }, content: [P('سازوکار')] },
          { type: 'tableHeader', attrs: { colspan: 1, rowspan: 1, colwidth: [150] }, content: [P('انرژی')] },
          { type: 'tableHeader', attrs: { colspan: 1, rowspan: 1, colwidth: [150] }, content: [P('مثال')] },
        ] },
        { type: 'tableRow', content: [ { type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [P('نفوذ ساده')] }, { type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [P('نیاز ندارد')] }, { type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [P('اکسیژن')] } ] },
        { type: 'tableRow', content: [ { type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [P('انتشار تسهیل‌شده')] }, { type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [P('نیاز ندارد')] }, { type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [P('گلوکز')] } ] },
        { type: 'tableRow', content: [ { type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [P('پمپ سدیم-پتاسیم')] }, { type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [P('ATP')] }, { type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [P('۳Na+ بیرون / ۲K+ درون')] } ] },
        { type: 'tableRow', content: [ { type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [P('اندوسیتوز')] }, { type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [P('ATP')] }, { type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [P('LDL')] } ] },
        { type: 'tableRow', content: [ { type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [P('کانال‌های یونی')] }, { type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [P('گرادیان')] }, { type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [P('Na+ در گره سینوسی')] } ] },
        { type: 'tableRow', content: [ { type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [P('ضدحمل')] }, { type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [P('گرادیان')] }, { type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [P('NCX قلب')] } ] },
        { type: 'tableRow', content: [ { type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [P('هم‌حمل')] }, { type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [P('گرادیان')] }, { type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [P('SGLT1 روده')] } ] },
        { type: 'tableRow', content: [ { type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [P('اکسوسیتوز')] }, { type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [P('ATP')] }, { type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [P('انتقال نوروترانسمیتر')] } ] },
      ] },
      ...longParas(1, 'جدول'),
    ],
  });

  /* صفحه ۵ — قاب‌دار: کادرهای آموزشی (جریان container) */
  pages.push({
    kind: 'framed',
    blocks: [
      H(2, 'کادرهای آموزشی — مفاهیم کلیدی'),
      { type: 'calloutBlock', attrs: { title: 'نکتهٔ مهم' }, content: longParas(3, 'کادر نکته') },
      { type: 'questionBlock', attrs: { question: 'چرا پمپ سدیم-پتاسیم «الکترروژنیک» است؟' }, content: [P('زیرا به‌ازای هر چرخه، بار مثبت خالص را از سلول خارج می‌کند: ۳ یون سدیم بیرون و ۲ یون پتاسیم درون. این اختلاف بار، سهم مستقیمی در پتانسیل غشایی دارد.')] },
      { type: 'exampleBlock', attrs: { title: 'مثال بالینی' }, content: longParas(2, 'مثال') },
    ],
  });

  /* صفحه ۶ — بلنک: پاراگراف خیلی بلند (برش خطی + جفت‌های بیوه/اورفن) */
  pages.push({
    kind: 'blank',
    blocks: [
      H(2, 'مطالعهٔ موردی: هیپوناترمی'),
      P('بیمار ۶۵ ساله با سابقهٔ مصرف دیورتیک تیازیدی، با سردرد و گیجی مراجعه کرده است. سدیم سرم ۱۲۰ میلی‌اکی‌والان بر لیتر گزارش شده است. ارزیابی اولیه شامل بررسی حجم داخل عروقی، اسمولالیته ادرار و سدیم ادرار است. درمان هیپوناترمی مزمن باید آهسته باشد؛ تصحیح سریع‌تر از ۸ تا ۱۰ میلی‌اکی‌والان در ۲۴ ساعت خطر سندرم دمیلیناسیون اسموتیک را به‌دنبال دارد. در ادامه، محدودیت مایعات در موارد هیپوولمیک توصیه نمی‌شود و لازم است بر اساس طبقه‌بندی حجمی، محلول سالین ایزوتونیک یا هیپرتونیک انتخاب شود. پایش روزانه سدیم سرم و علائم عصبی الزامی است و پس از پایدار شدن بیمار، اصلاح رژیم دارویی و آموزش بیمار برای پیشگیری از عود انجام می‌گیرد. ' + LOREM_FA[5] + ' ' + LOREM_FA[2] + ' ' + LOREM_FA[6]),
      ...longParas(2, 'مورد'),
    ],
  });

  /* صفحه ۷ — نوت‌بوکی: نقل‌قول + پاراگراف‌ها (سرریز به صفحهٔ ۸) */
  pages.push({
    kind: 'notebook',
    blocks: [
      H(2, 'فصل سوم: قلب و عروق'),
      { type: 'blockquote', content: [P('«قلب پمپ نیست؛ یک عضو حس‌گر است که پمپ می‌شود.» — استاد سعید نظری')] },
      ...longParas(4, 'قلب'),
    ],
  });

  /* صفحه ۸ — قاب‌دار: لیست مرتب دوم (پیوستگی شماره‌گذاری بعد از سرریز) */
  pages.push({
    kind: 'framed',
    blocks: [
      H(2, 'مراحل هدایت الکتریکی قلب (مرتب)'),
      { type: 'orderedList', content: [
        'تولید تکانه در گره سینوسی-دهلیزی',
        'انتشار در دهلیزها و انقباض آن‌ها',
        'تأخیر فیزیولوژیک در گره دهلیزی-بطری',
        'هدایت سریع در باندل هیس',
        'تفکیک به شاخه‌های راست و چپ',
        'پورکینژه و دپولاریزاسیون بطنی',
        'ریپولاریزاسیون و آماده‌سازی برای چرخهٔ بعد',
      ].map((t) => ({ type: 'listItem', content: [P(t)] })) },
      ...longParas(3, 'هدایت'),
    ],
  });

  /* صفحه ۹ — بلنک: محتوای سبک + صفحه‌شکن دستی (مرز سخت) */
  pages.push({
    kind: 'blank',
    blocks: [
      H(2, 'خلاصهٔ فصل‌ها'),
      P('این بخش به‌صورت عمدی کوتاه است و پس از آن یک «صفحه جدید» دستی درج شده تا مرز سخت (manual pageBreak) تست شود.'),
      { type: 'pageBreak' },
      P('این پاراگراف باید دقیقاً در صفحهٔ بعد از مرز دستی ظاهر شود، نه روی همان صفحه.'),
    ],
  });

  /* صفحه ۱۰ — قاب‌دار: جمع‌بندی */
  pages.push({
    kind: 'framed',
    blocks: [
      H(2, 'جمع‌بندی و پرسش‌های مرور'),
      ...longParas(2, 'جمع‌بندی'),
      { type: 'bulletList', content: [
        { type: 'listItem', content: [P('همئوستاز پایهٔ همهٔ تنظیم‌های فیزیولوژیک است')] },
        { type: 'listItem', content: [P('پتانسیل غشایی از تعادل گرادیان‌های یونی برمی‌آید')] },
        { type: 'listItem', content: [P('برون‌ده قلبی حاصل ضرب ضربان در حجم ضربه‌ای است')] },
      ] },
      P('پرسش ۱: تفاوت بازخورد مثبت و منفی را با مثال توضیح دهید.'),
      P('پرسش ۲: نقش میتوکندری در متابولیزم هوازی چیست؟'),
      P('پرسش ۳: چرا تصحیح سریع هیپوناترمی خطرناک است؟'),
    ],
  });

  /* merge pages → stored format: pageBreak nodes between pages, first
     page's kind in doc attrs.pageKind */
  const blocks = [];
  pages.forEach((pg, i) => {
    if (i > 0) blocks.push(pageBreak(pg.kind));
    blocks.push(...pg.blocks);
  });
  const doc = { type: 'doc', content: blocks };
  if (pages[0].kind !== 'framed') doc.attrs = { pageKind: pages[0].kind };
  return doc;
}

/* ── checks ───────────────────────────────────────────────────────── */
function checkBooklet(doc) {
  const blocks = doc.content ?? [];
  const breaks = blocks.filter((b) => b?.type === 'pageBreak');
  /* stored format invariants:
     • every pageBreak sits at TOP level (never nested)
     • each break carries the kind of the page it OPENS (or nothing for
       the manual hard-break) — the client's splitDocIntoPages reads it */
  let manualBreaks = 0;
  const kindSeq = ['framed']; // first page's kind = doc attrs (framed here)
  for (const b of breaks) {
    const k = b.attrs?.kind;
    if (k) kindSeq.push(k);
    else if (b.attrs?.auto) kindSeq.push('auto');
    else manualBreaks++;
  }
  const okKinds =
    kindSeq.every((k) => ['framed', 'blank', 'notebook', 'auto'].includes(k)) &&
    manualBreaks === 1 &&
    breaks.length === 10; // 9 page boundaries + 1 inline manual break
  const lists = blocks.filter((b) => b?.type === 'orderedList');
  const listStarts = lists.map((l) => l.attrs?.start ?? 1);
  const inlineBreaks = blocks.some((b) => Array.isArray(b?.content) && b.content.some((c) => c?.type === 'pageBreak'));
  return { blocks: blocks.length, breaks: breaks.length, pages: breaks.length + 1, manualBreaks, okKinds, listStarts, inlineBreaks };
}

/* ── main ─────────────────────────────────────────────────────────── */
async function main() {
  console.log(`[seed-booklet] server: ${BASE}  user: ${EMAIL}`);
  const health = await api('/health');
  if (!health.ok) throw new Error('server /health not ok');
  console.log('[seed-booklet] health ok');

  let token;
  try {
    ({ token } = await api('/auth/login', { method: 'POST', body: { email: 'demo@pernote.local', password: 'demo1234' } }));
    console.log('[seed-booklet] logged in as demo@pernote.local');
  } catch {
    await api('/auth/register', { method: 'POST', body: { name: 'QA Booklet', email: EMAIL, password: 'qa123456' } });
    ({ token } = await api('/auth/login', { method: 'POST', body: { email: EMAIL, password: 'qa123456' } }));
    console.log(`[seed-booklet] registered new user ${EMAIL}`);
  }

  const doc = buildBookletDoc();
  const audit = checkBooklet(doc);
  console.log('[seed-booklet] built doc:', JSON.stringify(audit));
  if (!audit.okKinds) throw new Error('page kinds sequence mismatch — check the builder');

  const { note } = await api('/notes', { method: 'POST', token, body: {
    title: 'جزوهٔ ده‌صفحه‌ای فیزیولوژی (QA)',
    chapter: 'فصل ۱ تا ۵',
    content: doc,
    html: '<p>(QA booklet — rendered on the client)</p>',
    plainText: 'جزوهٔ ده‌صفحه‌ای فیزیولوژی (QA)',
  } });
  console.log(`[seed-booklet] created note ${note._id}`);
  console.log(`[seed-booklet] open in editor: ${BASE.replace(':4000', ':5173')}/editor/${note._id}`);

  await sleep(500);
  const { note: reloaded } = await api(`/notes/${note._id}`, { token });
  const persisted = reloaded.content?.type === 'doc';
  console.log(`[seed-booklet] reload ok=${persisted} updatedAt=${reloaded.updatedAt}`);
  if (!persisted) throw new Error('persisted content is not a TipTap doc');
  console.log('[seed-booklet] DONE ✅');
}

main().catch((err) => {
  console.error('[seed-booklet] FAILED:', err.message);
  process.exit(1);
});
