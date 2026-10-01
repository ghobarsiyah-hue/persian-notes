/* build-guide-note.mjs — تولید «راهنمای کامل پرشین‌نوت» — یک جزوه ۵۰ صفحه‌ای
   که خودِ سایت را با امکانات خودِ سایت معرفی می‌کند: هر صفحه از بلوک‌های
   بومی (کادر آموزشی، سوال، جدول، مقایسه، زمان‌خط، فرمول، آیکون درون‌متنی،
   انواع صفحه) استفاده می‌کند. اجرا: node scripts/build-guide-note.mjs  */
import { readFileSync } from 'node:fs';

const API = process.env.PN_API ?? 'http://127.0.0.1:4000/api';
const EMAIL = process.env.PN_EMAIL ?? 'demo@pernote.local';
const PASS = process.env.PN_PASS ?? 'demo1234';

const icons = JSON.parse(readFileSync('/tmp/icons.json', 'utf8'));
const ic = (n) => icons[n] ?? icons['star'];
/* real equation ASTs — pre-parsed with the site's own parseMath (see
   scripts note in HANDOFF); keyed by the LaTeX source */
const ASTS = JSON.parse(readFileSync(new URL('../tmp-asts.json', import.meta.url), 'utf8').toString());

/* ── small builders (TipTap JSON) ─────────────────────────────────────── */
const p = (text, opts = {}) => ({
  type: 'paragraph',
  attrs: { textAlign: opts.align ?? null, indent: opts.indent ?? 0 },
  content: text ? (Array.isArray(text) ? text : [{ type: 'text', text }]) : undefined,
});
const t = (text, marks) => (marks ? { type: 'text', text, marks } : { type: 'text', text });
const bold = (text) => t(text, [{ type: 'bold' }]);
const H = (level, text) => ({
  type: 'heading', attrs: { level, textAlign: null, indent: 0 },
  /* text may be a string OR an array of inline nodes (text/inlineIcon) —
     interpolating a node object into a template string produced the classic
     "[object Object]" text bug; keep nodes as nodes. */
  content: Array.isArray(text)
    ? text
    : [{ type: 'text', text }],
});
const bullet = (items, marker = '') => ({
  type: 'bulletList',
  attrs: { marker, textAlign: null },
  content: items.map((i) => ({ type: 'listItem', content: [p(i)] })),
});
const numbered = (items) => ({
  type: 'orderedList',
  attrs: { textAlign: null },
  content: items.map((i) => ({ type: 'listItem', content: [p(i)] })),
});
const quote = (text) => ({ type: 'blockquote', content: [p(text)] });
const hr = () => ({ type: 'horizontalRule' });
const iconInline = (name) => ({ type: 'inlineIcon', attrs: { src: ic(name), alt: name, title: name } });
const task = (checked, text) => ({
  type: 'paragraph',
  attrs: { textAlign: null, indent: 0 },
  content: [{ type: 'text', text: `${checked ? '☑' : '☐'} ${text}` }],
});

/* callout families: definition/important/exam/warning/summary/comparison/timeline/footnote/longanswer/highlight/reference/procon */
const callout = (kind, title, children) => ({
  type: 'calloutBlock',
  attrs: { kind, title },
  content: children,
});
const example = (title, children) => ({ type: 'exampleBlock', attrs: { title }, content: children });
const keyterm = (term, children) => ({ type: 'keyTermBlock', attrs: { term }, content: children });
const highlight = (title, children) => ({ type: 'highlightBox', attrs: { title }, content: children });
const reference = (title, children) => ({ type: 'referenceBlock', attrs: { title }, content: children });
const timeline = (title, children) => ({ type: 'timeline', attrs: { title }, content: children });
const comparison = (leftLabel, rightLabel, leftRows, rightRows) => ({
  type: 'comparisonTable',
  attrs: { leftLabel, rightLabel },
  content: [{
    type: 'paragraph',
    attrs: { textAlign: null, indent: 0 },
    content: [{ type: 'text', text: `${leftRows} ||| ${rightRows}` }],
  }],
});
const procon = (topic, pro, con) => ({
  type: 'proConBlock',
  attrs: { topic, proText: pro, conText: con },
  content: [p()],
});
const footnote = (label, children) => ({ type: 'footnoteBlock', attrs: { label }, content: children });
const codeOutput = (label, code, out) => ({
  type: 'codeOutputBlock',
  attrs: { lang: 'bash', label, codeText: code, outText: out },
  content: [p()],
});
const formula = (latex) => ({ type: 'formulaBlock', content: [{ type: 'text', text: latex }] });
const equation = (latex, align = 'center') => ({
  type: 'equation',
  attrs: { ast: parseMathSafe(latex), display: true, mode: 'professional', align, numbered: false, color: null },
});
const equationInline = (latex) => ({
  type: 'equationInline',
  attrs: { ast: parseMathSafe(latex), display: false, mode: 'professional', align: null, numbered: false, color: null },
});
function parseMathSafe(latex) {
  /* real ASTs pre-parsed by the site's own parser — a placeholder [{ph}]
     rendered as an empty math box (□) which looked broken in the guide */
  return ASTS[latex] ?? [{ type: 'ph' }];
}

/* question families */
const shortQ = (question, opts = {}) => ({
  type: 'questionBlock',
  attrs: {
    question, answerText: opts.answer ?? '', points: opts.points ?? 0,
    qVariant: opts.v ?? 'v1', showAnswer: opts.show ?? true, answerAt: opts.answerAt ?? 'mark',
    qAccent: '', qChip: opts.chip ?? '', qGap: opts.gap ?? '',
    styleBg: '', styleBorder: '', styleBorderWidth: -1, styleBorderStyle: '', styleRadius: -1, styleTitle: '',
  },
  content: [p()],
});
const longQ = (question, opts = {}) => ({
  type: 'longAnswerBlock',
  attrs: {
    question, answerText: opts.answer ?? '', points: opts.points ?? 0,
    qVariant: opts.v ?? 'v1', showAnswer: opts.show ?? true, answerAt: opts.answerAt ?? 'mark',
    qAccent: '', qChip: '', qGap: opts.gap ?? '',
    styleBg: '', styleBorder: '', styleBorderWidth: -1, styleBorderStyle: '', styleRadius: -1, styleTitle: '',
  },
  content: opts.body ? [p(opts.body)] : [p()],
});
const tfQ = (question, answer, opts = {}) => ({
  type: 'trueFalseBlock',
  attrs: {
    question, answer, points: opts.points ?? 0,
    qVariant: opts.v ?? 'v1', showAnswer: opts.show ?? true, answerAt: opts.answerAt ?? 'mark',
    qAccent: '', qChip: '', qGap: opts.gap ?? '',
    styleBg: '', styleBorder: '', styleBorderWidth: -1, styleBorderStyle: '', styleRadius: -1, styleTitle: '',
  },
  content: [p()],
});
const mcqQ = (qTitle, options, correct, opts = {}) => ({
  type: 'mcqBlock',
  attrs: {
    qTitle, options: [...options, '', '', '', ''].slice(0, 4), correct,
    layout: opts.layout ?? 'stacked', points: opts.points ?? 0,
    qVariant: opts.v ?? 'v1', showAnswer: opts.show ?? true, answerAt: opts.answerAt ?? 'mark',
    qAccent: '', qChip: opts.chip ?? '', qGap: opts.gap ?? '',
    styleBg: '', styleBorder: '', styleBorderWidth: -1, styleBorderStyle: '', styleRadius: -1, styleTitle: '',
  },
  content: [p()],
});

