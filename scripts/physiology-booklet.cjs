/**
 * physiology-booklet.cjs — author a 10-page Persian physiology booklet
 * through the app's own REST pipeline, exactly like the browser would:
 *   register → subject → tags → note (10 TipTap pages) → autosave PATCH
 *   → GET round-trip → search → AI → Word/HTML export → version history.
 * Everything is logged to .phys-report.json (UTF-8) for review.
 */
const fs = require('fs');

const BASE = 'http://localhost:4000/api';
const OUT = '.phys-report.json';
const report = { steps: [] };

function step(name, data, ok = true) {
  report.steps.push({ name, ok, data });
  console.log(`${ok ? 'ok ' : 'FAIL'} ${name}`);
  if (!ok) report.failed = name;
  return data;
}

async function req(method, path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text.slice(0, 400); }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return json;
}

/* ── TipTap JSON builders (mirror server/src/seed/builders.ts) ─────────── */
const ZWNJ = '\u200c';
const t = (text, marks) => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const p = (text, marks) => ({ type: 'paragraph', ...(text ? { content: [t(text, marks)] } : {}) });
const pr = (runs) => ({ type: 'paragraph', content: runs });
const B = { type: 'bold' };
const I = { type: 'italic' };
const h = (level, text) => ({ type: 'heading', attrs: { level, textAlign: 'right' }, content: [t(text)] });
const callout = (kind, title, paras) => ({ type: 'calloutBlock', attrs: { kind, title }, content: paras.map((x) => p(x)) });
const question = (q, a) => ({ type: 'questionBlock', attrs: { question: q }, content: [p(a)] });
const keyTerm = (term, expl) => ({ type: 'keyTermBlock', attrs: { term }, content: [p(expl)] });
const example = (title, paras) => ({ type: 'exampleBlock', attrs: { title }, content: paras.map((x) => p(x)) });
const formula = (latex, caption) => ({
  type: 'formulaBlock',
  content: [t(latex)],
  ...(caption ? {} : {}),
});
const ul = (...items) => ({ type: 'bulletList', content: items.map((x) => ({ type: 'listItem', content: [p(x)] })) });
const ol = (...items) => ({ type: 'orderedList', content: items.map((x) => ({ type: 'listItem', content: [p(x)] })) });
const cell = (text, header) => ({
  type: header ? 'tableHeader' : 'tableCell',
  attrs: { textAlign: 'right' },
  content: [p(text)],
});
const table = (headers, rows) => ({
  type: 'table',
  content: [
    { type: 'tableRow', content: headers.map((x) => cell(x, true)) },
    ...rows.map((r) => ({ type: 'tableRow', content: r.map((x) => cell(x, false)) })),
  ],
});
const hr = () => ({ type: 'horizontalRule' });
const break_ = () => ({ type: 'pageBreak' });
const doc = (pages) => ({ type: 'doc', content: pages.map((nodes, i) => (i ? [break_(), ...nodes] : nodes)).flat() });

/* ── the booklet — «فیزیولوژی: سیستم قلبی‌عروقی و تنفسی» — 10 pages ────── */

const page1 = [
  h(1, 'جزوه فیزیولوژی: سیستم قلبی‌عروقی و تنفسی'),
  p('درس: فیزیولوژی عمومی | مقطع: علوم پزشکی | جمع‌بندی دو سامانه حیاتی بدن در یک جزوه مرور سریع', [I]),
  hr(),
  callout('definition', 'فیزیولوژی چیست؟', [
    'فیزیولوژی دانش مطالعهٔ کارکردهای زندهٔ بدن است؛ یعنی توضیحِ اینکه هر اندام چگونه کار می‌کند، چه نیروها و سیگنال‌هایی آن را تنظیم می‌کنند و اختلال در هر جزء چه اثری بر کل بدن می‌گذارد.',
  ]),
  p('در این جزوه دو سامانهٔ به‌هم‌پیوسته را مرور می‌کنیم: سامانهٔ قلبی‌عروقی که خون و مواد حل‌شده در آن را جابه‌جا می‌کند، و سامانهٔ تنفسی که اکسیژن و دی‌اکسیدکربن را بین هوا و خون مبادله می‌کند. هدف این است که پس از خواندن، بتوانید هر مفهوم را در یک جمله توضیح دهید و با اعداد کلیدی آن را کمی‌سازی کنید.'),
  h(2, 'نقشهٔ راه جزوه'),
  ol(
    'مفاهیم پایه: هم‌ایستایی، مایع درون‌یاخته و برون‌یاخته',
    'پتانسیل غشایی و بافت‌های قابل تحریک',
    'قلب: ساختار، سیستم هدایت و سیکل قلبی',
    'برون‌ده قلبی و تنظیم آن',
    'عروق، فشار خون و مقاومت محیطی',
    'تنظیم عصبی و هورمونی فشار خون',
    'سیستم تنفسی: تهویه و تبادل گازی',
    'خلاصه، فلش‌کارت‌ها و خودآزمایی'
  ),
  keyTerm('هم‌ایستایی (Homeostasis)', 'حفظ ثبات نسبی محیط داخلی بدن با سازوکارهای بازخورد منفی و مثبت؛ پایهٔ فهم همهٔ فصل‌های فیزیولوژی.'),
];

