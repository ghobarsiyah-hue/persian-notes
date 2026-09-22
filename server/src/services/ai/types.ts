export type AIAction =
  | 'proofread' // اصلاح نگارشی
  | 'professionalize' // حرفه‌ای‌سازی متن
  | 'summarize' // خلاصه کن
  | 'simplify' // ساده‌تر توضیح بده
  | 'key_points' // ساخت نکات مهم
  | 'exam_points' // ساخت نکات امتحانی
  | 'questions' // ساخت سوال
  | 'flashcards' // ساخت فلش‌کارت
  | 'table' // ساخت جدول
  | 'continue' // ادامه بده
  | 'structure'; // مرتب‌سازی

export const AI_ACTION_LABELS: Record<AIAction, string> = {
  proofread: 'اصلاح نگارشی',
  professionalize: 'حرفه‌ای‌سازی متن',
  summarize: 'خلاصه کن',
  simplify: 'ساده‌تر توضیح بده',
  key_points: 'ساخت نکات مهم',
  exam_points: 'ساخت نکات امتحانی',
  questions: 'ساخت سوال',
  flashcards: 'ساخت فلش‌کارت',
  table: 'ساخت جدول',
  continue: 'ادامه بده',
  structure: 'مرتب‌سازی',
};

export type AIScope = 'selection' | 'paragraph' | 'section' | 'document';

export interface AIRequestContext {
  action: AIAction;
  text: string;
  scope: AIScope;
  instruction?: string;
  note?: {
    title?: string;
    subject?: string;
    chapter?: string;
    sectionTitle?: string;
  };
}

export interface AIResult {
  action: AIAction;
  output: string;
  provider: string;
  /** plain text summary of what happened (shown to the user) */
  detail?: string;
}

export interface AIProvider {
  readonly name: string;
  isActionAvailable(action: AIAction): boolean;
  run(ctx: AIRequestContext): Promise<AIResult>;
}

export class AIUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AIUnavailableError';
  }
}

export const AI_NOT_CONFIGURED =
  'این عملیات به یک سرویس هوش مصنوعی نیاز دارد. در فایل .env مقدار AI_PROVIDER را روی openai بگذارید و OPENAI_API_KEY را وارد کنید. عملیات «اصلاح نگارشی» با موتور داخلی بدون اینترنت انجام می‌شود.';