/* the real TipTap table shape (prosemirror-tables): table > tableRow > (tableParagraph cells) */
const CELL_PAD = { textAlign: null, indent: 0 };
const cell = (children, header = false) => ({
  type: header ? 'tableHeader' : 'tableCell',
  attrs: { colspan: 1, rowspan: 1, colwidth: null },
  content: children,
});
const row = (cells) => ({ type: 'tableRow', content: cells });
const table = (headerCells, dataRows, opts = {}) => ({
  type: 'table',
  attrs: {
    striped: opts.striped ?? true, borderless: false, align: null,
    width: null, cellpad: null, tstyle: opts.tstyle ?? null, gridColor: null,
  },
  content: [row(headerCells.map((h) => cell([p(h)], true))), ...dataRows.map((r) => row(r.map((c) => cell([p(c)]))))],
});

const pageBreak = (kind = 'framed', pid) => ({
  type: 'pageBreak',
  attrs: { kind, auto: false, pid, cover: null },
});

/* ── page assembly ────────────────────────────────────────────────────── */
const pages = [];
let pageNo = 0;
/** each page: title paragraph pattern + body blocks; page 1 rides the doc attrs */
function page(blocks, kind = 'framed') {
  pageNo += 1;
  pages.push({ blocks, kind, no: pageNo });
}

const PH = 'پرشین‌نوت';

/* ── فصل ۱: آشنایی (ص ۳–۸) ── */
page([
  H(2, [iconInline('rocket'), t(' خوش آمدید — این جزوه، خودِ سایت است')]),
  p('این جزوه ۵۰ صفحه‌ای با «پرشین‌نوت» نوشته شده و همه‌چیزِ درونش — از کادرهای رنگی و سوالات تا جدول‌ها و فرمول‌ها — با امکانات خودِ ویرایشگر ساخته شده است. یعنی هر چه می‌بینید، همین حالا می‌توانید بسازید.'),
  callout('definition', 'پرشین‌نوت چیست؟', [
    p('پرشین‌نوت یک دفترچه‌ی جزوه‌نویسی فارسی، راست‌به‌چپ و مخصوص دانش‌آموزان و دانشجویان است: صفحه‌های A4 واقعی، قالب‌های آماده، کادرهای آموزشی، بانک سوال، هم‌نویسی گروهی و خروجی PDF و Word کاملاً هم‌سان با ادیت‌پیج.'),
  ]),
  keyterm('واژه‌نامه سریع', [
    bullet([
      'ادیت‌پیج: همان چیزی که موقع نوشتن می‌بینید.',
      'پیش‌نمایش: بازنمایی دقیق خروجی قبل از چاپ.',
      'پنل چپ‌باز: هر تنظیماتی به‌صورت پنل از سمت چپ باز می‌شود (مثل همین راهنما).',
    ]),
  ]),
  highlight('این جزوه چطور خوانده شود؟', [
    p('فصل‌ها با تیتر بنفش شروع می‌شوند؛ هر قابلیت یک کادر آموزشی دارد و انتهای هر فصل چند سوال مرور است — همان‌طور که برای جزوه‌ی درسی هم جزوه می‌نویسید.'),
  ]),
], 'framed');

page([
  H(2, 'نقشه‌ی کلی سایت'),
  p('پس از ورود، ستون سمت راست سایت مسیر شماست:'),
  numbered([
    'داشبورد — خلاصه‌ی روز: ادامه‌ی ویرایش‌های اخیر، علاقه‌مندی‌ها و سطل زباله.',
    'جزوه‌های من — گالری جزوه‌ها با پیش‌نمایش زنده‌ی صفحه‌ی اول روی هر کارت.',
    'جزوه‌نویسی — ورود مستقیم به ویرایشگر صفحه‌بندی‌شده.',
    'موضوعات — دسته‌بندی درسی (فیزیک، شیمی، …) با رنگ اختصاصی.',
    'گروه‌های من — جزوه‌نویسی گروهی و مدیریت اعضا.',
    'فروشگاه — قالب‌های آماده برای شروع سریع.',
    'سطل زباله — بازیابی یا حذف همیشگی.',
    'تنظیمات — ظاهر، ویرایشگر، قاب صفحه و حساب.',
  ]),
  callout('important', 'پیش‌نمایش کارت‌ها', [
    p('هر کارت جزوه در «جزوه‌های من» یک تصویر کوچک زنده از صفحه‌ی اول دارد — همان چیزی که موقع چاپ می‌بینید، بدون باز کردن جزوه.'),
  ]),
  table(
    ['بخش', 'چه کاری انجام می‌دهد؟'],
    [
      ['داشبورد', 'دسترسی سریع به آخرین ویرایش‌ها و علاقه‌مندی‌ها'],
      ['جزوه‌های من', 'فیلتر بر اساس موضوع، جست‌وجوی سریع، شخصی‌سازی هر جزوه'],
      ['فروشگاه', 'کلون یک‌کلیکی قالب‌های آماده به فهرست شخصی شما'],
    ],
  ),
], 'framed');

page([
  H(2, 'حساب و امنیت'),
  p('ثبت‌نام با ایمیل و رمز انجام می‌شود و نشست شما امن نگه داشته می‌شود. اگر نشست منقضی شود، داده‌ها از دست نمی‌روند — دوباره وارد شوید و ادامه دهید.'),
  callout('warning', 'نشست منقضی شد؟', [
    p('اگر پیام «نشست شما منقضی شد» دیدید فقط دوباره وارد شوید؛ ویرایش‌های ذخیره‌شده محفوظ‌اند. نسخه‌های پیشین هر جزوه هم در تاریخچه نگه داشته می‌شود.'),
  ]),
  callout('exam', 'نکته‌ی امنیتی', [
    p('رمز قوی انتخاب کنید و از اشتراک‌گذاری حساب خودداری کنید. در آینده: ورود دو مرحله‌ای و مدیریت نشست‌های فعال.'),
  ]),
  tfQ('داده‌های جزوه بعد از انقضای نشست پاک می‌شوند.', 'false', { points: 1, v: 'v2' }),
], 'framed');