const page2 = [
  h(1, 'بخش ۱ — مقدمه و مفاهیم پایه'),
  p('بدن انسان حدود ۶۰ درصد آب است. دوسوم این آب درون یاخته‌ها (مایع درون‌یاخته) و یک‌سوم بیرون آن‌ها (مایع برون‌یاخته) قرار دارد. مایع برون‌یاخته خود به پلاسمای خون و مایع میان‌بافتی تقسیم می‌شود و مرز میان این دو، جدار مویرگ‌هاست. تمام سازوکارهای فیزیولوژیک در نهایت برای حفظ ترکیب ثابت همین مایع برون‌یاخته فعال‌اند، چون یاخته‌ها فقط با آن تبادل ماده دارند.'),
  h(2, 'سطوح سازمان‌دهی و سهم هر سامانه'),
  table(
    ['سامانه', 'وظیفهٔ اصلی', 'سهم در هم‌ایستایی'],
    [
      ['قلبی‌عروقی', 'پمپ و توزیع خون', 'انتقال اکسیژن، مواد غذایی، هورمون و گرما'],
      ['تنفسی', 'تبادل گازی', 'تأمین اکسیژن و دفع دی‌اکسیدکربن، تنظیم pH'],
      ['ادراری', 'تصفیهٔ خون', 'حفظ حجم و ترکیب مایعات و دفع مواد زاید'],
      ['عصبی', 'کنترل سریع', 'حس کردن، فرمان دادن و هماهنگی اندام‌ها'],
      ['اندوکرین', 'کنترل کند و پایدار', 'تنظیم متابولیسم، رشد و تعادل آب و الکترولیت'],
    ]
  ),
  callout('important', 'نکتهٔ کلیدی', [
    'همهٔ سامانه‌های بدن در واقع «خدمتگزار» مایع برون‌یاخته‌اند: قلب آن را به حرکت درمی‌آورد، ریه‌ها گازهای آن را تعویض می‌کنند، کلیه‌ها ترکیب آن را تصفیه می‌کنند و کبد مواد لازم را به آن اضافه می‌کند.',
  ]),
  keyTerm('مایع میان‌بافتی', 'آن بخش از مایع برون‌یاخته که مستقیماً یاخته‌ها را احاطه می‌کند و از طریق مویرگ‌ها با پلاسما تبادل می‌شود.'),
];

const page3 = [
  h(1, 'بخش ۲ — پتانسیل غشایی و بافت‌های قابل تحریک'),
  p('غشای همهٔ یاخته‌ها یک اختلاف پتانسیل الکتریکی دارد، اما فقط یاخته‌های قابل تحریک (عصبی و عضلانی) می‌توانند این پتانسیل را به‌سرعت تغییر دهند و از آن «زبان ارتباطی» بسازند. سه عامل در ایجاد پتانسیل استراحت (حدود -۷۰ میلی‌ولت در نورون) نقش دارند: اختلاف غلظت یون‌ها در دو سوی غشا، نفوذپذیری انتخابی غشا، و پمپ سدیم-پتاسیم.'),
  formula('V = \\frac{RT}{F} \\ln\\frac{[K^+]_o}{[K^+]_i}', 'معادلهٔ نرنست برای پتانسیل تعادلی پتاسیم'),
  p('پمپ سدیم-پتاسیم با مصرف ATP، به‌ازای هر چرخه سه یون سدیم را به بیرون و دو یون پتاسیم را به درون یاخته می‌برد؛ همین تفاوت ۳:۲ سهم کوچکی در منفی بودن پتانسیل استراحت دارد اما نقش اصلی آن حفظ گرادیان‌های یونی است که «باتری» یاخته محسوب می‌شوند.'),
  h(2, 'پتانسیل عمل'),
  ul(
    'آستانه: با رسیدن پتانسیل به حدود -۵۵ میلی‌ولت، کانال‌های وابسته به ولتاژ سدیم به‌صورت انفجاری باز می‌شوند.',
    'صعود سریع: ورود سدیم، غشا را تا حدود +۳۰ میلی‌ولت مثبت می‌کند (فاز دپلاریزاسیون).',
    'بازگشت: بسته‌شدن کانال‌های سدیمی و باز شدن کانال‌های پتاسیمی، پتانسیل را به استراحت برمی‌گرداند (رپلاریزاسیون).',
    'هیپرپلاریزاسیون گذرا: تأخیر در بسته شدن کانال‌های پتاسیمی، پتانسیل را موقتاً منفی‌تر از استراحت می‌برد.'
  ),
  callout('exam', 'نکتهٔ امتحانی', [
    'نسبت ۳:۲ پمپ سدیم-پتاسیم، مقدار پتانسیل استراحت نورون (-۷۰mV)، آستانه (-۵۵mV) و اوج پتانسیل عمل (+۳۰mV) از پرتکرارترین اعداد در آزمون‌های فیزیولوژی‌اند.',
  ]),
  question('چرا پتانسیل عمل یک‌سویه پیش می‌رود و به عقب برنمی‌گردد؟', 'به دلیل دورهٔ تحریک‌ناپذیری (Refactory): کانال‌های سدیمی پس از باز شدن، تا پایان بازگشت به حالت اولیه به محرک پاسخ نمی‌دهند؛ بنابراین امواج فقط به نواحی استراحت مجاور منتقل می‌شوند.'),
];

