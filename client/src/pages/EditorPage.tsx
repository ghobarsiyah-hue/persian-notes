import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TextSelection } from '@tiptap/pm/state';
import { Fragment } from '@tiptap/pm/model';
import { useParams, useNavigate } from 'react-router-dom';
import { ApiRequestError } from '@/api/client';
import { useApp } from '@/store/AppProvider';
import { analyzeDocument, faDigits } from '@/utils/fa';
import type { AIResult, Note, PageKind, SaveState } from '@/types';
import { DEFAULT_BORDER_SETTINGS, type BorderSettings } from '@/types';
import { Page as PageComponent, EMPTY_FLOATS_LIST, plainTextOf, type PageProps } from '@/components/editor/Page';
import { PageSidebar } from '@/components/editor/PageSidebar';
import { FloatingLayer, createFloatingElement, type FloatingElement } from '@/components/editor/FloatingLayer';
import { getScopeText } from '@/editor/editorScope';
import {
  findOverflowSplit,
  findManualBreakSplit,
  measureFreeSpace,
  findBackflowSplit,
  isOverflowing,
  bumpLayoutVersion,
  type PrevPageContext,
} from '@/editor/overflowFlow';
import { insertAIOutput } from '@/editor/aiInsert';
import { objectMaxArea } from '@/editor/pageCapacity';
import { flowEngineActiveRef } from '@/editor/flowEngineState';
import { currentPaginationMode, onCapacityReject, runManualPageBreakSplit } from '@/editor/paginationMode';
import { hasTrailingPageBreak } from '@/editor/overflowFlow';
import { renderFormulasInHtml, renderEquationsInHtml } from '@/editor/extensions/blocks';

/** every math-bearing export path: KaTeX-formulas first, then structured
 *  equations (LaTeX source → professional KaTeX markup) */
const renderMathInHtml = (h: string) => renderEquationsInHtml(renderFormulasInHtml(h));
import { Ribbon } from '@/editor/ribbon/ribbonCommands';
import { SelectionToolbar } from '@/editor/ribbon/SelectionToolbar';
import { RightPanel, type AIScope, type PanelTab } from '@/components/editor/RightPanel';
import { AIDiffModal } from '@/components/ai/AIDiffModal';
import { PrintPreviewModal } from '@/components/export/PrintPreviewModal';
import { prepareWordHtml, buildWordEduCss, buildWordHeaderFooter } from '@/utils/wordExport';
import { EduBlocksModal } from '@/components/editor/EduBlocksModal';
import { eduBlocksCss, isTinted, resolveEduBlocks, DEFAULT_EDU_BLOCKS } from '@/utils/eduBlocks';
import type { ExportPage } from '@/utils/pageModelExport';
import { notesApi, tagsApi, aiApi, exportApi } from '@/api/endpoints';
import { useCollabSession } from '@/collab/useCollabSession';
import { CollabPresenceChip, CollabBanner } from '@/components/editor/CollabPresence';
import { wireDocObserver, seedPageFragmentFromJson, publishStructure } from '@/collab/editorSync';
import type { CollabSession } from '@/collab/session';
import { structureCreatePage, structureDeletePage, structureMovePage, reconcilePagesFromStructure, pagesFromRestoredDoc } from '@/collab/structureSync';
import { floatUpsert, floatPatch, floatDelete, floatDiff, reconcileFloatsFromSession } from '@/collab/floatSync';
import { publishTitle as collabPublishTitle, observeTitle } from '@/collab/metadataSync';
import { pageJsonFromFragment } from '@/collab/editorSync';
import { AutosaveScheduler, pendingNoteStore, pendingKey } from '@/save/persistence';
import type { PendingNoteSave } from '@/types';
import { SaveStatusBadge } from '@/components/editor/SaveStatusBadge';
import { docJsonToHtml } from '@/utils/staticSchema';
import { emitUserEvent } from '@/events/userEvents';
import { ContextMenu, type MenuItem } from '@/editor/ribbon/contextual/contextMenu';
import { buildContextMenuItems, detectRightClickTarget, type CtxMenuActions } from '@/editor/ribbon/contextual/contextMenuItems';
/* raw Persian font pack — inlined into the HTML/Word export so documents
   opened offline keep B Titr / Shabnam / Dast Nevis / Sahel faces */
import fontsCssRaw from '../../public/fonts.css?raw';

/* Offline-pending autosaves are namespaced by USER id via pendingKey()
   (save/persistence.ts — the ONE pending store): after a logout, user B
   must never be able to read (or even collide with) user A's queued
   document state (§7/§9 — AUTH-13). */

const A4_W_PX = 794;
const A4_H_PX = 1123;

interface DocPage {
  id: string;
  pageNumber: number;
  content: Record<string, unknown> | null;
  floatingElements: FloatingElement[];
  /** visual kind: framed (قاب‌دار) | blank (بدون قاب) | notebook (نوت‌بوکی) */
  kind: PageKind;
  /** true when this sheet was created by the automatic pagination engine
   *  (flow overflow) — such pages may be removed again when they empty out;
   *  manually created pages are never removed automatically. */
  auto?: boolean;
}

function emptyPage(): DocPage {
  return {
    id: `page-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    pageNumber: 1,
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    floatingElements: [],
    kind: 'framed',
    auto: false,
  };
}

/** Editor JSON and persisted decorative floating layers live in the same
 *  `content` object; split them so TipTap never sees the foreign key. */
function splitContent(raw: Record<string, unknown>): { doc: Record<string, unknown>; floats: FloatingElement[] } {
  const floats = Array.isArray(raw?.floatingElements) ? raw.floatingElements as FloatingElement[] : [];
  const doc: Record<string, unknown> = { ...raw };
  delete doc.floatingElements;
  return { doc, floats };
}

function mergeContent(doc: Record<string, unknown>, floats: FloatingElement[]): Record<string, unknown> {
  return { ...doc, floatingElements: floats };
}

const PAGE_KINDS: PageKind[] = ['framed', 'blank', 'notebook'];
function isPageKind(v: unknown): v is PageKind {
  return typeof v === 'string' && (PAGE_KINDS as string[]).includes(v);
}

/** Split a stored document JSON into per-page docs. A top-level `pageBreak`
 *  node marks a page boundary, so notes saved by the multi-page editor (and
 *  legacy single-sheet notes that used the pageBreak divider) reopen as real
 *  sibling pages instead of one giant clipped sheet. Each page's visual kind
 *  rides along: the FIRST page's kind is stored in the doc's `attrs.pageKind`,
 *  every following page's kind on the pageBreak node right before it. The
 *  pageBreak's `auto` attr marks sheets the pagination engine created.
 *
 *  COLLABORATION INVARIANT: page identity must be STABLE across clients and
 *  reloads — every editor binds its TipTap instance to the shared yjs
 *  fragment `page:<pageId>`, so two clients that load the same note must
 *  derive the SAME ids or their edits land in different fragments and never
 *  converge. Ids are therefore deterministic (`p1…pN`, the persisted
 *  pageBreak ordinal) and only NEW pages (created at runtime by the user)
 *  get random ids — which the merge below persists for the next load. */
function splitDocIntoPages(doc: Record<string, unknown> | null): Array<{ id?: string; content: Record<string, unknown>; kind: PageKind; auto: boolean }> {
  const blocks = Array.isArray(doc?.content) ? (doc.content as Record<string, unknown>[]) : [];
  const docAttrs = (doc?.attrs ?? {}) as Record<string, unknown>;
  const firstKind: PageKind = isPageKind(docAttrs.pageKind) ? docAttrs.pageKind : 'framed';
  const chunks: Array<{ id?: string; nodes: Record<string, unknown>[]; kind: PageKind; auto: boolean }> = [{ id: 'p1', nodes: [], kind: firstKind, auto: false }];
  let ordinal = 1;
  for (const block of blocks) {
    if (block?.type === 'pageBreak') {
      const attrs = (block.attrs ?? {}) as Record<string, unknown>;
      ordinal += 1;
      chunks.push({ id: typeof attrs.pid === 'string' && attrs.pid ? attrs.pid : `p${ordinal}`, nodes: [], kind: isPageKind(attrs.kind) ? attrs.kind : 'framed', auto: attrs.auto === true });
      continue;
    }
    chunks[chunks.length - 1].nodes.push(block);
  }
  /* a trailing pageBreak must not produce an empty phantom page */
  if (chunks.length > 1 && chunks[chunks.length - 1].nodes.length === 0) chunks.pop();
  return chunks.map((c) => ({
    id: c.id,
    kind: c.kind,
    auto: c.auto,
    content: {
      type: 'doc',
      content: c.nodes.length ? c.nodes : [{ type: 'paragraph' }],
    },
  }));
}

/** Merge all pages back into ONE stored document, with `pageBreak` nodes
 *  between them — keeps the persisted format backward-compatible with the
 *  pre-multi-page format (versions, print fallbacks, old clients).
 *  Each page's visual kind is persisted on the pageBreak node before it
 *  (and the first page's kind in the doc attrs) so بلنک/نوت‌بوکی sheets
 *  survive save → load. */
function mergePagesIntoDoc(pages: DocPage[]): Record<string, unknown> {
  const blocks: Record<string, unknown>[] = [];
  pages.forEach((p) => {
    if (blocks.length > 0) {
      const attrs: Record<string, unknown> = {};
      /* the stable page id rides the break (see splitDocIntoPages — collab
         fragments are addressed by it; format stays backward-compatible:
         old clients/servers just ignore the unknown attr) */
      if (p.id) attrs.pid = p.id;
      if (p.kind !== 'framed') attrs.kind = p.kind;
      if (p.auto) attrs.auto = true;
      blocks.push(Object.keys(attrs).length ? { type: 'pageBreak', attrs } : { type: 'pageBreak' });
    }
    const arr = Array.isArray(p.content?.content)
      ? (p.content.content as Record<string, unknown>[])
      : [];
    /* inline pageBreak nodes are layout directives the flow engine consumes
       into real page boundaries — they must NOT persist inside a page's own
       content, or a trailing one would split the stored doc into a phantom
       empty page on reload */
    blocks.push(...arr.filter((n) => n?.type !== 'pageBreak'));
  });
  const firstKind = pages[0]?.kind ?? 'framed';
  const doc: Record<string, unknown> = {
    type: 'doc',
    content: blocks.length ? blocks : [{ type: 'paragraph' }],
  };
  if (firstKind !== 'framed') doc.attrs = { pageKind: firstKind };
  return doc;
}

/** Build a page entry. `id` comes from splitDocIntoPages when loading
 *  (STABLE — collaboration fragments are addressed by it); only pages
 *  created live by the user get a fresh random id, which mergePagesIntoDoc
 *  then persists on the pageBreak so the id survives reload. */
function makePage(i: number, content: Record<string, unknown>, floats: FloatingElement[], kind: PageKind = 'framed', auto = false, id?: string): DocPage {
  return {
    id: id ?? `page-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
    pageNumber: i + 1,
    content,
    floatingElements: floats,
    kind,
    auto,
  };
}

function ShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  const groups = [
    { section: 'Editing', items: [
      { keys: 'Ctrl+Z', label: 'برگردان' }, { keys: 'Ctrl+Shift+Z', label: 'بازگردانی' },
      { keys: 'Ctrl+B', label: 'بولد' }, { keys: 'Ctrl+I', label: 'ایتالیک' },
      { keys: 'Ctrl+U', label: 'زیرخط' }, { keys: 'Ctrl+K', label: 'درج لینک' },
    ]},
    { section: 'ابزارها', items: [
      { keys: 'Ctrl+S', label: 'ذخیره' }, { keys: 'Ctrl+F', label: 'جستجو و جایگزینی' },
      { keys: 'Ctrl+P', label: 'چاپ / PDF' }, { keys: '/', label: 'منوی بلوک' },
    ]},
    { section: 'حالت‌ها', items: [
      { keys: 'Ctrl+Shift+F', label: 'حالت تمرکز' }, { keys: 'Ctrl+Shift+A', label: 'پنل هوش مصنوعی' },
      { keys: 'Ctrl+/', label: 'راهنمای میانبرها' },
      { keys: 'Esc', label: 'خروج از حالت تمرکز' },
    ]},
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && onClose()} style={{ animation: 'pn-fade-in 0.1s ease-out' }}>
      {/* آیتم ۱۰: مودال به حالت مات (سطح توپر) برگشت — بدون شیشه */}
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl bg-white dark:bg-[#1a1a1a] pn-shadow-popover" style={{ animation: 'pn-scale-in 0.1s ease-out' }}>
        <div className="flex items-center justify-between px-6 py-4" style={{ boxShadow: 'inset 0 -1px 0 0 rgba(0,0,0,0.06)' }}>
          <h2 className="text-[15px] font-semibold text-[#171717] dark:text-white tracking-[-0.01em]">میانبرهای صفحه‌کلید</h2>
          <button type="button" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-md text-[#666] hover:bg-gray-100 dark:hover:bg-[#222] transition-[background] duration-100" aria-label="Close">✕</button>
        </div>
        <div className="grow overflow-y-auto p-6 space-y-5">
          {groups.map((g) => (
            <div key={g.section}>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-[#0070f3]">{g.section}</h3>
              <div className="space-y-0.5">
                {g.items.map((s) => (
                  <div key={s.label} className="flex items-center justify-between rounded-lg px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-[background] duration-100">
                    <span className="text-[13px] text-[#444] dark:text-[#aaa]">{s.label}</span>
                    <div className="flex gap-1">
                      {s.keys.split('+').map((k, i) => (
                        <span key={i}>
                          {i > 0 && <span className="mx-0.5 text-[#999] text-[10px]">+</span>}
                          <span className="pn-shortcut-key">{k}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function EditorPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { subjects, tags, reloadTags, toast, online, settings, saveSettings, user } = useApp();

  const [note, setNote] = useState<Note | null>(null);
  /* REAL note id for every save path. The route id can be 'new' — after the
     create-and-replace the URL changes but the component does NOT remount
     (same /editor/:id route), so anything captured from `id` at mount time
     (the autosave scheduler's noteId, closure sends, patchAndSave) kept
     PATCHing /api/notes/new → Mongo CastError → «شناسه وارد شده نامعتبر است»
     on EVERY save of a note opened via + جزوه‌نویسی. All save paths read
     this ref (updated at load) instead of the stale route param. */
  const noteIdRef = useRef(id);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [chapter, setChapter] = useState('');
  const [subjectId, setSubjectId] = useState<string>('');
  const [noteTags, setNoteTags] = useState<string[]>([]);
  const [favorite, setFavorite] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  /* ── Real-time collaboration (group notes only) ────────────────────────
     The session/seat/presence layer. SaveState above remains the ONLY
     persistence indicator — connection status lives in collabUi.state.conn
     and is rendered separately (they are different concerns by design). */
  const collab = useCollabSession(() => noteIdRef.current, Boolean(user?.id));
  const collabSession = collab.session;
  const collabState = collab.state;
  /** collaboration is LIVE for this note (transport + room joined) */
  const collabActive = Boolean(collabSession && collabState);
  /** view-only because all 4 editing seats are taken (the 5th editor) */
  const collabSeatFull = collabActive && collabState!.denyReason === 'capacity';
  /** view-only because the server says this user lacks edit rights */
  const collabForbidden = collabActive && collabState!.denyReason === 'forbidden';
  /** effective per-page editability while collaborating */
  const collabCanEdit = collabActive ? collabState!.seat === 'active' : true;
  /* stable refs for long-lived callbacks (createPage/deletePage/… are
     useCallback([]) — they must never capture a stale session/seat) */
  const collabSessionRef = useRef<CollabSession | null>(null);
  collabSessionRef.current = collabSession;
  const collabSeatRef = useRef<'active' | 'view' | 'acquiring' | null>(null);
  collabSeatRef.current = collabActive ? collabState!.seat : null;
  /* right sidebar (document meta + هوش مصنوعی) — closed by
     default so the page gets the full width; toggled from the Ribbon's
     far-left button (or Alt+S), and opened by the AI button */
  const [aiOpen, setAiOpen] = useState(false);
  /* sidebar tab is controlled here so the Ribbon's AI button can select it */
  const [panelTab, setPanelTab] = useState<PanelTab>('ai');
  const [scope, setScope] = useState<AIScope>('selection');
  const [aiRunning, setAiRunning] = useState(false);
  const [aiAction, setAiAction] = useState<{ label: string; id: string } | null>(null);
  /* page whose editor an AI run originated from (captured in runAI, consumed
     in acceptAI) — the async round-trip must not retarget the page */
  const aiOriginPageIdRef = useRef<string | null>(null);
  const [aiResult, setAiResult] = useState<AIResult | null>(null);
  const [aiOriginal, setAiOriginal] = useState('');
  const [aiError, setAiError] = useState<string | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  /* کادرهای آموزشی customization modal (Ribbon → طراحی → کادرها) */
  const [eduBlocksOpen, setEduBlocksOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  /* right-click context menu (راست‌کلیک سفارشی) — items are built per
     context in contextMenuItems.tsx; ctxMenuActions is wired below, after
     the host callbacks it forwards (notes API / find panel / float layer) */
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  /* Rendered HTML of the active page — used as a fallback for HTML export/print
     when the current doc hasn't produced anything yet (e.g. right after load). */
  const [html, setHtml] = useState('');
  /* document-level design state edited from the Ribbon's طراحی/چیدمان tabs —
     border is the real persisted BorderSettings used by PageBorder + PDF */
  const [zoom, setZoom] = useState(1);
  const border = useMemo<BorderSettings>(
    () => ({ ...DEFAULT_BORDER_SETTINGS, ...(settings?.border ?? {}) }),
    [settings?.border]
  );
  const patchBorder = useCallback(
    (patch: Partial<BorderSettings>) => { void saveSettings({ border: { ...border, ...patch } }); },
    [border, saveSettings]
  );

  /* ── کادرهای آموزشی: resolved settings + generated live CSS ──────────
     The customization (border, radius, titles, per-family fills) is one
     stylesheet injected over the document pages — the SAME generator feeds
     the print/PDF export, so the PDF always matches the editor. */
  const eduBlocks = useMemo(
    () => resolveEduBlocks(settings?.editor.eduBlocks) ?? DEFAULT_EDU_BLOCKS,
    [settings?.editor.eduBlocks]
  );
  const eduCss = useMemo(
    () => [
      eduBlocksCss(eduBlocks, { prefix: '.document-pages' }),
      eduBlocksCss(eduBlocks, { prefix: '.dark .document-pages', dark: true }),
    ].filter(Boolean).join('\n'),
    [eduBlocks]
  );
  const eduTinted = isTinted(eduBlocks);

  const [pages, setPages] = useState<DocPage[]>([emptyPage()]);
  const [activePageId, setActivePageId] = useState<string>('');
  const [floatingElementsByPage, setFloatingElementsByPage] = useState<Record<string, FloatingElement[]>>({});
  /* Floating layers have ONE source of truth: the per-page record the
     FloatingLayer writes through. Materializing floats back into `pages` on
     every drag/resize step used to recreate every page object (breaking the
     Page memo identity and re-scheduling thumbnails). Pages are re-merged
     with their floats on each render (a one-level map that preserves object
     identity for untouched pages) — save()/export read the merged view. */
  const pagesWithFloats = useMemo(
    () => pages.map((p) => {
      const floats = floatingElementsByPage[p.id];
      return floats && floats !== p.floatingElements ? { ...p, floatingElements: floats } : p;
    }),
    [pages, floatingElementsByPage]
  );
  /* page-management sidebar (thumbnail strip beside the workspace) —
     item ۹: the AI assistant panel now SHARES this one column. The rail
     carries two quiet tabs (صفحات / دستیار); `aiOpen` selects the دستیار
     tab instead of mounting a second aside on the other side. The Ribbon's
     AI button just switches tabs on the same surface. */
  const [pagesBarOpen, setPagesBarOpen] = useState(true);
  const [pageThumbs, setPageThumbs] = useState<Record<string, string>>({});
  const pageRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const editorRef = useRef<any>(null);
  const [editorReady, setEditorReady] = useState(false);
  /* one live editor per page — the PDF exporter reads every page's HTML from
     here so export always covers ALL pages, not just the visible one */
  const pageEditorsRef = useRef<Record<string, any>>({});

  /* ── Page-action context resolution (single source of truth) ──────────
     EVERY page-targeted action (Ribbon tools, AI panel, context menu,
     shortcuts) must mutate the page that INITIATED it — never page 1,
     never «whatever editor was last focused».

     resolvePageEditor(pageId?) returns the editor of the explicitly given
     page, else the editor of the page that currently owns the user's
     attention (activePageId), else null. There is deliberately NO fallback
     to pages[0]/editors[0]: a page-targeted action without a resolvable
     page context FAILS with a diagnostic (and a user-safe toast) instead of
     silently mutating the wrong sheet. */
  const resolvePageEditor = useCallback((pageId?: string | null): any | null => {
    if (pageId) {
      const ed = pageEditorsRef.current[pageId];
      if (!ed) {
        console.error(
          '[page-context] no live editor for requested page', pageId,
          '— refusing to redirect the action to another page',
        );
        return null; // fail-safe: never redirect to another page
      }
      return ed;
    }
    const aid = activePageIdRef.current;
    const ed = aid ? pageEditorsRef.current[aid] : null;
    if (!ed) {
      console.error(
        '[page-context] no live editor for the ACTIVE page', aid || '(none)',
        '— refusing to redirect the action to another page',
      );
      return null; // fail-safe: never redirect to another page
    }
    return ed;
  }, []);

  /* keep the legacy singleton (editorRef) glued to the ACTIVE page at all
     times. The historical bug: editorRef was repointed ONLY on real editor
     focus, while activePageId also changed via sidebar navigation, paper
     mousedown, page create/delete/merge and engine moves — every such path
     left editorRef (and thus the Ribbon/AI/shortcut tools) aimed at the
     previously focused page (page 1 after load). */
  useEffect(() => {
    const ed = activePageId ? pageEditorsRef.current[activePageId] : null;
    editorRef.current = ed;
    setEditorReady(!!ed);
  }, [activePageId, pages]);

  /* last rendered HTML per page (fallback when an editor isn't mounted yet) */
  const pageHtmlRef = useRef<Record<string, string>>({});
  const dirtyRef = useRef(false);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  /* buildFullHtml lives at module scope below; aliased here so the one-time
     scheduler construction can reference it through a stable name */
  const buildFullHtmlRef = useRef<() => string>(() => '');
  /* mirror of `pages` for the flow pass (avoids stale closures) */
  const pagesRef = useRef<DocPage[]>([...pages]);
  /* Stable-identity save()/callbacks read live values through these refs —
     the callbacks keep ONE identity for the component's whole life (no
     per-keystroke closure recreation, no window-listener churn), while
     still seeing fresh metadata at call time. */
  const noteRef = useRef<Note | null>(null);
  noteRef.current = note;
  /* saveState mirror for non-React consumers (collab persistence rhythm) */
  const saveStateRef = useRef<SaveState>('idle');
  saveStateRef.current = saveState;
  const titleRef = useRef(title);
  titleRef.current = title;
  const subjectIdRef = useRef(subjectId);
  subjectIdRef.current = subjectId;
  const chapterRef = useRef(chapter);
  chapterRef.current = chapter;
  const noteTagsRef = useRef(noteTags);
  noteTagsRef.current = noteTags;
  const favoriteRef = useRef(favorite);
  favoriteRef.current = favorite;
  const floatsByPageRef = useRef(floatingElementsByPage);
  floatsByPageRef.current = floatingElementsByPage;
  const saveInFlightRef = useRef(false);

  /* ── Centralized autosave scheduler (save/persistence.ts) ────────────
     ONE per-document scheduler owns the debounce/single-flight/flush
     cycle and the offline pending queue; the editor hot path only calls
     scheduler.markDirty(). It is ref-held (never re-created on render) and
     reads all live state through the refs above, so its identity is stable
     for the component's whole life — no per-keystroke closures. */
  const schedulerRef = useRef<AutosaveScheduler | null>(null);
  if (!schedulerRef.current) {
    schedulerRef.current = new AutosaveScheduler({
      /* noteId is read LIVE through the ref — the route starts at 'new' and
         becomes the real id after create-and-replace (no remount, no
         re-creation: the closure reads noteIdRef.current at flush time) */
      get noteId() { return noteIdRef.current; },
      debounceMs: 1500,
      buildPayload: () => {
        /* payload construction is identical to the previous save(): it runs
           ONLY at flush time, never per keystroke (§14) */
        const pagesNow = pagesRef.current;
        const floatsNow = floatsByPageRef.current;
        const mergedPages = pagesNow.map((p) => {
          const floats = floatsNow[p.id];
          return floats && floats !== p.floatingElements ? { ...p, floatingElements: floats } : p;
        });
        const merged = mergePagesIntoDoc(mergedPages);
        let wordCount = 0;
        const plainParts: string[] = [];
        for (const p of mergedPages) {
          wordCount += analyzeDocument(p.content ?? {}).wordCount;
          plainParts.push(plainTextOf(p.content ?? {}));
        }
        return {
          title: titleRef.current.trim() || 'Untitled note',
          subjectId: subjectIdRef.current || null,
          chapter: chapterRef.current,
          content: mergeContent(merged, mergedPages.flatMap((p) => p.floatingElements)),
          html: buildFullHtmlRef.current(),
          plainText: plainParts.join(' '),
          tags: noteTagsRef.current,
          favorite: favoriteRef.current,
          wordCount,
        };
      },
      send: async (payload, baseRevision) => {
        try {
          const { note: updated } = await notesApi.update(noteIdRef.current, { ...payload, baseRevision });
          setNote(updated);
          dirtyRef.current = false;
          emitUserEvent('note.saved', { targetType: 'note', targetId: noteIdRef.current });
          return typeof updated?.revision === 'number' ? updated.revision : null;
        } catch (err) {
          /* ── REVISION CONFLICT (§16): the server 409 carries its current
             revision. Re-seed and re-queue; the RETRY rebuilds the payload
             from the CANONICAL room state (see schedulerBuildPayload), so a
             stale snapshot can never win. The scheduler treats this as a
             quiet retry, not a failure. */
          const e = err as { status?: number; payload?: { code?: string; revision?: number } };
          if (e?.status === 409 && e.payload?.code === 'revision_conflict') {
            conflictRetryRef.current?.(typeof e.payload.revision === 'number' ? e.payload.revision : 0);
            throw Object.assign(err as Error, { handledConflict: true });
          }
          throw err;
        }
      },
      setState: (s) => setSaveState(s),
      userId: () => user?.id ?? '',
      isOfflineError: (err) => err instanceof ApiRequestError && err.offline,
      onError: (message) => toast('Save failed: ' + message, 'error'),
    });
  }
  const scheduler = schedulerRef.current;
  /* conflict handler installed after the scheduler exists — send() resolves
     it through this ref (defined before the scheduler in deps closure) */
  const conflictRetryRef = useRef<(serverRevision: number) => void>(() => {});
  conflictRetryRef.current = (serverRevision: number) => { scheduler.handleConflict(serverRevision); };

  /* ── Automatic pagination engine (Word-like flow) ─────────────────────
     One pass walks the page list: any page whose content exceeds the A4
     usable height has ONLY the overflowing portion moved forward (line-level
     for text, list items for lists, whole blocks for tables/images,
     keep-with-next for headings). Passes cascade until every page fits,
     creating new sheets as needed. A second phase pulls content BACKWARD
     when deletion leaves free space and removes flow-created pages that
     empty out. Manual pageBreak nodes force hard boundaries.

     Caret continuity: the caret of the ACTIVE page is mapped through every
     move (same logical text on the destination page), so typing flows
     across a break without jumps. Undo history survives because content is
     moved with ProseMirror transactions — never setContent. */
  const flowScheduledRef = useRef(false);
  const flowRunningRef = useRef(false);
  const flowPassesRef = useRef(0);
  const pendingFlowSelectionRef = useRef<{ pageId: string; from: number; to: number } | null>(null);
  /* [LAYOUT]/[PAGE] debug channel (§29) — on with `window.__layoutDebug = true`
     in devtools: traces why pages are created/removed and whether layout
     runs repeatedly. No-op otherwise. */
  const debugLog = (channel: string, message: string) => {
    if (typeof window !== 'undefined' && (window as { __layoutDebug?: boolean }).__layoutDebug) {
      console.debug(`[${channel}] ${message}`);
    }
  };

  useEffect(() => {
    const pending = pendingFlowSelectionRef.current;
    if (!pending || pending.pageId !== activePageId) return;
    const editor = pageEditorsRef.current[pending.pageId];
    if (!editor || editor.isDestroyed) return;
    pendingFlowSelectionRef.current = null;
    const endPos = Math.max(1, editor.state.doc.content.size - 1);
    /* from/to < 0 is the "park the caret at the END of the page" sentinel
       (used when the page the user was on is removed by backflow cleanup) */
    const clamp = (pos: number) => (pos < 0 ? endPos : Math.max(1, Math.min(pos, endPos)));
    /* set the mapped selection WITHOUT scrolling — prosemirror's
       tr.scrollIntoView() would hard-jump the scroll container (the instant
       "سوییچ" the user felt when a page filled up) */
    /* selection-only transaction: silence the engine flag so the editors'
       onUpdate skip a pointless mirror refresh + autosave churn — a selection
       changes neither the JSON nor the HTML */
    flowEngineActiveRef.current = true;
    try {
      editor.commands.setTextSelection({ from: clamp(pending.from), to: clamp(pending.to) });
      /* focus WITHOUT the native scroll-jump: preventScroll keeps the viewport
         perfectly still while the caret lands on the destination page — typing
         continues seamlessly at the same visual position the content flowed to */
      const pmDom = editor.view.dom as HTMLElement;
      try { pmDom.focus({ preventScroll: true }); }
      catch { pmDom.focus(); }
      /* if the destination sheet is (partly) OFF-SCREEN, glide to it smoothly
         instead of teleporting the viewport */
      requestAnimationFrame(() => {
        if (editor.isDestroyed) return;
        try {
          const paper = pmDom.closest('.page-paper');
          const scroller = pmDom.closest('.pn-editor-scroll');
          if (paper && scroller) {
            const pr = paper.getBoundingClientRect();
            const sr = scroller.getBoundingClientRect();
            const fullyVisible = pr.top >= sr.top && pr.bottom <= sr.bottom;
            if (!fullyVisible) paper.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        } catch { /* layout not ready — nothing to glide to */ }
      });
    } finally {
      flowEngineActiveRef.current = false;
    }
  }, [pages, activePageId]);
  /* the engine reads the active page through a ref — scheduleAutoFlow/runAutoFlow
     are memoized once, so a state closure would go stale */
  const activePageIdRef = useRef(activePageId);
  useEffect(() => { activePageIdRef.current = activePageId; }, [activePageId]);

  useEffect(() => { pagesRef.current = pagesWithFloats; }, [pagesWithFloats]);

  /** true when the page's doc holds no meaningful content (an empty
   *  paragraph alone counts as empty). */
  function isDocEmpty(json: Record<string, unknown> | null): boolean {
    const arr = Array.isArray(json?.content) ? (json!.content as Record<string, unknown>[]) : [];
    if (arr.length === 0) return true;
    if (arr.length !== 1) return false;
    const only = arr[0];
    if (only.type !== 'paragraph') return false;
    const inner = Array.isArray(only.content) ? only.content : [];
    if (inner.length === 0) return true;
    /* single whitespace-only text node */
    return inner.every((n) => n.type === 'text' && typeof n.text === 'string' && n.text.trim() === '');
  }

  /** Schedule a flow pass on the next animation frame — batches a typing
   *  burst into ONE pass instead of thrashing per keystroke.
   *
   *  ManualFixedPagePolicy (paginationMode.ts): the AUTOMATIC flow engine
   *  is bypassed in the normal editing path — no automatic page creation,
   *  no content movement, no backflow. The whole engine below is kept
   *  intact for the future SmartPaginationPolicy; `autoFlow` is the single
   *  gate. (The per-editor-mount re-schedule call also warms the pages
   *  mirror, which the manual-break consumer below still needs.) */
  const scheduleAutoFlow = useCallback(() => {
    if (!currentPaginationMode().autoFlow) return;
    if (flowScheduledRef.current || flowRunningRef.current) return;
    flowScheduledRef.current = true;
    requestAnimationFrame(() => {
      flowScheduledRef.current = false;
      runAutoFlow();
    });
  }, []);

  /** Find the next single content move the layout needs: a pending manual
   *  pageBreak, forward overflow, or backward free space. Null = settled. */
  function nextFlowMove(opts?: { allowPageSwitch?: boolean }): {
    pageIndex: number;
    /** explicit direction — NEVER inferred from ids (a null targetId means
     *  "engine creates a new page", a real id means forward/backward) */
    direction: 'forward' | 'backward';
    split: {
      from: number;
      to: number;
      nodes: Record<string, unknown>[];
      /** continuation backflow: rows/items belong INSIDE the previous
       *  page's last table/list instead of after it */
      appendIntoPrev?: 'table' | 'list' | 'container';
      appendIntoPrevType?: string;
      /** ordered-list continuation: renumber the list that remains */
      remainingListStart?: number;
    };
    /** existing page that receives the content — null → engine creates */
    targetId: string | null;
    newPageId?: string;
    sourceActive: boolean;
    sourceCaret: number | null;
  } | null {
    const cur = pagesRef.current;
    const activeId = activePageIdRef.current;
    /* Caret-follow policy (Word-like): the caret/active-page follow the
       moved content whenever they sit INSIDE the moved region — the user is
       by definition editing there, so continuing to type must keep working.
       A clock-based gesture window here is what froze typing: a pause >3s
       before Enter meant the new paragraph flowed to the next sheet while
       the caret stayed stranded at the bottom of the full page. Background
       reflows (AI insertion, font re-layout, programmatic fills) are gated
       differently: they never carry a live selection INTO the split, so
       `sourceSel.head >= split.from` is simply false for them. */
    const userActive = opts?.allowPageSwitch !== false;
    /* — forward: manual breaks and overflow, in page order — */
    for (let i = 0; i < cur.length; i++) {
      const p = cur[i];
      const ed = pageEditorsRef.current[p.id];
      if (!ed) continue;
      /* a manual break moves content even without a live user gesture — but
         the caret/active-page must still only follow when the user is
         actually interacting (allowPageSwitch, the same gate as overflow). */
      const manual = findManualBreakSplit(ed);
      if (manual) {
        return { pageIndex: i, direction: 'forward', split: manual, targetId: cur[i + 1]?.id ?? null, sourceActive: p.id === activeId && userActive, sourceCaret: null };
      }
      const split = findOverflowSplit(ed);
      if (split) {
        /* Page-switch gating: overflowing content ALWAYS flows forward (the
           sheet is physically full — that must happen regardless of what the
           user is doing), but the active page/caret follows onto the new
           sheet ONLY when the user is actively interacting. Background
           reflows (AI insertion, async font re-layout, programmatic fills)
           must never yank the editor to the next sheet. */
        return {
          pageIndex: i,
          direction: 'forward',
          split,
          targetId: cur[i + 1]?.id ?? null,
          newPageId: `page-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          sourceActive: p.id === activeId && userActive,
          sourceCaret: ed.state.selection.from,
        };
      }
    }
    /* — BACKWARD-FLOW GUARD (read the forward section below first): when the
       layout is settled but some page still overflows, it means the engine
       could not compute a split for it (measurement failed, unsplittable
       block, …). A page that stays overfull is exactly the "first sheet
       stretches / content clips" bug — so fall back to the coarsest possible
       move: everything from the page's SECOND block flows forward. */
    for (let i = 0; i < cur.length; i++) {
      const p = cur[i];
      const ed = pageEditorsRef.current[p.id];
      if (!ed || ed.state.doc.childCount < 2) continue;
      if (!isOverflowing(ed)) continue;
      const secondStart = ed.state.doc.child(0).nodeSize;
      const nodes: Record<string, unknown>[] = [];
      ed.state.doc.forEach((n: any, _o: number, index: number) => {
        if (index >= 1) nodes.push(n.toJSON());
      });
      if (!nodes.length) continue;
      return {
        pageIndex: i,
        direction: 'forward',
        split: { from: secondStart, to: ed.state.doc.content.size, nodes },
        targetId: cur[i + 1]?.id ?? null,
        newPageId: `page-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        sourceActive: p.id === activeId && userActive,
        sourceCaret: ed.state.selection.from,
      };
    }
    /* — backward: page i has free room, page i+1 gives content up.
       Pairs involving a doomed EMPTY auto page are skipped (that page is
       about to be removed; pulling content into or out of it oscillates).
       prevLast tells the engine what the previous page ENDS with so a split
       table/list/container can RE-JOIN (rows re-join the table, items the
       list, children the box) instead of being appended after it. */
    for (let i = 0; i < cur.length - 1; i++) {
      const p = cur[i];
      const n = cur[i + 1];
      if ((p.auto && isDocEmpty(p.content)) || (n.auto && isDocEmpty(n.content))) continue;
      const ed = pageEditorsRef.current[p.id];
      const ned = pageEditorsRef.current[n.id];
      if (!ed || !ned) continue;
      const free = measureFreeSpace(ed);
      if (free <= 2) continue;
      const prevDoc = ed.state.doc;
      const prevLastBlock = prevDoc.childCount
        ? prevDoc.child(prevDoc.childCount - 1)
        : null;
      const prevLast: PrevPageContext | null = prevLastBlock
        ? {
            type: prevLastBlock.type.name,
            attrs: JSON.parse(JSON.stringify(prevLastBlock.attrs ?? {})) as Record<string, unknown>,
            node: prevLastBlock.toJSON() as Record<string, unknown>,
          }
        : null;
      /* an engine-created (auto) page may hand over its ENTIRE content —
         the reconcile pass removes it once it empties. Manual pages must
         keep their last block, or the sheet would vanish under the user. */
      const back = findBackflowSplit(ned, free, { allowEmpty: n.auto === true, prevLast });
      if (!back || back.nodes.length === 0) continue;
      /* spread (not pick) so appendIntoPrev / appendIntoPrevType survive
         into applyFlowMove's re-join branch */
      return { pageIndex: i, direction: 'backward', split: { ...back }, targetId: p.id, sourceActive: false, sourceCaret: null };
    }
    return null;
  }

  /** Outcome of one applied move — drives the cascade loop. */
  type FlowResult = 'moved' | 'created' | 'removed' | 'blocked';

  /** Apply one move with transactions on both editors, then reconcile page
   *  state, create/remove pages, map the caret/selection through the move.
   *  'moved' = done between existing editors (cascade may continue inline);
   *  'created'/'removed' = page list changed (wait for React to mount the
   *  new editor); 'blocked' = destination editor not mounted (wait). */
  function applyFlowMove(move: NonNullable<ReturnType<typeof nextFlowMove>>): FlowResult {
    const cur = pagesRef.current;
    const split = move.split;
    /* Direction is EXPLICIT data produced by nextFlowMove — never inferred
       from ids. (Inferring "targetId === own page id" used to misread a
       manual break on the LAST page, whose null targetId means "create a
       page", as a backward move and splice content behind the source.) */
    const backward = move.direction === 'backward';
    const srcPage = backward ? cur[move.pageIndex + 1] : cur[move.pageIndex];
    const ed = srcPage ? pageEditorsRef.current[srcPage.id] : null;
    if (!ed) return 'blocked';

    /* NEVER delete from the source unless the destination editor is live —
       otherwise the moved content would be lost between mounts */
    if (move.targetId !== null) {
      const destId = backward ? cur[move.pageIndex]?.id : cur[move.pageIndex + 1]?.id;
      if (!destId || !pageEditorsRef.current[destId]) return 'blocked';
    }

    /* The ACTIVE page's live selection is snapshotted BEFORE the move so it
       can be mapped into the destination — a text selection that straddles
       the break must survive as a RANGE, not collapse to a caret. */
    const sourceSel = move.sourceActive && ed
      ? ed.state.selection
      : null;
    const followSelection = !backward && !!sourceSel && sourceSel.head >= split.from;
    /* The moved content is PREPENDED at the destination's doc pos 1, so a
       source position p maps to `p - split.from + 1` (2a inserts the exact
       JSON tail — no prefix is re-created on the destination). */
    const selectionOffset = 1;
    const mapSelection = (pos: number) => Math.max(1, pos - split.from + selectionOffset);
    /* A text selection that STRADDLES the break (starts before split.from,
       ends after it) used to be dropped entirely: the engine only followed
       head-based selections, so the very next keystroke typed into the void
       on the OLD page. Fix: when the selection starts in the SAME textblock
       the split cuts, the kept PREFIX of that block is PREPENDED onto the
       destination's moved tail (rebuilding the block whole), and the mapped
       range is shifted by that prefix so from/to stay valid and ordered.
       Selections starting in earlier blocks fall back to caret-follow. */
    let mergedSel: { from: number; to: number } | null = null;
    let keptPrefixJSON: Record<string, unknown>[] | null = null;
    if (!followSelection && sourceSel && !backward && sourceSel.to > split.from && sourceSel.from < split.from) {
      try {
        const $split = ed.state.doc.resolve(split.from);
        const $from = ed.state.doc.resolve(sourceSel.from);
        if ($from.parent === $split.parent && $from.parent.isTextblock) {
          const blockStart = $split.before(1);
          const keptPrefix = $from.parent.cut(0, Math.max(0, sourceSel.from - (blockStart + 1)));
          if (keptPrefix.nodeSize) {
            const json = keptPrefix.toJSON() as Record<string, unknown>;
            keptPrefixJSON = [json];
            const prefixSize = keptPrefix.nodeSize;
            mergedSel = {
              from: Math.max(1, mapSelection(sourceSel.from) + prefixSize),
              to: Math.max(1, mapSelection(sourceSel.to) + prefixSize),
            };
          } else {
            /* empty kept prefix — the whole block moved; plain mapping suffices */
            mergedSel = { from: mapSelection(sourceSel.from), to: mapSelection(sourceSel.to) };
          }
        }
      } catch { /* degenerate doc — fall back to caret-only behavior */ }
    }
    /* the selection payload that follows the content onto the destination —
       either the mapped live selection or the rebuilt cross-boundary range */
    const destPendingSel = (followSelection && sourceSel)
      ? { from: mapSelection(sourceSel.from), to: mapSelection(sourceSel.to) }
      : mergedSel;

    /* — 1. remove the moved content from the source editor.
       addToHistory:false — the flow engine's bookkeeping must NOT pollute
       the user's undo stack (undoing "the engine moved my line" would
       fight the backflow engine and lose content). User edits keep their
       normal history on each page. */
    const srcTr = ed.state.tr.delete(split.from, split.to);
    srcTr.setMeta('addToHistory', false);
    ed.view.dispatch(srcTr);
    /* a move may legitimately empty the page (continuation backflow taking
       the whole table, a leading pageBreak) — doc content is block+, so
       leave an empty paragraph rather than an invalid empty document */
    if (ed.state.doc.childCount === 0) {
      try {
        const fillTr = ed.state.tr.insert(0, ed.state.schema.nodes.paragraph.create());
        fillTr.setMeta('addToHistory', false);
        ed.view.dispatch(fillTr);
      } catch { /* schema without a paragraph — nothing to fill with */ }
    }

    if (!backward && move.targetId !== null) {
      /* — 2a. forward onto an existing next page: prepend — */
      const dest = cur[move.pageIndex + 1];
      const ned = dest ? pageEditorsRef.current[dest.id] : null;
      if (ned) {
        /* insert each node at 0, from last to first, so order is preserved.
           A selection that straddled the break contributes its KEPT PREFIX
           first: prepended onto the moved tail, it rebuilds the cut block
           whole so the preserved range lands on the right characters. */
        const prefixNodes = keptPrefixJSON
          ? keptPrefixJSON
              .map((j) => {
                try { return ned.state.schema.nodeFromJSON(j as never); }
                catch { return null; }
              })
              .filter((n): n is NonNullable<typeof n> => !!n)
          : [];
        const toInsert: { json: Record<string, unknown>; node: unknown }[] = [
          ...prefixNodes.map((node, i2) => ({ json: keptPrefixJSON![i2], node })),
          ...split.nodes.map((json) => ({ json, node: null as unknown })),
        ];
        for (let k = toInsert.length - 1; k >= 0; k--) {
          try {
            const item = toInsert[k];
            const node = item.node ?? ned.state.schema.nodeFromJSON(item.json as never);
            const insTr = ned.state.tr.insert(0, node as never);
            insTr.setMeta('addToHistory', false);
            ned.view.dispatch(insTr);
          } catch { /* schema mismatch — skip this node */ }
        }
        /* caret/selection follow the content onto the destination page
           (typing across the break). The moved content lands at doc pos 1,
           so a source position p maps to p - split.from + 1. Without the
           shift the caret stays on the source page in the middle of moved
           text; typing would land one page late. */
        if (destPendingSel) {
          pendingFlowSelectionRef.current = {
            pageId: dest.id,
            from: destPendingSel.from,
            to: destPendingSel.to,
          };
          activePageIdRef.current = dest.id;
          setActivePageId(dest.id);
        }
        /* the ACTIVE page only follows the move when the user's caret is
           ON the moved content (handled above via pendingFlowSelectionRef).
           A background flow pass — e.g. the page fills up while the user
           types/keeps editing page 1 — must NOT yank the active page (and
           with it the caret, the sidebar highlight and the Ribbon's tools)
           onto the next sheet: page 1 stayed selectable and its first
           keystroke after the overflow "jumped" to page 2. */
      }
    } else if (!backward) {
      /* — 2b. engine creates a NEW page directly after the SOURCE page —
         THE SOURCE is pages[move.pageIndex]: the page whose editor just
         gave up the overflow. (Splicing after `cur[move.pageIndex]` instead
         of the source id used to file the new sheet one page EARLY when a
         manual break fired on the last page — the "previous page moved to
         page 2" bug.) The page and its content assignment come from the
         SAME move — never a page created first and filled later. */
      const newId = move.newPageId!;
      const newContent: Record<string, unknown> = {
        type: 'doc',
        content: split.nodes.length ? split.nodes : [{ type: 'paragraph' }],
      };
      setPages((prev) => {
        const idx = prev.findIndex((p) => p.id === srcPage.id);
        if (idx === -1) return prev;
        const src = prev[idx];
        const fitted = (pageEditorsRef.current[src.id]?.getJSON?.() ?? src.content) as Record<string, unknown>;
        const next = [...prev];
        next.splice(idx + 1, 0, {
          id: newId,
          pageNumber: 0,
          content: newContent,
          floatingElements: [],
          kind: src.kind,
          auto: true, // engine-created → may be removed again when it empties
        });
        next[idx] = { ...next[idx], content: fitted };
        return next.map((p, i2) => ({ ...p, pageNumber: i2 + 1 }));
      });
      setFloatingElementsByPage((prev) => ({ ...prev, [newId]: [] }));
      debugLog('PAGE', `created page ${cur.length + 1} for ${split.nodes.length} block(s) from page ${move.pageIndex + 1}`);
      /* typing flowed onto the fresh sheet — make IT the active (editable)
         page so the user's next keystroke lands there, not in the void. */
      if (destPendingSel) {
        pendingFlowSelectionRef.current = {
          pageId: newId,
          from: destPendingSel.from,
          to: destPendingSel.to,
        };
        activePageIdRef.current = newId;
        setActivePageId(newId);
      }
      return 'created';
    } else {
      /* — 2c. backward move onto the PREVIOUS page —
         Continuations RE-JOIN: rows are appended INSIDE the previous page's
         last table (repeated header is a split artifact and disappears),
         list items inside the previous list, container children inside the
         previous box. Anything else is appended at the page's end. */
      const dest = cur[move.pageIndex];
      const ned = pageEditorsRef.current[dest?.id];
      if (ned) {
        const last = ned.state.doc.childCount ? ned.state.doc.lastChild : null;
        const intoKind = split.appendIntoPrev;
        const intoType = split.appendIntoPrevType;
        const matchType = intoKind === 'table' ? 'table' : intoType ?? '';
        const historyFree = (tr: any) => { tr.setMeta('addToHistory', false); return tr; };
        if (
          intoKind &&
          last &&
          last.type.name === matchType
        ) {
          /* re-join INSIDE the previous page's last table/list/container:
             inserting at content.size - 1 (just before the block's closing
             token) adds the rows/items/children as its last children, so a
             repeated header or split stem never duplicates */
          const insertAt = ned.state.doc.content.size - 1;
          for (const j of split.nodes) {
            try {
              const node = ned.state.schema.nodeFromJSON(j as never);
              ned.view.dispatch(historyFree(ned.state.tr.insert(insertAt, node)));
            } catch { /* schema mismatch — skip */ }
          }
        } else {
          for (const j of split.nodes) {
            try {
              const node = ned.state.schema.nodeFromJSON(j as never);
              ned.view.dispatch(historyFree(ned.state.tr.insert(ned.state.doc.content.size, node)));
            } catch { /* schema mismatch — skip */ }
          }
        }
        /* backward flow must never shove content in AFTER the active
           caret: if the user is typing at the previous page's end, park
           the caret back at the very end so the next keystroke continues
           the sentence instead of landing mid-inserted-text. */
        if (dest && dest.id === activePageIdRef.current && ned.state.selection.from < ned.state.doc.content.size - 1) {
          try {
            const endTr = historyFree(ned.state.tr);
            endTr.setSelection(TextSelection.create(ned.state.doc, ned.state.doc.content.size - 1));
            ned.view.dispatch(endTr.scrollIntoView());
          } catch { /* best effort */ }
        }
      }
    }

    /* ordered-list continuation backflow: renumber the list that REMAINS on
       the source page (its first items just flowed back into the previous
       page's list, so numbering must stay continuous) */
    if (backward && split.remainingListStart != null && ed.state.doc.childCount > 0) {
      try {
        const firstNode = ed.state.doc.child(0);
        const renumTr = ed.state.tr.setNodeMarkup(0, undefined, {
          ...firstNode.attrs,
          start: split.remainingListStart,
        });
        renumTr.setMeta('addToHistory', false);
        ed.view.dispatch(renumTr);
      } catch { /* best effort */ }
    }

    /* — 3. reconcile page state from the live editors (their onUpdate
       already fired → autosave; here we refresh the mirror for the cascade) — */
    setPages((prev) => {
      let next = prev.map((p) => {
        const live = pageEditorsRef.current[p.id];
        return live ? { ...p, content: live.getJSON() as Record<string, unknown> } : p;
      });
      /* cleanup: remove flow-created (auto) pages that emptied out —
         manually created pages are NEVER removed automatically */
      if (next.length > 1) {
        const removedIds = next.filter((p, i2) => p.auto && i2 > 0 && isDocEmpty(p.content)).map((p) => p.id);
        if (removedIds.length) {
          next = next.filter((p) => !removedIds.includes(p.id)).map((p, i2) => ({ ...p, pageNumber: i2 + 1 }));
          setFloatingElementsByPage((fp) => {
            const copy = { ...fp };
            removedIds.forEach((rid) => delete copy[rid]);
            return copy;
          });
          /* the active sheet must never dangle after engine removal: park
             the user on the PREDECESSOR of the removed page with the caret
             at its END (the -1 sentinel maps to doc end in the pending-
             selection effect) — jumping to page 1 teleported the caret and
             broke typing right after a deletion-triggered backflow */
          if (removedIds.includes(activePageIdRef.current)) {
            const removedIdx = next.findIndex((p) => p.id === activePageIdRef.current);
            const predecessor = next[Math.max(0, removedIdx - 1)] ?? next[0];
            if (predecessor) {
              pendingFlowSelectionRef.current = { pageId: predecessor.id, from: -1, to: -1 };
              activePageIdRef.current = predecessor.id;
            }
            setActivePageId(predecessor?.id ?? next[0]?.id ?? '');
          }
        }
      }
      return next;
    });
    return 'moved';
  }

  /** One full cascade: repeatedly apply the next needed move until the
   *  layout is stable (bounded to avoid infinite loops). Moves between
   *  EXISTING editors run synchronously (ProseMirror dispatch is sync); a
   *  move that creates/removes a PAGE ends the pass — the [pages] effect
   *  re-schedules once React mounts the new editor. */
  function runAutoFlow() {
    if (flowRunningRef.current) return;
    flowRunningRef.current = true;
    /* every engine dispatch (content move) fires the page editors' onUpdate
       → setPages + autosave churn per cascade step; the engine reconciles
       the pages mirror itself, so silence that during the pass. The edit
       that TRIGGERED the flow already scheduled the save before this flag
       goes up (onUpdate runs synchronously in the key handler). */
    flowEngineActiveRef.current = true;
    /* diag: trace the engine's verdict on every page — remove after debugging */
    const __dbg = (window as unknown as { __flowDbg?: string }).__flowDbg !== undefined;
    try {
      const __first = nextFlowMove();
      if (__dbg) (window as unknown as { __flowDbg?: unknown }).__flowDbg = {
        pages: pagesRef.current.map((p) => {
          const e = pageEditorsRef.current[p.id];
          return { id: p.id.slice(-4), ed: !!e, ov: e ? isOverflowing(e) : null, h: e ? e.view.dom.offsetHeight : null, kids: e ? e.state.doc.childCount : null, sp: e ? (() => { try { const s = findOverflowSplit(e); return s ? { from: s.from, n: s.nodes.length } : null; } catch (err) { return 'ERR:' + String(err).slice(0, 120); } })() : null };
        }),
        move: __first ? { pageIndex: __first.pageIndex, targetId: __first.targetId, nodes: __first.split.nodes.length, from: __first.split.from } : null,
      };
      /* oscillation guard: the same move applied twice within one cascade
         means forward/backward are fighting (measurement noise) — stop */
      const seen = new Set<string>();
      for (let pass = 0; pass < 100; pass++) {
        flowPassesRef.current = pass + 1;
        /* pass 0 reuses the pre-computed move; later passes measure fresh */
        const move = pass === 0 ? __first : nextFlowMove();
        if (move) {
          /* oscillation guard: the signature must capture EVERYTHING that
             defines a move — including its DIRECTION. Two moves with equal
             signatures are the engine fighting itself (Page A ↔ Page B);
             one deterministic move may legitimately repeat: forward pushes
             a tail page-by-page until it settles. */
          const sig = `${move.direction}:${move.pageIndex}:${move.targetId ?? 'new'}:${move.split.from}:${move.split.to}`;
          if (seen.has(sig)) break; // ping-pong — layout is as stable as it gets
          seen.add(sig);
          debugLog('PAGE', `flow move: ${move.direction} page ${move.pageIndex + 1} → ${move.targetId ? 'page ' + (move.direction === 'backward' ? move.pageIndex + 1 : move.pageIndex + 2) : 'NEW'} (${move.split.nodes.length} blocks)`);
          const result = applyFlowMove(move);
          if (result === 'blocked' || result === 'created') break; // page list/mounts changed — re-schedule via effect
          /* refresh the mirror so the next pass reads the moved content */
          pagesRef.current = pagesRef.current.map((p) => {
            const live = pageEditorsRef.current[p.id];
            if (!live) return p;
            const json = live.getJSON() as Record<string, unknown>;
            return json === p.content ? p : { ...p, content: json };
          });
          /* a removal is already scheduled by the reconcile — end the pass
             so React can unmount the sheet before the cascade continues */
          if (pagesRef.current.some((p, i2) => p.auto && i2 > 0 && isDocEmpty(p.content))) break;
          continue;
        }
        /* layout settled: final sweep — engine-created pages the user has
           emptied out are removed (manual pages are never touched). Runs
           only when no move is pending, so it can't cause flicker by
           deleting a sheet the cascade would immediately refill. */
        setPages((prev) => {
          if (prev.length <= 1) return prev;
          const doomed = prev.filter((p, i2) => p.auto && i2 > 0 && isDocEmpty(p.content)).map((p) => p.id);
          if (!doomed.length) return prev;
          const kept = prev.filter((p) => !doomed.includes(p.id)).map((p, i2) => ({ ...p, pageNumber: i2 + 1 }));
          setFloatingElementsByPage((fp) => {
            const copy = { ...fp };
            doomed.forEach((rid) => delete copy[rid]);
            return copy;
          });
          if (doomed.includes(activePageIdRef.current)) {
            const doomedIdx = prev.findIndex((p) => p.id === activePageIdRef.current);
            const predecessor = kept[Math.max(0, doomedIdx - 1)] ?? kept[0];
            if (predecessor) {
              pendingFlowSelectionRef.current = { pageId: predecessor.id, from: -1, to: -1 };
              activePageIdRef.current = predecessor.id;
            }
            setActivePageId(predecessor?.id ?? kept[0]?.id ?? '');
          }
          return kept;
        });
        break; // cleanup changed the page list — let React commit first
      }
    } finally {
      flowEngineActiveRef.current = false;
      flowRunningRef.current = false;
    }
  }

  /* every edit anywhere triggers a rAF-batched flow pass */
  useEffect(() => {
    scheduleAutoFlow();
  }, [pages, scheduleAutoFlow]);

  /* ── Manual PageBreak consumption (ManualFixedPagePolicy §27) ──────────
     Automatic pagination is OFF, but a manually inserted pageBreak node
     must remain a hard boundary: when any page's doc contains one with
     content after it, the content AFTER the break moves onto a NEW manual
     page — the same mechanism the flow engine's findManualBreakSplit used,
     run directly by the host, with no overflow detection around it.
     Runs only on real doc updates (page content changed), never on
     selection-only churn. */
  const consumeManualBreaks = useCallback(() => {
    if (currentPaginationMode().autoFlow) return; // engine handles breaks
    for (const p of pagesRef.current) {
      const ed = pageEditorsRef.current[p.id];
      if (!ed) continue;
      /* TRAILING break (last block, nothing after it): the user asked for a
         new page after this one — remove the break node and append an empty
         MANUAL page. Without this the break would silently vanish on save
         (mergePagesIntoDoc strips inline breaks). */
      if (hasTrailingPageBreak(ed)) {
        flowEngineActiveRef.current = true;
        try {
          const doc = ed.state.doc;
          const breakPos = doc.content.size - doc.lastChild!.nodeSize;
          const tr = ed.state.tr.delete(breakPos, doc.content.size);
          tr.setMeta('addToHistory', false);
          ed.view.dispatch(tr);
          if (ed.state.doc.childCount === 0) {
            const fillTr = ed.state.tr.insert(0, ed.state.schema.nodes.paragraph.create());
            fillTr.setMeta('addToHistory', false);
            ed.view.dispatch(fillTr);
          }
        } finally {
          flowEngineActiveRef.current = false;
        }
        setPages((prev) => {
          const idx = prev.findIndex((pg) => pg.id === p.id);
          if (idx === -1) return prev;
          const fitted = (pageEditorsRef.current[p.id]?.getJSON?.() ?? prev[idx].content) as Record<string, unknown>;
          const next = [...prev];
          next.splice(idx + 1, 0, {
            id: `page-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            pageNumber: 0,
            content: { type: 'doc', content: [{ type: 'paragraph' }] },
            floatingElements: [],
            kind: prev[idx].kind,
            auto: false, // the user's manual break declared this page
          });
          next[idx] = { ...next[idx], content: fitted };
          return next.map((pg, i2) => ({ ...pg, pageNumber: i2 + 1 }));
        });
        debugLog('PAGE', `trailing manual pageBreak consumed on page ${p.pageNumber} → new empty manual page`);
        return;
      }
      const split = runManualPageBreakSplit(ed);
      if (!split || split.nodes.length === 0) continue;
      /* move everything after the break onto a fresh MANUAL page */
      flowEngineActiveRef.current = true;
      try {
        const srcTr = ed.state.tr.delete(split.from, split.to);
        srcTr.setMeta('addToHistory', false);
        ed.view.dispatch(srcTr);
        if (ed.state.doc.childCount === 0) {
          try {
            const fillTr = ed.state.tr.insert(0, ed.state.schema.nodes.paragraph.create());
            fillTr.setMeta('addToHistory', false);
            ed.view.dispatch(fillTr);
          } catch { /* schema without a paragraph */ }
        }
      } finally {
        flowEngineActiveRef.current = false;
      }
      const newContent: Record<string, unknown> = {
        type: 'doc',
        content: split.nodes,
      };
      setPages((prev) => {
        const idx = prev.findIndex((pg) => pg.id === p.id);
        if (idx === -1) return prev;
        const fitted = (pageEditorsRef.current[p.id]?.getJSON?.() ?? prev[idx].content) as Record<string, unknown>;
        const next = [...prev];
        next.splice(idx + 1, 0, {
          id: `page-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          pageNumber: 0,
          content: newContent,
          floatingElements: [],
          kind: prev[idx].kind,
          auto: false, // MANUAL page — never auto-removed
        });
        next[idx] = { ...next[idx], content: fitted };
        return next.map((pg, i2) => ({ ...pg, pageNumber: i2 + 1 }));
      });
      debugLog('PAGE', `manual pageBreak consumed on page ${p.pageNumber} → new manual page`);
      return; // one split per pass; the next update pass handles further breaks
    }
  }, []);

  /* after any page-content change (or editor mount), consume manual breaks */
  useEffect(() => {
    consumeManualBreaks();
  }, [pages, consumeManualBreaks]);

  /* ── Capacity feedback (fit-or-reject) ─────────────────────────────────
     The per-page FixedPageGuard emits `pn:capacity-reject` when a
     transaction is rejected; the host surfaces ONE throttled toast. The
     page itself stays fully editable — this is only user feedback. */
  const capacityToastShownRef = useRef(false);
  useEffect(() => {
    return onCapacityReject(() => {
      if (capacityToastShownRef.current) return;
      capacityToastShownRef.current = true;
      toast('صفحه پر است — برای ادامه، صفحه جدید اضافه کنید یا محتوا را کوتاه کنید.', 'error');
      setTimeout(() => { capacityToastShownRef.current = false; }, 1800);
    });
  }, [toast]);

  const editorFontSize = settings?.editor.fontSize ?? 16;
  const editorLineHeight = settings?.editor.lineHeight ?? 2;

  /* re-run the flow when font metrics / zoom change the usable layout */
  useEffect(() => {
    scheduleAutoFlow();
  }, [editorFontSize, editorLineHeight, zoom, scheduleAutoFlow]);

  /* Persian web fonts (B Titr, Sahel, …) load ASYNC — the first layout pass
     may measure fallback-metric text and paginate wrong, and the doc NEVER
     settles into that (wrong) state on its own. When document.fonts.ready
     resolves, invalidate and re-layout once (§13: invalidate and recalculate
     in a CONTROLLED way — one deterministic extra pass, not a loop). */
  useEffect(() => {
    let cancelled = false;
    document.fonts?.ready.then(() => {
      if (cancelled) return;
      bumpLayoutVersion();
      scheduleAutoFlow();
    });
    return () => { cancelled = true; };
  }, [scheduleAutoFlow]);

  // Loading — `new` creates a fresh note first, so "+ جزوه‌نویسی" (/editor/new)
  // opens a real editable note instead of trying to fetch a note with id "new".
  useEffect(() => {
    (async () => {
      try {
        let n: Note;
        if (id === 'new') {
          ({ note: n } = await notesApi.create({ title: 'جزوه بدون عنوان' }));
          navigate(`/editor/${n._id}`, { replace: true });
        } else {
          ({ note: n } = await notesApi.get(id));
        }
        setNote(n);
        /* the scheduler/pending-store and every save closure aim HERE, not
           at the stale route param — fixes /editor/new saving to 'new' */
        noteIdRef.current = n._id;
        setChapter(n.chapter);
        setSubjectId(typeof n.subjectId === 'object' ? (n.subjectId?._id ?? '') : (n.subjectId ?? ''));
        setNoteTags((n.tags as Array<{ _id: string }>).map((t) => t._id));
        setFavorite(n.favorite);
        const { doc: loadedDoc, floats: loadedFloats } = splitContent(n.content as Record<string, unknown>);
        /* one real sibling page per stored pageBreak section — a multi-page
           note reopens as multiple A4 sheets, not one giant clipped page */
        const loadedPages: DocPage[] = splitDocIntoPages(loadedDoc)
          .map((c, i) => makePage(i, c.content, i === 0 ? loadedFloats : [], c.kind, c.auto, c.id));
        setPages(loadedPages);
        setActivePageId(loadedPages[0].id);
        setFloatingElementsByPage(Object.fromEntries(loadedPages.map((p) => [p.id, p.floatingElements])));
        setHtml(n.html || '');
        /* seed the revision-safe base: the scheduler's sends will carry
           baseRevision = the server revision seen at load (§4) */
        scheduler.setBaseRevision(typeof n.revision === 'number' ? n.revision : 0);
        const pending = pendingNoteStore.get(user?.id ?? '', noteIdRef.current);
        if (pending) {
          try {
            const p = pending as PendingNoteSave & { json?: Record<string, unknown>; html?: string };
            const pendingJson = p.payload?.content ?? p.json;
            if (pendingJson && new Date(p.updatedAt) > new Date(n.updatedAt)) {
              const { doc: pendingDoc, floats: pendingFloats } = splitContent(pendingJson as Record<string, unknown>);
              const pendingPages: DocPage[] = splitDocIntoPages(pendingDoc)
                .map((c, i) => makePage(i, c.content, i === 0 ? pendingFloats : [], c.kind, c.auto, c.id));
              setPages(pendingPages);
              setActivePageId(pendingPages[0].id);
              setFloatingElementsByPage(Object.fromEntries(pendingPages.map((pg) => [pg.id, pg.floatingElements])));
              setHtml(String(p.payload?.html ?? p.html ?? ''));
              /* queued edits exist → the next save must include them; mark
                 dirty so the scheduler flushes them (offline → pendingSync) */
              scheduler.markDirty();
              toast('Offline changes restored.', 'info');
              emitUserEvent('note.restored', { targetType: 'note', targetId: noteIdRef.current });
            } else { pendingNoteStore.clear(user?.id ?? '', noteIdRef.current); }
          } catch { pendingNoteStore.clear(user?.id ?? '', noteIdRef.current); }
        }
        setSaveState('saved');
      } catch (e) { setLoadError((e as Error).message); }
    })();
  }, [id, toast, user?.id, scheduler]);

  /* ── Collaboration: local yjs ops fan-out + initial seeding ──────────
     LOCAL editor transactions are merged into the session's Y.Doc by the
     Collaboration extension; this observer forwards every non-server
     update to the transport. Remote ('server') updates are never echoed —
     the loop is structurally impossible (collab/editorSync.ts). */
  useEffect(() => {
    if (!collabSession) return;
    return wireDocObserver(collabSession, () => false);
  }, [collabSession]);

  /* seed the room's SEMANTIC structure + fragments + floats ONCE per session
     with the loaded document. Deterministic — NO setTimeout ordering: the
     pagesRef sync effect is registered BEFORE this one, so its body has
     already run by the time this effect executes (same commit). Every step
     is idempotent: a room seeded by the server/another client wins and our
     writes no-op (fragment length check, per-object equality, order filled
     only when empty). */
  const seededNoteIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!collabSession || !note) return;
    const nid = noteIdRef.current;
    if (!nid || nid === 'new' || seededNoteIdRef.current === nid) return;
    seededNoteIdRef.current = nid;
    const s = collabSession;
    const cur = pagesRef.current;
    if (cur.length === 0) return;
    /* SEMANTIC structure: only when the room has no order yet (first client
       after server seed) do we publish the loaded page list. The ids here
       are the STABLE p1…pN derivation — identical to the server's seed, so
       this usually just confirms it. */
    if (s.readPageOrder().length === 0) {
      cur.forEach((p, i) => s.opCreatePage(p.id, p.kind, p.auto ?? false, i === 0 ? undefined : cur[i - 1].id));
    }
    /* content fragments: server seeds them from the persisted note; the
       client seeds ONLY empty fragments from its own page JSON (idempotent,
       first-writer wins) — covers runtime-created pages persisted with pid */
    cur.forEach((p) => {
      seedPageFragmentFromJson(s, p.id, p.content as Record<string, unknown>);
    });
    /* floats: per-object upsert (equality-guarded) + legacy §4 mirror only
       when the room has none (never clobber another client's state) */
    for (const p of cur) {
      const local = (floatsByPageRef.current[p.id] ?? []) as unknown as Array<Record<string, unknown>>;
      for (const f of local) s.opUpsertFloat(p.id, f);
      if (!s.readFloats(p.id)) s.commitFloats(p.id, local);
    }
    /* legacy 'structure.pages' mirror — kept coherent for the server's
       fallback §4 projection (roomDoc legacy path) */
    s.writeStructure(cur.map((p) => ({ id: p.id, kind: p.kind, auto: p.auto ?? false })));
  }, [collabSession, note]);

  /* legacy mirror upkeep — semantic ops above are the authority; this only
     refreshes structure.pages when the local page list actually changes
     (identity-checked → no yjs write when nothing changed) */
  const pageIdsKey = pagesWithFloats.map((p) => `${p.id}:${p.kind}:${p.auto ? 1 : 0}`).join('|');
  useEffect(() => {
    if (!collabSession) return;
    const entries = pagesWithFloats.map((p) => ({ id: p.id, kind: p.kind, auto: p.auto ?? false }));
    const cur = collabSession.readStructure();
    if (JSON.stringify(cur) === JSON.stringify(entries)) return;
    collabSession.writeStructure(entries);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collabSession, pageIdsKey]);

  /* ── collaboration → local state (RECEIVE path, §3/§4/§5/§7) ────────────
     The Y.Doc IS the synchronization authority — no setTimeout ordering.
     Every remote update reconciles (a) the page STRUCTURE from the semantic
     pageOrder/pageMeta and (b) the per-page FLOAT objects; both reconciles
     are identity-stable (same array reference when nothing changed → zero
     React churn on remote TYPING, which never moves structure). Our own
     commits arrive with origin 'local' and are skipped — no echo loop. */
  useEffect(() => {
    if (!collabSession) return;
    const s = collabSession;
    const reconcile = () => {
      const nextPages = reconcilePagesFromStructure(s, pagesRef.current);
      if (nextPages) {
        setPages(nextPages);
        setFloatingElementsByPage((prev) => {
          const next = { ...prev };
          for (const p of nextPages) if (!next[p.id]) next[p.id] = [];
          for (const k of Object.keys(next)) if (!nextPages.some((pg) => pg.id === k)) delete next[k];
          return next;
        });
        /* a remote structural change may have removed the active page */
        if (!nextPages.some((p) => p.id === activePageIdRef.current)) {
          const np = nextPages[0];
          if (np) { activePageIdRef.current = np.id; setActivePageId(np.id); }
        }
      }
      for (const p of pagesRef.current) {
        const local = (floatsByPageRef.current[p.id] ?? []) as unknown as Array<Record<string, unknown>>;
        const merged = reconcileFloatsFromSession(s, p.id, local);
        if (merged) {
          setFloatingElementsByPage((prev) => ({ ...prev, [p.id]: merged as never[] }));
          s.commitFloats(p.id, merged); /* keep the §4 mirror coherent */
        }
      }
    };
    const onDocUpdate = (_u: Uint8Array, origin: unknown) => {
      if (origin === 'local') return; /* our own commit — no echo */
      reconcile();
    };
    s.doc.on('update', onDocUpdate);
    return () => { s.doc.off('update', onDocUpdate); };
  }, [collabSession]);

  /* SYSTEM restore (§20): the server applied the restored doc into the
     room — the yjs ops inside it reconcile pages/fragments/floats through
     the receive path above; here we only guard the active page and inform. */
  useEffect(() => {
    if (!collabSession) return;
    collabSession.onRestoredDoc = () => {
      const order = collabSession.readPageOrder();
      if (order.length && !order.includes(activePageIdRef.current)) {
        const np = pagesRef.current.find((p) => p.id === order[0]) ?? pagesRef.current[0];
        if (np) { activePageIdRef.current = np.id; setActivePageId(np.id); }
      }
      toast('نسخهٔ انتخابی بازیابی شد — سند برای همهٔ هم‌ویرایشگران به‌روزرسانی شد.', 'info');
    };
    return () => { collabSession.onRestoredDoc = null; };
  }, [collabSession, toast]);

  /* collaborative metadata: TITLE (§13) — remote edits mirror into local
     state WITHOUT autosave (the room persists the title itself); local
     typing is never stomped (skip while the title input is focused) */
  useEffect(() => {
    if (!collabSession) return;
    return observeTitle(collabSession, (t) => {
      if (t === titleRef.current) return;
      const active = document.activeElement as HTMLInputElement | null;
      if (active && active.tagName === 'INPUT' && active.value === titleRef.current) return;
      setTitle(t);
    });
  }, [collabSession]);

  /* presence: publish the CURRENT page (throttled to page CHANGES + the
     15s heartbeat — informational only, never edit routing, §11) */
  useEffect(() => {
    if (!collabSession) return;
    collabSession.setAwarenessPage(activePageId || null);
  }, [collabSession, activePageId]);

  /* Full-document HTML across EVERY page, in page order. Reads from the live
     editors (export always covers ALL pages, not just the visible one) and
     falls back to the last render for a page whose editor isn't mounted. */
  const buildFullHtml = useCallback(
    () => pagesRef.current.map((p) => pageEditorsRef.current[p.id]?.getHTML?.() ?? pageHtmlRef.current[p.id] ?? '').join('\n'),
    []
  );

  /* buildFullHtml is defined below the scheduler construction — publish it
     through the ref so the scheduler's buildPayload reads the real one */
  buildFullHtmlRef.current = buildFullHtml;
  /* the scheduler's builder is needed verbatim by the versioned-save path —
     expose it through a function that reads the scheduler's deps */
  const schedulerBuildPayload = () => {
    /* ── CANONICAL SNAPSHOT (§15): while collaborating, the persisted §4
       document is built from the ROOM's canonical state — semantic page
       order + per-page CRDT fragments (the live editors render exactly
       that state) + per-object floats. The local React mirror can lag one
       reconcile behind a remote op; building from the room guarantees a
       stale local snapshot can never overwrite newer collaborative state
       (server-side 'doc' guard double-checks this too). Non-collab notes:
       the local mirror (identical content, cheaper path). */
    const s = collabSessionRef.current;
    const useCanonical = Boolean(s && collabSeatRef.current === 'active' && s.readPageOrder().length > 0);
    const mergedPages: DocPage[] = useCanonical
      ? (() => {
          const sess = s!;
          return sess.readPageOrder().map((pid, i) => {
            const meta = sess.readPageMeta(pid);
            const local = pagesRef.current.find((p) => p.id === pid);
            const json = pageEditorsRef.current[pid]?.getJSON?.() as Record<string, unknown> | undefined;
            const content = json && (json.content as unknown[])?.length ? json : (pageJsonFromFragment(sess, pid) ?? local?.content ?? { type: 'doc', content: [{ type: 'paragraph' }] });
            /* floats: room canonical merged with local-only extras (never
               drop an offline-created object — §36 no silent data loss) */
            const roomFloats = sess.readFloatObjects(pid) as unknown as FloatingElement[];
            const localFloats = floatsByPageRef.current[pid] ?? [];
            const roomIds = new Set(roomFloats.map((f) => String(f.id)));
            const floats = [...roomFloats, ...localFloats.filter((f) => !roomIds.has(String(f.id)))];
            return {
              id: pid,
              pageNumber: i + 1,
              content,
              floatingElements: floats,
              kind: (meta.kind === 'blank' || meta.kind === 'notebook' ? meta.kind : 'framed') as PageKind,
              auto: meta.auto,
            };
          });
        })()
      : pagesRef.current.map((p) => {
          const floats = floatsByPageRef.current[p.id];
          return floats && floats !== p.floatingElements ? { ...p, floatingElements: floats } : p;
        });
    const merged = mergePagesIntoDoc(mergedPages);
    let wordCount = 0;
    const plainParts: string[] = [];
    for (const p of mergedPages) {
      wordCount += analyzeDocument(p.content ?? {}).wordCount;
      plainParts.push(plainTextOf(p.content ?? {}));
    }
    return {
      title: titleRef.current.trim() || 'Untitled note',
      subjectId: subjectIdRef.current || null,
      chapter: chapterRef.current,
      content: mergeContent(merged, mergedPages.flatMap((p) => p.floatingElements)),
      html: buildFullHtml(),
      plainText: plainParts.join(' '),
      tags: noteTagsRef.current,
      favorite: favoriteRef.current,
      wordCount,
    };
  };

  /* ── Collaboration → persistence handoff ────────────────────────────
     When autosave fires while collaborating, the merged §4 document is
     ALSO submitted to the room (doc frame) so the server-side room mirror
     stays coherent; the REST PUT (the existing scheduler send) remains the
     canonical persistence path with baseRevision/409 semantics intact. */
  const buildPayloadRef = useRef(schedulerBuildPayload);
  buildPayloadRef.current = schedulerBuildPayload;
  useEffect(() => {
    if (!collabSession || !collabActive) return;
    if (collabState?.seat !== 'active') return;
    /* submit the merged doc to the room on a slow rhythm — the REST PUT
       (existing scheduler) stays the canonical persistence path; this only
       keeps the SERVER-side room mirror fresh for server-side persistence. */
    const iv = setInterval(() => {
      if (saveStateRef.current === 'dirty' || saveStateRef.current === 'saving') return;
      const doc = buildPayloadRef.current().content as Record<string, unknown>;
      collabSession.submitDocForPersistence(doc);
    }, 6000);
    return () => { clearInterval(iv); };
  }, [collabSession, collabActive, collabState?.seat]);

  // Autosave — persists EVERY page (merged with pageBreak separators so the
  // stored format stays compatible), not just the one being edited. Without
  // this, typing on page 2 would overwrite the note with only page 2.
  /* ── Save-cost boundary (§10/§21) ────────────────────────────────────
     The AutosaveScheduler owns debounce/single-flight/flush; these thin
     wrappers are the ONLY surface the rest of the page needs. markDirty()
     on the hot path is one boolean + one state transition — no
     serialization, no network, no closures recreated. */
  const debouncedSave = useCallback(() => { scheduler.markDirty(); }, [scheduler]);

  const save = useCallback(async (versionReason?: string) => {
    if (!noteRef.current) return;
    /* single-flight + newest-state-wins live inside the scheduler: a second
       flush request while a PUT is running is folded into the next debounced
       save — never a duplicate full-document PUT (§3). `versionReason` (an
       explicit manual/AI version request) rides along on the payload so the
       server records it like before. */
    if (versionReason) {
      /* the scheduler owns payload building — reuse its builder so the
         version snapshot is EXACTLY what a normal flush would send */
      const payload = { ...schedulerBuildPayload(), versionReason, baseRevision: scheduler.getBaseRevision() };
      const nid = noteIdRef.current;
      try {
        const { note: updated } = await notesApi.update(nid, payload);
        setNote(updated);
        dirtyRef.current = false;
        setSaveState('saved');
        scheduler.setBaseRevision(typeof updated.revision === 'number' ? updated.revision : 0);
        pendingNoteStore.clear(user?.id ?? '', nid);
      } catch (e) {
        if (e instanceof ApiRequestError && e.offline) {
          setSaveState('offline');
          pendingNoteStore.set(user?.id ?? '', nid, { baseRevision: scheduler.getBaseRevision(), updatedAt: new Date().toISOString(), payload });
        } else {
          setSaveState('failed');
          toast('Save failed: ' + (e as Error).message, 'error');
        }
      }
      return;
    }
    await scheduler.flush();
  }, [scheduler, id, toast, user?.id, schedulerBuildPayload]);

  /* Per-keystroke hot path: ONE doc JSON per changed page, page-local state
     update, autosave scheduling. No HTML/plainText serialization here —
     save() derives them from the live editors when a save actually fires. */
  const onEditorUpdate = useCallback((pageId: string, json: Record<string, unknown>) => {
    /* Render-cascade guard (§11): setPages always creates a new pages ARRAY
       (thumbs/sidebar/toolbar read fresh state — that re-render is needed and
       cheap). The EXPENSIVE part was every child Page re-rendering on every
       keystroke. Fixed by keeping prop identity stable for untouched pages:
       only the edited page's `content` becomes a NEW object; every other
       page keeps its SAME object reference (see memoized PageComponent). */
    setPages((prev) => prev.map((p) => (p.id === pageId ? { ...p, content: json } : p)));
    /* BUGFIX (pageHtmlRef was never written): the per-page HTML mirror is the
       FALLBACK for save/export when a page's editor is not mounted (large
       multi-page documents unmount off-screen sheets). It stayed an empty
       object forever, so an unmounted page contributed EMPTY HTML to
       buildFullHtml()/exportPages — the persisted note and the Word/HTML
       exports silently lost whole pages. Rebuild HTML from the page JSON via
       the extensions' static renderHTML (no live editor needed). */
    pageHtmlRef.current[pageId] = docJsonToHtml(json);
    /* `html` state is only a FALLBACK for Word/HTML export (buildFullHtml()
       is primary). Mirroring the FULL document HTML into React state on
       EVERY keystroke was pure render pressure — keep it load-time-only. */
    dirtyRef.current = true;
    scheduler.markDirty();
  }, [scheduler]);

  /* Reconnect: offline/queued edits flush deterministically once the network
     is back (offline → pendingSync → saved inside the scheduler). */
  useEffect(() => {
    if (online && (saveState === 'offline' || saveState === 'pendingSync')) void scheduler.syncPending();
  }, [online, saveState, scheduler]);
  useEffect(() => { document.body.classList.toggle('pn-focus-mode', focusMode); return () => document.body.classList.remove('pn-focus-mode'); }, [focusMode]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => { if (dirtyRef.current) e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  /* آیتم ۷: اصلاح نیم‌فاصله (runHalfSpaceFix + Ctrl+Shift+H) کاملاً حذف شد. */

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && focusMode) { setFocusMode(false); return; }
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;
      const k = e.key.toLowerCase();
      if (k === 's') { e.preventDefault(); void save(); }
      else if (e.shiftKey && k === 'f') { e.preventDefault(); setFocusMode((v) => !v); }
      else if (k === 'k') { e.preventDefault(); editorRef.current?.chain().focus().toggleLink({ href: '' }).run(); }
      else if (k === '/') { e.preventDefault(); setShortcutsOpen((v) => !v); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [save, focusMode]);

  // AI
  const runAI = async (action: { id: string; label: string }) => {
    /* capture the ORIGINATING page's editor NOW (§4): the AI round-trip is
       async and the user may navigate to another page (or none may have
       focus) before the result is accepted — the accept must still mutate
       the page the action was started from. */
    const originPageId = activePageIdRef.current;
    const editor = resolvePageEditor(originPageId);
    if (!editor) { toast('ابتدا صفحه‌ای انتخاب کنید.', 'error'); return; }
    const scopeText = getScopeText(editor, scope);
    if (!scopeText.text.trim()) { toast(scope === 'selection' ? 'Select some text first.' : 'No content in this scope.', 'error'); return; }
    setAiRunning(true); setAiAction({ id: action.id, label: action.label }); setAiError(null); setAiOriginal(scopeText.text);
    aiOriginPageIdRef.current = originPageId;
    try { const result = await aiApi.run({ action: action.id as never, text: scopeText.text, scope, noteId: noteIdRef.current }); setAiResult(result); }
    catch (e) { setAiResult(null); setAiError((e as Error).message); }
    finally { setAiRunning(false); }
  };

  const acceptAI = async (output: string, mode: 'replace' | 'insert') => {
    /* §4/§18: the target is the page the AI action ORIGINATED from, captured
       at runAI time — NOT whatever page is active when the user finally
       clicks «پذیرش» in the diff modal. Falls back to the active page only
       when the originating page no longer exists (page deleted meanwhile) —
       never to page 1 by position. */
    const editor =
      (aiOriginPageIdRef.current && pageEditorsRef.current[aiOriginPageIdRef.current]) ||
      resolvePageEditor();
    if (!editor) return;
    const scopeInfo = getScopeText(editor, scope);
    const actionId = (aiAction?.id ?? 'proofread') as never;
    if (mode === 'replace' && scopeInfo.range) {
      editor.chain().focus().insertContentAt(scopeInfo.range, output.split('\n').filter(Boolean).map((line) => ({ type: 'paragraph', content: [{ type: 'text', text: line }] }))).run();
    } else { insertAIOutput(editor, actionId, output, mode === 'replace' && scope === 'selection'); }
    setAiResult(null); setAiAction(null);
    toast('AI suggestion applied. Use Ctrl+Z to undo.', 'success');
    setTimeout(() => void save('After AI operation'), 600);
  };

  // Tags
  const addTag = async (raw: string) => {
    const name = raw.trim().replace(/^#/, '');
    if (!name) return;
    try { const { tag } = await tagsApi.create(name); if (!noteTags.includes(tag._id)) setNoteTags((t) => [...t, tag._id]); await reloadTags(); }
    catch (e) { toast('Failed to add tag: ' + (e as Error).message, 'error'); }
  };

  const removeTag = (tid: string) => setNoteTags((ts) => ts.filter((x) => x !== tid));

  const toggleFavorite = () => { setFavorite(!favorite); patchAndSave({ favorite: !favorite }); };

  const cloneNote = async () => {
    setAiOpen(false);
    try { const { note: cloned } = await notesApi.clone(noteIdRef.current); navigate(`/editor/${cloned._id}`); toast('Cloned.', 'success'); }
    catch (e) { toast('Clone failed: ' + (e as Error).message, 'error'); }
  };

  const trashNote = async () => {
    if (!window.confirm('Move to trash?')) return;
    await notesApi.update(noteIdRef.current, { trashed: true });
    toast('Moved to trash.', 'info');
    navigate('/notes');
  };

  /* floating layers — PAGE-LOCAL (§6/§9): the element is attached to the
     page that owns the action. `pageId` is the ORIGINATING page captured at
     menu-open/action time; when absent the action belongs to the currently
     active page (the Ribbon's add-tab semantics). A pageId that no longer
     resolves FAILS SAFELY with a toast — it is never redirected to page 1
     or to any other sheet. */
  const addFloatingElement = useCallback((
    type: FloatingElement['type'],
    init?: { src?: string; width?: number; height?: number; aspectRatio?: number },
    pageId?: string | null,
  ) => {
    const targetId = pageId ?? activePageIdRef.current;
    if (!targetId || !pagesRef.current.some((p) => p.id === targetId)) {
      console.error('[page-context] floating insert requested for unknown page', targetId, '— refusing to redirect it');
      toast('صفحهٔ مقصد یافت نشد — درج انجام نشد.', 'error');
      return;
    }
    setFloatingElementsByPage((prev) => {
      const list = prev[targetId] ?? [];
      /* placement is policy, not arithmetic: new objects land on a cascade
         anchor INSIDE the object area (objectMaxArea — keeps the required
         gap from the page's right edge; §2 of the object-system task) */
      const kind = pagesRef.current.find((p) => p.id === targetId)?.kind ?? 'framed';
      const area = objectMaxArea(kind);
      const slot = list.length % 6;
      const x = Math.min(area.x0 + slot * 24, Math.max(area.x0, area.w - 180));
      const y = Math.min(area.y0 + slot * 24, Math.max(area.y0, area.h - 140));
      return { ...prev, [targetId]: [...list, createFloatingElement(type, x, y, init)] };
    });
    /* float mutations must reach autosave (persistence gap: floating objects
       previously only lived in React state until an unrelated text edit) */
    dirtyRef.current = true;
    scheduler.markDirty();
  }, [toast, scheduler]);

  /* live drag/resize geometry of the object being manipulated — stored in a
     REF (no re-render) and read by the contextual ribbon's float tools so
     width/position display tracks the gesture; cleared on commit (null) */
  const liveFloatGeometryRef = useRef<{ pageId: string; id: string; x: number; y: number; width: number; height: number } | null>(null);
  const handleLiveFloatGeometry = useCallback((pgId: string, id: string, g: { x: number; y: number; width: number; height: number } | null) => {
    liveFloatGeometryRef.current = g ? { pageId: pgId, id, ...g } : null;
  }, []);
  /* originating page of the OPEN context menu (captured when the menu is
     built from the right-clicked page, consumed by its menu actions) */
  const ctxOriginPageIdRef = useRef<string | null>(null);

  const patchAndSave = (patch: Record<string, unknown>) => {
    if (!note) return;
    notesApi.update(noteIdRef.current, patch).then(({ note: updated }) => setNote(updated)).catch((e) => toast('Failed to save: ' + (e as Error).message, 'error'));
  };

  // Exports
  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
  };
  const exportHtml = () => {
    const finalHtml = renderMathInHtml(buildFullHtml() || html);
    const blob = new Blob([`<!doctype html><html dir="rtl" lang="fa"><head><meta charset="utf-8"><title>${title}</title><link href="https://cdn.jsdelivr.net/gh/rastikerdar/sahel-font@v3.4.0/dist/font-face.css" rel="stylesheet"><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css"><style>${fontsCssRaw}</style><style>body{font-family:Sahel,Tahoma;direction:rtl;max-width:800px;margin:2rem auto;line-height:2;padding:0 1rem}</style></head><body>${finalHtml}</body></html>`], { type: 'text/html;charset=utf-8' });
    downloadBlob(blob, `${title || 'note'}.html`);
  };
  const exportWord = async () => {
    try {
      /* the Word path takes the RAW editor HTML (LaTeX sources still
         un-rendered) — prepareWordHtml converts every equation into native
         OMML so Word shows real editable math instead of KaTeX markup it
         cannot style, and reproduces the editor's checkbox look.
         BUGFIX (Ribbon/Word path parity): this route used to SKIP
         buildWordHeaderFooter entirely, so the Word file exported from the
         Ribbon («فایل → خروجی Word») silently lost the ornamental page
         frame (قاب) and the PAGE-field page number, while the SAME export
         from the print-preview modal included them. Both buttons now build
         the identical payload. */
      const blob = await exportApi.docx({
        title: title || 'Untitled',
        html: prepareWordHtml(buildFullHtml() || html),
        subject: subjects.find((s) => s._id === subjectId)?.name,
        chapter,
        headerText: settings?.export.headerText ?? '',
        footerText: settings?.export.footerText ?? '',
        bodyFontFamily: settings?.editor.fontFamily,
        fontSizePx: settings?.editor.fontSize,
        lineHeight: settings?.editor.lineHeight,
        eduCss: buildWordEduCss(settings?.editor.eduBlocks, (settings?.editor.eduBlocks ?? 'minimal') === 'tinted'),
        /* ornamental page frame (قاب) → VML in the Word page header, page
           number → a real PAGE field in the footer: both repeat on every
           page just like the editor sheet and the PDF */
        ...buildWordHeaderFooter(settings?.border, { subject: subjects.find((s) => s._id === subjectId)?.name, chapter, title: title || 'Untitled' }),
      });
      downloadBlob(blob, `${title || 'note'}.doc`); toast('فایل Word آماده شد.', 'success');
    } catch (e) { toast('خروجی Word ناموفق بود: ' + (e as Error).message, 'error'); }
  };

  /* Page management functions — MUST stay above the early returns below:
     hooks may not run conditionally (Rules of Hooks), otherwise React throws
     "Rendered more hooks than during the previous render" when the note
     finishes loading and the full tree renders for the first time. */
  /* Page-management callbacks read pages/activePageId through refs and are
     built ONCE (§11): stable identity for the Ribbon/sidebar props, no
     closure recreation per keystroke, no listener churn. */
  const createPage = useCallback((afterId: string, content?: Record<string, unknown>, floatingElements?: FloatingElement[], kind: PageKind = 'framed'): string => {
    const pagesNow = pagesRef.current;
    const afterIndex = pagesNow.findIndex((p) => p.id === afterId);
    const newIndex = afterIndex === -1 ? pagesNow.length : afterIndex + 1;
    const newPage: DocPage = {
      id: `page-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      pageNumber: 0, // will be recalculated
      content: content ?? { type: 'doc', content: [{ type: 'paragraph' }] },
      floatingElements: floatingElements ?? [],
      kind,
    };
    setPages((prev) => {
      const next = [...prev];
      next.splice(newIndex, 0, newPage);
      return next.map((p, idx) => ({ ...p, pageNumber: idx + 1 }));
    });
    setActivePageId(newPage.id);
    setFloatingElementsByPage((prev) => ({ ...prev, [newPage.id]: floatingElements ?? [] }));
    /* ── CREATE_PAGE (semantic, §2/§3): publish the structural op through
       the room so every peer creates the same page representation and binds
       the same page:<pageId> fragment BEFORE content ops arrive. Seat-less
       (view-only) users cannot restructure — mirrors text editability. */
    const s = collabSessionRef.current;
    if (s && collabSeatRef.current === 'active') {
      structureCreatePage(s, newPage.id, kind, false, afterIndex >= 0 ? afterId : undefined);
      /* duplicate/flow-created content seeds the (empty) fragment locally —
         the op travels as normal CRDT updates (no full-doc broadcast) */
      if (content && !isDocEmpty(content)) seedPageFragmentFromJson(s, newPage.id, content);
      for (const f of floatingElements ?? []) {
        s.opUpsertFloat(newPage.id, f as unknown as Record<string, unknown>);
      }
      if (floatingElements?.length) {
        s.commitFloats(newPage.id, floatingElements as unknown as Array<Record<string, unknown>>);
      }
    }
    return newPage.id;
  }, []);

  const deletePage = useCallback((pageId: string) => {
    const pagesNow = pagesRef.current;
    if (pagesNow.length <= 1) return; // never delete the last page
    setPages((prev) => {
      const filtered = prev.filter((p) => p.id !== pageId);
      return filtered.map((p, idx) => ({ ...p, pageNumber: idx + 1 }));
    });
    setFloatingElementsByPage((prev) => {
      const next = { ...prev };
      delete next[pageId];
      return next;
    });
    if (activePageIdRef.current === pageId) {
      const remaining = pagesNow.filter((p) => p.id !== pageId);
      setActivePageId(remaining[0]?.id ?? '');
    }
    /* ── DELETE_PAGE (semantic, §4): entry-level op — drops the order entry,
       meta, fragment content and float state in ONE transaction; other
       pages are untouched. Concurrent delete/reorder converges (yjs). */
    const s = collabSessionRef.current;
    if (s && collabSeatRef.current === 'active') structureDeletePage(s, pageId);
  }, []);

  const movePageTo = useCallback((pageId: string, targetId: string, before: boolean) => {
    let nextAfterId: string | null = null;
    setPages((prev) => {
      const draggedIdx = prev.findIndex((p) => p.id === pageId);
      const targetIdx = prev.findIndex((p) => p.id === targetId);
      if (draggedIdx === -1 || targetIdx === -1 || draggedIdx === targetIdx) return prev;
      const next = prev.map((p) => ({ ...p }));
      const [moved] = next.splice(draggedIdx, 1);
      const insertAt = before ? targetIdx : targetIdx + 1;
      next.splice(insertAt, 0, moved);
      nextAfterId = next[insertAt + 1]?.id ?? null;
      return next.map((p, idx) => ({ ...p, pageNumber: idx + 1 }));
    });
    /* ── MOVE_PAGE (semantic, §5): ordering syncs by ID — pageNumber stays
       derived UI info; concurrent reorders converge via yjs list ops */
    const s = collabSessionRef.current;
    if (s && collabSeatRef.current === 'active') structureMovePage(s, pageId, nextAfterId);
  }, []);

  const appendPageAtEnd = useCallback(() => {
    const lastId = pagesRef.current[pagesRef.current.length - 1]?.id ?? '';
    return createPage(lastId);
  }, [createPage]);

  const pageAfterActive = useCallback(() => {
    const pagesNow = pagesRef.current;
    const activeIdx = pagesNow.findIndex((p) => p.id === activePageIdRef.current);
    if (activeIdx === -1 || activeIdx === pagesNow.length - 1) return appendPageAtEnd();
    const afterId = pagesNow[activeIdx + 1].id;
    return createPage(afterId);
  }, [createPage, appendPageAtEnd]);

  /** add a page of a specific visual kind (بلنک بدون قاب / نوت‌بوکی خط‌دار) */
  const addPageOfKind = useCallback((kind: PageKind) => {
    const pagesNow = pagesRef.current;
    return createPage(activePageIdRef.current || pagesNow[pagesNow.length - 1]?.id || '', undefined, undefined, kind);
  }, [createPage]);

  const pageBeforeActive = useCallback(() => {
    const pagesNow = pagesRef.current;
    const activeIdx = pagesNow.findIndex((p) => p.id === activePageIdRef.current);
    if (activeIdx <= 0) return appendPageAtEnd();
    const beforeId = pagesNow[activeIdx - 1].id;
    return createPage(beforeId);
  }, [createPage, appendPageAtEnd]);

  /* ── Pages sidebar (thumbnail strip) handlers ─────────────────────── */
  const scrollToPageEl = (pageId: string) => {
    setTimeout(() => {
      document.querySelector(`[data-page-id="${pageId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  };
  const selectPageFromSidebar = useCallback((pageId: string) => {
    setActivePageId(pageId);
    scrollToPageEl(pageId);
  }, []);
  /* stable across keystrokes: reads pages via a ref inside the closure */
  const pagesLenRef = useRef(0);
  pagesLenRef.current = pages.length;
  const lastPageIdRef = useRef('');
  lastPageIdRef.current = pages[pages.length - 1]?.id ?? '';
  const activePageIdStableRef = useRef(activePageId);
  activePageIdStableRef.current = activePageId;
  const addPageFromSidebar = useCallback((afterId?: string, kind?: PageKind) => {
    const newId = createPage(afterId || activePageIdStableRef.current || lastPageIdRef.current || '', undefined, undefined, kind);
    scrollToPageEl(newId);
  }, [createPage]);
  const duplicatePage = useCallback((pageId: string) => {
    const src = pagesRef.current.find((p) => p.id === pageId);
    if (!src) return;
    const contentCopy = src.content
      ? (JSON.parse(JSON.stringify(src.content)) as Record<string, unknown>)
      : { type: 'doc', content: [{ type: 'paragraph' }] };
    /* floats read from the live per-page record (single source of truth) */
    const srcFloats = floatsByPageRef.current[pageId] ?? src.floatingElements ?? [];
    const floatsCopy = srcFloats.map((f) => JSON.parse(JSON.stringify(f)) as FloatingElement);
    /* the copy must keep the source page's visual kind (قاب‌دار/بلنک/نوت‌بوکی) —
       createPage defaults to 'framed', which used to turn notebook/blank
       duplicates into framed sheets */
    const newId = createPage(pageId, contentCopy, floatsCopy, src.kind);
    scrollToPageEl(newId);
  }, [createPage]);

  /* ── Page-model PDF export ─────────────────────────────────────────────
     The pages array below is the single source of truth: application Page N
     becomes exactly one A4 PDF page N. The snapshot is taken at the moment
     the user opens print/PDF — every page's HTML comes from its live editor
     (falling back to the last render for unmounted pages) — so scroll
     position, zoom and when the note was last edited never matter. */
  const [exportPages, setExportPages] = useState<ExportPage[]>([]);
  const openPrintPreview = useCallback(() => {
    setExportPages(
      pages
        /* the auto-flow engine cleans up empty engine-created pages
           asynchronously (next animation frame / next render) — opening
           print/PDF right after an edit or an overflow "crop" can catch
           `pages` a tick before that cleanup lands, so a page that is
           ALREADY doomed (auto + empty) would otherwise be exported as a
           stray blank A4 sheet. Drop it here too, defensively, so export
           never shows a page the editor itself is about to remove. */
        .filter((p) => !(p.auto && isDocEmpty(p.content)))
        .map((p) => ({
          id: p.id,
          html: pageEditorsRef.current[p.id]?.getHTML?.() ?? pageHtmlRef.current[p.id] ?? '',
          floatingElements: floatingElementsByPage[p.id] ?? [],
          kind: p.kind,
        }))
    );
    setPrintOpen(true);
  }, [pages, floatingElementsByPage]);

  /* ── host actions for the custom context menu ──────────────────────────
     The menu items forward to the SAME systems this page uses:
     • افزودن به یادداشت → the notes API (a new note carrying the text)
     • جستجو در متن → a window event the Ribbon listens for (its find panel
       state lives inside the Ribbon)
     • افزودن شکل/یادداشت → the active page's floating layer
     • چاپ/PDF → dispatched as `pn:open-print-preview` by the menu; the
       listener below keeps the menu decoupled from this page's state. */
  const ctxMenuActions = useMemo<CtxMenuActions>(() => ({
    addToNote: (text) => {
      void (async () => {
        try {
          const doc = {
            type: 'doc',
            content: text.split('\n').filter(Boolean).map((line) => ({
              type: 'paragraph',
              content: [{ type: 'text', text: line }],
            })),
          };
          await notesApi.create({
            title: `از «${title.trim() || 'بدون عنوان'}»`,
            content: doc as Record<string, unknown>,
          });
          toast('به یادداشت‌ها افزوده شد.', 'success');
        } catch (e) { toast('افزودن به یادداشت ناموفق بود: ' + (e as Error).message, 'error'); }
      })();
    },
    openFind: () => window.dispatchEvent(new CustomEvent('pn:open-find')),
    openReplace: () => window.dispatchEvent(new CustomEvent('pn:open-find', { detail: { replace: true } })),
    addFloating: (type) => addFloatingElement(type, undefined, ctxOriginPageIdRef.current),
  }), [title, toast, addFloatingElement]);

  /* horizontal quick-format bar: shown as a card DIRECTLY ABOVE the vertical
     menu ONLY when a real text selection exists (formatting + بازنویسی AI
     live ONLY here — the vertical menu never duplicates them) */
  const [selToolbar, setSelToolbar] = useState(false);
  useEffect(() => {
    if (!ctxMenu) { setSelToolbar(false); return; }
    const editor = editorRef.current;
    if (!editor) { setSelToolbar(false); return; }
    try {
      const sel = editor.state.selection;
      /* text selections only — NodeSelection (image/equation) and CellSelection
         get no quick-format bar (formatting doesn't apply to them) */
      setSelToolbar(sel instanceof TextSelection && !sel.empty);
    } catch { setSelToolbar(false); }
  }, [ctxMenu]);
  useEffect(() => {
    const onOpenPrint = () => openPrintPreview();
    window.addEventListener('pn:open-print-preview', onOpenPrint);
    return () => window.removeEventListener('pn:open-print-preview', onOpenPrint);
  }, [openPrintPreview]);

  const activePage = useMemo(() => pages.find((p) => p.id === activePageId) ?? pages[0], [pages, activePageId]);
  const outline = useMemo(() => analyzeDocument(activePage?.content ?? {}), [activePage?.content]);
  const subject = subjects.find((s) => s._id === subjectId);

  /* Thumbnails for the pages sidebar — refreshed (debounced) from the
     changed pages' live editors so the strip reflects edits ~0.4s after
     typing stops. Formulas are rendered here too, matching print/export.
     Only pages whose content object actually changed are re-serialized:
     a typing burst on page 50 re-renders ONE thumbnail (one getHTML + one
     math render), never the whole document (§20). */
  const thumbSrcRef = useRef<Record<string, unknown>>({});
  useEffect(() => {
    const t = setTimeout(() => {
      setPageThumbs((prev) => {
        let changed = false;
        const next = { ...prev };
        const seen = new Set<string>();
        for (const p of pages) {
          seen.add(p.id);
          if (thumbSrcRef.current[p.id] === p.content && prev[p.id] !== undefined) continue;
          thumbSrcRef.current[p.id] = p.content;
          const html = renderMathInHtml(pageEditorsRef.current[p.id]?.getHTML?.() ?? pageHtmlRef.current[p.id] ?? '');
          if (prev[p.id] !== html) { next[p.id] = html; changed = true; }
        }
        /* prune deleted pages so the map cannot grow unbounded (§23) */
        for (const key of Object.keys(next)) {
          if (!seen.has(key)) { delete next[key]; delete thumbSrcRef.current[key]; changed = true; }
        }
        return changed ? next : prev;
      });
    }, 400);
    return () => clearTimeout(t);
  }, [pages]);

  /** Stable per-page callbacks (§11 render-cascade fix): identity depends
   *  only on the page-ID list — typing in page N must never hand other
   *  pages fresh closures. Active-page state is read via activePageIdRef
   *  inside the callbacks (always fresh, no dependency needed). These
   *  hooks live ABOVE the `if (loadError)` early return — React forbids
   *  any hook-count change between renders. */
  const pageIdKey = useMemo(() => pages.map((p) => p.id).join('\u0000'), [pages]);

  /** Sidebar page list (§11): new identity only when the page STRUCTURE
   *  (ids/order/count) changes or a thumbnail actually updates — typing in
   *  page N must not rebuild the strip's page array. */
  const sidebarPages = useMemo(
    () => pages.map((p) => ({ id: p.id, pageNumber: p.pageNumber, kind: p.kind, html: pageThumbs[p.id] ?? '' })),
    // pageIdKey encodes id/order/count; pageThumbs changes only after its
    // 400ms debounce actually ran (not per keystroke).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pageIdKey, pageThumbs]
  );
  const togglePagesBar = useCallback(() => setPagesBarOpen((v) => !v), []);
  const addPageOfKindSidebar = useCallback((kind: PageKind) => addPageOfKind(kind), [addPageOfKind]);
  const pageCallbacks = useMemo(() => {
    const map: Record<string, Pick<PageProps, 'setFloatingElements' | 'onUpdate' | 'onActivate' | 'onEditorFocus' | 'editorRef' | 'onPasteToFloat'>> = {};
    for (const p of pages) {
      map[p.id] = {
        setFloatingElements: (els) => {
          /* float mutations (drag/resize/format from the ribbon panels) must
             reach autosave — without marking dirty the change lived only in
             React state until an unrelated text edit saved the note */
          dirtyRef.current = true;
          scheduler.markDirty();
          const prevList = (floatsByPageRef.current[p.id] ?? []) as FloatingElement[];
          const nextList = typeof els === 'function' ? els(prevList) : els;
          setFloatingElementsByPage((prev) => ({ ...prev, [p.id]: nextList }));
          /* ── semantic float sync (§7/§8) — COMMIT-ORIENTED: this runs on
             meaningful commits (drag end / format change / insert / delete
             / text edit), never pointermove (§10). Per-OBJECT ops: only the
             changed properties travel, so A moving x and B resizing width
             merge; text edits ride the same property map (§9). */
          const s = collabSessionRef.current;
          if (s && collabSeatRef.current === 'active') {
            const prevRecs = prevList as unknown as Array<Record<string, unknown>>;
            const nextRecs = nextList as unknown as Array<Record<string, unknown>>;
            const seen = new Set<string>();
            for (const rec of nextRecs) {
              const oid = String(rec.id ?? '');
              if (!oid) continue;
              seen.add(oid);
              const prevEl = prevRecs.find((x) => String(x.id ?? '') === oid);
              if (!prevEl) floatUpsert(s, p.id, rec);
              else {
                const patch = floatDiff(prevEl, rec);
                if (patch) floatPatch(s, p.id, oid, patch);
              }
            }
            for (const rec of prevRecs) {
              const oid = String(rec.id ?? '');
              if (oid && !seen.has(oid)) floatDelete(s, p.id, oid);
            }
            /* legacy §4 mirror for the persistence projection */
            s.commitFloats(p.id, nextRecs);
          }
        },
        onUpdate: onEditorUpdate,
        /* paste/drop of image FILES becomes a FLOATING image object on this
           page (paste → تصویر شناور) — routed through addFloatingElement so
           the object gets the standard placement/bounds/autosave pipeline */
        onPasteToFloat: (src, width, height, aspectRatio) => addFloatingElement('image', { src, width, height, aspectRatio }, p.id),
        onActivate: () => { if (p.id !== activePageIdRef.current) setActivePageId(p.id); },
        onEditorFocus: () => {
          /* a real user focus cancels any stale caret-follow the engine
             queued for ANOTHER page — otherwise the queued selection could
             fire much later, teleporting the caret the moment the user
             returns to that page */
          const pendingSel = pendingFlowSelectionRef.current;
          if (pendingSel && pendingSel.pageId !== p.id) pendingFlowSelectionRef.current = null;
          if (p.id !== activePageIdRef.current) {
            activePageIdRef.current = p.id;
            setActivePageId(p.id);
            /* the Ribbon / AI / contextual tools read editorRef.current
               synchronously — point it at the FOCUSED page's editor
               immediately, don't wait for the re-render */
            editorRef.current = pageEditorsRef.current[p.id] ?? editorRef.current;
            setEditorReady(!!pageEditorsRef.current[p.id]);
          }
        },
        editorRef: (e) => {
          /* register EVERY page's editor — the PDF exporter reads
             HTML from all of them, not just the active page */
          pageEditorsRef.current[p.id] = e;
          if (p.id === activePageIdRef.current) {
            editorRef.current = e;
            setEditorReady(e !== null);
          }
          /* a page's editor mounted/unmounted (initial load, engine
             page creation) — give the pagination engine a chance
             to measure the fresh sheet */
          scheduleAutoFlow();
        },
      };
    }
    return map;
    // activePageId is read via activePageIdRef (always fresh) inside the
    // callbacks, so it must NOT be a dependency — that would re-create
    // every closure on every page switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageIdKey, onEditorUpdate, scheduleAutoFlow, addFloatingElement, scheduler]);

  if (loadError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4" style={{ animation: 'pn-fade-in 0.15s ease-out' }}>
        <p className="text-[14px] text-[#ff5b4f]">{loadError}</p>            <button type="button" onClick={() => navigate('/')} className="h-9 rounded-lg bg-[#171717] px-4 text-[13px] font-medium text-white dark:bg-white dark:text-[#171717] pn-shadow-border hover:opacity-80 transition-[opacity] duration-100">بازگشت به داشبورد</button>
      </div>
    );
  }
  if (!note) {
    return <div className="flex h-full items-center justify-center text-[13px] text-[#999]">در حال بارگذاری…</div>;
  }

  /* save-state UI comes from the ONE centralized machine (SaveStatusBadge +
     SAVE_STATE_META) — this page keeps no label/color table of its own */

  return (
    <div className="relative flex h-full min-w-0 flex-1 flex-col">

      {/* flex-row-reverse: DOM order is [PageSidebar column] then [editor];
          the row-reverse paints the sidebar on the RIGHT of the RTL screen.
          The RightPanel below renders INSIDE the same sidebar column area via
          PageSidebar's embedded slot when the دستیار tab is active. */}
      <div className="flex min-h-0 flex-1 flex-row-reverse">
        {/* Pages sidebar — thumbnail strip with per-page actions
            (افزودن/تکثیر/جابه‌جایی/حذف); stays reachable in focus mode
            (unlike other <aside> panels) so page previews can still be
            opened/closed via the rail toggle */}
        <PageSidebar
          open={pagesBarOpen}
          onToggle={togglePagesBar}
          /* ONE column, two tabs — the AI panel renders INSIDE the sidebar
             column when its tab is active (no parallel aside, no overlap) */
          aiOpen={aiOpen}
          onTabChange={(next) => { if (next === 'pages') { setAiOpen(false); } else { setAiOpen(true); setPanelTab('ai'); } }}
          aiSlot={
            <RightPanel
              embedded
              note={note}
              doc={activePage.content ?? {}}
              scope={scope}
              onScopeChange={setScope}
              onRunAction={(a) => void runAI(a)}
              running={aiRunning}
              runningAction={aiAction?.id ?? null}
              editor={editorReady ? editorRef.current : null}
              tab={panelTab}
              onTabChange={setPanelTab}
              title={title}
              onTitleChange={(t) => { setTitle(t); debouncedSave(); }}
              saveState={saveState}
              favorite={favorite}
              onToggleFavorite={toggleFavorite}
              onClone={() => void cloneNote()}
              onTrash={() => void trashNote()}
              onBack={() => navigate(-1)}
              subjects={subjects}
              subjectId={subjectId}
              onSubjectChange={(v) => { setSubjectId(v); patchAndSave({ subjectId: v || null }); }}
              chapter={chapter}
              onChapterChange={(c) => { setChapter(c); if (c !== note.chapter) patchAndSave({ chapter: c }); }}
              tags={tags}
              noteTags={noteTags}
              onAddTag={(name) => void addTag(name)}
              onRemoveTag={removeTag}
            />
          }
          /* §11: keyed on page-ID list only — a content keystroke keeps the
             same array identity (thumb html updates flow in via the 400ms
             debounce, which replaces this array only when it actually runs) */
          pages={sidebarPages}
          activePageId={activePageId}
          editorFontSize={editorFontSize}
          editorLineHeight={editorLineHeight}
          onSelect={selectPageFromSidebar}
          onAddPage={addPageFromSidebar}
          onAddPageOfKind={addPageOfKindSidebar}
          onDuplicate={duplicatePage}
          onDelete={deletePage}
          onReorder={movePageTo}
        />
        {/* Editor column — the Ribbon tab strip (فایل/خانه/افزودن/…) is now the
            topmost bar; title/meta/save/actions live in the sidebar */}
        <div className="flex min-w-0 flex-1 flex-col">
          <Ribbon
            editor={editorReady ? editorRef.current : null}
            onOpenAIPanel={() => { setAiOpen((v) => !v); setPanelTab('ai'); }}
            aiPanelOpen={aiOpen}
            onOpenPrintPreview={openPrintPreview}
            /* جستجو و جایگزینی is now a dropdown panel opened by the
               Ribbon's own search icon (Ctrl+F opens it too) */
            onToggleFind={() => setFindOpen(true)}
            onNewPage={() => createPage(activePageId || pages[pages.length - 1]?.id || '')}
            onAddPage={addPageOfKind}
            onAppendPageAtEnd={() => appendPageAtEnd()}
            onAddFloatingElement={addFloatingElement}
            onNavigateSettings={() => navigate('/settings')}
            onToggleSidebar={() => setAiOpen((v) => !v)}
            onToggleFocus={() => setFocusMode((v) => !v)}
            onSave={() => { void save(); }}
            onShowHistory={() => { void save('Manual version save from Ribbon'); toast('نسخه‌ای از سند ثبت شد.', 'success'); }}
            onShowShortcuts={() => setShortcutsOpen(true)}
            onExportWord={exportWord}
            onExportHtml={exportHtml}
            wordCount={outline.wordCount}
            border={border}
            onBorderChange={patchBorder}
            zoom={zoom}
            onZoomChange={setZoom}
            eduBlocks={eduBlocks}
            onOpenEduBlocks={() => setEduBlocksOpen(true)}
            saveState={saveState}
            /* collaboration presence (group notes only) — separate concern
               from SaveState, rendered beside it in the Ribbon */
            collabPresence={collabActive && collabState ? <CollabPresenceChip state={collabState} /> : null}
          />
          <div className="pn-editor-scroll flex-1 overflow-y-auto py-8"          onContextMenu={(e) => {
            // Suppress the native browser menu over the editor workspace
            e.preventDefault();
            /* resolve the editor of the page that was ACTUALLY clicked —
               the active page's editor may still be another sheet here,
               because the mousedown-activation re-render has not run yet */
            const pageEl = (e.target as HTMLElement).closest('[data-page-id]');
            const pageId = pageEl?.getAttribute('data-page-id') ?? '';
            /* §3: the right-clicked page OWNS this menu — remember it so
               every action built from it (addFloating, AI, …) targets the
               same page even if the active page differs */
            ctxOriginPageIdRef.current = pageId || null;
            const editor = (pageId && pageEditorsRef.current[pageId]) || editorRef.current;
            if (!editor) return;
            // Detect what was right-clicked and align the editor/floating selection
            const floatHit = detectRightClickTarget(editor, e.nativeEvent);
            // Build the context-specific menu (pure data — no editor re-render)
            const items = buildContextMenuItems(editor, ctxMenuActions, floatHit, e.nativeEvent);
            if (items.length > 0) {
              setCtxMenu({ x: e.clientX, y: e.clientY, items });
            }
          }}>
            {/* zoom is a pure visual transform of the workspace — it never
                changes the A4 logical size (794×1123) or the PDF export.
                CSS zoom (not transform) keeps drag/resize coordinates and
                hit-testing consistent. */}
            <div className={`document-pages${eduTinted ? ' edu-tinted' : ''}`} style={{ zoom }}>
              {pages.map((page) => (
                <PageComponent
                  key={page.id}
                  pageId={page.id}
                  pageNumber={page.pageNumber}
                  kind={page.kind}
                  borderSettings={border}
                  content={page.content}
                  /* ── collaboration binding ── when the room is live, each
                     sheet binds to its shared yjs fragment (identity = stable
                     page id); a viewer without a seat gets collabEditable
                     false (VIEW-ONLY) — never a page reload, seat upgrades
                     flip this prop in place (collab/session.ts) */
                  collabFragment={collabActive && collabSession ? collabSession.fragmentFor(page.id) : undefined}
                  collabEditable={collabCanEdit}
                  /* ALL pages stay editable (Word-like): only the FOCUSED
                     editor receives keyboard input, so gating editability on
                     the active page routed Delete/Backspace to the previously
                     focused page — the "select on page 1, delete, but page
                     N's text changed" bug. The active page is now derived
                     from real editor focus (onEditorFocus below). */
                  enabled={true}
                  active={page.id === activePageId}
                  fontSize={editorFontSize}
                  lineHeight={editorLineHeight}
                  /* §11: stable per-page callbacks + shared empty array —
                     an untouched page's props keep identity across keystrokes */
                  floatingElements={floatingElementsByPage[page.id] ?? EMPTY_FLOATS_LIST}
                  setFloatingElements={pageCallbacks[page.id].setFloatingElements}
                  onActivate={pageCallbacks[page.id].onActivate}
                  onUpdate={pageCallbacks[page.id].onUpdate}
                  onEditorFocus={pageCallbacks[page.id].onEditorFocus}
                  editorRef={pageCallbacks[page.id].editorRef}
                  editorContainerRef={editorContainerRef}
                  onLiveGeometry={handleLiveFloatGeometry}
                />
              ))}
            </div>
          </div>

        </div>

      </div>

      {focusMode && (
        <button type="button" onClick={() => setFocusMode(false)} className="fixed bottom-4 right-4 z-40 rounded-lg bg-[#171717] px-3 py-2 text-[11px] font-medium text-white pn-shadow-border dark:bg-white dark:text-[#171717]" style={{ animation: 'pn-slide-up 0.1s ease-out' }}>
          ✕ خروج از حالت تمرکز <span className="pn-shortcut-key ml-1.5">Esc</span>
        </button>
      )}

      {/* view-only / seat-full banner (the 5th editor, or revoked access) */}
      {collabActive && collabState && (collabState.denyReason === 'capacity' || collabState.denyReason === 'forbidden') && (
        <div className="pointer-events-none fixed bottom-4 left-1/2 z-40 -translate-x-1/2" style={{ animation: 'pn-slide-up 0.15s ease-out' }}>
          <CollabBanner state={collabState} onRequestSeat={collab.requestSeat} />
        </div>
      )}

      <AIDiffModal open={Boolean(aiResult) || Boolean(aiError)} result={aiResult} running={aiRunning} originalText={aiOriginal} actionLabel={aiAction?.label ?? ''} detail={aiResult?.detail} error={aiError ?? undefined} onAccept={(out, mode) => void acceptAI(out, mode)} onClose={() => { setAiResult(null); setAiError(null); setAiAction(null); }} />
      {/* RAW HTML (LaTeX sources un-rendered) — the Word path converts
          equations to OMML itself; the PDF path re-renders them from pages */}
      <PrintPreviewModal
        open={printOpen}
        onClose={() => setPrintOpen(false)}
        html={buildFullHtml() || html}
        pages={exportPages.map((p) => ({ ...p, html: renderMathInHtml(p.html) }))}
        meta={{ title: title || 'Untitled', subject: subject?.name, chapter }}
      />
      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      {/* کادرهای آموزشی customization — the same generated CSS also feeds
          the print/PDF pipeline so export always mirrors the editor */}
      <style dangerouslySetInnerHTML={{ __html: eduCss }} />
      <EduBlocksModal open={eduBlocksOpen} onClose={() => setEduBlocksOpen(false)} />
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxMenu.items}
          onClose={() => setCtxMenu(null)}
          /* horizontal quick-format card directly above the menu — only with a
             real text selection (formatting + بازنویسی با هوش مصنوعی live
             ONLY here; the vertical menu never duplicates them) */
          toolbar={selToolbar && editorReady && editorRef.current
            ? (
              <SelectionToolbar
                editor={editorRef.current}
                onRunAI={(a) => { setCtxMenu(null); void runAI(a); }}
              />
            )
            : undefined}
        />
      )}
    </div>
  );
}
