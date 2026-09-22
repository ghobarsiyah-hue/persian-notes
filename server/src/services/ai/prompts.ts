import { AI_ACTION_LABELS, type AIRequestContext } from './types.js';

/**
 * Builds the Persian system prompt for an action.
 * Ground rules given to the model:
 *  - never invent facts, preserve meaning and scientific accuracy
 *  - output Persian (formal academic), keep Latin scientific terms intact
 *  - return ONLY the transformed text (no explanations)
 */
export function buildSystemPrompt(action: AIRequestContext['action']): string {
  const base = [
    'تو یک ویرایشگر حرفه‌ای جزوه‌های درسی و علمی فارسی هستی.',
    'قوانین مهم:',
    '۱) هرگز اطلاعات علمی جدیدی اضافه نکن و معنا و صحت محتوا را تغییر نده (مگر در «ادامه بده»).',
    '۲) اصطلاحات لاتین، نام داروها، اختصارات، واحدها و فرمول‌ها را دقیقاً حفظ کن.',
    '۳) از نیم‌فاصله درست استفاده کن (می‌، نمی‌، ‌ها، ‌تر، ‌ترین).',
    '۴) فقط متن نهایی را برگردان؛ بدون توضیح، بدون پیش‌گفتار، بدون علامت نقل‌قول اضافه.',
    '۵) پاسخ را به فارسی معیار و لحن دانشگاهی بنویس.',
  ].join('\n');

  const perAction: Record<string, string> = {
    proofread:
      'وظیفه: اصلاح نگارشی متن (غلط‌های املایی، فاصله‌گذاری، نیم‌فاصله، علائم سجاوندی، ساخت جمله) بدون تغییر هیچ‌گونه معنا یا اطلاعات. محاوره را به فارسی معیار تبدیل کن.',
    professionalize:
      'وظیفه: روان‌تر و خواناتر کردن متن با حفظ کامل معنا؛ جمله‌بندی آکادمیک، بدون افزودن اطلاعات جدید.',
    summarize: 'وظیفه: خلاصه‌کردن متن با حفظ نکات کلیدی؛ خروجی به شکل پاراگراف فشرده یا فهرست کوتاه.',
    simplify:
      'وظیفه: توضیح همان محتوا با زبان ساده‌تر برای دانشجو؛ دقت علمی حفظ شود، اصطلاحات تخصصی با معادل ساده در پرانتز.',
    key_points:
      'وظیفه: استخراج نکات مهم متن به شکل فهرست خط‌چین (هر مورد یک خط کوتاه). فقط نکات واقعاً موجود در متن.',
    exam_points:
      'وظیفه: استخراج نکات امتحانی و تست‌پذیر (اعداد، نام‌ها، روابط، استثناها) به شکل فهرست کوتاه و دقیق.',
    questions:
      'وظیفه: از متن ۳ تا ۵ سوال مطالعه‌ای با پاسخ کوتاه بساز. قالب هر مورد:\nس: ...\nج: ...',
    flashcards:
      'وظیفه: از متن فلش‌کارت بساز. قالب هر مورد در یک خط:\nپرسش ::: پاسخ',
    table:
      'وظیفه: اگر اطلاعات متن ساختار جدول‌پذیر دارد، آن را به جدول Markdown تبدیل کن (ردیف اول سرستون‌ها). اگر جدول‌پذیر نیست، دقیقاً همین را در یک جمله بگو: «این متن ساختار جدولی ندارد.»',
    continue:
      'وظیفه: نوشتن ادامهٔ متن با همان سبک، لحن و سطح؛ حداکثر ۳ تا ۵ جمله. از اطلاعات متن به‌عنوان بافت استفاده کن و خارج از موضوع نرو.',
    structure:
      'وظیفه: متن به‌هم‌ریخته را به یادداشت ساختارمند تبدیل کن: از تیترهای Markdown (##، ###)، فهرست‌ها و **متن پررنگ** استفاده کن. هیچ اطلاعات جدیدی اضافه نکن؛ فقط بازسازماندهی کن.',
  };

  return `${base}\n\n${perAction[action] ?? 'وظیفه: بازنویسی دقیق متن با حفظ کامل معنا.'}`;
}

export function buildUserPrompt(ctx: AIRequestContext): string {
  const parts: string[] = [];
  const note = ctx.note;
  const ctxLines = [
    note?.subject ? `درس/موضوع: ${note.subject}` : null,
    note?.chapter ? `فصل: ${note.chapter}` : null,
    note?.sectionTitle ? `بخش فعلی: ${note.sectionTitle}` : null,
  ].filter(Boolean);
  if (ctxLines.length) parts.push(`زمینه سند:\n${ctxLines.join('\n')}`);
  const scopeLabel: Record<string, string> = {
    selection: 'متن انتخاب‌شده',
    paragraph: 'پاراگراف فعلی',
    section: 'بخش فعلی سند',
    document: 'کل سند',
  };
  parts.push(`دامنه: ${scopeLabel[ctx.scope] ?? 'متن'}`);
  if (ctx.instruction) parts.push(`درخواست اضافه کاربر: ${ctx.instruction}`);
  parts.push(`عملیات: ${AI_ACTION_LABELS[ctx.action]}`);
  parts.push(`متن:\n"""\n${ctx.text}\n"""`);
  return parts.join('\n\n');
}
