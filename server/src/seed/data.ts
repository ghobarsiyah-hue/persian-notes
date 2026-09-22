import {
  doc,
  p,
  h,
  callout,
  question,
  keyTerm,
  example,
  formula,
  equation,
  pInline,
  ul,
  ol,
  table,
  hr,
  type TNode,
} from './builders.js';
import { PHYSIOLOGY_BOOKLET } from './physiologyBooklet.js';

export interface SeedTemplate {
  key: string;
  name: string;
  description: string;
  category: string;
  style: Record<string, unknown>;
  content: TNode;
}

const PARA =
  'در این بخش مطالب اصلی را بنویسید. برای درج بلوک‌های آموزشی کافی است کاراکتر / را تایپ کنید.';

export const SEED_TEMPLATES: SeedTemplate[] = [
  {
    key: 'university',
    name: 'جزوه دانشگاهی',
    description: 'ساختار استاندارد جزوه با فصل‌بندی، تعاریف و نکات مهم',
    category: 'دانشگاهی',
    style: { fontSize: 16, lineHeight: 2, headingScale: 1.2 },
    content: doc(
      h(1, 'عنوان جزوه'),
      p('نام درس: … | استاد: … | نیم‌سال: …'),
      h(2, 'فصل اول'),
      callout('definition', 'تعریف', ['تعریف اصطلاح اصلی این فصل را اینجا بنویسید.']),
      p(PARA),
      callout('important', 'نکته مهم', ['نکات کلیدی فصل اول را اینجا یادداشت کنید.']),
      h(2, 'فصل دوم'),
      p(PARA)
    ),
  },
  {
    key: 'medical',
    name: 'جزوه پزشکی',
    description: 'مناسب دروس علوم پایه پزشکی با اصطلاحات لاتین و بلوک‌های بالینی',
    category: 'پزشکی',
    style: { fontSize: 15, lineHeight: 2.1 },
    content: doc(
      h(1, 'عنوان درس پزشکی'),
      callout('definition', 'تعریف', [
        'Acetylcholine: ناقل عصبی در محل اتصال عصبی–عضلانی.',
      ]),
      h(2, 'مکانیسم عمل'),
      p('مکانیسم را با حفظ اصطلاحات لاتین توضیح دهید؛ مثلاً: Nicotinic receptors در غشای پس‌سیناپسی.'),
      callout('exam', 'نکته امتحانی', [
        'نکات تست‌پذیر مانند اعداد، نام‌ها و استثناها را اینجا بنویسید.',
      ]),
      h(2, 'جدول مقایسه'),
      table(
        ['ویژگی', 'سیستم الف', 'سیستم ب'],
        [
          ['مکان', '…', '…'],
          ['عملکرد', '…', '…'],
        ]
      )
    ),
  },
  {
    key: 'biology',
    name: 'جزوه زیست‌شناسی',
    description: 'ساختار موضوعی زیست‌شناسی با اصطلاحات کلیدی',
    category: 'دبیرستان / دانشگاه',
    style: { fontSize: 16, lineHeight: 2 },
    content: doc(
      h(1, 'فصل: سلول'),
      keyTerm('اندامک', 'ساختار تخصص‌یافته درون سلول که عملکرد مشخصی دارد.'),
      h(2, 'میتوکندری'),
      ul(
        'تولید ATP از طریق تنفس سلولی',
        'دارای دو غشا؛ غشای داخلی چین‌خوردگی‌هایی به نام کریستا دارد',
        'دارای DNA مستقل'
      ),
      callout('warning', 'توجه', [
        'تفاوت غشای داخلی و خارجی در امتحانات پرتکرار است.',
      ])
    ),
  },
  {
    key: 'physiology',
    name: 'جزوه فیزیولوژی',
    description: 'قالب فیزیولوژی با فرمول‌ها و مکانیسم‌ها',
    category: 'علوم پایه',
    style: { fontSize: 15, lineHeight: 2.1, accentColor: '#1d4ed8' },
    content: doc(
      h(1, 'فیزیولوژی — سیستم قلبی‌عروقی'),
      formula('CO = HR \\times SV', 'برون‌ده قلبی = ضربان قلب × حجم ضربه‌ای'),
      h(2, 'سیکل قلبی'),
      ol('سیستول دهلیزی', 'سیستول بطنی', 'دیاستول عمومی'),
      callout('exam', 'نکته امتحانی', [
        'مدت زمان هر فاز و فشارهای حاکم را به خاطر بسپارید.',
      ])
    ),
  },
];

