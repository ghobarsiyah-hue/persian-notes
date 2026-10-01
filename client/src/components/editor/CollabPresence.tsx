import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MAX_ACTIVE_EDITORS } from '@/collab/session';
import type { CollabSessionState, CollabEditorPresence } from '@/collab/session';

/* ═══════════════════════════════════════════════════════════════════════
   Presence chip + state banner — the MINIMAL collab UI (§2/§6/§7).

   Rendered beside the existing SaveStatusBadge in the Ribbon area. It never
   replaces or repurposes SaveState: collaboration state and persistence
   state stay TWO separate concerns (§3).

   §2 state model: the chip's dot reflects conn; the label distinguishes
   editing / view-only WITH its reason (transferred = another tab of yours
   took over, released = stale seat, revoked = permission, note-deleted =
   the note is gone). denyReason (join-time) drives the banner.
   Persian, RTL, Vercel-clean (no new dashboard).
   ═══════════════════════════════════════════════════════════════════════ */

const CONN_LABEL: Record<CollabSessionState['conn'], string> = {
  connecting: 'در حال اتصال…',
  connected: 'متصل',
  reconnecting: 'در حال اتصال مجدد…',
  offline: 'آفلاین',
};

const CONN_COLOR: Record<CollabSessionState['conn'], string> = {
  connecting: '#f5a623',
  connected: '#74b2c7',
  reconnecting: '#f5a623',
  offline: '#ff5b4f',
};

/** fa digits for the ۳/۴ counter (matches utils/fa digits, tiny local copy
 *  to keep this module dependency-free) */
function faNum(n: number): string {
  const d = '۰۱۲۳۴۵۶۷۸۹';
  return String(n).replace(/\d/g, (c) => d[Number(c)]);
}

/** §7: a collaborator's current page as a human label. The editor passes
 *  the ordered page ids so `صفحه ۵` can be derived from a pageId without
 *  any new protocol — unknown ids (created remotely, list not yet synced)
 *  degrade to a neutral label. */
function pageLabel(pageId: string | null, pageIds: string[] | null): string | null {
  if (!pageId) return null;
  if (pageIds) {
    const idx = pageIds.indexOf(pageId);
    if (idx >= 0) return `صفحه ${faNum(idx + 1)}`;
  }
  return 'صفحه‌ای دیگر';
}

const VIEW_ONLY_LABEL: Record<CollabSessionState['viewOnlyReason'] & string, string> = {
  transferred: 'ویرایش در پنجرهٔ دیگر',
  released: 'جایگاه ویرایش آزاد شد',
  revoked: 'دسترسی ویرایش ندارید',
  'note-deleted': 'این یادداشت حذف شده است',
};

