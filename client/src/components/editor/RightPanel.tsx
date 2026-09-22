import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { ArrowRight, Star, Copy, Trash2 } from 'lucide-react';
import { aiApi } from '@/api/endpoints';
import type { AIActionInfo, Note, SaveState, Subject, Tag } from '@/types';
import { SaveStatusBadge } from '@/components/editor/SaveStatusBadge';

export type AIScope = 'selection' | 'paragraph' | 'section' | 'document';
export type PanelTab = 'ai';

interface Props {
  /* item ۹: rendered INSIDE the pages sidebar column (shared surface) when
     true — same 200px column, no own border/shadow; standalone aside when
     false (legacy callers) */
  embedded?: boolean;
  note: Note | null;
  doc: Record<string, unknown> | null;
  scope: AIScope;
  onScopeChange: (s: AIScope) => void;
  onRunAction: (action: AIActionInfo) => void;
  running: boolean;
  runningAction: string | null;
  editor?: Editor | null;
  /* sidebar tab is controlled by the parent (Ribbon AI button switches to it) */
  tab: PanelTab;
  onTabChange: (t: PanelTab) => void;
  /* document meta — moved here from the old top header */
  title: string;
  onTitleChange: (t: string) => void;
  saveState: SaveState;
  favorite: boolean;
  onToggleFavorite: () => void;
  onClone: () => void;
  onTrash: () => void;
  onBack: () => void;
  subjects: Subject[];
  subjectId: string;
  onSubjectChange: (id: string) => void;
  chapter: string;
  onChapterChange: (c: string) => void;
  tags: Tag[];
  noteTags: string[];
  onAddTag: (name: string) => void;
  onRemoveTag: (id: string) => void;
}

const SCOPES: Array<{ id: AIScope; label: string; icon: string }> = [
  { id: 'selection', label: 'انتخاب', icon: '⊕' },
  { id: 'paragraph', label: 'پاراگراف', icon: '¶' },
  { id: 'section', label: 'بخش', icon: '≡' },
  { id: 'document', label: 'کل سند', icon: '▬' },
];

const ACTION_ICONS: Record<string, string> = {
  proofread: '✎', professionalize: '◆', summarize: '≡', simplify: '◉',
  key_points: '◆', exam_points: '◎', questions: '؟', flashcards: '◧',
  table: '▦', continue: '→', structure: '⊞',
};

