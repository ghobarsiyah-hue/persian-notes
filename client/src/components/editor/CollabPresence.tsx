import { MAX_ACTIVE_EDITORS } from '@/collab/session';
import type { CollabSessionState } from '@/collab/session';

/* ═══════════════════════════════════════════════════════════════════════
   Presence chip + view-only banner — the MINIMAL collab UI (task §UI).

   Rendered beside the existing SaveStatusBadge in the Ribbon area. It never
   replaces or repurposes SaveState: connection and persistence stay two
   separate concerns. Persian, RTL, Vercel-clean (no new dashboard).
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

export function CollabPresenceChip({ state }: { state: CollabSessionState }) {
  const active = state.activeEditors.length;
  const seatLabel = `ویرایشگران ${faNum(active)}/${faNum(state.maxEditors || MAX_ACTIVE_EDITORS)}`;
  const isView = state.seat === 'view';
  return (
    <span
      className="inline-flex select-none items-center gap-1.5 text-[10px] font-medium"
      style={{ color: isView ? '#f5a623' : '#74b2c7' }}
      role="status"
      aria-live="polite"
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
      <span>{isView ? 'فقط مشاهده' : 'در حال ویرایش'}</span>
      <span className="opacity-70">·</span>
      <span>{seatLabel}</span>
      {/* editor avatars (max 4) */}
      <span className="inline-flex items-center -space-x-1 space-x-reverse">
        {state.activeEditors.slice(0, state.maxEditors || MAX_ACTIVE_EDITORS).map((e) => (
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
    </span>
  );
}

/** banner for the seat-full / forbidden states — shown ONCE, dismissible,
 *  never blocks reading the note (the 5th editor keeps full read access) */
export function CollabBanner({ state, onRequestSeat }: { state: CollabSessionState; onRequestSeat: () => void }) {
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
