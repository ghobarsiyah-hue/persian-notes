import { SAVE_STATE_META } from '@/save/persistence';
import type { SaveState } from '@/types';

/**
 * The ONE save-status indicator (§6): subtle, persistent, RTL Persian,
 * driven exclusively by the centralized SaveState machine. Renders nothing
 * but the current state — it re-renders only when `state` actually changes
 * (it is a pure component; parents should pass a stable primitive).
 *
 *   ● ذخیره شد        ○ در حال ذخیره…      ! آفلاین — ذخیره محلی
 *   × خطا در ذخیره    ↻ در انتظار همگام‌سازی
 */
export function SaveStatusBadge({ state, className = '' }: { state: SaveState; className?: string }) {
  const meta = SAVE_STATE_META[state];
  const glyph =
    state === 'failed' ? '×'
    : state === 'offline' ? '!'
    : state === 'pendingSync' ? '↻'
    : state === 'saving' || state === 'dirty' ? '○'
    : '●';
  return (
    <span
      className={`inline-flex select-none items-center gap-1.5 text-[10px] font-medium ${className}`}
      style={{ color: meta.color }}
      role="status"
      aria-live="polite"
      aria-label={meta.text}
      title={meta.text}
    >
      <span
        aria-hidden="true"
        className="inline-flex h-3 w-3 items-center justify-center text-[9px] leading-none"
        style={{ animation: meta.pulse ? 'pn-pulse 1.5s ease infinite' : undefined }}
      >
        {glyph}
      </span>
      {meta.text}
    </span>
  );
}