export function CollabPresenceChip({ state, pageIds, onRequestSeat }: { state: CollabSessionState; pageIds?: string[]; onRequestSeat?: () => void }) {
  const [open, setOpen] = useState(false);
  /* the popover OPENS DOWNWARD (user request: the chip sits in the TOP
     ribbon — the old `bottom-full` upward panel rendered above the
     viewport and was invisible). Like the AccountChip popover it is
     portaled to document.body with a fixed position measured from the
     chip, so no ribbon ancestor (glass/backdrop/overflow) can clip it. */
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const panelRef = useRef<HTMLSpanElement | null>(null);
  const POPOVER_W = 224; /* w-56 */

  /* ONE placement rule: the panel is always FULLY inside the viewport —
     below the chip (the chip lives in the top ribbon), clamped on both
     axes, and capped in height with internal scroll. Whatever the window
     size, the contents stay reachable; the panel can never leave the page. */
  const placePanel = () => {
    const r = rootRef.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - POPOVER_W - 8));
    const top = Math.min(r.bottom + 6, Math.max(8, window.innerHeight - 100));
    setPos((p) => (p && Math.abs(p.top - top) < 1 && Math.abs(p.left - left) < 1 ? p : { top, left }));
  };

  const toggle = () => {
    if (!open) placePanel();
    setOpen((v) => !v);
  };

  /* while open, track resize/scroll so the panel can never be stranded
     outside the viewport by a reflow (cheap: same-value updates bail out) */
  useEffect(() => {
    if (!open) return;
    const onReflow = () => placePanel();
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true);
    return () => {
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    };
  }, [open]);
  const active = state.activeEditors.length;
  const max = state.maxEditors || MAX_ACTIVE_EDITORS;
  const seatLabel = `ویرایشگران ${faNum(active)}/${faNum(max)}`;
  const isView = state.seat === 'view';
  /* §2 state model — the chip label must tell the TRUTH in every state:
     acquiring is NOT view-only (the user asked for a seat and is waiting). */
  const myLabel = state.seat === 'active'
    ? 'در حال ویرایش'
    : state.seat === 'acquiring'
      ? 'در نوبت جایگاه ویرایش…'
      : state.viewOnlyReason
        ? VIEW_ONLY_LABEL[state.viewOnlyReason]
        : 'فقط مشاهده';
  /* capacity-blocked (recoverable) → the popover offers the seat request;
     permission-denied (permanent) → NO retry affordance at all (§33). */
  const canRequestSeat = state.denyReason === 'capacity' && state.seat !== 'active';

  /* close the popover on any outside click (never steals focus from the
     editor — the button itself is the only interactive surface). The
     portaled panel is outside rootRef, so it must be excluded too. */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <span ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        onClick={toggle}
        className="inline-flex select-none items-center gap-1.5 text-[10px] font-medium"
        style={{ color: isView ? '#f5a623' : '#74b2c7' }}
        role="status"
        aria-live="polite"
        aria-expanded={open}
        title={`${CONN_LABEL[state.conn]} — ${seatLabel}`}
      >
        {/* connection dot — persistence dot (SaveStatusBadge) stays separate */}
        <span
          aria-hidden="true"
          className="inline-flex h-3 w-3 items-center justify-center text-[9px] leading-none"
          style={{ color: CONN_COLOR[state.conn], animation: state.conn !== 'connected' ? 'pn-pulse 1.5s ease infinite' : undefined }}
        >
          ●
        </span>
        <span>{myLabel}</span>
        <span className="opacity-70">·</span>
        <span>{seatLabel}</span>
        {/* editor avatars (max 4) */}
        <span className="inline-flex items-center -space-x-1 space-x-reverse">
          {state.activeEditors.slice(0, max).map((e) => (
            e.avatar
              ? <img key={e.sessionId} src={e.avatar} alt="" className="h-4 w-4 rounded-full ring-1 ring-white dark:ring-[#1a1a1a]" />
              : (
                <span
                  key={e.sessionId}
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#e4e4e7] text-[8px] font-semibold text-[#52525b] ring-1 ring-white dark:bg-[#26272b] dark:text-[#a1a1aa] dark:ring-[#1a1a1a]"
                >
                  {(e.displayName || '؟').slice(0, 1)}
                </span>
              )
          ))}
        </span>
      </button>

      {/* §6 popover — session-level facts ONLY (name / state / page).
          NOT member management: that lives in the Group surfaces.
          When capacity-blocked it doubles as the honest recovery surface:
          ONE quiet «دریافت جایگاه ویرایش» action (§32) — no upgrade/
          downgrade semantics, just the seat request the model already
          supports. Permission-denied users never see it (§33). */}
      {open && pos && createPortal(
        <span
          ref={panelRef}
          dir="rtl"
          className="fixed z-[300] block w-56 overflow-y-auto rounded-xl bg-white p-2 text-start pn-shadow-popover dark:bg-[#1c1d21]"
          style={{ top: pos.top, left: pos.left, maxHeight: 'calc(100vh - 16px)', animation: 'pn-fade-in 0.12s ease-out' }}
          role="dialog"
          aria-label="هم‌ویرایشگران"
        >
          <span className="block px-2 pb-1.5 pt-1 text-[10px] font-semibold text-[#71717a] dark:text-[#a1a1aa]">
            {CONN_LABEL[state.conn]} — {seatLabel}
          </span>
          {state.activeEditors.length === 0 && (
            <span className="block px-2 py-1.5 text-[11px] text-[#71717a] dark:text-[#a1a1aa]">هم‌ویرایشگری آنلاین نیست</span>
          )}
          {state.activeEditors.slice(0, max).map((e) => (
            <PresenceRow key={e.sessionId} editor={e} pageIds={pageIds ?? null} />
          ))}
          {canRequestSeat && onRequestSeat && (
            <span className="mt-1.5 block border-t border-black/[.06] px-2 pt-2 dark:border-white/[.08]">
              <button
                type="button"
                onClick={() => { onRequestSeat(); setOpen(false); }}
                className="w-full rounded-md bg-[#155e6b]/10 px-2 py-1.5 text-[11px] font-semibold text-[#155e6b] transition-[background] duration-100 hover:bg-[#155e6b]/20 dark:bg-[#74b2c7]/15 dark:text-[#9ed3e0] dark:hover:bg-[#74b2c7]/25"
              >
                دریافت جایگاه ویرایش
              </button>
            </span>
          )}
        </span>,
        document.body,
      )}
    </span>
  );
}