export function RightPanel({
  embedded = false,
  scope, onScopeChange, onRunAction, running, runningAction,
  title, onTitleChange, saveState,
  favorite, onToggleFavorite, onClone, onTrash, onBack,
  subjects, subjectId, onSubjectChange, chapter, onChapterChange,
  tags, noteTags, onAddTag, onRemoveTag,
}: Props) {
  const [actions, setActions] = useState<AIActionInfo[]>([]);
  const [provider, setProvider] = useState<string>('');
  const [tagInput, setTagInput] = useState('');

  useEffect(() => {
    aiApi.status().then((s) => { setActions(s.actions); setProvider(s.provider); }).catch(() => setActions([]));
  }, []);

  return (
    <aside
      className={`flex min-w-0 shrink-0 flex-col ${embedded ? 'w-full grow' : 'pn-glass-panel w-64 border-r border-black/5 dark:border-white/5'}`}
      style={embedded ? undefined : { boxShadow: '-1px 0 0 0 rgba(0,0,0,0.06)' }}
    >
      {/* ── Document header (moved from the old top bar) ── */}
      <div className="shrink-0 p-3" style={{ boxShadow: 'inset 0 -1px 0 0 rgba(0,0,0,0.06)' }}>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={onBack} title="بازگشت" aria-label="بازگشت" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[#666] hover:bg-gray-100 dark:hover:bg-[#222] transition-[background] duration-100">
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
          <input
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="عنوان جزوه"
            className="min-w-0 grow bg-transparent text-[14px] font-semibold tracking-[-0.02em] text-[#171717] outline-none placeholder:text-[#ccc] dark:text-white dark:placeholder:text-[#444]"
          />
        </div>

        <div className="mt-1.5 flex items-center justify-between">
          <SaveStatusBadge state={saveState} />
          <div className="flex items-center gap-0.5">
            <button type="button" onClick={onToggleFavorite} title="نشان‌گذاری" className={`flex h-6 w-6 items-center justify-center rounded-md transition-[color] duration-100 ${favorite ? 'text-[#f5a623]' : 'text-[#ccc] hover:text-[#f5a623]'}`}>
              <Star className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={onClone} title="کپی جزوه" className="flex h-6 w-6 items-center justify-center rounded-md text-[#999] hover:bg-gray-100 hover:text-[#666] dark:hover:bg-[#222] transition-[background,color] duration-100">
              <Copy className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={onTrash} title="انتقال به سطل زباله" className="flex h-6 w-6 items-center justify-center rounded-md text-[#999] hover:bg-red-50 hover:text-[#ff5b4f] dark:hover:bg-red-950 transition-[background,color] duration-100">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* meta: subject / chapter / tags */}
        <div className="mt-2 space-y-1.5">
          <select
            value={subjectId}
            onChange={(e) => onSubjectChange(e.target.value)}
            className="h-7 w-full rounded-md bg-gray-50 px-1.5 text-[11px] font-medium text-[#666] dark:bg-[#1a1a1a] dark:text-[#aaa] cursor-pointer outline-none"
            style={{ boxShadow: '0 0 0 1px rgba(0,0,0,0.06)' }}
          >
            <option value="">بدون موضوع</option>
            {subjects.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
          </select>
          <input
            value={chapter}
            onChange={(e) => onChapterChange(e.target.value)}
            placeholder="فصل…"
            className="h-7 w-full rounded-md bg-gray-50 px-2 text-[11px] font-medium text-[#666] placeholder:text-[#ccc] dark:bg-[#1a1a1a] dark:text-[#aaa] dark:placeholder:text-[#444] outline-none"
            style={{ boxShadow: '0 0 0 1px rgba(0,0,0,0.06)' }}
          />
          <div className="flex flex-wrap gap-1">
            {noteTags.map((tid) => {
              const t = tags.find((x) => x._id === tid);
              return (
                <button key={tid} type="button" onClick={() => onRemoveTag(tid)} className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-[#666] hover:bg-red-50 hover:text-[#ff5b4f] dark:bg-[#222] dark:text-[#888] dark:hover:bg-red-950 transition-[background,color] duration-100">
                  #{t?.name ?? '?'} ✕
                </button>
              );
            })}
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAddTag(tagInput); setTagInput(''); } }}
              placeholder="+ برچسب"
              className="h-6 w-16 rounded-md bg-transparent px-1 text-[10px] font-medium text-[#666] placeholder:text-[#ccc] dark:text-[#aaa] outline-none"
            />
          </div>
        </div>
      </div>

      <div className="grow overflow-y-auto overscroll-behavior-contain p-3">
        <div className="space-y-4">
          <div>
            <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#999]">Scope</h4>
            <div className="grid grid-cols-2 gap-1">
              {SCOPES.map((s) => (
                <button key={s.id} type="button" onClick={() => onScopeChange(s.id)} className={`flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition-[background,color] duration-100 ${scope === s.id ? 'bg-[#171717] text-white dark:bg-white dark:text-[#171717]' : 'bg-gray-50 text-[#666] hover:bg-gray-100 dark:bg-[#1a1a1a] dark:text-[#888] dark:hover:bg-[#222]'}`}>
                  <span>{s.icon}</span>{s.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#999]">
              Actions {provider && <span className="font-normal normal-case">({provider})</span>}
            </h4>
            <div className="space-y-0.5">
              {actions.map((a) => {
                const icon = ACTION_ICONS[a.id] || '⚡';
                const isActive = running && runningAction === a.id;
                return (
                  <button
                    key={a.id}
                    type="button"
                    disabled={!a.available || running}
                    onClick={() => onRunAction(a)}
                    title={a.available ? a.label : 'Requires AI service configuration'}
                    className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-right text-[12px] transition-[background,color] duration-100 ${
                      a.available
                        ? 'bg-gray-50 text-[#444] hover:bg-[#0070f3]/5 hover:text-[#0070f3] dark:bg-[#1a1a1a] dark:text-[#aaa] dark:hover:bg-[#0070f3]/10 dark:hover:text-[#3291ff]'
                        : 'cursor-not-allowed bg-gray-50 text-[#ccc] dark:bg-[#1a1a1a] dark:text-[#555]'
                    } ${isActive ? 'opacity-50' : ''}`}
                  >
                    <span className="text-[13px]">{icon}</span>
                    <span className="grow font-medium">{a.label}</span>
                    {!a.available && <span className="text-[9px] rounded bg-gray-100 px-1 py-0.5 dark:bg-[#222]">off</span>}
                    {isActive && <span className="text-[9px] rounded bg-[#0070f3]/10 px-1 py-0.5 text-[#0070f3]">…</span>}
                  </button>
                );
              })}
              {actions.length === 0 && <p className="py-4 text-center text-[12px] text-[#999]">Could not load actions. Check server connection.</p>}
            </div>
          </div>

          <div className="rounded-lg bg-[#fafafa] p-2.5 text-[11px] leading-5 text-[#999] dark:bg-[#1a1a1a]" style={{ boxShadow: '0 0 0 1px rgba(0,0,0,0.04)' }}>
            ⊘ The assistant never modifies content without your approval. A backup is saved before each AI operation.
          </div>
        </div>
      </div>
    </aside>
  );
}