const page4 = [
  h(1, 'بخش ۳ — قلب: ساختار کارکردی و سیستم هدایت'),
  p('قلب یک پمپ دوگانه است: نیمهٔ راست خون کم‌اکسیژن را به ریه‌ها می‌فرستد (گردش ریوی) و نیمهٔ چپ خون اکسیژن‌دار را به کل بدن (گردش سیستمیک). دیوارهٔ قلب از سه لایه ساخته شده است: اندوکارد (داخلی)، میوکارد (عضلانی و اصلی) و اپیکارد (خارجی). ضخامت بطن چپ چند برابر بطن راست است، چون باید خون را در برابر مقاومت زیاد گردش سیستمیک پمپ کند.'),
  h(2, 'گره‌ها و مسیر هدایت'),
  ul(
    'گره سینوسی-دهلیزی (SA) در دیوارهٔ دهلیز راست: ضربان‌ساز طبیعی قلب با آهنگ ۶۰ تا ۱۰۰ بار در دقیقه.',
    'گره دهلیزی-بطنی (AV): تنها راه عبور تحریک از دهلیزها به بطن‌ها؛ با تأخیر عمدی حدود ۰٫۱ ثانیه تا دهلیزها اول خون را کامل تخلیه کنند.',
    'دستهٔ هیس و رشته‌های پورکنژ: انتقال بسیار سریع تحریک به سراسر بطن‌ها با سرعت تا ۴ متر بر ثانیه.',
    'سلول‌های ضربان‌ساز به‌صورت خودکار دپلاریزه می‌شوند؛ آهنگ آن‌ها: SA بیش از AV و AV بیش از بطن‌هاست.'
  ),
  callout('warning', 'توجه', [
    'بلاک کامل AV یعنی بطن‌ها دیگر تحریک دهلیزی دریافت نمی‌کنند و با آهنگ ذاتی خودشان (۲۰ تا ۴۰ بار در دقیقه) می‌زنند؛ درجهٔ بلاک و جایگاه ضربان‌ساز فرعی، شدت علامت‌ها را تعیین می‌کند.',
  ]),
  question('چرا تأخیر گره AV از نظر کارکردی حیاتی است؟', 'چون به دهلیزها فرصت می‌دهد پیش از شروع انقباض بطن‌ها، آخرین سهم خون را به آن‌ها بریزند (پر شدن نهایی) و بازدهٔ پمپ حدود ۲۰ تا ۳۰ درصد افزایش یابد.'),
];