page([
  H(2, 'ویرایشگر: صفحه‌های A4 واقعی'),
  p('ویرایشگر پرشین‌نوت مثل Word واقعی صفحه‌بندی شده: هر صفحه دقیقاً ۲۱×۲۹٫۷ سانتی‌متر است و همان چیزی که می‌بینید، همان چیزی است که چاپ می‌شود — بدون «غافلگیری» در خروجی.'),
  callout('definition', 'موتور جریان خودکار', [
    p('وقتی متن از صفحه پر شود، به‌صورت خودکار به صفحه‌ی بعد سرریز می‌شود و صفحه‌ی خالی اضافی پاک می‌گردد. نگران تقسیم متن نباشید؛ فقط بنویسید.'),
  ]),
  example('شروع سریع', [
    numbered([
      'از «جزوه‌نویسی» یک جزوه‌ی خالی بسازید.',
      'قالب صفحه را از تب «طراحی» انتخاب کنید (قاب‌دار، خیلی سبز، نوت‌بوکی…).',
      'بنویسید؛ سرریز صفحات خودکار انجام می‌شود.',
      'Ctrl+S برای ذخیره — یا اجازه دهید ذخیره‌ی خودکار کار کند.',
    ]),
  ]),
  reference('میان‌برهای کاربردی', [
    bullet([
      'Ctrl+S — ذخیره‌ی دستی',
      'Ctrl+Z / Ctrl+Shift+Z — برگردان/بازگردانی',
      'Ctrl+Shift+F — حالت تمرکز',
    ]),
  ]),
], 'framed');

page([
  H(2, 'متن: تایپوگرافی فارسی'),
  p('ادیتور با فونت‌های فارسی آماده کار می‌کند: ساحل، صاحل، شبنم، دست‌نویس، سامیم، تنها، گندم، پرستو، لاله‌زار… فونت، اندازه و ارتفاع خط را از تب «متن» تنظیم کنید.'),
  p([
    t('مثال درون‌خطی: فرمول معروف دلتا '),
    equationInline('Delta = b^2 - 4ac'),
    t(' در همین خط، درون متن است — نه در خط جدا.'),
  ]),
  callout('summary', 'تنظیمات سند', [
    p('اندازه‌ی فونت و ارتفاع خط کل سند از تنظیمات اعمال می‌شود و خروجی PDF دقیقاً همان را بازتولید می‌کند (نه نسخه‌ی «حدودی»).'),
  ]),
  formula('int_0^infty e^{-x} dx = 1'),
  p('کادر بالا یک «فرمول» است — لاتک خام درون کادر زرد که در خروجی به فرم تایپ‌شده تبدیل می‌شود.'),
], 'framed');

page([
  H(2, 'فهرست‌ها و نشانگرها'),
  p('لیست گلوله‌ای و شماره‌دار با نشانگرهای متنوع: دایره، مربع، خط‌تیره، اعداد فارسی و… . نشانگر از منوی راست‌کلیک روی خود لیست عوض می‌شود.'),
  bullet([
    'نشانگر دایره‌ای — برای ویژگی‌ها',
    'نشانگر مربعی — برای چک‌لیست',
  ], 'square'),
  numbered([
    'مرحله‌ی اول',
    'مرحله‌ی دوم — شماره‌ها خودکار ادامه می‌یابند',
  ]),
  task(true, 'تسلط بر لیست‌ها'),
  task(false, 'ساخت چک‌لیست مطالعه'),
], 'framed');

page([
  H(2, 'کادرهای آموزشی — ۱۲ خانواده'),
  p('هسته‌ی جزوه‌نویسی درسی کادرها هستند. هر کدام رنگ، آیکون و رفتار خودش را دارد:'),
  table(
    ['کادر', 'کاربرد'],
    [
      ['تعریف (آبی)', 'مفاهیم پایه'],
      ['نکته‌ی مهم (کهربایی)', 'نکاتی که سوال می‌شوند'],
      ['نکته‌ی امتحانی (فیروزه‌ای)', 'هشدارهای امتحان'],
      ['توجه (سرخ)', 'خطاهای رایج'],
      ['خلاصه (آبی)', 'چکیده‌ی پایان بخش'],
    ],
  ),
  callout('definition', 'تعریف — نمونه‌ی زنده', [
    p('این یک کادر «تعریف» واقعی است؛ همان‌طور که در خروجی PDF هم دیده می‌شود.'),
  ]),
  callout('important', 'نکته‌ی مهم — نمونه‌ی زنده', [
    p('کادرها هر سه خروجی (ادیتور، PDF، Word) را یکسان نگه می‌دارند.'),
  ]),
  callout('warning', 'توجه — نمونه‌ی زنده', [
    p('از این کادر برای هشدارها و اشتباه‌های رایج استفاده کنید.'),
  ]),
], 'framed');

page([
  H(2, 'کادرها — ادامه‌ی خانواده‌ها'),
  callout('exam', 'نکته‌ی امتحانی — نمونه', [
    p('مثلاً: «در آزمون، واحد جواب را چک کنید.»'),
  ]),
  callout('summary', 'خلاصه — نمونه', [
    p('جمع‌بندی سه‌خطیِ پایان هر فصل عالی جواب می‌دهد.'),
  ]),
  example('مثال حل‌شده', [
    p('هر «مثال» می‌تواند چند پاراگراف، لیست و حتی فرمول داشته باشد.'),
    p([
      t('مساحت دایره: '),
      equationInline('A = pi r^2'),
    ]),
  ]),
  keyterm('اصطلاح کلیدی', [
    p('واژه‌های فنی را با این کادر برجسته کنید؛ مرور شب امتحان سریع می‌شود.'),
  ]),
], 'framed');

page([
  H(2, 'کادرهای پیشرفته'),
  highlight('جعبه‌ی برجسته', [
    p('برای مهم‌ترین جمله‌ی صفحه — دیدنی‌ترین کادر.'),
  ]),
  reference('منبع', [
    p('ارجاع کتاب/مقاله با قالب آکادمیک.'),
  ]),
  footnote('پاورقی', [
    p('یادداشت حاشیه‌ای کوتاه، با حاشیه‌ی نقطه‌چین.'),
  ]),
  timeline('زمان‌خط — تاریخچه‌ی نسخه‌ها', [
    p('۰٫۹ — پنل‌های چپ‌باز، بانک سوال، جلد و فهرست'),
    p('۰٫۸ — قالب «خیلی سبز»، جدول‌های طراحی‌شده'),
    p('۰٫۷ — هم‌نویسی گروهی و پیش‌نمایش زنده'),
  ]),
], 'framed');

page([
  H(2, 'مقایسه و موافق/مخالف'),
  comparison('PDF سایت', 'چاپ مرورگر', 'صفحه‌بندی دقیق A4', 'وابسته به تنظیمات چاپ'),
  p('کادر «مقایسه» دو ستون با سرستون رنگی می‌سازد — برای تقابل دو مفهوم.'),
  procon('جزوه‌نویسی دیجیتال', 'جست‌وجو، پشتیبان، چندرسانه‌ای', 'نیاز به تمرین ابزار'),
  p('کادر «موافق/مخالف» دو ستون سبز/سرخ با برچسب — برای بحث‌های دو طرفه.'),
  callout('important', 'کدام را کجا؟', [
    bullet([
      'مقایسه: دو مفهوم هم‌جنس (دوران‌ها، تئوری‌ها)',
      'موافق/مخالف: یک موضوع با دو دیدگاه',
    ]),
  ]),
], 'framed');