SEED_TEMPLATES.push(
  {
    key: 'math-equations',
    name: 'آزمایش معادلات ریاضی',
    description: 'صفحهٔ آزمایش ویرایشگر معادلهٔ ساختاریافته — همهٔ ساختارها و نمادها',
    category: 'آزمایش',
    style: { fontSize: 16, lineHeight: 2 },
    content: doc(
      h(1, 'آزمایش معادلات ریاضی'),
      p('روی هر فرمول کلیک کنید تا ویرایش شود؛ تب «معادله» در ریبون باز می‌شود. برای ساخت سریع: x^2 و x_i و a/b را تایپ کنید.'),

      h(2, 'مقدمات — توان، اندیس، کسر'),
      pInline(['مجموع مربعات: ', equation('x^2 + y^2 = z^2', { display: false }), ' — فیثاغورس']),
      equation('a^2 + b^2 = c^2', { numbered: true }),
      equation('\frac{a}{b} + \frac{c}{d} = \frac{ad + cb}{bd}'),
      equation('x_1 = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}'),

      h(2, 'رادیکال و انتگرال'),
      equation('\sqrt{x^2 + 1} + \sqrt[3]{x+7}'),
      equation('\int_0^1 x^2 dx = \frac{1}{3}', { numbered: true }),
      equation('\int\int\int f(x,y,z) dxdydz'),
      equation('\oint_C \vec{F} \cdot d\vec{r} = 0'),

      h(2, 'سیگما و حد'),
      equation('\sum_{i=1}^{n} i = \frac{n(n+1)}{2}'),
      equation('\prod_{k=1}^{n} k = n!'),
      equation('\lim_{x \to 0} \frac{\sin x}{x} = 1'),

      h(2, 'ماتریس و دستگاه معادلات'),
      equation('\begin{pmatrix} a & b \\ c & d \end{pmatrix} \begin{pmatrix} x \\ y \end{pmatrix} = \begin{pmatrix} e \\ f \end{pmatrix}'),
      equation('A = \begin{pmatrix} 2 & 0 & 1 \\ 3 & 5 & 7 \end{pmatrix}'),

      h(2, 'حالت‌ها (تکه‌ای)'),
      equation('f(x) = \begin{cases} x^2 & x > 0 \\ 0 & x = 0 \\ -x & x < 0 \end{cases}'),

      h(2, 'توابع و نمادها'),
      equation('\sin^2\theta + \cos^2\theta = 1'),
      equation('\log_2 8 = 3, \quad \ln e = 1'),
      pInline(['حاصل‌ضرب داخلی: ', equation('\vec{u} \cdot \vec{v} = |\vec{u}||\vec{v}|\cos\theta', { display: false }), ' و گرادیان ', equation('\nabla f', { display: false }), ' در نقطهٔ بحرانی صفر است.']),
      equation('\alpha + \beta + \gamma = \pi'),
      equation('\forall \epsilon > 0 \ \exists \delta > 0'),

      h(2, 'ترکیب پیچیده'),
      equation('y = \frac{\sqrt{x^2 + 1}}{\int_0^1 f(t) dt}', { numbered: true }),
      equation('e^{i\pi} + 1 = 0'),
      p('نکته: فرمول‌های درون‌متنی با Enter به متن برمی‌گردند؛ Tab بین جاهای خالی می‌چرخد.')
    ),
  },
  {
    key: 'anatomy',
    name: 'جزوه آناتومی',
    description: 'قالب آناتومی با تکیه بر ساختارها و روابط فضایی',
    category: 'علوم پایه',
    style: { fontSize: 15, lineHeight: 2 },
    content: doc(
      h(1, 'آناتومی'),
      callout('definition', 'تعریف', ['اصطلاح تشریحی و معادل فارسی آن را وارد کنید.']),
      h(2, 'ساختارهای مهم'),
      ul('منشأ', 'مسیر', 'خون‌رسانی', 'عصب‌گیری'),
      callout('important', 'نکته مهم', ['روابط فضایی بین ساختارها را با شکل مرور کنید.'])
    ),
  },
  {
    key: 'biochemistry',
    name: 'جزوه بیوشیمی',
    description: 'قالب بیوشیمی با فرمول‌های شیمیایی و مسیرهای متابولیک',
    category: 'علوم پایه',
    style: { fontSize: 15, lineHeight: 2 },
    content: doc(
      h(1, 'بیوشیمی'),
      formula('C_6H_{12}O_6 + 6O_2 \\rightarrow 6CO_2 + 6H_2O', 'واکنش کلی تنفس سلولی'),
      h(2, 'مراحل مسیر'),
      table(
        ['مرحله', 'مکان', 'خروجی'],
        [
          ['گلیکولیز', 'سیتوپلاسم', '۲ ATP'],
          ['چرخه کربس', 'ماتریکس میتوکندری', 'NADH, FADH₂'],
        ]
      )
    ),
  },
  {
    key: 'exam-summary',
    name: 'خلاصه امتحانی',
    description: 'فشرده‌ترین شکل جزوه برای شب امتحان',
    category: 'مرور',
    style: { fontSize: 14, lineHeight: 1.8, pageMargin: 15 },
    content: doc(
      h(1, 'خلاصه امتحانی'),
      callout('summary', 'خلاصه', ['مهم‌ترین موارد در چند خط']),
      ul('نکته ۱', 'نکته ۲', 'نکته ۳'),
      callout('exam', 'نکته امتحانی', ['پرتکرارترین تست‌های این مبحث'])
    ),
  },
  {
    key: 'quick-review',
    name: 'مرور سریع',
    description: 'سوال و جواب‌های کوتاه برای مرور روزانه',
    category: 'مرور',
    style: { fontSize: 15, lineHeight: 2 },
    content: doc(h(1, 'مرور سریع'), question('سوال اول؟', 'پاسخ کوتاه.'), question('سوال دوم؟', 'پاسخ کوتاه.')),
  },
  {
    key: 'flashcards',
    name: 'فلش‌کارت',
    description: 'مجموعه کارت‌های پرسش و پاسخ',
    category: 'مرور',
    style: { fontSize: 15, lineHeight: 2 },
    content: doc(
      h(1, 'فلش‌کارت‌ها'),
      keyTerm('اصطلاح اول', 'معنی یا تعریف کوتاه آن.'),
      keyTerm('اصطلاح دوم', 'معنی یا تعریف کوتاه آن.'),
      hr(),
      p('برای افزودن کارت جدید، بلوک «اصطلاح کلیدی» را از منوی / درج کنید.')
    ),
  }
);