const page5 = [
  h(1, 'بخش ۴ — سیکل قلبی: فازها و فشارها'),
  p('سیکل قلبی، مجموعهٔ رویدادها از یک انقباض تا انقباض بعدی است. با ضربان ۷۵ بار در دقیقه، طول هر سیکل حدود ۰٫۸ ثانیه است؛ ۰٫۳ ثانیه سیستول بطنی و ۰٫۵ ثانیه دیاستول عمومی. نکتهٔ کلیدی این است که با افزایش ضربان، بیشترین کوتاهی در دیاستول رخ می‌دهد و همین، زمان پر شدن قلب را محدود می‌کند.'),
  table(
    ['فاز', 'مدت', 'وضعیت دریچه‌ها', 'رویداد اصلی'],
    [
      ['پر شدن سریع', '≈۰٫۱۱ ثانیه', 'میترال باز، آئورت بسته', 'ورود انبوه خون به بطن چپ (صدای سوم طبیعی)'],
      ['دیاستولیز (پر شدن آرام)', '≈۰٫۱۹ ثانیه', 'میترال باز، آئورت بسته', 'پر شدن تدریجی تا پایان دیاستول'],
      ['سیستول دهلیزی', '≈۰٫۱ ثانیه', 'میترال باز، آئورت بسته', 'انقباض دهلیز و «پر شدن نهایی» بطن'],
      ['انقباض هم‌دما', '≈۰٫۰۵ ثانیه', 'هر دو بسته', 'افزایش فشار بطن بدون تغییر حجم'],
      ['تخلیهٔ سریع', '≈۰٫۱۳ ثانیه', 'میترال بسته، آئورت باز', 'خروج حدود ۷۰ میلی‌لیتر خون'],
      ['تخلیهٔ کاهش‌یافته', '≈۰٫۰۹ ثانیه', 'میترال بسته، آئورت باز', 'کاهش سرعت تخلیه تا بسته شدن آئورت'],
    ]
  ),
  example('محاسبهٔ زمان سیستول در ضربان بالا', [
    'اگر ضربان قلب به ۱۵۰ برسد، هر سیکل فقط ۰٫۴ ثانیه طول می‌کشد. سیستول نمی‌تواند کمتر از حدود ۰٫۲ ثانیه شود، پس دیاستول به کمتر از ۰٫۲ ثانیه می‌رسد؛ زمان پر شدن ناقص می‌ماند و حجم ضربه‌ای افت می‌کند. نتیجه: در ضربان‌های خیلی بالا، برون‌ده قلبی به‌جای افزایش، کاهش می‌یابد.',
  ]),
  callout('exam', 'نکتهٔ امتحانی', [
    'ترتیب صداها را حفظ کنید: S1 (بسته شدن دریچه‌های دهلیزی-بطنی، شروع سیستول) و S2 (بسته شدن دریچه‌های سینی، پایان سیستول). صدای S3 در پر شدن سریع و S4 در سیستول دهلیزی شنیده می‌شود.',
  ]),
];

const page6 = [
  h(1, 'بخش ۵ — برون‌ده قلبی و تنظیم آن'),
  p('برون‌ده قلبی (CO) حجم خونی است که در یک دقیقه از بطن چپ بیرون می‌رود و حاصل‌ضرب آهنگ ضربان در حجم ضربه‌ای است. در فرد سالم بالغ این مقدار حدود ۵ لیتر در دقیقه است؛ یعنی کل حجم خون بدن (۵ لیتر) هر دقیقه یک بار کامل پمپ می‌شود.'),
  formula('CO = HR \\times SV', 'برون‌ده قلبی = آهنگ ضربان × حجم ضربه‌ای'),
  formula('SV = EDV - ESV', 'حجم ضربه‌ای = حجم پایان دیاستول − حجم پایان سیستول'),
  h(2, 'سه تنظیم‌کنندهٔ اصلی حجم ضربه‌ای'),
  ul(
    'پیش‌بار (Preload): میزان کشیدگی دیوارهٔ بطن پیش از انقباض؛ طبق قانون فرانک-استارلینگ، پر شدن بیشتر تا یک حد بهینه، انقباض قوی‌تر می‌سازد.',
    'قراردادپذیری (Contractility): قدرت ذاتی عضلهٔ قلبی که با فعالیت سمپاتیک و کاتکول‌آمین‌ها افزایش می‌یابد.',
    'پس‌بار (Afterload): مقاومتی که بطن باید بر آن غلبه کند؛ عمدتاً فشار شریانی و مقاومت محیطی کل (TPR).'
  ),
  table(
    ['عامل', 'اثر بر برون‌ده', 'سازوکار'],
    [
      ['ورزش', 'افزایش تا ۴ تا ۵ برابر', 'افزایش هم‌زمان ضربان، پیش‌بار و قراردادپذیری'],
      ['خونریزی حاد', 'کاهش', 'کاهش حجم وریدی → کاهش پیش‌بار'],
      ['سمپاتیک', 'افزایش', 'افزایش آهنگ ضربان و قراردادپذیری'],
      ['پاراسمپاتیک (واگ)', 'کاهش آهنگ', 'مهار گره SA و کند کردن هدایت AV'],
    ]
  ),
  question('در خونریزی حاد، بدن چگونه برون‌ده را حفظ می‌کند؟', 'کاهش فشار حبابکی فعال‌شدن سمپاتیک را به همراه دارد: انقباض عروق وریدی (افزایش بازگشت وریدی)، افزایش ضربان و قراردادپذیری، و انقباض عروق در اندام‌های غیرحیاتی برای حفظ فشار گشائی مغز و قلب.'),
];

