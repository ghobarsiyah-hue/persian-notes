import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ChevronsLeft, ChevronsRight, Copy, FilePlus, MoreVertical, Trash2, Edit3, Plus, Sparkles, LayoutPanelLeft, type LucideIcon } from 'lucide-react';
import { faDigits } from '@/utils/fa';
import { PageTypePicker } from './PageTypePicker';
import type { PageKind } from '@/types';
import { PageBorder, BookletChrome } from '@/components/border/PageBorder';
import { PAGE_PREVIEW_BORDER } from '@/components/editor/Page';

/* ── Thumbnail geometry ──────────────────────────────────────────────
   A4 = 794×1123. Scale ~17% → 135×191px so 3-4 pages fit at once. */
const THUMB_W = 794;
const THUMB_H = 1123;
const THUMB_SCALE = 0.17;
const BOX_W = Math.round(THUMB_W * THUMB_SCALE); // ≈135
const BOX_H = Math.round(THUMB_H * THUMB_SCALE); // ≈191
const MENU_EST_HEIGHT = 180;

/** Extract the first heading text from page HTML for a tiny title preview. */
function extractTitle(html: string): string | null {
  const m = html.match(/<(?:h[1-6])[^>]*>([^<]+)<\/(?:h[1-6])>/i);
  return m ? m[1].trim().slice(0, 30) : null;
}

export interface PageSidebarItem {
  id: string;
  pageNumber: number;
  kind: PageKind;
  html: string;
  /** item 15: cover thumbnail fields (only when kind === 'cover') */
  coverSrc?: string;
  coverFit?: 'cover' | 'contain';
  coverTitle?: string;
  coverSubtitle?: string;
}

interface Props {
  open: boolean;
  onToggle: () => void;
  pages: PageSidebarItem[];
  activePageId: string;
  editorFontSize: number;
  editorLineHeight: number;
  onSelect: (id: string) => void;
  onAddPage: (afterId?: string, kind?: PageKind) => void;
  onAddPageBefore?: (beforeId: string, kind?: PageKind) => void;
  onAddPageOfKind: (kind: PageKind) => void;
  /** item 15: open the جلد/فهرست insert modal */
  onOpenCoverInsert: () => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onRename?: (id: string) => void;
  onReorder: (draggedId: string, targetId: string, before: boolean) => void;
  /* item ۹ — ONE column shared by pages + AI: when the دستیار tab is
     active the host renders the RightPanel as `aiSlot` inside this aside,
     and the header shows the two-tab switch instead of page actions. */
  aiOpen?: boolean;
  onTabChange?: (tab: 'pages' | 'ai') => void;
  aiSlot?: ReactNode;
}

/* ── Action menu row ───────────────────────────────────────────────── */