export interface SeedNote {
  title: string;
  chapter: string;
  section: string;
  subjectName: string;
  tags: string[];
  content: TNode;
  /** stable key so multi-seed runs never duplicate the same note */
  seedKey?: string;
}

export const SEED_NOTES: SeedNote[] = [
  {
    title: 'سیکل قلبی و برون‌ده قلبی',
    chapter: 'سیستم قلبی‌عروقی',
    section: 'سیکل قلبی',
    subjectName: 'فیزیولوژی',
    tags: ['فیزیولوژی', 'امتحان', 'مهم'],
    content: doc(
      h(1, 'سیکل قلبی'),
      callout('definition', 'تعریف', [
        'سیکل قلبی به مجموعه رویدادهای مکانیکی قلب از ابتدای یک ضربان تا ابتدای ضربان بعدی گفته می‌شود.',
      ]),
      h(2, 'فازهای سیکل قلبی'),
      ol('سیستول دهلیزی', 'سیستول بطنی (شامل فاز انقباض ایزومتریک و فاز تخلیه)', 'دیاستول عمومی'),
      h(2, 'برون‌ده قلبی'),
      formula('CO = HR \\times SV', 'برون‌ده قلبی برابر ضربان قلب در حجم ضربه‌ای است.'),
      p(
        'برون‌ده قلبی (Cardiac Output) در فرد بزرگ‌سال سالم در حالت استراحت حدود ۵ لیتر بر دقیقه است. این مقدار در ورزش می‌تواند تا ۴ برابر افزایش یابد.'
      ),
      callout('exam', 'نکته امتحانی', [
        'مقدار برون‌ده قلبی استراحتی (۵ لیتر بر دقیقه) و ظرفیت افزایش تا ۴ برابر در ورزش، نکته پرتکرار تست است.',
        'کوتاه‌ترین فاز سیکل قلبی، سیستول دهلیزی است.',
      ]),
      question(
        'ضربان قلب شخصی ۷۰ بار در دقیقه و حجم ضربه‌ای او ۷۰ میلی‌لیتر است؛ برون‌ده قلبی چقدر است؟',
        'CO = 70 × 70 = 4900 میلی‌لیتر در دقیقه (حدود ۵ لیتر).'
      ),
      table(
        ['فاز', 'دریچه دهلیزی-بطنی', 'دریچه سینی‌لونار', 'حجم بطن'],
        [
          ['سیستول بطنی', 'بسته', 'باز', 'کاهش می‌یابد'],
          ['دیاستول عمومی', 'باز', 'بسته', 'افزایش می‌یابد'],
        ]
      )
    ),
  },
  PHYSIOLOGY_BOOKLET,
];

