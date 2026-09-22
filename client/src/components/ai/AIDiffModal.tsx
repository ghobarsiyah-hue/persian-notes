import { useState } from 'react';
import { Spinner, Button } from '@/components/ui';
import { LeftDock } from '@/components/editor/LeftDock';
import type { AIResult } from '@/types';

interface Props {
  open: boolean;
  result: AIResult | null;
  running: boolean;
  /** what the AI is replacing — shown for comparison */
  originalText: string;
  actionLabel: string;
  detail?: string;
  error?: string;
  onAccept: (output: string, mode: 'replace' | 'insert') => void;
  onClose: () => void;
}

/**
 * AI result — docked on the LEFT side of the editor (item ۹): the same
 * LeftDock surface as the print preview. Nothing is applied automatically;
 * the panel always ends with an explicit accept/reject step.
 */
export function AIDiffModal({ open, result, running, originalText, actionLabel, detail, error, onAccept, onClose }: Props) {
  const [mode, setMode] = useState<'replace' | 'insert'>('replace');

  /* actions live in the dock header — primary submit + quiet dismiss */
  const headerActions = !running && result ? (
    <>
      <Button
        size="sm"
        variant="primary"
        onClick={() => onAccept(result.output, mode)}
        title={mode === 'replace' ? 'جایگزینی متن اصلی با پیشنهاد' : 'درج پیشنهاد در ادامه متن'}
      >
        {mode === 'replace' ? 'پذیرش و جایگزینی' : 'پذیرش و درج'}
      </Button>
    </>
  ) : undefined;

  return (
    <LeftDock
      open={open}
      onClose={onClose}
      title={`نتیجه دستیار — ${actionLabel}`}
      subtitle={running ? 'در حال پردازش…' : result ? 'هیچ تغییری بدون تأیید شما اعمال نمی‌شود' : undefined}
      actions={headerActions}
    >
      {running && (
        <div className="flex items-center justify-center gap-3 py-16 text-[13px] text-ink-500">
          <Spinner className="h-5 w-5" />
          در حال پردازش…
        </div>
      )}

      {!running && error && (
        <p role="alert" className="m-4 rounded-lg bg-red-50 px-3 py-2.5 text-[12.5px] leading-5 text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {!running && !error && result && (
        <div className="flex min-h-full flex-col">
          {detail && (
            <p className="mx-4 mt-3 rounded-lg bg-ink-100 px-3 py-2 text-[11.5px] leading-5 text-ink-600 dark:bg-ink-800 dark:text-ink-300">
              {detail}
            </p>
          )}

          {/* stacked original → suggestion: in a narrow dock the two-column
              comparison cramped the text; a vertical flow reads naturally */}
          <div className="space-y-3 p-4">
            <section aria-label="متن اصلی">
              <h3 className="mb-1 text-[11px] font-semibold tracking-[0.02em] text-ink-500">متن اصلی</h3>
              <div className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg px-3 py-2.5 text-[13px] leading-7 text-ink-700 shadow-ring dark:text-ink-200" dir="rtl">
                {originalText || '—'}
              </div>
            </section>
            <section aria-label="پیشنهاد دستیار">
              <h3 className="mb-1 text-[11px] font-semibold tracking-[0.02em] text-ink-500">پیشنهاد دستیار</h3>
              <div className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg bg-ink-50 px-3 py-2.5 text-[13px] leading-7 text-ink-800 shadow-ring dark:bg-ink-800 dark:text-ink-100" dir="rtl">
                {result.output}
              </div>
            </section>
          </div>

          {/* apply mode + reject — pinned at the bottom, always visible */}
          <div className="mt-auto flex items-center justify-between gap-3 border-t border-ink-100 px-4 py-3 dark:border-ink-800">
            <div className="flex items-center gap-3 text-[12px] text-ink-600 dark:text-ink-300">
              <label className="flex cursor-pointer items-center gap-1.5">
                <input type="radio" name="ai-apply-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />
                جایگزینی
              </label>
              <label className="flex cursor-pointer items-center gap-1.5">
                <input type="radio" name="ai-apply-mode" checked={mode === 'insert'} onChange={() => setMode('insert')} />
                درج در ادامه
              </label>
            </div>
            <Button size="sm" variant="secondary" onClick={onClose}>رد کردن</Button>
          </div>
        </div>
      )}
    </LeftDock>
  );
}

export function AIRunningOverlay() {
  return (
    <div className="flex items-center gap-2 text-ink-500">
      <Spinner /> در حال پردازش…
    </div>
  );
}
