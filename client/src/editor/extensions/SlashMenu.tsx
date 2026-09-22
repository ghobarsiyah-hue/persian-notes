import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import type { Editor, Range } from '@tiptap/core';

export interface SlashItem {
  title: string;
  /** React node icon — string glyphs are still accepted for SSR safety */
  icon: ReactNode | string;
  /** section label shown above consecutive items of the same group */
  group?: string;
  keywords: string[];
  command: (editor: Editor, range: Range) => void;
}

interface MenuState {
  items: SlashItem[];
  command: (item: SlashItem) => void;
}

/** the actual menu UI */
function SlashMenuView({ state, registerKeyHandler }: { state: MenuState; registerKeyHandler: (fn: (e: KeyboardEvent) => boolean) => void }) {
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => setSelected(0), [state.items]);

  useEffect(() => {
    registerKeyHandler((event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setSelected((s) => {
          const next = event.key === 'ArrowDown' ? s + 1 : s - 1;
          return (next + state.items.length) % Math.max(1, state.items.length);
        });
        return true;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const item = state.items[selected];
        if (item) state.command(item);
        return true;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        return false; // let suggestion close itself
      }
      return false;
    });
  }, [state, selected, registerKeyHandler]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${selected}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  if (!state.items.length) {
    return (
      <div className="slash-menu px-3 py-4 text-center text-sm text-ink-500">
        موردی یافت نشد
      </div>
    );
  }

  return (
    <div className="slash-menu" ref={listRef}>
      {state.items.map((item, i) => {
        const showGroup = item.group && state.items[i - 1]?.group !== item.group;
        return (
          <div key={`${item.group ?? ''}-${item.title}`}>
            {showGroup && <div className="slash-group-label">{item.group}</div>}
            <div
              data-index={i}
              data-selected={i === selected}
              className="slash-item"
              onClick={() => state.command(item)}
              onMouseEnter={() => setSelected(i)}
            >
              <div className="slash-item-inner">
                <div className="slash-item-top">
                  <span className="slash-item-icon">
                    {typeof item.icon === 'string' ? item.icon : item.icon}
                  </span>
                  <span className="slash-item-title font-semibold">{item.title}</span>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Suggestion renderer that mounts the React menu near the caret */
export function createSlashRenderer() {
  let el: HTMLDivElement | null = null;
  let root: Root | null = null;
  let keyHandler: ((e: KeyboardEvent) => boolean) | null = null;

  const render = (props: SuggestionProps) => {
    root?.render(
      <SlashMenuView
        state={{
          items: props.items as SlashItem[],
          command: (item) => props.command(item),
        }}
        registerKeyHandler={(fn) => {
          keyHandler = fn;
        }}
      />
    );
  };

  const position = (props: SuggestionProps) => {
    if (!el) return;
    const rect = props.clientRect?.();
    if (rect) {
      el.style.top = `${rect.bottom + window.scrollY + 6}px`;
      el.style.left = `${rect.left + window.scrollX}px`;
    }
  };

  return {
    onStart(props: SuggestionProps) {
      el = document.createElement('div');
      el.style.cssText = 'position:absolute;z-index:60;';
      document.body.appendChild(el);
      root = createRoot(el);
      render(props);
      position(props);
    },
    onUpdate(props: SuggestionProps) {
      render(props);
      position(props);
    },
    onKeyDown(props: SuggestionKeyDownProps) {
      if (props.event.key === 'Escape') {
        props.view.dispatch(props.view.state.tr.setMeta('closeSlashMenu', true));
      }
      return keyHandler?.(props.event) ?? false;
    },
    onExit() {
      root?.unmount();
      el?.remove();
      el = null;
      root = null;
      keyHandler = null;
    },
  };
}