SEED_NOTES.push(
  {
    title: 'میتوکندری و تنفس سلولی',
    chapter: 'اندامک‌های سلولی',
    section: 'میتوکندری',
    subjectName: 'زیست‌شناسی',
    tags: ['مهم', 'مرور', 'علوم_پایه'],
    content: doc(
      h(1, 'میتوکندری'),
      callout('definition', 'تعریف', [
        'میتوکندری اندامکی است که نقش اصلی آن تولید ATP است و دارای دو غشا می‌باشد. غشای داخلی آن دارای چین‌خوردگی‌هایی به نام کریستا است.',
      ]),
      h(2, 'وظیفه اصلی'),
      p('تولید ATP از طریق تنفس سلولی (Cellular Respiration).'),
      h(2, 'ساختار'),
      ul(
        'دارای دو غشا: خارجی صاف و داخلی چین‌خورده',
        'چین‌خوردگی‌های غشای داخلی کریستا (Cristae) نام دارند',
        'فضای درونی غشای داخلی: ماتریکس (Matrix)',
        'دارای DNA و ریبوزوم مستقل (نیمه‌مستقل)'
      ),
      keyTerm('کریستا', 'چین‌خوردگی‌های غشای داخلی میتوکندری که سطح واکنش‌های تنفس سلولی را افزایش می‌دهند.'),
      formula('C_6H_{12}O_6 + 6O_2 \\rightarrow 6CO_2 + 6H_2O + ATP', 'واکنش کلی تنفس سلولی'),
      example('چرا کریستا اهمیت دارد؟', [
        'افزایش سطح غشای داخلی باعث جایگاه بیشتر آنزیم‌های زنجیره انتقال الکترون و ATP سنتاز می‌شود؛ بنابراین سرعت تولید ATP بیشتر می‌شود.',
      ])
    ),
  },
  {
    title: 'گلیکولیز — مسیر و تنظیم',
    chapter: 'متابولیسم کربوهیدرات‌ها',
    section: 'گلیکولیز',
    subjectName: 'بیوشیمی',
    tags: ['بیوشیمی', 'امتحان'],
    content: doc(
      h(1, 'گلیکولیز (Glycolysis)'),
      callout('definition', 'تعریف', [
        'گلیکولیز مسیر تجزیه گلوکز به دو مولکول پیرووات است که در سیتوپلاسم همه سلول‌ها انجام می‌شود و به اکسیژن نیازی ندارد.',
      ]),
      h(2, 'مراحل کلیدی'),
      ul(
        'فاز سرمایه‌گذاری: مصرف ۲ ATP',
        'فاز برداشت: تولید ۴ ATP و ۲ NADH',
        'خروجی خالص: ۲ ATP، ۲ NADH و ۲ پیرووات',
        'آنزیم محدودکننده سرعت: فسفوفروکتوکیناز-۱ (PFK-1)'
      ),
      callout('exam', 'نکته امتحانی', [
        'آنزیم PFK-1 اصلی‌ترین نقطه تنظیمی گلیکولیز است و ATP به‌صورت آلوستریک از آن جلوگیری می‌کند.',
        'گلیکولیز در سیتوپلاسم رخ می‌دهد، نه در میتوکندری.',
      ]),
      question('خروجی خالص یک دور گلیکولیز از هر مولکول گلوکز چیست؟', '۲ ATP، ۲ NADH و ۲ مولکول پیرووات.')
    ),
  }
);