page([
  H(2, 'کد و خروجی — برای درس‌های برنامه‌نویسی'),
  codeOutput(
    'نصب سریع پروژه',
    'git clone <repo>\ncd persian-notes\nnpm install\nnpm run dev',
    'سایت روی http://localhost:5199 بالا می‌آید',
  ),
  p('کادر «کد و خروجی» دو بخش دارد: کد (چپ‌چین) و «خروجی مورد انتظار» — برای آموزش برنامه‌نویسی یا دستورهای ترمینال.'),
], 'framed');

page([
  H(2, 'جدول‌های طراحی‌شده'),
  p('جدول‌ها قالب‌های آماده دارند و می‌توانید خطوط، رنگ سرستون، زبر شدن ردیف‌ها و شعاع گوشه‌ها را تنظیم کنید — همه‌ی این‌ها در PDF هم حفظ می‌شود.'),
  table(
    ['قالب صفحه', 'مناسب برای'],
    [
      ['قاب‌دار (کلاسیک)', 'جزوه‌ی رسمی درسی'],
      ['خیلی سبز (جزوه‌ای)', 'نوشتن روزمره با سربرگ فصل'],
      ['نوت‌بوکی', 'ریاضی و رسم — با خطوط دفتری'],
      ['ساده (بلنک)', 'طرح و اسکیس آزاد'],
    ],
  ),
  table(
    ['ستون A', 'ستون B', 'ستون C'],
    [
      ['سلول', 'سلول زبر', 'سلول'],
      ['ردیف دوم', '—', '—'],
    ],
    { striped: true },
  ),
  callout('exam', 'نکته‌ی جدول', [
    p('عرض ستون‌ها را با کشیدن لبه بگیرید؛ همان عرض در PDF حفظ می‌شود.'),
  ]),
], 'framed');

page([
  H(2, 'فرمول و معادله‌ی ساختاریافته'),
  p('دو ابزار دارید: «فرمول» (کادر لاتک) و «معادله» (شیء ساختاریافته با ویرایشگر نمادها).'),
  equation('x = frac(-b, sqrt(b^2-4ac))'),
  p('معادله‌ی بالا یک شیء واقعی است؛ در PDF با KaTeX حرفه‌ای حروف‌چینی می‌شود و در Word به فرم بومی Word (OMML) تبدیل می‌شود.'),
  callout('important', 'تفاوت مهم', [
    bullet([
      'فرمول: سریع — لاتک بنویسید، تمام.',
      'معادله: دقیق — با پالت نمادها (√، کسر، انتگرال) بسازید.',
    ]),
  ]),
], 'framed');

page([
  H(2, 'تصاویر و اشکال شناور'),
  p('عکس را paste کنید — به‌صورت «شناور» وارد می‌شود و می‌توانید کنارش متن بنویسید. اشکال (مستطیل، دایره، فلش، ابری…) هم متن درون خودشان دارند.'),
  callout('summary', 'ویژگی‌های لایه‌ی شناور', [
    bullet([
      'چرخش، فلیپ افقی/عمودی، شعاع گوشه',
      'حاشیه با سبک خطی/نقطه‌چین/خط‌چین',
      'سایه‌ی نرم، شفافیت',
      'متن درون شکل — با فونت و تراز مستقل',
    ]),
  ]),
  example('کاربرد درسی', [
    p('فلش + کادر متن = نمودار جریان درسی؛ همه در PDF سر جای خودشان می‌نشینند.'),
  ]),
], 'framed');

page([
  H(2, 'آیکون‌های درون‌متنی'),
  p([
    iconInline('lightbulb'),
    t(' آیکون‌ها مثل یک «حرف» درون متن جریان دارند — نه بلوک جدا. از انتخاب‌گر آیکون (تب درج) بگزارید: '),
    iconInline('star'),
    t(' '),
    iconInline('check-circle'),
    t(' '),
    iconInline('rocket'),
    t(' '),
    iconInline('shield-check'),
    t(' …'),
  ]),
  callout('exam', 'نکته', [
    p('آیکون‌ها SVG برداری‌اند: در هر اندازه‌ای شفاف می‌مانند و در PDF دقیقاً چاپ می‌شوند.'),
  ]),
  bullet([
    'برای برچسب‌گذاری بخش‌ها: ' + 'آیکون + تیتر',
    'برای خط‌کشی بصری بین پاراگراف‌ها',
  ]),
], 'framed');

page([
  H(2, 'قالب‌های صفحه — کجا استفاده کنیم؟'),
  table(
    ['قالب', 'ظاهر', 'بهترین کاربرد'],
    [
      ['قاب‌دار', 'قاب تزئینی + شماره صفحه', 'جزوه‌ی رسمی'],
      ['خیلی سبز', 'سربرگ فصل + فضای باز', 'نوشتن روزمره'],
      ['نوت‌بوکی', 'خطوط دفتری + حاشیه‌ی سرخ', 'ریاضی'],
      ['بلنک', 'خالی مطلق', 'اسکیس'],
      ['جلد', 'طرح جلد + عنوان', 'صفحه‌ی اول جزوه'],
      ['فهرست', 'ردیف‌های نقطه‌چین', 'فهرست مطالب'],
    ],
  ),
  callout('important', 'سربرگ فصل', [
    p('در قالب «خیلی سبز» می‌توانید نام فصل را در شیار بالای قاب بنویسید و بازه‌ی صفحاتش را تعیین کنید — مثلاً «فصل ۲» روی صفحات ۵ تا ۱۲.'),
  ]),
], 'framed');

page([
  H(2, 'بانک سوال — چهار خانواده'),
  numbered([
    'سوال کوتاه — جمله‌ی پاسخ کوتاه + خط پاسخ اختیاری در انتها',
    'سوال تشریحی — فضای پاسخ بلند (خط‌دار در قالب‌های v2/v3)',
    'درست/نادرست — دکمه‌های انتخاب + پاسخ رنگی',
    'چهارگزینه‌ای — چهار گزینه، چیدمان زیرهم یا ۲×۲، علامت پاسخ صحیح',
  ]),
  mcqQ('ویرایشگر پرشین‌نوت چند خانواده‌ی سوال دارد؟', ['۲', '۳', '۴', '۵'], 2, { points: 1, v: 'v2', chip: 'circle' }),
  p('این خودش یک سوال چهارگزینه‌ای واقعی است — گزینه‌ی ۳ درست است و به همین شکل در PDF هم می‌نشیند.'),
], 'framed');