const page7 = [
  h(1, 'بخش ۶ — عروق، فشار خون و مقاومت محیطی'),
  p('رگ‌ها فقط لولهٔ انتقال خون نیستند؛ هر بخش وظیفهٔ خاص خود را دارد: شریان‌ها به‌دلیل غنی بودن از بافت الاستیک، ضربان تپندهٔ قلب را به جریان پیوسته تبدیل می‌کنند (اثر هویرگولی)، آرتریول‌ها با تغییر قطر خود «شیر تنظیم» فشار و توزیع جریان‌اند، مویرگ‌ها محل مبادله‌اند و وریدها مخزن خون (Capacitance).'),
  formula('BP = CO \\times TPR', 'فشار شریانی = برون‌ده قلبی × مقاومت محیطی کل'),
  formula('Q = \\frac{\\Delta P}{R}', 'قانون پوآزی: جریان = اختلاف فشار ÷ مقاومت؛ مقاومت با شعاع به توان ۴ رابطهٔ معکوس دارد'),
  callout('important', 'نکتهٔ کلیدی', [
    'وابستگی به توان چهارم یعنی نصف شدن شعاع آرتریول، مقاومت را ۱۶ برابر می‌کند. همین است که آرتریول‌ها را به مؤثرترین ابزار تنظیم جریان خون تبدیل کرده است.',
  ]),
  h(2, 'فشارهای مرجع در گردش خون'),
  table(
    ['اندازه‌گیری', 'مقدار طبیعی', 'یادداشت'],
    [
      ['فشار شریانی سیستمیک', '۱۲۰ بر ۸۰ mmHg', 'سیستول/دیاستول در انگشت‌نگاری بازو'],
      ['فشار میانگین شریانی', '≈۹۳ mmHg', 'دیاستول + یک‌سوم فشار نبض'],
      ['فشار بطن راست', '۲۵ بر ۵ mmHg', 'سیستم گردش ریوی فشار کم است'],
      ['فشار مویرگی', '≈۱۷ mmHg', 'تعادل استارلینگ مایعات میان‌بافتی'],
      ['فشار ورید مرکزی', '≈۰ تا ۵ mmHg', 'شاخص بازگشت وریدی و پیش‌بار'],
    ]
  ),
  keyTerm('فشار نبض (Pulse Pressure)', 'اختلاف فشار سیستول و دیاستول؛ افزایش آن نشانهٔ سفتی شریان‌ها (مثل آترواسکلروز) یا حجم ضربه‌ای بالاست.'),
];

const page8 = [
  h(1, 'بخش ۷ — تنظیم عصبی و هورمونی فشار خون'),
  p('فشار شریانی باید در ثانیه‌ها تنظیم شود؛ این کار را بازتاب فشاری (Baroreflex) انجام می‌دهد. گیرنده‌های فشاری در قوس آئورت و سینوس کاروتید، کشیدگی دیواره را حس می‌کنند و از راه عصب واگ و گلوسوفارنژینال به مرکز عصبی در بصل‌النخاع می‌فرستند. افزایش فشار → افزایش فرمان پاراسمپاتیک و کاهش فرمان سمپاتیک → کاهش ضربان و اتساع عروق؛ و برعکس.'),
  h(2, 'سازوکار هورمونی بلندمدت: سیستم رنین-آنژیوتانسین-آلدوسترون'),
  ol(
    'کاهش فشار یا سدیم در کلیه → ترشح رنین از سلول‌های یوکساگلومولار',
    'رنین، آنژیوتانسینوژن کبد را به آنژیوتانسین I تبدیل می‌کند',
    'آنژیوتانسین I در ریه با ACE به آنژیوتانسین II تبدیل می‌شود',
    'آنژیوتانسین II: انقباض عروق، ترشح آلدوسترون از فوق‌کلیه و حس تشنگی',
    'آلدوسترون: بازجذب سدیم و آب در لولهٔ دیستال → افزایش حجم خون و فشار'
  ),
  callout('warning', 'توجه', [
    'داروهای مهارکنندهٔ ACE دقیقاً همین حلقه را هدف می‌گیرند: با جلوگیری از تولید آنژیوتانسین II، هم مقاومت عروقی را کم می‌کنند و هم افزایش حجم مایعات را مهار می‌کنند.',
  ]),
  keyTerm('بازتاب فشاری', 'سازوکار تنظیم ثانیه‌ای فشار خون با گیرنده‌های سینوس کاروتید و قوس آئورت؛ برای فشارهای پایدار در عرض چند روز «تنظیم می‌شود» و اثر مؤثر خود را از دست می‌دهد.'),
  keyTerm('رنین', 'آنزیمی پروتئولیتیک از کلیه که اولین و محدودکننده‌ترین گام زنجیرهٔ رنین-آنژیوتانسین-آلدوسترون را کاتالیز می‌کند.'),
];