/** one popover row: avatar + name + (editing page | viewing) */
function PresenceRow({ editor, pageIds }: { editor: CollabEditorPresence; pageIds: string[] | null }) {
  const label = pageLabel(editor.pageId, pageIds);
  return (
    <span className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[#f4f4f5] dark:hover:bg-[#26272b]">
      {editor.avatar
        ? <img src={editor.avatar} alt="" className="h-6 w-6 shrink-0 rounded-full ring-1 ring-[#e4e4e7] dark:ring-[#26272b]" />
        : (
          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#e4e4e7] text-[10px] font-semibold text-[#52525b] dark:bg-[#26272b] dark:text-[#a1a1aa]">
            {(editor.displayName || '؟').slice(0, 1)}
          </span>
        )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] font-medium text-[#18181b] dark:text-[#fafafa]">{editor.displayName}</span>
        <span className="block text-[10px] text-[#71717a] dark:text-[#a1a1aa]">
          {editor.pageId ? (label ?? 'در حال ویرایش') : 'آنلاین'}
        </span>
      </span>
    </span>
  );
}

/** banner for the join-time denied states (§32/§33):
 *  - capacity: recoverable — auto-retries via the seats broadcast, manual
 *    retry button, NEVER shown to a user whose denial is permission.
 *  - forbidden: permanent — no retry loop, no capacity UI.
 *  A mid-session note-deleted state renders its own quiet notice instead
 *  (the socket is closed by the server; there is nothing to request). */
export function CollabBanner({ state, onRequestSeat }: { state: CollabSessionState; onRequestSeat: () => void }) {
  if (state.viewOnlyReason === 'note-deleted') {
    return (
      <div
        className="pointer-events-auto flex items-center gap-2 rounded-lg px-3 py-1.5 text-[11px] font-medium pn-shadow-border"
        style={{ background: '#fef2f2', color: '#991b1b' }}
        role="status"
      >
        <span>این یادداشت حذف شده است — ویرایش غیرفعال شد.</span>
      </div>
    );
  }
  if (state.denyReason === 'capacity') {
    const active = state.activeEditors.length;
    return (
      <div
        className="pointer-events-auto flex items-center gap-2 rounded-lg px-3 py-1.5 text-[11px] font-medium pn-shadow-border"
        style={{ background: '#fffbeb', color: '#92400e' }}
        role="status"
      >
        <span>در حال حاضر {faNum(Math.max(active, state.maxEditors || MAX_ACTIVE_EDITORS))} نفر در حال ویرایش این یادداشت هستند.</span>
        <button
          type="button"
          onClick={onRequestSeat}
          className="rounded-md bg-[#92400e]/10 px-2 py-0.5 hover:bg-[#92400e]/20 transition-[background] duration-100"
        >
          تلاش برای دریافت جایگاه ویرایش
        </button>
      </div>
    );
  }
  if (state.denyReason === 'forbidden') {
    return (
      <div
        className="pointer-events-auto flex items-center gap-2 rounded-lg px-3 py-1.5 text-[11px] font-medium pn-shadow-border"
        style={{ background: '#fef2f2', color: '#991b1b' }}
        role="status"
      >
        <span>دسترسی ویرایش ندارید — این یادداشت فقط برای مشاهده است.</span>
      </div>
    );
  }
  return null;
}