page([
  H(2, 'سوالات — حالت‌های نمایش پاسخ'),
  callout('definition', 'سه سیاست پاسخ', [
    bullet([
      'روی گزینه — گزینه‌ی صحیح سبز می‌شود (برای جزوه‌ی آموزشی)',
      'انتهای سوال — خط کوچک «پاسخ صحیح: …» (نمونه‌سوال؛ جواب لو نمی‌رود)',
      'بدون پاسخ — برگه‌ی کاملاً خالی (آزمون واقعی)',
    ]),
  ]),
  shortQ('واحد اندازه‌گیری نیرو چیست؟', { answer: 'نیوتون (N)', points: 0.5, v: 'v3', answerAt: 'end' }),
  tfQ('هر صفحه‌ی سایت دقیقاً A4 است.', 'true', { points: 0.5, v: 'v4', answerAt: 'end' }),
  mcqQ('خروجی «پاسخ صحیح: گزینه ۲» یعنی چه؟', ['گزینه ۲ سبز شده', 'پاسخ در انتهای سوال آمده', 'سوال بی‌پاسخ است', 'سوال حذف شده'], 1, { points: 1, v: 'v5', answerAt: 'end', chip: 'none', gap: 'wide' }),
], 'framed');

page([
  H(2, 'قالب‌های آماده‌ی سوال — ۱۲ طرح'),
  p('هر خانواده‌ی سوال ۱۲ قالب آماده دارد (خط ظریف، کارت، امتحانی، مینیمال، تیتر خط‌دار، پیل، کنتراست، کلاسیک، سری‌دار…) و یک پیش‌نمایش کوچک قبل از انتخاب.'),
  shortQ('نمونه با قالب «امتحانی» (v3)', { v: 'v3', points: 1, gap: 'wide' }),
  longQ('نمونه‌ی تشریحی با قالب «کارت» (v2)', { v: 'v2', points: 2 }),
  tfQ('نمونه درست/نادرست با قالب «پیل» (v6)', 'true', { v: 'v6', points: 0.5 }),
], 'framed');

page([
  H(2, 'شخصی‌سازی کادرها'),
  p('از راست‌کلیک روی هر کادر: «شخصی‌سازی کادر…» — رنگ پس‌زمینه، رنگ و ضخامت حاشیه، سبک خط، شعاع گوشه و رنگ تیتر، فقط برای همان کادر.'),
  callout('definition', 'با شخصی‌سازی جدا', [
    p('این کادر حاشیه‌ی بنفش نقطه‌چین و پس‌زمینه‌ی یاسی دارد.', ),
  ]),
  callout('definition', 'با تیتر رنگی سفارشی', [
    p('تیتر این کادر سبز شده — جدا از رنگ خانواده.'),
  ]),
  callout('important', 'جداسازی سوال از کادر', [
    p('شخصی‌سازی کادر روی باکس‌های سوال اعمال نمی‌شود؛ برای سوالات مودال جداگانه‌ی «شخصی‌سازی سوال» هست تا استایل باکس‌ها با امتحان قاطی نشود.'),
  ]),
], 'framed');

page([
  H(2, 'شخصی‌سازی سوال'),
  p('مودال «شخصی‌سازی سوال» برای چهار خانواده‌ی سوال: قالب ۱۲گانه، نمره، چیدمان گزینه‌ها (زیرهم/۲×۲)، رنگ اکسان، شکل شماره‌ی گزینه (دایره/مربع/حاشیه‌دار)، فاصله‌ی گزینه‌ها و جایگاه پاسخ.'),
  mcqQ('نمونه با اکسان فیروزه‌ای و چیپ مربع', ['الف', 'ب', 'ج', 'د'], 0, { v: 'v9', chip: 'square', gap: 'tight' }),
  mcqQ('نمونه‌ی ۲×۲ با چیپ دایره', ['۱', '۲', '۳', '۴'], 3, { v: 'v1', layout: 'grid', chip: 'circle' }),
  tfQ('شکل شماره‌ی گزینه روی درست/نادرست اثر دارد.', 'false', { v: 'v3' }),
], 'framed');

page([
  H(2, 'نمره‌دهی اختیاری'),
  p('نمره‌ی سوال دلخواه است: عدد بگذارید تا «(۲ نمره)» کنار صورت سوال بیاید؛ خالی بگذارید تا هیچ چیزی نوشته نشود — نه حتی «۰ نمره».'),
  shortQ('سوال با نمره‌ی ۱٫۵', { points: 1.5, v: 'v2' }),
  shortQ('سوال بدون نمره', { points: 0, v: 'v2' }),
  callout('exam', 'جمع نمره', [
    p('نمره‌ها فقط نمایشی‌اند؛ در آینده: برگه‌ی امتحانی با جمع خودکار نمره و بارم‌بندی.'),
  ]),
], 'framed');

page([
  H(2, 'ذخیره، نسخه‌ها و سطل زباله'),
  numbered([
    'ذخیره‌ی خودکار با تأخیر کوتاه؛ نشانگر وضعیت کنار آواتارها.',
    'تاریخچه‌ی نسخه‌ها — بازگشت به هر نقطه‌ی زمانی.',
    'حذف = انتقال به سطل زباله؛ بازیابی تا هر وقت خواستید.',
    'تکثیر جزوه از پنل «مدیریت جزوه» — پایه‌ای برای قالب شخصی.',
  ]),
  callout('warning', 'حذف همیشگی', [
    p('«حذف همیشگی» فقط از داخل سطل زباله و با تأیید انجام می‌شود — غیرقابل بازگشت است.'),
  ]),
], 'framed');

page([
  H(2, 'جزوه‌های من — گالری و مدیریت'),
  bullet([
    'پیش‌نمایش زنده‌ی صفحه‌ی اول روی هر کارت',
    'دکمه‌ی ⚙ برای پنل مدیریت: عنوان، موضوع، فصل، برچسب، علاقه‌مندی',
    'تکثیر، انتقال به سطل، بازیابی — همه از همان پنل',
    'فیلتر موضوع و جست‌وجوی سریع در همان نوار بالا',
  ]),
  callout('summary', 'برچسب‌ها', [
    p('برچسب بسازید (مثلاً «نیم‌سال اول») و جزوه‌ها را جدا از موضوعات دسته‌بندی کنید.'),
  ]),
], 'framed');

page([
  H(2, 'گروه‌ها — جزوه‌ی مشترک'),
  p('یک گروه بسازید، دوستان را دعوت کنید و روی یک جزوه هم‌زمان بنویسید: حضور و هم‌نویسی زنده، نقش‌ها (سازنده/مدیر/عضو) و جزوه‌های گروهی جدا از شخصی.'),
  callout('definition', 'نقش‌ها', [
    bullet([
      'سازنده — همه‌ی اختیارات + حذف گروه',
      'مدیر — دعوت، حذف عضو، ویرایش تنظیمات',
      'عضو — نوشتن در جزوه‌های گروهی',
    ]),
  ]),
  callout('important', 'تنظیمات امنیتی گروه', [
    p('از نسخه‌ی ۰٫۹: دعوت با تأیید مدیر، محدودسازی ویرایش به اعضا، و قفل جزوه‌های گروهی.'),
  ]),
], 'framed');