const page9 = [
  h(1, 'بخش ۸ — سیستم تنفسی: تهویه و تبادل گازی'),
  p('سامانهٔ تنفسی هوا را بین محیط و کیسه‌های هوایی (آلوئول) جابه‌جا می‌کند تا خون در مرز آلوئول-مویرگ، اکسیژن بگیرد و دی‌اکسیدکربن پس دهد. تهویهٔ دقیقه‌ای حاصل‌ضرب حجم جاری در تعداد تنفس است و بخشی از آن فقط فضای مرده را تهویه می‌کند؛ تنها تهویهٔ آلوئولی در تبادل گازی سهم دارد.'),
  formula('V_E = V_T \\times f', 'تهویهٔ دقیقه‌ای = حجم جاری × فرکانس تنفس'),
  formula('V_A = (V_T - V_D) \\times f', 'تهویهٔ آلوئولی = (حجم جاری − حجم فضای مرده) × فرکانس'),
  table(
    ['حجم/ظرفیت', 'مقدار تقریبی', 'معنا'],
    [
      ['حجم جاری (VT)', '≈۵۰۰ میلی‌لیتر', 'هوای یک تنفس عادی'],
      ['فضای مردهٔ تشریحی', '≈۱۵۰ میلی‌لیتر', 'مسیر رسانایی بدون تبادل گازی'],
      ['حجم ذخیرهٔ انگیزشی', '≈۳۰۰۰ میلی‌لیتر', 'هوای اضافهٔ قابل دم بعد از دم عادی'],
      ['ظرفیت باقی‌ماندهٔ کارکردی', '≈۲۳۰۰ میلی‌لیتر', 'هوای داخل ریه پس از بازدم عادی'],
    ]
  ),
  h(2, 'کنترل تنفس'),
  p('مرکز تنفس در بصل‌النخاع و پل مغزی، آهنگ و عمق تنفس را تعیین می‌کند. محرک اصلی در حالت عادی، پاسخ یاخته‌های شیمیایی مرکزی به افزایش pH کم (افزایش CO2) مایع مغزی-نخاعی است؛ گیرنده‌های محیطی کاروتید و آئورت فقط در افت شدید اکسیژن (PaO2 زیر ۶۰ mmHg) نقش اصلی را می‌گیرند.'),
  callout('exam', 'نکتهٔ امتحانی', [
    'منحنی تفکیک هموگلوبین را سمت راست‌می‌کند: افزایش CO2، افزایش حرارت، افت pH (اثر بور) و افزایش ۲و3-BPG. نتیجه: آسان‌تر شدن آزادسازی اکسیژن در بافت‌های فعال.',
  ]),
  question('چرا هیپرونتیلاسیون، سردرد و سبک‌سری می‌آورد؟', 'دفع بیش از حد CO2 باعث کمبود CO2 و قلیایی شدن خون می‌شود؛ انقباض عروق مغزی کاهش جریان خون مغزی را به همراه دارد و علائم سبک‌سری و تیرگی دید ظاهر می‌شود.'),
];

const page10 = [
  h(1, 'بخش ۹ — جمع‌بندی، فلش‌کارت‌ها و خودآزمایی'),
  callout('summary', 'خلاصهٔ جزوه در یک نگاه', [
    'قلب با ۵ لیتر بر دقیقه، خون را در دو گردش پمپ می‌کند؛ سیکل قلبی ۰٫۸ ثانیه است و قانون فرانک-استارلینگ، برون‌ده را با پیش‌بار تنظیم می‌کند. فشار شریانی حاصل‌ضرب برون‌ده در مقاومت محیطی است و دو بازو دارد: بازتاب فشاری برای تنظیم ثانیه‌ای و سیستم رنین-آنژیوتانسین-آلدوسترون برای تنظیم ساعت تا روزها. ریه‌ها با تهویهٔ آلوئولی حدود ۴ لیتر بر دقیقه، تعویض گاز را انجام می‌دهند و مرکز تنفس بیش از همه به CO2 حس است.',
  ]),
  h(2, 'فلش‌کارت‌های مرور سریع'),
  keyTerm('برون‌ده قلبی', 'حجم خون پمپ‌شده در یک دقیقه؛ CO = HR × SV؛ مقدار طبیعی ≈ ۵ لیتر بر دقیقه.'),
  keyTerm('پیش‌بار', 'میزان کشیدگی دیوارهٔ بطن پیش از انقباض؛ شاخص بالینی آن حجم پایان دیاستول یا فشار ورید مرکزی است.'),
  keyTerm('پس‌بار', 'بار مقاومتی برابر فشار شریانی که بطن چپ باید بر آن غلبه کند تا خون تخلیه شود.'),
  keyTerm('تهویهٔ آلوئولی', 'بخشی از تهویه که واقعاً به آلوئول می‌رسد و در تبادل گازی سهم دارد؛ VA = (VT − VD) × f.'),
  h(2, 'خودآزمایی'),
  question('با ضربان ۷۰ و حجم ضربه‌ای ۷۰ میلی‌لیتر، برون‌ده قلبی چقدر است؟', '۷۰ × ۷۰ = ۴۹۰۰ میلی‌لیتر ≈ ۴٫۹ لیتر بر دقیقه؛ در محدودهٔ طبیعی ۵ لیتر.'),
  question('در بلاک کامل AV، ضربان‌ساز جایگزین کجاست و آهنگ آن چند است؟', 'یاخته‌های ضربان‌ساز خودِ بطن‌ها (شاخه‌های پورکنژ) با آهنگ ذاتی ۲۰ تا ۴۰ بار در دقیقه.'),
  question('چرا در کم‌کاری تیروئید، مقاومت محیطی افزایش می‌یابد؟', 'کاهش متابولیسم پایه و افت تولید گرما بدن را وادار می‌کند با انقباض عروق پوست، اتلاف حرارت را کم کند؛ نتیجهٔ بالینی آن فشار دیاستول بالاتر است.'),
  hr(),
  p('منبع اصلی مطالب: Guyton & Hall, Textbook of Medical Physiology, 14th ed., ch. 9–14 و 37–41؛ بازنویسی آموزشی به فارسی برای مرور سریع.', [I]),
];

