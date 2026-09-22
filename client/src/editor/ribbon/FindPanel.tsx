import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { faDigits } from '@/utils/fa';

interface Match {
  from: number;
  to: number;
}

function collectMatches(editor: Editor, query: string): Match[] {
  if (!query.trim()) return [];
  const q = query.toLowerCase();
  const matches: Match[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const text = node.text.toLowerCase();
    let idx = text.indexOf(q);
    while (idx !== -1) {
      matches.push({ from: pos + idx, to: pos + idx + query.length });
      idx = text.indexOf(q, idx + q.length);
    }
  });
  return matches;
}

const btn =
  'flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-xs font-medium text-ink-600 transition-colors hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-40';

/**
 * Find & Replace panel — opens as a dropdown from the toolbar's search icon  * (خانه → ویرایش tab). Replaces the old floating search box that
 * occupied a strip at the top of the editor; Ctrl+F still opens it.
 */
export function FindPanel({
  editor, onClose, panelWidth, showReplace, onShowReplaceChange,
}: {
  editor: Editor | null;
  onClose: () => void;
  /** match the host dropdown width so the inner fields line up */
  panelWidth?: number;
  /** optional controlled state — lets the host expand جایگزینی
   *  programmatically (Ctrl+H / right-click جایگزینی در متن) */
  showReplace?: boolean;
  onShowReplaceChange?: (v: boolean) => void;
}) {
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [showReplaceState, setShowReplaceState] = useState(false);
  const showReplaceEffective = showReplace ?? showReplaceState;
  const setShowReplace = (v: boolean | ((cur: boolean) => boolean)) => {
    if (onShowReplaceChange) {
      onShowReplaceChange(typeof v === 'function' ? v(showReplaceEffective) : v);
    } else {
      setShowReplaceState(v);
    }
  };
  const [active, setActive] = useState(0);
  const [tick, setTick] = useState(0); // re-collect matches on doc changes
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    void tick;
    return editor ? collectMatches(editor, query) : [];
  }, [editor, query, tick]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => setActive(0), [query]);

  const scrollToMatch = useCallback(
    (m: Match | undefined) => {
      if (!editor || !m) return;
      editor.view.dispatch(
        editor.view.state.tr
          .setSelection(TextSelection.create(editor.view.state.doc, m.from, m.to))
          .scrollIntoView()
      );
    },
    [editor]
  );

  useEffect(() => {
    if (!editor) return;
    const onUpdate = () => setTick((t) => t + 1);
    editor.on('update', onUpdate);
    return () => {
      editor.off('update', onUpdate);
    };
  }, [editor]);

  // Escape closes the whole dropdown; Enter/Shift+Enter navigate
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && showReplace && query && matches.length > 0) {
        e.preventDefault();
        replaceAll();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, showReplace, query, matches]);

  const go = (dir: 1 | -1) => {
    if (matches.length === 0) return;
    const next = (active + dir + matches.length) % matches.length;
    setActive(next);
    scrollToMatch(matches[next]);
  };

  const replaceOne = () => {
    if (!editor || matches.length === 0) return;
    const m = matches[active];
    if (!m) return;
    editor.chain().focus().insertContentAt({ from: m.from, to: m.to }, replacement).run();
    setTick((t) => t + 1);
  };

  const replaceAll = () => {
    if (!editor || !query) return;
    const all = collectMatches(editor, query);
    if (all.length === 0) return;
    // replace from the end so earlier positions stay valid
    const chain = editor.chain().focus();
    for (let i = all.length - 1; i >= 0; i--) {
      chain.insertContentAt({ from: all[i].from, to: all[i].to }, replacement);
    }
    chain.run();
    setTick((t) => t + 1);
  };

  return (
    <div style={{ width: panelWidth }}>
      <div className="flex items-center gap-1.5">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              go(e.shiftKey ? -1 : 1);
            }
          }}
          placeholder="جستجو در جزوه…"
          aria-label="جستجو در جزوه"
          className="h-8 min-w-0 grow rounded-md bg-ink-50 px-2.5 text-sm text-ink-900 shadow-ring outline-none placeholder:text-ink-400 dark:bg-ink-800 dark:text-ink-100"
        />
        <span className="shrink-0 whitespace-nowrap px-1 text-[11px] tabular-nums text-ink-500 dark:text-ink-400">
          {query ? `${faDigits(active + 1)} از ${faDigits(matches.length)}` : ''}
        </span>
        <button type="button" onClick={() => go(-1)} disabled={!matches.length} className={btn} title="مورد قبلی (Shift+Enter)">↑</button>
        <button type="button" onClick={() => go(1)} disabled={!matches.length} className={btn} title="مورد بعدی (Enter)">↓</button>
        <button
          type="button"
          onClick={() => setShowReplace((v) => !v)}
          className={`${btn} ${showReplace ? 'bg-ink-100 dark:bg-ink-800' : ''}`}
          title={showReplace ? 'بستن جایگزینی' : 'جایگزینی'}
        >
          {showReplace ? '▾' : '▸'}
        </button>
      </div>

      {showReplace && (
        <div className="mt-1.5 flex items-center gap-1.5 border-t border-ink-100 pt-1.5 dark:border-ink-800">
          <input
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            placeholder="جایگزین با…"
            aria-label="متن جایگزین"
            className="h-8 min-w-0 grow rounded-md bg-ink-50 px-2.5 text-sm text-ink-900 shadow-ring outline-none placeholder:text-ink-400 dark:bg-ink-800 dark:text-ink-100"
          />
          <button type="button" onClick={replaceOne} disabled={!matches.length} className={btn} title="جایگزینی این مورد">این مورد</button>
          <button type="button" onClick={replaceAll} disabled={!matches.length} className={btn} title="جایگزینی همه (Ctrl+Enter)">همه</button>
        </div>
      )}
    </div>
  );
}