page([
  H(2, 'هم‌نویسی زنده — چطور کار می‌کند؟'),
  numbered([
    'هر عضو نشان‌گر رنگی خودش را دارد.',
    'ویرایش‌ها بی‌درنگ به اعضای دیگر می‌رسد (بدون refresh).',
    'ساختار صفحات (اضافه/حذف/ترتیب) هم بین همه همگام می‌شود.',
    'اگر اینترنت قطع شود، تغییرها صف می‌شوند و با وصل شدن ارسال می‌گردند.',
  ]),
  tfQ('برای هم‌نویسی باید صفحه را دستی refresh کرد.', 'false', { points: 0.5, v: 'v2' }),
], 'framed');

page([
  H(2, 'دستیار هوش مصنوعی'),
  p('پنل چپِ دستیار کنار پیش‌نمایش صفحات می‌نشیند: خلاصه‌سازی، اصلاح متن، تولید سوال از متن و توضیح مفاهیم — نتیجه به‌صورت پیشنهاد می‌آید و با «پذیرش» وارد سند می‌شود.'),
  callout('important', 'پذیرش/رد پیشنهاد', [
    p('هیچ تغییری بدون تأیید شما در متن نمی‌نشیند؛ می‌توانید قبل از پذیرش، تفاوت را ببینید.'),
  ]),
  callout('exam', 'راهنمای درخواست خوب', [
    p('بگویید «این سه پاراگراف را خلاصه کن» به‌جای «کمک کن» — درخواست مشخص، خروجی دقیق می‌دهد.'),
  ]),
], 'framed');

page([
  H(2, 'خروجی PDF — هم‌سان با ادیت‌پیج'),
  p('پیش‌نمایش چاپ همان صفحات ویرایشگر را با همان هندسه نشان می‌دهد؛ هر صفحه‌ی سایت = دقیقاً یک صفحه‌ی A4 در PDF. قاب، سربرگ فصل، شماره صفحه و اشکال شناور همه منتقل می‌شوند.'),
  table(
    ['چیز', 'در PDF چه می‌شود؟'],
    [
      ['قاب و شماره‌ی صفحه', 'عیناً با همان رنگ و جایگاه'],
      ['کادرهای آموزشی', 'رنگ و حاشیه‌ی دقیق'],
      ['سوالات', 'همان قالب و پاسخ‌ها'],
      ['اشکال شناور', 'همان مختصات'],
      ['معادلات', 'حروف‌چینی KaTeX'],
    ],
  ),
], 'framed');

page([
  H(2, 'خروجی Word'),
  p('خروجی Word (docx/) برای ادامه‌ی کار در مدرسه/دانشگاه: معادلات به فرم بومی Word، جدول‌ها با همان عرض‌ها، قاب صفحه در سربرگ Word و شماره‌ی صفحه با فیلد واقعی PAGE.'),
  callout('important', 'چه چیزهایی منتقل نمی‌شود؟', [
    p('اشکال شناور و پیش‌نمایش‌های تعاملی به Word نمی‌آیند — Word مدل صفحه‌ی ثابت ندارد؛ آن‌ها را در PDF بگیرید.'),
  ]),
], 'framed');

page([
  H(2, 'تنظیمات — ظاهر و تجربه'),
  bullet([
    'تم روشن/تیره با انیمیشن نرم',
    'جایگاه نوتیفیکیشن‌ها (بالا/پایین)',
    'پروفایل: آواتار، رنگ، یا انتخاب پروفایل رباتی',
    'اضافه‌کردن کاربر با آیدی',
  ]),
  callout('definition', 'پروفایل رباتی', [
    p('اگر آواتار ندارید، یک چهره‌ی رباتیک رنگی به‌صورت خودکار می‌گیرید؛ در تنظیمات می‌توانید بین طرح‌ها انتخاب کنید.'),
  ]),
], 'framed');

page([
  H(2, 'تنظیمات — ویرایشگر'),
  bullet([
    'اندازه‌ی فونت و ارتفاع خط سند',
    'فونت پیش‌فرض جزوه',
    'استایل کادرها (مینیمال/رنگی + جزئیات کامل: حاشیه، سایه، نوار اکسان، تیتر)',
  ]),
  callout('summary', 'قالب‌بندی سراسری', [
    p('تنظیمات ویرایشگر روی جزوه‌های تازه اعمال می‌شود؛ جزوه‌های موجود شخصی‌سازی خودشان را نگه می‌دارند.'),
  ]),
], 'framed');

page([
  H(2, 'میان‌برها و راست‌کلیک'),
  p('منوی راست‌کلیک زمینه‌ای است: روی متن، روی کادر، روی سوال، روی جدول — هر کدام گزینه‌های خودشان را دارند (شخصی‌سازی، تبدیل نوع، تکثیر، حذف).'),
  table(
    ['زمینه', 'نمونه‌ی گزینه‌ها'],
    [
      ['متن', 'بولد/ایتالیک، لیست، سربرگ، پیوند'],
      ['کادر آموزشی', 'شخصی‌سازی، تبدیل به خانواده‌ی دیگر، تکثیر'],
      ['سوال', 'شخصی‌سازی سوال، تغییر قالب، پاسخ'],
      ['جدول', 'افزودن سطر/ستون، قالب آماده، رنگ خطوط'],
    ],
  ),
], 'framed');

page([
  H(2, 'جلد و فهرست — قالب کتاب'),
  p('از تب «طراحی»: «جلد / فهرست…» — سه نوع صفحه‌ی ویژه: جلد آغازین، جلد داخلی و صفحه‌ی فهرست. عکس جلد آپلود کنید، عنوان بگذارید؛ صفحه‌ها سر جای درست خودشان (اول جزوه) درج می‌شوند.'),
  callout('important', 'ترتیب تضمینی', [
    p('جلد آغازین همیشه صفحه‌ی ۱ می‌شود؛ جلد داخلی و فهرست بعد از آن — حتی اگر وسط جزوه روی دکمه بزنید.'),
  ]),
  callout('definition', 'شیار نام درس', [
    p('قاب صفحه یک جای خالی بالا-چپ دارد: نام درس یا فصل را همان‌جا بنویسید تا روی همه‌ی صفحات انتخابی چاپ شود.'),
  ]),
], 'framed');