function MenuRow({
  icon: Icon,
  label,
  onClick,
  disabled,
  danger,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 px-3 py-[7px] text-[12.5px] leading-none transition-colors duration-75 ${
        disabled ? 'cursor-not-allowed opacity-35' : 'hover:bg-black/[.04] dark:hover:bg-white/[.06]'
      } ${danger ? 'text-red-500 dark:text-red-400' : 'text-[#333] dark:text-[#ccc]'}`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 opacity-60" />
      <span className="grow text-right">{label}</span>
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   PageSidebar — compact page navigator with live A4 thumbnails.
   Collapses to a slim rail with page count badge.
   ═══════════════════════════════════════════════════════════════════════ */

/** Memoized (§20): typing must not re-render the whole thumbnail strip.
 *  Its props are the §11-stable callbacks + the memoized `pages` array
 *  (new identity only when page structure or a thumbnail actually changes),
 *  so a keystroke in the editor bails out here. `activePageId` still flips
 *  the strip on real page switches. */
export const PageSidebar = memo(function PageSidebar({
  open,
  onToggle,
  pages,
  activePageId,
  editorFontSize,
  editorLineHeight,
  onSelect,
  onAddPage,
  onAddPageBefore,
  onAddPageOfKind,
  onOpenCoverInsert,
  onDuplicate,
  onDelete,
  onRename,
  onReorder,
  aiOpen = false,
  onTabChange,
  aiSlot,
}: Props) {
  const [menu, setMenu] = useState<{ id: string; top: number; left: number } | null>(null);
  const [addMenu, setAddMenu] = useState<{ top: number; left: number } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; before: boolean } | null>(null);
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  /* ── Close menus on outside click / Escape / scroll ── */
  useEffect(() => {
    if (!menu && !addMenu) return;
    const close = () => { setMenu(null); setAddMenu(null); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setMenu(null); setAddMenu(null); }
    };
    document.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    const list = listRef.current;
    list?.addEventListener('scroll', close);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', onKey);
      list?.removeEventListener('scroll', close);
    };
  }, [menu, addMenu]);

  /* ── IntersectionObserver for lazy thumbnail rendering ── */
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const observer = new IntersectionObserver(
      (entries) => {
        setVisibleIds((prev) => {
          const next = new Set(prev);
          for (const entry of entries) {
            const id = entry.target.getAttribute('data-page-id');
            if (!id) continue;
            if (entry.isIntersecting) next.add(id);
            else if (!entry.intersectionRatio) next.delete(id);
          }
          return next;
        });
      },
      { root: list, rootMargin: '60px 0px', threshold: 0 },
    );
    for (const el of itemRefs.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, [pages, open]);

  /* ── Scroll active page into view ── */
  useEffect(() => {
    if (!open) return;
    const el = itemRefs.current.get(activePageId);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activePageId, open]);

  /* ── Collapsed rail ── */
  if (!open) {
    return (
      <aside className="pn-pages-rail">
        <button
          type="button"
          onClick={onToggle}
          title="نمایش صفحات"
          className="pn-pages-rail-btn"
        >
          <ChevronsRight className="h-4 w-4" />
        </button>
        <div className="pn-pages-rail-count">
          {faDigits(pages.length)}
        </div>
      </aside>
    );
  }

  /* ── Expanded sidebar ── */
  return (
    <aside className="pn-pages-sidebar">
      {/* ── Header: two quiet tabs (صفحات / دستیار) when the AI slot is
          wired — otherwise the classic single-purpose header ── */}
      <div className="pn-pages-header">
        {onTabChange ? (
          <div role="tablist" aria-label="پنل کناری" className="flex min-w-0 items-center gap-1">
            <button
              type="button"
              role="tab"
              aria-selected={!aiOpen}
              onClick={() => onTabChange('pages')}
              title="پیش‌نمایش صفحات"
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-semibold transition-colors ${
                !aiOpen ? 'bg-black/[.06] text-[#171717] dark:bg-white/[.08] dark:text-white' : 'text-[#999] hover:text-[#666] dark:text-[#666] dark:hover:text-[#aaa]'
              }`}
            >
              <LayoutPanelLeft className="h-3.5 w-3.5" aria-hidden="true" />
              صفحات
              <span className="text-[10px] font-medium opacity-60">{faDigits(pages.length)}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={aiOpen}
              onClick={() => onTabChange('ai')}
              title="دستیار هوش مصنوعی"
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-semibold transition-colors"
              style={
                aiOpen
                  ? { background: '#155e6b', color: '#ffffff' }
                  : { color: '#999999' }
              }
              onMouseEnter={(e) => { if (!aiOpen) e.currentTarget.style.color = '#155e6b'; }}
              onMouseLeave={(e) => { if (!aiOpen) e.currentTarget.style.color = '#999999'; }}
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              دستیار
            </button>
          </div>
        ) : (
          <>
            <span className="pn-pages-title">صفحات</span>
            <span className="pn-pages-count">{faDigits(pages.length)}</span>
          </>
        )}
        <div className="pn-pages-header-spacer" />
        <button
          type="button"
          onClick={onToggle}
          title="بستن نوار کناری"
          className="pn-pages-header-btn"
        >
          <ChevronsLeft className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* ── AI slot (item ۹): when the دستیار tab is active, the host's
          RightPanel renders HERE — one column, one shared surface; the
          page thumbnails (and their footer + menus) stay unmounted. ── */}
      {aiOpen && aiSlot}

      {/* ── Pages body — hidden (not unmounted-off) while the AI tab is
          active; conditional render keeps the sidebar honest about which
          tab owns the space. ── */}
      {/* ── Thumbnail list ── */}
      <div ref={listRef} className="pn-pages-list" style={aiOpen ? { display: 'none' } : undefined}>
        {pages.map((p) => {
          const isActive = p.id === activePageId;
          const isDragged = dragId === p.id;
          const showLine = dropTarget?.id === p.id;
          const isVisible = visibleIds.has(p.id);
          const title = extractTitle(p.html);
          return (
            <div
              key={p.id}
              ref={(el) => { if (el) itemRefs.current.set(p.id, el); else itemRefs.current.delete(p.id); }}
              data-page-id={p.id}
              className={`pn-page-item ${isDragged ? 'is-dragged' : ''}`}
              draggable
              onDragStart={(e) => {
                setDragId(p.id);
                setDropTarget(null);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', p.id);
              }}
              onDragEnd={() => { setDragId(null); setDropTarget(null); }}
              onDragOver={(e) => {
                if (!dragId || dragId === p.id) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const r = e.currentTarget.getBoundingClientRect();
                const before = e.clientY < r.top + r.height / 2;
                setDropTarget((prev) => (prev?.id === p.id && prev.before === before ? prev : { id: p.id, before }));
              }}
              onDragLeave={(e) => {
                if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                setDropTarget((prev) => (prev?.id === p.id ? null : prev));
              }}
              onDrop={(e) => {
                e.preventDefault();
                const before = dropTarget?.before ?? false;
                if (dragId && dragId !== p.id) onReorder(dragId, p.id, before);
                setDragId(null);
                setDropTarget(null);
              }}
            >
              {/* Drag insertion line */}
              {showLine && (
                <span
                  className="pn-page-drop-line"
                  style={dropTarget!.before
                    ? { top: -2, height: 2 }
                    : { bottom: -2, height: 2 }}
                />
              )}

              {/* Page number badge + title */}
              <div className="pn-page-meta">
                <span className="pn-page-num">{faDigits(p.pageNumber)}</span>
                {title && <span className="pn-page-title">{title}</span>}
              </div>

              {/* Thumbnail */}
              <div className="pn-page-thumb-wrap">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onSelect(p.id); }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const r = e.currentTarget.getBoundingClientRect();
                    setMenu({
                      id: p.id,
                      top: Math.max(8, Math.min(r.top, window.innerHeight - MENU_EST_HEIGHT - 8)),
                      left: Math.min(r.right + 4, window.innerWidth - 180),
                    });
                  }}
                  aria-label={`رفتن به صفحه ${faDigits(p.pageNumber)}`}
                  className={`pn-page-thumb ${isActive ? 'is-active' : ''}`}
                >
                  {isVisible && p.html ? (
                    <div className="pn-page-thumb-inner">
                      <div
                        className={`page-paper${p.kind !== 'framed' ? ` page-${p.kind}` : ''}`}
                        style={{ margin: 0 } as CSSProperties}
                      >
                        {p.kind === 'framed' && (
                          <PageBorder settings={PAGE_PREVIEW_BORDER} pageNumber={p.pageNumber} totalPages={0} />
                        )}
                        {p.kind === 'booklet' && (
                          <BookletChrome settings={PAGE_PREVIEW_BORDER} pageNumber={p.pageNumber} />
                        )}
                        {p.kind === 'notebook' && (
                          <div
                            className="page-notebook-lines"
                            aria-hidden="true"
                            style={{
                              '--editor-font-size': `${editorFontSize}px`,
                              '--editor-line-height': String(editorLineHeight),
                            } as CSSProperties}
                          />
                        )}
                        {/* item 15: cover/toc thumbnails — static mini layers */}
                        {p.kind === 'cover' && (
                          <div className="page-cover-layer">
                            {p.coverSrc
                              ? <img src={p.coverSrc} alt="" className="absolute inset-0 h-full w-full" style={{ objectFit: p.coverFit === 'contain' ? 'contain' : 'cover' }} />
                              : <div className="absolute inset-0 bg-gradient-to-b from-ink-50 to-white dark:from-ink-900 dark:to-ink-950" />}
                            {(p.coverTitle || p.coverSubtitle) && (
                              <div className="absolute inset-x-0 bottom-6 flex flex-col items-center gap-1 px-6 text-center">
                                {p.coverTitle && <span className="max-w-full truncate rounded-md bg-black/60 px-3 py-1 text-[11px] font-extrabold text-white">{p.coverTitle}</span>}
                                {p.coverSubtitle && <span className="max-w-full truncate rounded bg-black/45 px-2 py-0.5 text-[9px] text-white/90">{p.coverSubtitle}</span>}
                              </div>
                            )}
                          </div>
                        )}
                        {p.kind === 'toc' && (
                          <div className="page-toc-layer"><div className="page-toc-heading">فهرست مطالب</div><div className="page-toc-lines">
                            {Array.from({ length: 12 }, (_, i) => (<div className="page-toc-row" key={i}><span className="page-toc-title" /><span className="page-toc-dots" /><span className="page-toc-num" /></div>))}
                          </div></div>
                        )}
                        <div className="page-content">
                          <div
                            className="pn-editor-wrap"
                            style={{
                              '--editor-font-size': `${editorFontSize}px`,
                              '--editor-line-height': String(editorLineHeight),
                            } as CSSProperties}
                          >
                            <div
                              className="pn-editor focus:outline-none ProseMirror"
                              dir="rtl"
                              dangerouslySetInnerHTML={{ __html: p.html }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <span className="pn-page-thumb-empty">
                      {p.html ? '…' : '—'}
                    </span>
                  )}
                </button>

                {/* ⋮ menu — visible on hover or active */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (menu?.id === p.id) { setMenu(null); return; }
                    const r = e.currentTarget.getBoundingClientRect();
                    setMenu({
                      id: p.id,
                      top: Math.max(8, Math.min(r.top, window.innerHeight - MENU_EST_HEIGHT - 8)),
                      left: Math.min(r.right + 4, window.innerWidth - 180),
                    });
                  }}
                  title="عملیات صفحه"
                  aria-label={`عملیات صفحه ${faDigits(p.pageNumber)}`}
                  className={`pn-page-dots ${isActive || menu?.id === p.id ? 'visible' : ''}`}
                >
                  <MoreVertical className="h-3 w-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── New page button — hidden while the دستیار tab owns the column ── */}
      <div className="pn-pages-footer" style={aiOpen ? { display: 'none' } : undefined}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (addMenu) { setAddMenu(null); return; }
            const r = e.currentTarget.getBoundingClientRect();
            /* pass the BUTTON's top; PageTypePickerFloating measures the real
               panel height after mount and lifts the box only as far as it
               must to stay inside the viewport (no guessed -160 offset). */
            setAddMenu({ top: r.top, left: r.left });
          }}
          className="pn-pages-add-btn"
        >
          <Plus className="h-3.5 w-3.5 opacity-50" />
          <span>صفحه جدید</span>
        </button>
      </div>

      {/* ── Add-page type picker ──
          Measured clamping: the old `r.top - 160` guess placed the panel
          half off-screen whenever the + button sat near the bottom of the
          sidebar. After mount we know the real height, so the panel is
          re-anchored to the button (opens upward) and clamped inside the
          viewport — never clipped, like the other popovers. */}
      {addMenu && (
        <PageTypePickerFloating top={addMenu.top} left={addMenu.left}>
          <PageTypePicker
            onPick={(kind) => {
              onAddPageOfKind(kind);
              setAddMenu(null);
            }}
            onPickSpecial={onOpenCoverInsert}
          />
        </PageTypePickerFloating>
      )}

      {/* ── Per-page action menu ── */}
      {menu && (() => {
        const p = pages.find((x) => x.id === menu.id);
        if (!p) return null;
        return (
          <div
            className="pn-glass-panel fixed z-50 w-48 overflow-hidden rounded-lg py-1 pn-shadow-popover"
            style={{ top: menu.top, left: menu.left, animation: 'pn-scale-in 0.1s ease-out' }}
            onClick={(e) => e.stopPropagation()}
          >
            {onAddPageBefore && (
              <MenuRow icon={FilePlus} label="افزودن صفحه قبل" onClick={() => { onAddPageBefore(p.id, p.kind); setMenu(null); }} />
            )}
            <MenuRow icon={FilePlus} label="افزودن صفحه بعد" onClick={() => { onAddPage(p.id, p.kind); setMenu(null); }} />
            <MenuRow icon={Copy} label="تکثیر صفحه" onClick={() => { onDuplicate(p.id); setMenu(null); }} />
            {onRename && (
              <MenuRow icon={Edit3} label="تغییر نام" onClick={() => { onRename(p.id); setMenu(null); }} />
            )}
            <div className="my-0.5 mx-2 h-px bg-black/[.06] dark:bg-white/[.08]" />
            <MenuRow
              icon={Trash2}
              label="حذف صفحه"
              danger
              disabled={pages.length <= 1}
              onClick={() => {
                if (window.confirm(`صفحه ${faDigits(p.pageNumber)} حذف شود؟`)) onDelete(p.id);
                setMenu(null);
              }}
            />
          </div>
        );
      })()}
    </aside>
  );
});

/**
 * Floating wrapper for the add-page type picker — MINIMAL reposition: the
 * panel keeps its natural spot just above the anchor button, lifted ONLY by
 * the few pixels needed to stay inside the viewport (previously the guessed
 * -160px offset cut the preview pages in half; a full flip-up moved it too
 * far). After mount the real height is known, so the clamp is exact.
 */
function PageTypePickerFloating({ top, left, children }: { top: number; left: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const m = 8;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    /* natural spot: just above the anchor (the footer + button). If that
       would clip the top edge, slide DOWN only as much as needed to fit. */
    const natural = top - h - 6;
    const t = natural < m ? Math.min(top + 6, m) : natural;
    const clampedT = Math.min(Math.max(m, t), Math.max(m, window.innerHeight - h - m));
    const l = Math.min(Math.max(m, left), Math.max(m, window.innerWidth - w - m));
    setPos({ top: clampedT, left: l });
  }, [top, left]);

  return (
    <div
      ref={ref}
      className="pn-glass-panel fixed z-50 overflow-hidden rounded-xl p-0 pn-shadow-popover"
      style={pos ? { top: pos.top, left: pos.left, animation: 'pn-scale-in 0.1s ease-out' } : { top: -9999, left: -9999, visibility: 'hidden' }}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}