const PAGES = [page1, page2, page3, page4, page5, page6, page7, page8, page9, page10];
const content = doc(PAGES);
const breakCount = content.content.filter((n) => n.type === 'pageBreak').length;

/* tiny HTML render of the doc for export endpoints (client normally sends this) */
function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function renderHtml(nodes) {
  let out = '';
  for (const n of nodes) {
    if (n.type === 'heading') out += `<h${n.attrs.level}>${esc(n.content.map((c) => c.text).join(''))}</h${n.attrs.level}>`;
    else if (n.type === 'paragraph') out += `<p>${esc((n.content || []).map((c) => c.text).join(''))}</p>`;
    else if (n.type === 'bulletList' || n.type === 'orderedList') {
      const tag = n.type === 'bulletList' ? 'ul' : 'ol';
      out += `<${tag}>${n.content.map((li) => `<li>${esc(li.content.map((c) => (c.content || []).map((t2) => t2.text).join('')).join(''))}</li>`).join('')}</${tag}>`;
    } else if (n.type === 'table') {
      out += `<table>` + n.content.map((row) => `<tr>${row.content.map((c) => `<td>${esc(c.content.map((t2) => t2.text).join(''))}</td>`).join('')}</tr>`).join('') + `</table>`;
    } else if (n.type === 'calloutBlock') out += `<div class="edu-block"><div class="edu-title">${esc(n.attrs.title)}</div>${renderHtml(n.content)}</div>`;
    else if (n.type === 'questionBlock') out += `<div class="edu-block edu-question"><div class="edu-title">${esc(n.attrs.question)}</div>${renderHtml(n.content)}</div>`;
    else if (n.type === 'keyTermBlock') out += `<div class="edu-block edu-keyterm"><div class="edu-title">${esc(n.attrs.term)}</div>${renderHtml(n.content)}</div>`;
    else if (n.type === 'exampleBlock') out += `<div class="edu-block edu-example"><div class="edu-title">${esc(n.attrs.title)}</div>${renderHtml(n.content)}</div>`;
    else if (n.type === 'formulaBlock') out += `<div class="edu-block edu-formula"><div class="edu-katex-src">${esc(n.content.map((c) => c.text).join(''))}</div></div>`;
    else if (n.type === 'horizontalRule') out += '<hr/>';
    else if (n.type === 'pageBreak') out += '<div style="page-break-after:always"></div>';
  }
  return out;
}
function plainText(nodes) {
  return nodes.map(function walk(n) {
    if (n.text) return n.text;
    if (Array.isArray(n.content)) return n.content.map(walk).join(' ');
    if (n.type === 'calloutBlock') return `${n.attrs.title}. ` + n.content.map(walk).join(' ');
    if (n.type === 'questionBlock') return `${n.attrs.question} ` + n.content.map(walk).join(' ');
    if (n.type === 'keyTermBlock') return `${n.attrs.term}: ` + n.content.map(walk).join(' ');
    if (n.type === 'exampleBlock') return `${n.attrs.title}. ` + n.content.map(walk).join(' ');
    return '';
  }).join(' ');
}
const html = renderHtml(content.content);
const plain = plainText(content.content);
const words = plain.split(/\s+/).filter(Boolean).length;