page([
  H(2, 'سربرگ بازه‌ای — هوشمند'),
  p('سربرگ و قالب را روی «بازه» اعمال کنید: مثلاً صفحات ۱ تا ۱۰ سربرگ «فصل ۱» و صفحات ۱۸ تا ۳۱ سربرگ «فصل ۲» — بدون ویرایش تک‌تک صفحات.'),
  table(
    ['بازه', 'سربرگ'],
    [['۱ تا ۱۰', 'فصل ۱ — سینماتیک'], ['۱۱ تا ۱۷', 'مرور و تمرین'], ['۱۸ تا ۳۱', 'فصل ۲ — دینامیک']],
  ),
  tfQ('برای تغییر سربرگ باید صفحات را یکی‌یکی ویرایش کرد.', 'false', { points: 0.5, v: 'v4' }),
], 'framed');

/* ── فصل ۳: تمرین (ص ۳۳–۴۰) ── */
page([
  H(2, 'آزمونک فصل ۱ — آشنایی'),
  mcqQ('پیش‌نمایش روی کارت جزوه چه چیزی را نشان می‌دهد؟', ['عکس آپلودی کاربر', 'صفحه‌ی اول زنده‌ی جزوه', 'فقط عنوان', 'آیکون موضوع'], 1, { points: 1, v: 'v2', chip: 'circle' }),
  tfQ('ذخیره‌ی خودکار فقط با Ctrl+S کار می‌کند.', 'false', { points: 1, v: 'v3' }),
  shortQ('میان‌بر حالت تمرکز چیست؟', { answer: 'Ctrl+Shift+F', points: 1, v: 'v4', answerAt: 'end' }),
], 'framed');

page([
  H(2, 'آزمونک فصل ۲ — ویرایشگر'),
  mcqQ('کدام گزینه از قابلیت‌های لایه‌ی شناور نیست؟', ['چرخش', 'متن درون شکل', 'حاشیه‌ی نقطه‌چین', 'تغییر نوع فایل جزوه'], 3, { points: 1, v: 'v2', gap: 'wide' }),
  longQ('سه تفاوت کادر «فرمول» و «معادله» را بنویسید.', { points: 3, v: 'v2' }),
  tfQ('آیکون‌های درون‌متنی مثل یک حرف رفتار می‌کنند.', 'true', { points: 0.5, v: 'v6' }),
], 'framed');

page([
  H(2, 'آزمونک فصل ۳ — خروجی'),
  mcqQ('هر صفحه‌ی سایت در PDF چه می‌شود؟', ['نصف صفحه', 'دقیقاً یک صفحه‌ی A4', 'دو صفحه', 'بستگی به متن دارد'], 1, { points: 1, v: 'v9', chip: 'square' }),
  tfQ('خروجی Word معادلات را به فرم بومی Word تبدیل می‌کند.', 'true', { points: 1, v: 'v2' }),
  shortQ('برای گرفتن برگه‌ی امتحانی بدون پاسخ، کدام گزینه‌ی جایگاه پاسخ را انتخاب می‌کنید؟', { answer: 'بدون پاسخ', points: 1, v: 'v5', answerAt: 'end' }),
], 'framed');

page([
  H(2, 'پاسخنامه‌ی آزمونک‌ها'),
  callout('summary', 'کلید آزمونک فصل ۱', [
    p('۱) گزینه‌ی ۲ — ۲) نادرست — ۳) Ctrl+Shift+F'),
  ]),
  callout('summary', 'کلید آزمونک فصل ۲', [
    p('۱) گزینه‌ی ۴ — ۲) باز — ۳) درست'),
  ]),
  callout('summary', 'کلید آزمونک فصل ۳', [
    p('۱) گزینه‌ی ۲ — ۲) درست — ۳) بدون پاسخ'),
  ]),
  highlight('الگوی جزوه‌نویسی پیشنهادی', [
    p('هر فصل: تعریف → مثال → نکته‌ی امتحانی → آزمونک ۳ سوالی → پاسخنامه. همین الگو را این جزوه رعایت کرده است.'),
  ]),
], 'framed');

page([
  H(2, 'از جزوه به کلاس — سناریوهای واقعی'),
  numbered([
    'معلم: جزوه‌ی فصل را با کادرها می‌نویسد، آزمونک می‌سازد، PDF می‌گیرد و در گروه کلاس می‌گذارد.',
    'دانش‌آموز: جزوه را کلون می‌کند، خلاصه‌ی خودش را با کادر «خلاصه» اضافه می‌کند.',
    'گروه پروژه: سه نفر هم‌زمان می‌نویسند؛ یکی طرح‌ها را با اشکال شناور می‌کشد.',
    'دانشجوی TA: بانک سوال فصل‌ها را می‌سازد و برگه‌ی تمرین «بدون پاسخ» چاپ می‌کند.',
  ]),
  example('نمونه‌ی واقعی', [
    p('جزوه‌ی «شیمی ۱۰» — ۳۴ صفحه، ۱۲ کادر تعریف، ۲۸ سوال، ۴ آزمونک، ۲ جدول مقایسه — همه با همین ابزارها.'),
  ]),
], 'framed');

page([
  H(2, 'نقشه‌ی راه — چه چیزهایی می‌آید؟'),
  p('این بخش با کادر «زمان‌خط» به‌روز نگه داشته می‌شود:'),
  timeline('در افق نسخه‌های بعدی', [
    p('برگه‌ی امتحانی با بارم‌بندی و جمع نمره'),
    p('ورود دو مرحله‌ای و مدیریت نشست‌ها'),
    p('کتابخانه‌ی قالب‌های عمومی کاربران'),
    p('خروجی تصویری از هر صفحه (PNG)'),
    p('نمودار و رسم ریاضی درون صفحه'),
    p('برچسب‌گذاری هوشمند خودکار متن'),
  ]),
  callout('important', 'پیشنهاد شما', [
    p('ایده‌ی بعدی ممکن است مال شما باشد — از بخش تنظیمات، بازخورد بفرستید.'),
  ]),
], 'framed');

page([
  H(2, 'پرسش‌های پرتکرار'),
  callout('definition', 'آیا بدون اینترنت می‌نویسم؟', [
    p('بله؛ تغییرها صف می‌شوند و با برگشتن شبکه ذخیره می‌شوند.'),
  ]),
  callout('definition', 'سقف حجم عکس؟', [
    p('محدودیت ۱۵۰KB برداشته شده؛ عکس‌ها هنگام آپلود بهینه می‌شوند.'),
  ]),
  callout('definition', 'جزوه‌ام کجا ذخیره می‌شود؟', [
    p('روی حساب شما در سرور؛ با تاریخچه‌ی نسخه. پشتیبان‌گیری خودکار است.'),
  ]),
  callout('definition', 'چند نفر هم‌زمان؟', [
    p('در گروه‌ها، ویرایش هم‌زمان با نشانگر رنگی — بدون تداخل.'),
  ]),
], 'framed');

page([
  H(2, 'واژه‌نامه'),
  table(
    ['واژه', 'یعنی'],
    [
      ['ادیت‌پیج', 'صفحه‌ی نوشتن با صفحه‌بندی A4'],
      ['پنل چپ‌باز', 'پنل تنظیمات که از چپ باز می‌شود'],
      ['قالب بازه‌ای', 'اعمال سربرگ/قالب روی بازه‌ی صفحات'],
      ['پلیت v7', 'قالب تیره‌ی سوال «کنتراست»'],
      ['نشست', 'مدت ورود فعال شما به حساب'],
    ],
  ),
], 'framed');

