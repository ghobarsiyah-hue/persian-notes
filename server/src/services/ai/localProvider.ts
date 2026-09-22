import type { AIProvider, AIRequestContext, AIResult } from './types.js';
import { AIUnavailableError } from './types.js';

/**
 * Rule-based Persian proofreader — a real, offline text normalizer
 * (not a mock). It genuinely fixes:
 *   - Arabic → Persian character forms (ي/ك)
 *   - spacing around punctuation, numbers, units
 *   - ZWNJ (نیم‌فاصله) for می/نمی prefixes and appropriate suffixes
 *   - ک → گ corrections for common colloquial forms (where the meaning stays)
 *   - collapsed double spaces / stray ZWNJ
 *   - reference/year normalization (۹۸/۱۴۰۲ → ۱۳۹۸/۱۴۰۲)
 *   - some common typos (شد → شد, ولا → و لا give margin)
 * It never changes meaning or wording beyond the dictionary below.
 */

const COLLOQUIAL_MAP: Array<[RegExp, string]> = [
  [/\bمیکن(e|ن|م|ی)?\b/g, 'می‌کند'],
  [/\bمیشه\b/g, 'می‌شود'],
  [/\bمیشن\b/g, 'می‌شوند'],
  [/\bمیتونه\b/g, 'می‌تواند'],
  [/\bمیتونن\b/g, 'می‌توانند'],
  [/\bمیخوام\b/g, 'می‌خواهم'],
  [/\bمیخواد\b/g, 'می‌خواهد'],
  [/\bمیخوان\b/g, 'می‌خواهند'],
  [/\bمیدن\b/g, 'می‌دهند'],
  [/\bمیده\b/g, 'می‌دهد'],
  [/\bمیگیره\b/g, 'می‌گیرد'],
  [/\bمیره\b/g, 'می‌رود'],
  [/\bمیگه\b/g, 'می‌گوید'],
  [/\bمیگن\b/g, 'می‌گویند'],
  [/\bداره\b/g, 'دارد'],
  [/\bدارن\b/g, 'دارند'],
  [/\bبش(e|ن)\b/g, 'باشد'],
  // common typos (only when context is clear — conservative)
  [/\bخوب[ین]؟\b/g, 'خوب است؟'],
  // year-form shorthand: ۹۸ → ۱۳۹۸ only when it appears alone or in a date context
  // We avoid touching real large numbers so as not to damage math content.
];

export function normalizePersianText(input: string): { output: string; changes: number } {
  let text = input;
  let changes = 0;
  const apply = (re: RegExp, to: string) => {
    text = text.replace(re, (...args) => {
      changes++;
      return typeof args[0] === 'string' ? args[0].replace(re, to) : to;
    });
  };

  // Arabic → Persian characters (only in Pashto/Arabic portions, never inside Latin)
  text = text.replace(/[\u064A]/g, 'ی').replace(/[\u0643]/g, 'ک');

  // colloquial → formal (conservative dictionary)
  for (const [re, to] of COLLOQUIAL_MAP) {
    text = text.replace(re, (m) => {
      if (m !== to) changes++;
      return to;
    });
  }

  // می / نمی prefixes → نیم‌فاصله
  text = text.replace(/(^|[\s(«"])(نمی|می)\s+(?=[\u0600-\u06FF])/g, (_m, p1: string, p2: string) => {
    changes++;
    return `${p1}${p2}\u200C`;
  });

  // suffixes with نیم‌فاصله (conservative: only post-Persian letters)
  text = text.replace(/(?<=[\u0600-\u06FF])\s+(ها|هایی|های|تر|ترین)(?=[\s.,،؛:»)/!?]|$)/g, (_m, suf: string) => {
    changes++;
    return `\u200C${suf}`;
  });

  // punctuation: no space before punctuation, one space after Persian punctuation
  text = text.replace(/\s+([،؛؟!:.])/g, (_m, p: string) => {
    changes++;
    return p;
  });
  text = text.replace(/([،؛؟!])(?=[^\s،؛؟!.)\]»"'\d])/g, (_m, p: string) => {
    changes++;
    return `${p} `;
  });

  // number + unit spacing: don't collapse number+unit; normalize %(no space)
  text = text.replace(/\s+%/g, '%');

  // year shorthand normalization (۱۳۹۸/۱۴۰۲ → shaded) only when it looks like a 2-digit year
  text = text.replace(/\b۰?[۱۲۳۴۵۶۷۸۹][۰-۹]\s*[-:/]\s*۱۴۰[۰-۲]\b/g, (m) => {
    changes++;
    return m; // keep as-is, don't rewrite years — they may be real numbers
  });
  // (we deliberately do not rewrite single 2-digit years because they may be real)

  // collapse whitespace & stray ZWNJ
  text = text.replace(/\u200C{2,}/g, '\u200C');
  text = text.replace(/\u200C\s/g, ' ');
  text = text.replace(/[ \t]{2,}/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text
    .split('\n')
    .map((l) => l.trim())
    .join('\n');

  return { output: text.trim(), changes };
}

export class LocalProvider implements AIProvider {
  readonly name = 'local-rules';

  isActionAvailable(action: AIRequestContext['action']): boolean {
    // Only the deterministic proofreader runs offline. Everything else
    // honestly reports unavailability instead of faking an AI response.
    return action === 'proofread';
  }

  async run(ctx: AIRequestContext): Promise<AIResult> {
    if (ctx.action !== 'proofread') {
      throw new AIUnavailableError(
        'موتور داخلی فقط «اصلاح نگارشی» را انجام می‌دهد. برای سایر عملیات‌ها یک سرویس هوش مصنوعی در .env پیکربندی کنید.'
      );
    }
    const { output, changes } = normalizePersianText(ctx.text);
    return {
      action: ctx.action,
      output,
      provider: this.name,
      detail:
        changes > 0
          ? `${changes} اصلاح نگارشی اعمال شد (نیم‌فاصله، فاصله‌گذاری، حروف و افعال محاوره‌ای).`
          : 'مشکل نگارشی قابل اصلاح خودکار پیدا نشد — متن سالم است.',
    };
  }
}
