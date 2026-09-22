/* ────────────────────────────────────────────────────────────────────────
   Vector icon assets for the IconPicker and inline insertion.

   - premium: Phosphor duotone icons (MIT) via Iconify — a curated set of
     monochrome/duotone line icons, recolorable by the user (they use
     currentColor, so we swap the color at insert time).
   - brands:  Simple Icons SVGs (famous-app logos). They keep their official
     brand color by default but can be recolored with the palette too.

   Both sets are downloaded once by `scripts/fetch-icons.mjs` into
   `src/assets/icons/{premium,brands}/` and inlined at build time via Vite
   `?raw` glob imports — fully offline, crisp at any zoom or print size.
   ──────────────────────────────────────────────────────────────────────── */
import { BRAND_FILE_BY_SLUG } from './iconFileMaps';

const premiumRaw = import.meta.glob('../../assets/icons/premium/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const brandRaw = import.meta.glob('../../assets/icons/brands/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const fileName = (p: string) => p.replace(/^.*\//, '');
const premiumByFile = new Map(Object.entries(premiumRaw).map(([p, svg]) => [fileName(p), svg]));
const brandByFile = new Map(Object.entries(brandRaw).map(([p, svg]) => [fileName(p), svg]));

export type IconCat = 'faces' | 'edu' | 'symbols' | 'nature' | 'comms' | 'tools';

export interface PremiumIcon {
  id: string;    /* base name — asset file `src/assets/icons/premium/{id}.svg` */
  cat: IconCat;
  name: string;  /* Persian label */
  kw: string;    /* Persian + English search keywords */
}

/** Curated premium duotone set (Phosphor). ids are resolved by the fetch script */
export const PREMIUM_ICONS: PremiumIcon[] = [
  /* ── صورتک‌ها ── */
  { id: 'smiley', cat: 'faces', name: 'لبخند', kw: 'لبخند خنده smile happy' },
  { id: 'smiley-wink', cat: 'faces', name: 'چشمک', kw: 'چشمک wink' },
  { id: 'smiley-meh', cat: 'faces', name: 'بی‌حال', kw: 'بی‌حال خنثی meh neutral' },
  { id: 'smiley-sad', cat: 'faces', name: 'ناراحت', kw: 'ناراحت غمگین sad' },
  { id: 'smiley-x-eyes', cat: 'faces', name: 'گیج', kw: 'گیج مرده dizzy' },
  { id: 'ghost', cat: 'faces', name: 'روح', kw: 'روح شبح ghost' },
  { id: 'skull', cat: 'faces', name: 'جمجمه', kw: 'جمجمه اسکلت skull' },
  { id: 'robot', cat: 'faces', name: 'ربات', kw: 'ربات robot هوش مصنوعی' },
  { id: 'alien', cat: 'faces', name: 'فضایی', kw: 'فضایی بیگانه alien' },
  { id: 'baby', cat: 'faces', name: 'نوزاد', kw: 'نوزاد بچه baby' },
  { id: 'heart', cat: 'faces', name: 'قلب', kw: 'قلب عشق دل heart love' },
  { id: 'heart-straight', cat: 'faces', name: 'قلب ساده', kw: 'قلب ساده heart' },
  { id: 'thumbs-up', cat: 'faces', name: 'پسند', kw: 'پسند تایید خوب like thumbs up' },

  /* ── آموزش ── */
  { id: 'book-open', cat: 'edu', name: 'کتاب باز', kw: 'کتاب باز خواندن book open' },
  { id: 'book', cat: 'edu', name: 'کتاب', kw: 'کتاب درس مطالعه book study' },
  { id: 'bookmark-simple', cat: 'edu', name: 'نشانک', kw: 'نشانک بوکمارک bookmark' },
  { id: 'pencil-simple', cat: 'edu', name: 'مداد', kw: 'مداد نوشتن pencil' },
  { id: 'pen-nib', cat: 'edu', name: 'قلم', kw: 'قلم خودنویس pen' },
  { id: 'note-pencil', cat: 'edu', name: 'یادداشت', kw: 'یادداشت جزوه note' },
  { id: 'paperclip', cat: 'edu', name: 'گیره کاغذ', kw: 'گیره کلیپ clip paperclip' },
  { id: 'push-pin', cat: 'edu', name: 'سنجاق', kw: 'سنجاق پین pin' },
  { id: 'lightbulb', cat: 'edu', name: 'ایده', kw: 'ایده لامپ bulb idea' },
  { id: 'microscope', cat: 'edu', name: 'میکروسکوپ', kw: 'میکروسکوپ علم microscope' },
  { id: 'flask', cat: 'edu', name: 'آزمایشگاه', kw: 'ارلن آزمایش شیمی flask lab' },
  { id: 'math-operations', cat: 'edu', name: 'ریاضی', kw: 'ریاضی محاسبه math' },
  { id: 'calculator', cat: 'edu', name: 'ماشین‌حساب', kw: 'ماشین‌حساب حساب calculator' },
  { id: 'graduation-cap', cat: 'edu', name: 'فارغ‌التحصیلی', kw: 'دانشگاه فارغ‌التحصیلی graduation cap' },
  { id: 'student', cat: 'edu', name: 'دانش‌آموز', kw: 'دانش‌آموز دانشجو student' },
  { id: 'chalkboard-teacher', cat: 'edu', name: 'معلم', kw: 'معلم تخته کلاس teacher board' },
  { id: 'chart-bar', cat: 'edu', name: 'نمودار', kw: 'نمودار آمار chart' },
  { id: 'chart-line-up', cat: 'edu', name: 'رشد', kw: 'نمودار صعودی رشد growth' },
  { id: 'chart-line-down', cat: 'edu', name: 'افت', kw: 'نمودار نزولی افت decline' },
  { id: 'calendar-blank', cat: 'edu', name: 'تقویم', kw: 'تقویم تاریخ calendar' },
  { id: 'alarm', cat: 'edu', name: 'ساعت زنگ‌دار', kw: 'ساعت زنگ هشدار alarm' },
  { id: 'bell', cat: 'edu', name: 'زنگ', kw: 'زنگ اعلان bell notification' },
  { id: 'folder-open', cat: 'edu', name: 'پوشه', kw: 'پوشه بایگانی folder' },
  { id: 'files', cat: 'edu', name: 'پرونده‌ها', kw: 'پرونده فایل‌ها files' },

  /* ── نمادها ── */
  { id: 'check-circle', cat: 'symbols', name: 'تایید', kw: 'تیک درست تایید check' },
  { id: 'x-circle', cat: 'symbols', name: 'رد', kw: 'ضربدر غلط اشتباه رد cross wrong' },
  { id: 'star', cat: 'symbols', name: 'ستاره', kw: 'ستاره star' },
  { id: 'sparkle', cat: 'symbols', name: 'درخشش', kw: 'درخشش جادو sparkle magic' },
  { id: 'warning-circle', cat: 'symbols', name: 'هشدار', kw: 'هشدار توجه warning' },
  { id: 'warning', cat: 'symbols', name: 'اخطار', kw: 'اخطار خطر danger alert' },
  { id: 'plus-circle', cat: 'symbols', name: 'افزودن', kw: 'بعلاوه مثبت اضافه plus add' },
  { id: 'minus-circle', cat: 'symbols', name: 'کم کردن', kw: 'منفی کم minus' },
  { id: 'percent', cat: 'symbols', name: 'درصد', kw: 'درصد percent' },
  { id: 'divide', cat: 'symbols', name: 'تقسیم', kw: 'تقسیم divide' },
  { id: 'recycle', cat: 'symbols', name: 'بازیافت', kw: 'بازیافت recycle' },
  { id: 'fire', cat: 'symbols', name: 'آتش', kw: 'آتش داغ fire hot' },
  { id: 'drop', cat: 'symbols', name: 'قطره', kw: 'قطره آب drop water' },
  { id: 'target', cat: 'symbols', name: 'هدف', kw: 'هدف نشانه target goal' },
  { id: 'trophy', cat: 'symbols', name: 'جام قهرمانی', kw: 'جام برنده trophy winner' },
  { id: 'medal', cat: 'symbols', name: 'مدال', kw: 'مدال طلا medal gold' },
  { id: 'crown', cat: 'symbols', name: 'تاج', kw: 'تاج پادشاه بهترین crown best' },
  { id: 'lightning', cat: 'symbols', name: 'رعد و برق', kw: 'برق صاعقه انرژی lightning energy' },
  { id: 'sun', cat: 'symbols', name: 'خورشید', kw: 'خورشید آفتاب sun' },
  { id: 'moon', cat: 'symbols', name: 'ماه', kw: 'ماه شب moon night' },
  { id: 'cloud', cat: 'symbols', name: 'ابر', kw: 'ابر هوا cloud weather' },
  { id: 'rainbow', cat: 'symbols', name: 'رنگین‌کمان', kw: 'رنگین‌کمان rainbow' },
  { id: 'snowflake', cat: 'symbols', name: 'برف', kw: 'برف سرد snowflake' },
  { id: 'hourglass', cat: 'symbols', name: 'ساعت شنی', kw: 'ساعت شنی صبر hourglass' },
  { id: 'clock', cat: 'symbols', name: 'ساعت', kw: 'ساعت زمان clock time' },

  /* ── طبیعت ── */
  { id: 'flower', cat: 'nature', name: 'گل', kw: 'گل شکوفه flower' },
  { id: 'flower-lotus', cat: 'nature', name: 'نیلوفر', kw: 'نیلوفر لوتوس lotus' },
  { id: 'flower-tulip', cat: 'nature', name: 'لاله', kw: 'لاله گل tulip' },
  { id: 'tree', cat: 'nature', name: 'درخت', kw: 'درخت جنگل tree forest' },
  { id: 'tree-evergreen', cat: 'nature', name: 'کاج', kw: 'کاج سرو evergreen pine' },
  { id: 'plant', cat: 'nature', name: 'گیاه', kw: 'گیاه گلدان plant' },
  { id: 'leaf', cat: 'nature', name: 'برگ', kw: 'برگ سبز leaf' },
  { id: 'cactus', cat: 'nature', name: 'کاکتوس', kw: 'کاکتوس بیابان cactus' },
  { id: 'apple-logo', cat: 'nature', name: 'سیب', kw: 'سیب میوه apple fruit' },
  { id: 'pizza', cat: 'nature', name: 'پیتزا', kw: 'پیتزا غذا pizza food' },
  { id: 'cake', cat: 'nature', name: 'کیک', kw: 'کیک تولد شیرینی cake birthday' },
  { id: 'coffee', cat: 'nature', name: 'قهوه', kw: 'قهوه چای نوشیدنی coffee tea' },
  { id: 'cat', cat: 'nature', name: 'گربه', kw: 'گربه پیشی حیوان cat' },
  { id: 'dog', cat: 'nature', name: 'سگ', kw: 'سگ حیوان dog' },
  { id: 'bird', cat: 'nature', name: 'پرنده', kw: 'پرنده سهره bird' },
  { id: 'butterfly', cat: 'nature', name: 'پروانه', kw: 'پروانه butterfly' },
  { id: 'fish', cat: 'nature', name: 'ماهی', kw: 'ماهی دریا fish' },
  { id: 'waves', cat: 'nature', name: 'موج', kw: 'موج دریا آب waves sea' },
  { id: 'mountains', cat: 'nature', name: 'کوه', kw: 'کوه قله mountains peak' },
  { id: 'globe', cat: 'nature', name: 'کره زمین', kw: 'زمین کره جهان globe world' },
  { id: 'rocket', cat: 'nature', name: 'موشک', kw: 'موشک فضا پرتاب rocket space' },
  { id: 'soccer-ball', cat: 'nature', name: 'فوتبال', kw: 'فوتبال توپ ورزش soccer sport' },
  { id: 'palette', cat: 'nature', name: 'پالت', kw: 'پالت نقاشی هنر رنگ art paint' },
  { id: 'music-note', cat: 'nature', name: 'نت موسیقی', kw: 'نت موسیقی آهنگ music song' },

  /* ── ارتباط ── */
  { id: 'chat-circle-text', cat: 'comms', name: 'گفتگو', kw: 'گفتگو چت پیام chat message' },
  { id: 'chat-circle-dots', cat: 'comms', name: 'پیام', kw: 'پیام حباب comment message' },
  { id: 'chat-teardrop-dots', cat: 'comms', name: 'چت', kw: 'چت پیام‌رسان teardrop' },
  { id: 'phone-call', cat: 'comms', name: 'تماس', kw: 'تلفن تماس گوشی phone call' },
  { id: 'envelope', cat: 'comms', name: 'نامه', kw: 'نامه پاکت mail envelope' },
  { id: 'envelope-open', cat: 'comms', name: 'پاکت نامه', kw: 'ایمیل پاکت باز email open' },
  { id: 'paper-plane-tilt', cat: 'comms', name: 'ارسال پیام', kw: 'ارسال پیام send plane' },
  { id: 'device-mobile', cat: 'comms', name: 'موبایل', kw: 'موبایل گوشی smartphone mobile' },
  { id: 'laptop', cat: 'comms', name: 'لپ‌تاپ', kw: 'لپ‌تاپ کامپیوتر laptop computer' },
  { id: 'monitor', cat: 'comms', name: 'مانیتور', kw: 'مانیتور دسکتاپ monitor desktop' },
  { id: 'link', cat: 'comms', name: 'لینک', kw: 'لینک پیوند link chain' },
  { id: 'megaphone', cat: 'comms', name: 'بلندگو', kw: 'بلندگو اعلان اطلاعیه megaphone announce' },
  { id: 'microphone', cat: 'comms', name: 'میکروفون', kw: 'میکروفون سخنرانی microphone' },
  { id: 'video-camera', cat: 'comms', name: 'ویدیو', kw: 'دوربین ویدیو فیلم video camera' },
  { id: 'film-slate', cat: 'comms', name: 'سینما', kw: 'فیلم سینما کلیپ film movie' },
  { id: 'headphones', cat: 'comms', name: 'هدفون', kw: 'هدفون موسیقی headphones' },
  { id: 'game-controller', cat: 'comms', name: 'بازی', kw: 'بازی دسته گیم game controller' },
  { id: 'gift', cat: 'comms', name: 'هدیه', kw: 'هدیه کادو جایزه gift present' },
  { id: 'confetti', cat: 'comms', name: 'جشن', kw: 'جشن جشنواره confetti celebrate' },
  { id: 'balloon', cat: 'comms', name: 'بادکنک', kw: 'بادکنک جشن balloon' },

  /* ── اشیا و ابزار ── */
  { id: 'key', cat: 'tools', name: 'کلید', kw: 'کلید رمز key password' },
  { id: 'lock', cat: 'tools', name: 'قفل', kw: 'قفل امنیت lock security' },
  { id: 'shield-check', cat: 'tools', name: 'محافظت', kw: 'سپر محافظت امنیت shield protect' },
  { id: 'compass', cat: 'tools', name: 'قطب‌نما', kw: 'قطب‌نما جهت compass' },
  { id: 'map-pin', cat: 'tools', name: 'موقعیت', kw: 'موقعیت نقشه آدرس map pin location' },
  { id: 'umbrella', cat: 'tools', name: 'چتر', kw: 'چتر باران umbrella' },
  { id: 'pipe-wrench', cat: 'tools', name: 'آچار', kw: 'آچار تعمیر ابزار wrench tool' },
  { id: 'gear', cat: 'tools', name: 'تنظیمات', kw: 'چرخ‌دنده تنظیمات gear settings' },
  { id: 'camera', cat: 'tools', name: 'دوربین', kw: 'دوربین عکاسی camera photo' },
  { id: 'scissors', cat: 'tools', name: 'قیچی', kw: 'قیچی برش scissors cut' },
  { id: 'printer', cat: 'tools', name: 'چاپگر', kw: 'چاپگر پرینت printer print' },
  { id: 'credit-card', cat: 'tools', name: 'کارت بانکی', kw: 'کارت بانکی پرداخت credit card' },
  { id: 'airplane', cat: 'tools', name: 'هواپیما', kw: 'هواپیما سفر airplane travel' },
  { id: 'car', cat: 'tools', name: 'ماشین', kw: 'ماشین خودرو car' },
  { id: 'bus', cat: 'tools', name: 'اتوبوس', kw: 'اتوبوس مدرسه bus' },
  { id: 'person-simple-bike', cat: 'tools', name: 'دوچرخه', kw: 'دوچرخه bicycle bike' },
  { id: 'house', cat: 'tools', name: 'خانه', kw: 'خانه منزل house home' },
  { id: 'flashlight', cat: 'tools', name: 'چراغ‌قوه', kw: 'چراغ‌قوه نور flashlight' },
  { id: 'wifi-high', cat: 'tools', name: 'وای‌فای', kw: 'وای‌فای اینترنت wifi internet' },
  { id: 'bluetooth', cat: 'tools', name: 'بلوتوث', kw: 'بلوتوث bluetooth' },
  { id: 'battery-charging', cat: 'tools', name: 'شارژ', kw: 'باتری شارژ انرژی battery charge' },
];

export const CATEGORIES: Array<{ id: IconCat; label: string }> = [
  { id: 'faces', label: 'صورتک‌ها' },
  { id: 'edu', label: 'آموزش' },
  { id: 'symbols', label: 'نمادها' },
  { id: 'nature', label: 'طبیعت' },
  { id: 'comms', label: 'ارتباط' },
  { id: 'tools', label: 'اشیا و ابزار' },
];

/** premium icon raw SVG (currentColor-based — colorize before use) */
export function premiumSvg(id: string): string | undefined {
  return premiumByFile.get(`${id}.svg`);
}

/** only the curated icons whose asset actually downloaded */
export const PREMIUM_AVAILABLE = PREMIUM_ICONS.filter((p) => premiumSvg(p.id) !== undefined);

export interface BrandMeta {
  slug: string;
  name: string;
  color: string;
  kw: string;
}

/** Famous apps — the «برنامه‌های معروف» tab (official brand color by default) */
export const BRANDS: BrandMeta[] = [
  { slug: 'whatsapp', name: 'واتساپ', color: '#25D366', kw: 'واتساپ whatsapp پیام‌رسان چت' },
  { slug: 'telegram', name: 'تلگرام', color: '#26A5E4', kw: 'تلگرام telegram پیام‌رسان چت' },
  { slug: 'instagram', name: 'اینستاگرام', color: '#E4405F', kw: 'اینستاگرام instagram عکس' },
  { slug: 'x', name: 'ایکس (توییتر)', color: '#0F1419', kw: 'توییتر ایکس twitter x شبکه اجتماعی' },
  { slug: 'facebook', name: 'فیسبوک', color: '#0866FF', kw: 'فیسبوک facebook شبکه اجتماعی' },
  { slug: 'messenger', name: 'مسنجر', color: '#00B2FF', kw: 'مسنجر messenger فیسبوک پیام‌رسان' },
  { slug: 'linkedin', name: 'لینکدین', color: '#0A66C2', kw: 'لینکدین linkedin کاری رزومه' },
  { slug: 'youtube', name: 'یوتیوب', color: '#FF0000', kw: 'یوتیوب youtube ویدیو فیلم' },
  { slug: 'tiktok', name: 'تیک‌تاک', color: '#25F4EE', kw: 'تیک‌تاک tiktok ویدیو' },
  { slug: 'snapchat', name: 'اسنپ‌چت', color: '#F7D200', kw: 'اسنپ‌چت snapchat' },
  { slug: 'pinterest', name: 'پینترست', color: '#BD081C', kw: 'پینترست pinterest عکس' },
  { slug: 'reddit', name: 'ردیت', color: '#FF4500', kw: 'ردیت reddit' },
  { slug: 'discord', name: 'دیسکورد', color: '#5865F2', kw: 'دیسکورد discord بازی گیم چت' },
  { slug: 'slack', name: 'اسلک', color: '#8C4FEB', kw: 'اسلک slack تیم کاری پیام‌رسان' },
  { slug: 'zoom', name: 'زوم', color: '#0B5CFF', kw: 'زوم zoom جلسه کلاس آنلاین ویدئو' },
  { slug: 'signal', name: 'سیگنال', color: '#3A76F0', kw: 'سیگنال signal پیام‌رسان امن' },
  { slug: 'viber', name: 'وایبر', color: '#7360F2', kw: 'وایبر viber پیام‌رسان' },
  { slug: 'line', name: 'لاین', color: '#00C300', kw: 'لاین line پیام‌رسان' },
  { slug: 'wechat', name: 'وی‌چت', color: '#07C160', kw: 'وی‌چت wechat پیام‌رسان' },
  { slug: 'github', name: 'گیت‌هاب', color: '#181717', kw: 'گیت‌هاب github کد برنامه‌نویسی' },
  { slug: 'gitlab', name: 'گیت‌لب', color: '#FC6D26', kw: 'گیت‌لب gitlab کد برنامه‌نویسی' },
  { slug: 'stackoverflow', name: 'استک اورفلو', color: '#F48027', kw: 'استک‌اورفلو stackoverflow سوال برنامه‌نویسی' },
  { slug: 'figma', name: 'فیگما', color: '#F24E1E', kw: 'فیگما figma طراحی رابط کاربری' },
  { slug: 'canva', name: 'کنوا', color: '#00C4CC', kw: 'کنوا canva طراحی گرافیک' },
  { slug: 'googlechrome', name: 'کروم', color: '#4285F4', kw: 'کروم گوگل‌کروم chrome مرورگر' },
  { slug: 'firefox', name: 'فایرفاکس', color: '#FF7139', kw: 'فایرفاکس firefox موزیلا مرورگر' },
  { slug: 'safari', name: 'سافاری', color: '#006CFF', kw: 'سافاری safari مرورگر اپل' },
  { slug: 'microsoftedge', name: 'اج', color: '#0078D7', kw: 'اج مایکروسافت‌اج edge مرورگر' },
  { slug: 'gmail', name: 'جیمیل', color: '#EA4335', kw: 'جیمیل gmail ایمیل گوگل' },
  { slug: 'googledrive', name: 'گوگل درایو', color: '#4285F4', kw: 'گوگل‌درایو googledrive فایل ابری' },
  { slug: 'googledocs', name: 'گوگل داکس', color: '#4285F4', kw: 'گوگل‌داکس googledocs سند نوشتن' },
  { slug: 'googlesheets', name: 'گوگل شیتس', color: '#34A853', kw: 'گوگل‌شیتز googlesheets جدول صفحه‌گسترده' },
  { slug: 'googlemaps', name: 'گوگل مپس', color: '#4285F4', kw: 'گوگل‌مپ googlemaps نقشه' },
  { slug: 'googlemeet', name: 'گوگل میت', color: '#00897B', kw: 'گوگل‌میت googlemeet جلسه آنلاین ویدئو' },
  { slug: 'dropbox', name: 'دراپ‌باکس', color: '#0061FF', kw: 'دراپ‌باکس dropbox فایل ابری' },
  { slug: 'onedrive', name: 'وان‌درایو', color: '#0078D4', kw: 'وان‌درایو onedrive مایکروسافت فایل ابری' },
  { slug: 'microsoftword', name: 'ورد', color: '#2B579A', kw: 'ورد word مایکروسافت متن' },
  { slug: 'microsoftexcel', name: 'اکسل', color: '#217346', kw: 'اکسل excel مایکروسافت جدول' },
  { slug: 'microsoftpowerpoint', name: 'پاورپوینت', color: '#D24726', kw: 'پاورپوینت powerpoint ارائه مایکروسافت' },
  { slug: 'microsoftoutlook', name: 'اوت‌لوک', color: '#0078D4', kw: 'اوت‌لوک outlook ایمیل مایکروسافت' },
  { slug: 'microsoftteams', name: 'تیمز', color: '#6264A7', kw: 'تیمز teams مایکروسافت جلسه کلاس' },
  { slug: 'spotify', name: 'اسپاتیفای', color: '#1DB954', kw: 'اسپاتیفای spotify موسیقی آهنگ' },
  { slug: 'soundcloud', name: 'ساندکلاد', color: '#FF5500', kw: 'ساندکلاد soundcloud موسیقی' },
  { slug: 'twitch', name: 'توییچ', color: '#9146FF', kw: 'توییچ twitch استریم پخش زنده' },
  { slug: 'steam', name: 'استیم', color: '#0B1B28', kw: 'استیم steam بازی گیم' },
  { slug: 'playstation', name: 'پلی‌استیشن', color: '#003791', kw: 'پلی‌استیشن playstation سونی بازی' },
  { slug: 'apple', name: 'اپل', color: '#0B0B0B', kw: 'اپل apple آیفون مک' },
  { slug: 'android', name: 'اندروید', color: '#3DDC84', kw: 'اندروید android گوشی' },
];

export function brandSvgRaw(slug: string): string | undefined {
  const file = BRAND_FILE_BY_SLUG[slug];
  return file ? brandByFile.get(file) : undefined;
}

/** raw SVG markup of a brand logo (alias of brandSvgRaw) */
export function brandSvg(slug: string): string | undefined {
  return brandSvgRaw(slug);
}

/* ── Emoji ─────────────────────────────────────────────────────────────
   Emoji icons are rendered as SVG <text> so the system emoji font draws
   them — no asset download needed, always available offline. */
export function emojiSvg(char: string): string | undefined {
  if (!char) return undefined;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><text x="16" y="24" text-anchor="middle" font-size="26" font-family="'Segoe UI Emoji','Noto Color Emoji',sans-serif">${char}</text></svg>`;
}

/** data URI of an emoji icon */
export function emojiDataUri(char: string): string | undefined {
  const svg = emojiSvg(char);
  return svg ? svgToDataUri(svg) : undefined;
}

const colorizeCache = new Map<string, string>();
/**
 * Recolor an SVG. Duotone/mono icons use currentColor — swap it for the
 * chosen color. Simple-Icons brand logos have no fill — inject one.
 * Cached by the FULL color|svg string — a length+prefix key collided
 * between Phosphor icons that share the same boilerplate header and
 * length, making different icons render with each other's colors
 * (ناراحت came out as لبخند).
 */
export function colorize(svg: string, color: string): string {
  const key = `${color}|${svg}`;
  const cached = colorizeCache.get(key);
  if (cached !== undefined) return cached;
  const out = svg.includes('currentColor')
    ? svg.replace(/currentColor/g, color)
    : svg.replace('<svg', `<svg fill="${color}"`);
  colorizeCache.set(key, out);
  return out;
}

/* data-URI cache — the same icon is reused in the grid and the document */
const uriCache = new Map<string, string>();
/** Encode an SVG string as a self-contained data URI (cache-keyed by svg) */
export function svgToDataUri(svg: string): string {
  let uri = uriCache.get(svg);
  if (!uri) {
    uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    uriCache.set(svg, uri);
  }
  return uri;
}

/** ready-to-insert data URI of a colorized premium icon */
export function premiumDataUri(id: string, color: string): string | undefined {
  const raw = premiumSvg(id);
  return raw ? svgToDataUri(colorize(raw, color)) : undefined;
}

/**
 * Brand data URI — keeps the official brand color unless the user picked a
 * specific color from the palette (then the logo is recolored to it).
 */
export function brandDataUri(slug: string, color?: string): string | undefined {
  const raw = brandSvgRaw(slug);
  if (!raw) return undefined;
  const meta = BRANDS.find((b) => b.slug === slug);
  const effective = !color || color === '#171717' ? (meta?.color ?? '#171717') : color;
  return svgToDataUri(colorize(raw, effective));
}