page([
  H(2, 'چک‌لیست شروع — امروز شروع کنید'),
  task(true, 'حساب بسازید یا با حساب نمونه وارد شوید'),
  task(true, 'یک جزوه بسازید و قالب «خیلی سبز» بدهید'),
  task(true, 'یک کادر «تعریف» و یک سوال چهارگزینه‌ای درج کنید'),
  task(true, 'پیش‌نمایش چاپ را ببینید و PDF بگیرید'),
  task(false, 'دوستان را به گروه دعوت کنید و هم‌نویسی را تست کنید'),
  task(false, 'جزوه‌تان را از پنل مدیریت به علاقه‌مندی‌ها اضافه کنید'),
  quote('جزوه‌نویسی، وقتی ابزارش درست باشد، خودش درس می‌شود.'),
], 'framed');

page([
  H(2, 'یادداشت پایانی'),
  p('این جزوه هم‌زمان سه کار کرد: راهنمای شما بود، تست کامل امکانات بود و خودش یک نمونه‌ی الگو است — از ساختارش برای جزوه‌های درسی‌تان الهام بگیرید.'),
  callout('important', 'یک نکته‌ی مهندسی', [
    p('همه‌ی این ۵۰ صفحه با API خودِ سایت ساخته شدند — یعنی هر آن‌چه اینجا دیدید، از مسیر رسمی ذخیره/بازیابی رد شده و در ادیتور، پیش‌نمایش و خروجی باید یکسان بدرخشد. اگر ناهماهنگی دیدید، همان‌جا باگِ ماست؛ گزارشش کنید.'),
  ]),
  reference('سند فنی', [
    p('فایل HANDOFF.md در ریشه‌ی پروژه — نقشه‌ی کامل معماری برای توسعه‌دهنده‌ی بعدی.'),
  ]),
  p('پایان — پرشین‌نوت ۰٫۹'),
], 'framed');

/* ── pad to exactly 50 pages with useful chapter-divider pages ────────── */
const dividers = [
  { t: 'یادداشت‌های من', body: 'این صفحه عمداً خالی گذاشته شده — نکته‌های خودتان را همین‌جا با قلم دست‌نویس بنویسید.', kind: 'notebook' },
  { t: 'تمرین‌های اضافه', body: 'مسئله‌های خودتان را اینجا اضافه کنید — قالب نوت‌بوکی برای محاسبات، ایده‌آل است.', kind: 'notebook' },
  { t: 'طرح آزاد', body: 'برای اسکیس و نمودار دستی — بدون خط.', kind: 'blank' },
  { t: 'مرور سریع', body: 'مفاهیمی که سخت یادتان می‌ماند را اینجا خلاصه کنید.', kind: 'notebook' },
  { t: 'یادداشت', body: 'صفحه‌ی آزاد بعدی.', kind: 'notebook' },
  { t: 'یادداشت', body: 'صفحه‌ی آزاد.', kind: 'notebook' },
  { t: 'یادداشت', body: 'صفحه‌ی آزاد.', kind: 'notebook' },
  { t: 'یادداشت', body: 'صفحه‌ی پایانی دفتر.', kind: 'notebook' },
];
for (const d of dividers) {
  if (pages.length >= 48) break;
  page([H(2, d.t), p(d.body)], d.kind);
}
/* trim/extend to exactly 48 content pages (plus cover + toc = 50) */
while (pages.length < 49) {
  page([H(2, 'یادداشت مطالعه'), p('صفحه‌ی آزاد برای یادداشت‌های شما.')], 'notebook');
}
pages.length = 49;

/* ── build the doc: cover + toc + 48 pages ───────────────────────────── */
const coverAttrs = { coverTitle: 'راهنمای کامل پرشین‌نوت', coverSubtitle: 'معرفی سایت با امکانات خودش — نسخه ۰٫۹' };
const blocks = [];
/* first page rides doc attrs (pageKind=cover + pageCover) */
blocks.push(...pages[0].blocks);
for (let i = 1; i < pages.length; i++) {
  blocks.push(pageBreak(pages[i].kind, `pg${i + 1}`));
  blocks.push(...pages[i].blocks);
}
/* the TOC page rides a pageBreak with kind='toc' at position 2: restructure —
   simpler: insert toc pageBreak after the first chunk is not possible in the
   single-doc flow, so the cover IS page 1 and page 2 (first pageBreak) is toc. */
const tocBreak = pageBreak('toc', 'pg2');
/* rebuild: page1 content (cover), toc break, page2 content… — shift pages[1..] */
blocks.length = 0;
blocks.push(...pages[0].blocks);
blocks.push(tocBreak);
blocks.push(
  H(1, 'فهرست مطالب'),
  p('این فهرست به‌صورت خودکار با عناوین فصل‌ها همگام می‌شود (در نقشه‌ی راه). شماره‌ی فصل‌ها را همین حالا دستی دنبال کنید:'),
  bullet([
    'فصل ۱ — آشنایی و حساب (ص ۳–۸)',
    'فصل ۲ — ویرایشگر و امکانات (ص ۹–۳۲)',
    'فصل ۳ — آزمونک‌ها و پاسخنامه (ص ۳۳–۴۰)',
    'فصل ۴ — سناریوها، نقشه‌ی راه، پرسش‌ها (ص ۴۱–۵۰)',
  ]),
);
for (let i = 1; i < pages.length; i++) {
  blocks.push(pageBreak(pages[i].kind, `pg${i + 2}`));
  blocks.push(...pages[i].blocks);
}

const doc = { type: 'doc', attrs: { pageKind: 'cover', pageCover: coverAttrs }, content: blocks };

/* plain text + rough html mirror for the list preview */
function docText(node) {
  let out = '';
  const walk = (n) => {
    if (n.type === 'text') out += n.text + ' ';
    (n.content ?? []).forEach(walk);
  };
  walk(doc);
  return out.trim();
}

/* ── POST to the API ──────────────────────────────────────────────────── */
const login = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASS }),
});
const { token } = await login.json();
if (!token) { console.error('LOGIN FAILED'); process.exit(1); }

const res = await fetch(`${API}/notes`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({
    title: '📕 راهنمای کامل پرشین‌نوت — ۵۰ صفحه',
    subjectId: null,
    chapter: 'راهنما',
    content: doc,
    plainText: docText(doc),
    tags: [],
  }),
});
const data = await res.json();
if (!res.ok) { console.error('CREATE FAILED', res.status, JSON.stringify(data).slice(0, 400)); process.exit(1); }
console.log('CREATED note:', data.note._id);
console.log('pages in doc:', pages.length + 1 /*toc*/);
console.log('open: http://localhost:5199/editor/' + data.note._id);