/* ── the pipeline run ──────────────────────────────────────────────────── */
(async () => {
  try {
    // 1. register (like the signup form); if the account already exists, log in
    let reg;
    try {
      reg = await req('POST', '/auth/register', { name: 'پدیدآور جزوه', email: 'phys-booklet@test.local', password: 'test1234' });
    } catch (e) {
      if (!String(e).includes('409')) throw e;
      reg = await req('POST', '/auth/login', { email: 'phys-booklet@test.local', password: 'test1234' });
    }
    const token = reg.token;
    step('register/login', { user: reg.user });

    // 2. subject + tags (like the dashboard sidebar)
    const subject = (await req('POST', '/subjects', { name: 'فیزیولوژی', color: '#1d4ed8' }, token)).subject;
    const tags = {};
    for (const name of ['قلبی‌عروقی', 'تنفسی', 'نکته امتحانی']) {
      tags[name] = (await req('POST', '/tags', { name }, token)).tag;
    }
    step('subject+tags', { subject: subject.name, tags: Object.keys(tags) });

    // 3. create the note with all 10 pages (like editor first save)
    const created = (await req('POST', '/notes', {
      title: 'جزوه فیزیولوژی — سیستم قلبی‌عروقی و تنفسی',
      subjectId: subject._id,
      chapter: 'دورهٔ مرور جامع',
      section: 'قلب و ریه',
      content,
      html,
      plainText: plain,
      tags: Object.values(tags).map((x) => x._id),
      wordCount: words,
    }, token)).note;
    step('create-note', { id: created._id, title: created.title, wordCount: created.wordCount, storedPageBreaks: (created.content.content || []).filter((n) => n.type === 'pageBreak').length });

    // 4. autosave-style PATCH (like the debounced editor autosave)
    const edited = (await req('PATCH', `/notes/${created._id}`, {
      content, html, plainText: plain, wordCount: words + 12,
      title: 'جزوه فیزیولوژی — سیستم قلبی‌عروقی و تنفسی (ویرایش ۲)',
      versionReason: 'ذخیرهٔ خودکار — آزمون مسیر',
    }, token)).note;
    step('autosave-patch', { title: edited.title, wordCount: edited.wordCount });

    // 5. GET round-trip: does the stored doc survive?
    const back = (await req('GET', `/notes/${created._id}`, undefined, token)).note;
    const backBreaks = (back.content.content || []).filter((n) => n.type === 'pageBreak').length;
    step('round-trip', { id: back._id, title: back.title, pageBreaks: backBreaks, tagsPopulated: Array.isArray(back.tags) && back.tags.length === 3 && typeof back.tags[0] === 'object' });
    if (backBreaks !== breakCount) throw new Error(`pageBreak mismatch: sent ${breakCount}, stored ${backBreaks}`);
    if (!back.tags?.length || typeof back.tags[0] !== 'object') throw new Error('tags were not populated as objects');

    // 6. list + search (like the notes list & global search pages)
    const list = (await req('GET', '/notes', undefined, token)).notes;
    const search = (await req('GET', `/search?q=${encodeURIComponent('فرانک-استارلینگ')}`, undefined, token)).results;
    const search2 = (await req('GET', `/search?q=${encodeURIComponent('فیزیولوژی')}`, undefined, token)).results;
    step('list+search', { listCount: list.length, hitFrank: search.length > 0, hitSubject: search2.length > 0, snippets: search.length > 0 ? search.map((r) => r.matchedIn) : [] });

    // 7. AI status + a real local action (Persian proofreader)
    const aiStatus = await req('GET', '/ai/status', undefined, token);
    const badText = 'قلب خون را پمپ می کند .بون ده قلبی پنج لیتر است ،پتانسیل استراحت منفی ۷۰ است';
    let aiRun = null;
    try {
      aiRun = await req('POST', '/ai/run', { action: 'correct', text: badText, scope: 'selection', noteId: created._id }, token);
    } catch (e) {
      aiRun = { error: String(e.message || e) };
    }
    step('ai', { provider: aiStatus.provider, actions: aiStatus.actions.filter((a) => a.available).length, runOk: !aiRun.error, result: aiRun.error ? aiRun.error : aiRun.result });

    // 8. exports (Word + HTML)
    const expDoc = await fetch(`${BASE}/export/docx`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ title: back.title, html, subject: 'فیزیولوژی', chapter: 'دورهٔ مرور جامع', footerText: 'پرشین‌نوت — جزوهٔ فیزیولوژی' }),
    });
    const expHtml = await fetch(`${BASE}/export/html`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ title: back.title, html, subject: 'فیزیولوژی', chapter: 'دورهٔ مرور جامع' }),
    });
    const docxLen = (await expDoc.arrayBuffer()).byteLength;
    const htmlLen = (await expHtml.arrayBuffer()).byteLength;
    step('exports', { docxStatus: expDoc.status, docxBytes: docxLen, htmlStatus: expHtml.status, htmlBytes: htmlLen });
    if (!expDoc.ok || docxLen < 1000) throw new Error('docx export failed');

    // 9. versions (autosave snapshots)
    const versions = (await req('GET', `/versions/note/${created._id}`, undefined, token)).versions;
    step('versions', { count: versions.length, reasons: versions.map((v) => v.reason) });

    fs.writeFileSync(OUT, JSON.stringify({ ok: true, noteId: created._id, subjectId: subject._id, words, pageBreaks: breakCount, htmlBytes: html.length, plainWords: words, ...report }, null, 2), 'utf8');
    console.log(`\nDONE — note ${created._id}, ${words} words, ${breakCount} page breaks → ${OUT}`);
  } catch (err) {
    report.error = String(err && err.stack || err);
    fs.writeFileSync(OUT, JSON.stringify({ ok: false, ...report }, null, 2), 'utf8');
    console.error('FAILED:', report.error);
    process.exit(1);
  }
})();
