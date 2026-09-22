/* ────────────────────────────────────────────────────────────────────────
   EquationNode — the REAL structured equation object in the document.

   A TipTap node whose state IS the math AST (JSON in attrs — it serializes
   with the document automatically, never flattens to text or an image).
   The NodeView renders the AST through the math renderer and, when the
   user clicks inside, becomes a live math surface:

   • click anywhere → caret at the exact math position (path/offset model)
   • typing builds real AST nodes; ^ _ / wrap the previous atom
   • arrows navigate mathematically; Tab cycles placeholders
   • backspace at a slot start dissolves the structure; at the very start
     of an EMPTY equation it dissolves the equation into the paragraph
   • every discrete operation = one TipTap history transaction, so the
     document's single undo/redo system handles equation edits
   • when the caret is inside, the node registers as the ACTIVE equation
     (bridge) and the contextual Equation/Design ribbon tab appears
   • copy = LaTeX on the clipboard; paste of LaTeX parses into structures

   The node also exists in an INLINE variant (equationInline) that flows
   inside Persian RTL paragraphs while keeping LTR math layout.
   ──────────────────────────────────────────────────────────────────────── */

import { Node, mergeAttributes } from '@tiptap/core';
import { NodeSelection, Selection, TextSelection } from '@tiptap/pm/state';
import type { Editor as TipTapEditor } from '@tiptap/core';
import {
  type MathNode, type MathPath, cloneAll, getListAt,
} from '@/editor/equations/ast';
import { parseMath } from '@/editor/equations/parser';
import { toLatex } from '@/editor/equations/serializer';
import {
  renderMath, renderCaretIn, caretFromPoint,
} from '@/editor/equations/renderer';
import {
  type Caret, typeChar, insertAtCaret, insertStructure, moveHorizontal, moveVertical,
  nextPlaceholder, prevPlaceholder, deleteBackward, deleteForward, normalize,
  isEmptyRoot, matrixAddRow, matrixDeleteRow, matrixAddCol, matrixDeleteCol,
  casesAddRow, casesDeleteRow,
} from '@/editor/equations/engine';
import { structureByKey } from '@/editor/equations/structures';
import { setActiveEquation, getActiveEquation, type ActiveEquation } from '@/editor/equations/bridge';

export interface EquationAttrs {
  /** the structured math AST — THE equation */
  ast: MathNode[];
  /** display (own line) vs inline (flows in a paragraph) */
  display: boolean;
  /** professional (rendered math) vs linear (LaTeX source shown) */
  mode: 'professional' | 'linear';
  /** display equation alignment — null inherits the paragraph's text-align */
  align: 'left' | 'center' | 'right' | null;
  /** numbering: true = auto number, string = manual label, false = none */
  numbered: boolean | string;
  color: string | null;
}

/* ── shared NodeView factory ───────────────────────────────────────── */

type NodeViewArgs = { node: any; editor: TipTapEditor; getPos: () => number | undefined };

function equationView(inline: boolean) {
  return ({ node, editor, getPos }: NodeViewArgs) => {
    const dom: HTMLElement = document.createElement(inline ? 'span' : 'div');
    dom.setAttribute('data-type', inline ? 'equationInline' : 'equation');
    dom.classList.add('mq-equation');
    if (inline) dom.classList.add('mq-equation-inline');
    dom.setAttribute('dir', 'ltr'); // math is ALWAYS laid out LTR (inside RTL Persian too)
    dom.setAttribute('contenteditable', 'false');

    const renderEl = document.createElement('span');
    renderEl.className = 'mq-surface';
    renderEl.setAttribute('dir', 'ltr');
    dom.appendChild(renderEl);

    /* linear source editor (Convert ▸ Linear) */
    const src = document.createElement('div');
    src.className = 'mq-linear-src';
    src.setAttribute('dir', 'ltr');
    try { src.contentEditable = 'plaintext-only'; } catch { src.contentEditable = 'true'; }
    dom.appendChild(src);
    let linearOpen = false;

    const a = () => node.attrs as EquationAttrs;
    const isEditing = () => dom.classList.contains('mq-editing');
    /* NOTE: the old first-use hint bar (تایپ کنید: x^2 …) was removed —
       users found the guide text inside the equation box noisy. */

    /* Convert ▸ Linear: the LaTeX source is LIVE — every keystroke re-parses
       into the real AST (debounced), so linear editing is structure editing */
    let srcTimer: number | null = null;
    const flushSrc = () => {
      const latex = src.textContent ?? '';
      const parsed = parseMath(latex);
      root = parsed.length ? parsed : [phNode()];
      caret = clampCaret(root, caret);
      commit(cloneAll(root));
    };
    src.addEventListener('input', () => {
      if (srcTimer) window.clearTimeout(srcTimer);
      srcTimer = window.setTimeout(flushSrc, 250);
    });
    /* Escape → back to the professional view · Enter → apply + exit to text.
       The source editor owns its keys; nothing else may steal them. */
    src.addEventListener('keydown', (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        if (srcTimer) window.clearTimeout(srcTimer);
        linearOpen = false;
        render();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (srcTimer) window.clearTimeout(srcTimer);
        flushSrc();
        linearOpen = false;
        render();
        exitToText(1);
      }
    });

    /* ── AST → TipTap transaction (ONE history step per operation) ── */
    let root: MathNode[] = [];
    let syncing = false;

    const commit = (next: MathNode[]) => {
      root = next;
      const pos = typeof getPos === 'function' ? getPos() : undefined;
      if (pos === undefined || syncing) return;
      const current = editor.state.doc.nodeAt(pos);
      if (!current || (current.type.name !== (inline ? 'equationInline' : 'equation'))) return; // replaced under us
      syncing = true;
      try {
        /* PRESERVE the NodeSelection across the attrs update: every symbol/
           structure insert is a setNodeMarkup (a ReplaceStep around the
           node) — if the mapped selection drifts off the node, the equation
           drops out of edit mode and the Design tab detaches mid-flow. A
           10–20-symbol equation must stay hot through the whole burst. */
        const sel = editor.state.selection;
        const wasNodeSel = sel instanceof NodeSelection && sel.from === pos;
        const tr = editor.state.tr.setNodeMarkup(pos, undefined, { ...a(), ast: cloneAll(next) });
        if (wasNodeSel) tr.setSelection(NodeSelection.create(tr.doc, pos));
        editor.view.dispatch(tr);
      } finally { syncing = false; }
    };

    /* ── rendering ────────────────────────────────────────────────── */
    const render = () => {
      const attrs = a();
      if (attrs.mode === 'linear' || linearOpen) {
        renderEl.style.display = 'none';
        src.style.display = 'block';
        if (document.activeElement !== src) src.textContent = toLatex(root);
        dom.classList.add('mq-linear');
        return;
      }
      dom.classList.remove('mq-linear');
      src.style.display = 'none';
      renderEl.style.display = '';        renderEl.innerHTML = '';
      renderEl.appendChild(renderMath(root, true, []));
      renderCaretIn(renderEl, caret.path, caret.offset);
      renderEl.classList.toggle('mq-selected-all', hasSelection());
    };

    /* ── caret state + edit lifecycle ─────────────────────────────── */
    let caret: Caret = { path: [], offset: 0 };
    let sel: { a: { path: MathPath; offset: number }; b: { path: MathPath; offset: number } } | null = null; // whole-equation selection
    let disposeSel: (() => void) | null = null;

    const setSelection = (s: typeof sel) => { sel = s; };
    const hasSelection = () => sel !== null;

    const beginEdit = (keepCaret = true) => {
      if (isEditing()) return;
      dom.classList.add('mq-editing');
      if (!keepCaret) {
        /* start at the first placeholder (or the start of the equation) */
        const firstPh = root.findIndex((n) => n.type === 'ph');
        caret = firstPh >= 0 ? { path: [], offset: firstPh } : { path: [], offset: Math.min(caret.offset, root.length) };
      }
      render();
      registerActive();
    };

    /* click → interactive surface + document NodeSelection (which is what
       makes the contextual Equation/Design ribbon tab appear/disappear) */
    const activateSurface = (hit: { path: MathPath; offset: number } | null) => {
      beginEdit();
      if (hit) caret = hit;
      const pos = typeof getPos === 'function' ? getPos() : undefined;
      if (pos !== undefined) {
        try {
          if (editor.state.selection.from < pos || editor.state.selection.from > pos + node.nodeSize) {
            editor.view.dispatch(
              editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)).scrollIntoView(),
            );
          }
          editor.view.focus();
        } catch { /* node gone */ }
      }
      render();
    };

    const endEdit = () => {
      if (!isEditing()) return;
      dom.classList.remove('mq-editing');
      dom.classList.remove('mq-typing');
      renderEl.querySelectorAll('.mq-caret').forEach((c) => c.remove());
      linearOpen = false; // leave the temporary linear view back to professional
      /* NOTE: the impl stays registered as the ACTIVE equation even after
         editing ends — Design-tab buttons (structures/symbols/surgery) must
         keep working while the equation is merely NodeSelected, and they
         re-enter edit mode themselves through beginEdit().
         An empty equation is NEVER auto-deleted here — a freshly inserted
         box must not vanish when the user clicks away; dissolving an empty
         equation happens explicitly via Backspace at its start. */
    };

    /* keep the caret on screen while typing near the viewport edge —
       the math surface is not a real focus target, so nothing scrolls it */
    const scrollCaretIntoView = () => {
      const c = renderEl.querySelector('.mq-caret');
      if (c) (c as HTMLElement).scrollIntoView({ block: 'nearest' });
    };

    /* typing mode: steady caret + text cursor for a beat after each key */
    let typingTimer: number | null = null;
    const markTyping = () => {
      dom.classList.add('mq-typing');
      if (typingTimer) window.clearTimeout(typingTimer);
      typingTimer = window.setTimeout(() => dom.classList.remove('mq-typing'), 700);
    };

    /* Word behavior: Space / Enter / arrows-off-the-edge leave the formula
       and put the DOCUMENT caret right where the user expects — after (or
       before) the equation — so typing Persian text or inserting another
       formula next to it just works. The formula stays in the sentence. */
    const exitToText = (side: 1 | -1 = 1) => {
      const pos = typeof getPos === 'function' ? getPos() : undefined;
      endEdit();
      if (pos === undefined) { editor.view.focus(); return; }
      const n = editor.state.doc.nodeAt(pos);
      if (!n) { editor.view.focus(); return; }
      const target = side === 1
        ? Math.min(pos + n.nodeSize, editor.state.doc.content.size)
        : Math.max(0, pos - 1);
      try {
        editor.view.dispatch(
          editor.state.tr.setSelection(Selection.near(editor.state.doc.resolve(target), side)).scrollIntoView(),
        );
      } catch { /* invalid position — keep focus where it is */ }
      editor.view.focus();
    };

    const registerActive = () => {
      const id = nodeId();
      const impl: ActiveEquation = {
        id,
        apply: (fn) => { beginEdit(); fn(); commit(cloneAll(root)); render(); },
        requestEdit: () => {
          beginEdit();
          const pos = typeof getPos === 'function' ? getPos() : undefined;
          if (pos !== undefined) {
            try {
              editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)).scrollIntoView());
              editor.view.focus();
            } catch { /* node gone */ }
          }
        },
        runCommand: (cmd) => { runEquationCommand(cmd); },
        insertStructureKey: (key) => {
          const def = structureByKey(key);
          if (!def) return;
          beginEdit();
          const r = insertStructure(root, caret, () => def.make());
          caret = r.caret;
          commit(cloneAll(root));
          render();
        },
        insertSymbol: (ch) => {
          beginEdit();
          caret = typeChar(root, caret, ch);
          commit(cloneAll(root));
          render();
        },
        mode: () => a().mode,
        setMode: (m) => {
          const pos = typeof getPos === 'function' ? getPos() : undefined;
          if (pos === undefined) return;
          editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...a(), mode: m }));
          linearOpen = false;
          render();
        },
        align: () => a().align,
        setAlign: (al) => {
          const pos = typeof getPos === 'function' ? getPos() : undefined;
          if (pos === undefined) return;
          /* clicking the already-active alignment resets it to inherit —
             the box follows the paragraph's text-align again */
          const next = a().align === al ? null : al;
          editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...a(), align: next }));
        },
        number: () => !!a().numbered,
        setNumber: (n) => {
          const pos = typeof getPos === 'function' ? getPos() : undefined;
          if (pos === undefined) return;
          editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...a(), numbered: n }));
        },
        display: () => a().display,
        setDisplay: (d) => {
          const pos = typeof getPos === 'function' ? getPos() : undefined;
          if (pos === undefined) return;
          editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...a(), display: d }));
        },
        openLinearEditor: () => { linearOpen = true; beginEdit(); render(); requestAnimationFrame(() => src.focus()); },
      };
      setActiveEquation(impl);
    };

    const nodeId = () => {
      const pos = typeof getPos === 'function' ? getPos() : undefined;
      return `eq@${inline ? 'i' : 'b'}@${pos ?? '?'}`;
    };

    /* ── keyboard: the math surface ─────────────────────────────────
       Key events are captured at DOCUMENT level: ProseMirror's own handlers
       live on its editable root and would otherwise insert plain text before
       our handler runs. While THIS equation is the active one, every key
       aimed at the editor (or the body, focus having been taken) goes to the
       MATH engine — other inputs/dialogs keep their keys. */
    const onKeyDown = (e: KeyboardEvent): boolean => {
      const t = e.target as HTMLElement | null;
      if (src.contains(t)) return false; // the linear source editor types natively
      if (!isEditing()) return false;
      const eq = getActiveEquation();
      const mine = eq?.id === nodeId();
      const aimedHere = dom.contains(t) || t == null || t === document.body;
      if (!mine || (!aimedHere && !!t && !t.isContentEditable)) return false;
      const apply = (fn: () => void) => { fn(); commit(cloneAll(root)); render(); };

      if (e.key === 'Escape') { commit(cloneAll(root)); exitToText(1); return true; }

      if (e.key === 'Tab') {
        e.preventDefault();
        const next = e.shiftKey ? prevPlaceholder(root, caret) : nextPlaceholder(root, caret);
        if (next) caret = next;
        render();
        return true;
      }

      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const dir = e.key === 'ArrowLeft' ? -1 : 1;
        if (hasSelection()) { setSelection(null); render(); return true; } // collapse selection first
        const m = moveHorizontal(root, caret, dir);
        caret = m.caret;
        if (m.atStart) { exitToText(-1); } // caret lands BEFORE the formula in the sentence
        else if (m.atEnd) { exitToText(1); } // …AFTER it — continue typing text / insert another
        else render();
        scrollCaretIntoView();
        return true;
      }

      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const dir = e.key === 'ArrowUp' ? -1 : 1;
        const v = moveVertical(root, caret, dir);
        if (v) { e.preventDefault(); caret = v; render(); scrollCaretIntoView(); return true; }
        return false; // falls through → document-level arrow (page scroll etc.)
      }

      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        if (hasSelection()) {
          /* select-all + delete → an empty equation with one placeholder */
          root = [phNode()];
          caret = { path: [], offset: 0 };
          setSelection(null);
          commit(cloneAll(root));
          render();
          return true;
        }
        const del = e.key === 'Backspace' ? deleteBackward : deleteForward;
        const r = del(root, caret);
        caret = r.caret;
        normalize(root);
        markTyping();
        if (r.atStart) {
          commit(cloneAll(root));
          if (isEmptyRoot(root)) {
            /* Backspace at the start of an EMPTY equation = dissolve it:
               block → empty paragraph, inline → removed from the sentence */
            endEdit();
            const pos = typeof getPos === 'function' ? getPos() : undefined;
            const size = pos !== undefined ? editor.state.doc.nodeAt(pos)?.nodeSize : undefined;
            if (pos !== undefined && size) {
              try {
                if (inline) editor.view.dispatch(editor.state.tr.delete(pos, pos + size));
                else editor.view.dispatch(
                  editor.state.tr.replaceWith(pos, pos + size, editor.schema.nodes.paragraph.create()),
                );
              } catch { /* node already gone */ }
              editor.view.focus();
            }
          } else {
            endEdit(); // caret exits to the sentence in front of the formula
            exitToText(-1);
          }
          return true;
        }
        commit(cloneAll(root));
        render();
        return true;
      }

      if (e.key === 'Enter') {
        /* Enter ends math editing and returns to the sentence — always,
           so the user can never get stuck inside the surface */
        e.preventDefault();
        commit(cloneAll(root));
        exitToText(1);
        return true;
      }

      if (e.key === ' ') {
        /* Word: Space at the TOP level exits the formula and keeps writing
           the sentence. Inside a structure slot it types a literal space
           (e.g. 'a + b' in a numerator) — no trap, no accidental exit. */
        if (caret.path.length === 0) {
          e.preventDefault();
          commit(cloneAll(root));
          exitToText(1);
          return true;
        }
        e.preventDefault();
        apply(() => { caret = typeChar(root, caret, ' '); normalize(root); });
        return true;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        /* select-all = highlight the WHOLE equation, delete/typing replaces it */
        setSelection(null);
        render();
        return true;
      }

      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        if (hasSelection()) {
          /* typing over select-all replaces the whole equation */
          root = [phNode()];
          caret = { path: [], offset: 0 };
          setSelection(null);
        }
        apply(() => { caret = typeChar(root, caret, e.key); normalize(root); });
        markTyping();
        scrollCaretIntoView();
        return true;
      }
      return false;
    };

    /* capture at document level BEFORE ProseMirror's handlers; handled keys
       are swallowed so the paragraph editor never sees them */
    const keyHandler = (e: KeyboardEvent) => {
      if (onKeyDown(e)) { e.preventDefault(); e.stopPropagation(); }
    };
    document.addEventListener('keydown', keyHandler, true);

    /* ── click → caret (hit-test through the annotated DOM) ─────────
       A click also puts a ProseMirror NodeSelection on the equation, which
       is what the contextual-ribbon probe reads — the Equation/Design tab
       appears because the DOCUMENT selection says so, not because of side
       channel state. */
    dom.addEventListener('mousedown', (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('.mq-linear-src')) return;
      e.preventDefault();
      e.stopPropagation();
      const r = dom.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) return;
      /* ANY click inside the box (even on whitespace) opens the surface and
         puts a NodeSelection on the node → the Equation/Design ribbon shows */
      activateSurface(caretFromPoint(renderEl, e.clientX, e.clientY));
    });

    /* editing ends when the DOCUMENT selection moves away — the equation is
       an atom node, so any selection that is no longer OUR NodeSelection
       (user clicked a paragraph, another object, another equation…) means
       the user left. Ribbon clicks never move the selection, so Design-tab
       buttons keep working while the equation stays selected. */
    disposeSel = (() => {
      const onSelUpdate = () => {
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        if (pos === undefined) { endEdit(); return; }
        const s = editor.state.selection as { from: number };
        const isNodeSel =
          (s as unknown as { constructor?: unknown }).constructor === NodeSelection && s.from === pos;
        if (isEditing()) {
          if (!isNodeSel) endEdit(); // selection moved away → editing ends
          return;
        }
        if (isNodeSel) {
          /* THIS equation is the selected object → it is the Design tab's
             target. Re-register the bridge impl so ribbon pickers (which may
             run without any prior click into the box) always mutate the
             selected equation, never a stale one. */
          registerActive();
          /* a freshly inserted EMPTY equation auto-activates: the caret
             jumps into its first placeholder so the user types immediately */
          if (isEmptyRoot(root)) beginEdit(false);
        }
      };
      editor.on('selectionUpdate', onSelUpdate);
      return () => { editor.off('selectionUpdate', onSelUpdate); };
    })();

    /* ── paste: LaTeX → structures ────────────────────────────────── */
    dom.addEventListener('paste', (e: ClipboardEvent) => {
      if (!isEditing()) return;
      const latex = e.clipboardData?.getData('text/plain') ?? '';
      if (!latex) return;
      e.preventDefault();
      e.stopPropagation();
      const nodes = parseMath(latex);
      caret = insertAtCaret(root, caret, nodes.length ? nodes : [phNode()]);
      normalize(root);
      commit(cloneAll(root));
      render();
    });

    /* ── copy: LaTeX on the clipboard ─────────────────────────────── */
    dom.addEventListener('copy', (e: ClipboardEvent) => {
      if (!isEditing()) return;
      e.preventDefault();
      e.stopPropagation();
      e.clipboardData?.setData('text/plain', toLatex(root));
    });

    /* ── ribbon command dispatch (Design tab → here) ──────────────── */
    const runEquationCommand = (cmd: string) => {
      beginEdit(true);
      if (!getListOf(caret.path)) caret = { path: [], offset: Math.min(caret.offset, root.length) };
      switch (cmd) {
        case 'copy.latex': {
          void navigator.clipboard?.writeText(toLatex(root));
          return;
        }
        case 'matrix.addRowAfter': {
          const p = nearestMatrixPath(caret.path);
          if (p) matrixAddRow(root, p, matrixRowIndex(caret.path, p) + 1);
          break;
        }
        case 'matrix.deleteRow': {
          const p = nearestMatrixPath(caret.path);
          if (p) matrixDeleteRow(root, p, matrixRowIndex(caret.path, p));
          break;
        }
        case 'matrix.addColAfter': {
          const p = nearestMatrixPath(caret.path);
          if (p) matrixAddCol(root, p);
          break;
        }
        case 'matrix.deleteCol': {
          const p = nearestMatrixPath(caret.path);
          if (p) matrixDeleteCol(root, p);
          break;
        }
        case 'cases.addRowAfter': {
          const p = nearestCasesPath(caret.path);
          if (p) casesAddRow(root, p, casesRowIndex(caret.path, p) + 1);
          break;
        }
        case 'cases.deleteRow': {
          const p = nearestCasesPath(caret.path);
          if (p) casesDeleteRow(root, p, casesRowIndex(caret.path, p));
          break;
        }
        default: break;
      }
      normalize(root);
      commit(cloneAll(root));
      render();
    };

    const getListOf = (p: MathPath): MathNode[] | null => {
      let list: MathNode[] = root;
      for (let i = 0; i < p.length; i++) {
        const seg = p[i];
        if (typeof seg !== 'number') return null;
        const n = list[seg];
        if (!n) return null;
        const kind = p[++i];
        if (kind === undefined) return list;
        if (kind === 'c') { if (!n.children) return null; list = n.children; }
        else if (kind === 'p') { const l = n.parts?.[p[++i] as number]; if (!l) return null; list = l; }
        else if (kind === 'l') { if (!n.lower) return null; list = n.lower; }
        else if (kind === 'u') { if (!n.upper) return null; list = n.upper; }
        else if (kind === 'r') { const l = n.rows?.[p[++i] as number]; if (!l) return null; list = l; }
        if (!list) return null;
      }
      return list;
    };
    const getNodeAt = (p: MathPath): MathNode | null => {
      const l = getListOf(p.slice(0, -1));
      const i = p[p.length - 1];
      return l && typeof i === 'number' ? l[i] ?? null : null;
    };
    const nearestMatrixPath = (p: MathPath): MathPath | null => walkUp(p, 'matrix');
    const nearestCasesPath = (p: MathPath): MathPath | null => walkUp(p, 'cases');
    const walkUp = (p: MathPath, type: string): MathPath | null => {
      for (let i = p.length - 1; i >= 0; i--) {
        if (typeof p[i] !== 'number') continue;
        const np = p.slice(0, i + 1);
        const n = getNodeAt(np);
        if (n?.type === type) return np;
      }
      return null;
    };
    const rowIndexIn = (caretPath: MathPath, structPath: MathPath): number => {
      const i = caretPath.indexOf('r', structPath.length);
      return i >= 0 && typeof caretPath[i + 1] === 'number' ? caretPath[i + 1] as number : 0;
    };
    const matrixRowIndex = (c: MathPath, m: MathPath) => rowIndexIn(c, m);
    const casesRowIndex = (c: MathPath, m: MathPath) => rowIndexIn(c, m);

    /* ── initial paint ────────────────────────────────────────────── */
    root = sanitizeAst(cloneAll(a().ast ?? []));
    if (!root.length) root = [phNode()];
    render();

    return {
      dom,
      /* no contentDOM: the AST is the state — all editing flows through
         the surface so the equation can never degrade into plain text */
      update(updated: typeof node) {
        if (updated.type.name !== (inline ? 'equationInline' : 'equation')) return false;
        const attrs = updated.attrs as EquationAttrs;
        const next = sanitizeAst(Array.isArray(attrs.ast) ? attrs.ast : []);
        /* external changes (undo/redo, ribbon attr updates) repaint */
        if (JSON.stringify(next) !== JSON.stringify(root)) {
          root = cloneAll(next);
          if (!root.length) root = [phNode()];
          caret = clampCaret(root, caret);
        }
        dom.classList.toggle('mq-align-left', attrs.align === 'left');
        dom.classList.toggle('mq-align-right', attrs.align === 'right');
        dom.classList.toggle('mq-align-inherit', attrs.align == null);
        render();
        node = updated;
        return true;
      },
      ignoreMutation: () => true, // we own the entire DOM inside the node
      stopEvent: (e: Event) => {
        const t = e.target as HTMLElement;
        return dom.contains(t);
      },
      destroy: () => {
        document.removeEventListener('keydown', keyHandler, true);
        disposeSel?.();
        if (getActiveEquation()?.id === nodeId()) setActiveEquation(null);
      },
    };
  };
}

const KNOWN_AST = new Set([
  'run', 'sym', 'func', 'frac', 'script', 'sqrt', 'bigop', 'accent',
  'delim', 'cases', 'matrix', 'numbered', 'row', 'ph',
]);

/** heal foreign/legacy AST payloads (e.g. seed JSON with {type:'latex'}) —
 *  unknown wrappers are re-parsed from their latex/text field */
function sanitizeAst(ns: MathNode[]): MathNode[] {
  const out: MathNode[] = [];
  for (const n of ns ?? []) {
    if (!n || typeof n !== 'object' || !KNOWN_AST.has(String(n.type))) {
      const latex = (n as { latex?: string; text?: string })?.latex ?? (n as { text?: string })?.text ?? '';
      if (latex) out.push(...parseMath(String(latex)));
      continue;
    }
    const copy: MathNode = { ...n };
    if (copy.parts) copy.parts = copy.parts.map(sanitizeAst);
    if (copy.children) copy.children = sanitizeAst(copy.children);
    if (copy.rows) copy.rows = copy.rows.map(sanitizeAst);
    if (copy.lower) copy.lower = sanitizeAst(copy.lower);
    if (copy.upper) copy.upper = sanitizeAst(copy.upper);
    out.push(copy);
  }
  return out;
}

function clampCaret(root: MathNode[], c: Caret): Caret {
  /* if the path no longer resolves, fall back to the root list */
  return getListAt(root, c.path)
    ? { path: c.path, offset: Math.min(c.offset, (getListAt(root, c.path) as MathNode[]).length) }
    : { path: [], offset: Math.min(c.offset, root.length) };
}

function phNode(): MathNode {
  return { type: 'ph' };
}

/* ── node definitions ──────────────────────────────────────────────── */

function equationNodeSpec(name: string, inline: boolean) {
  return Node.create({
    name,
    group: inline ? 'inline' : 'block',
    inline,
    selectable: true,
    /* atom for selection purposes: the surface handles ALL interaction */
    atom: true,
    defining: true,
    addAttributes() {
      return {
        ast: { default: [{ type: 'ph' }] },
        display: { default: !inline },
        mode: { default: 'professional' as const },
        /* null = inherit the paragraph's text-align (item 15: the box should
           be هم‌تراز with the text box it is inserted into by default) */
        align: { default: null },
        numbered: { default: false },
        color: { default: null },
      };
    },
    parseHTML() {
      return [{
        tag: inline ? 'span[data-type="equationInline"]' : 'div[data-type="equation"]',
        getAttrs: (el) => {
          const e = el as HTMLElement;
          /* the LaTeX source embedded in the HTML IS the round-trip: HTML →
             parseMath → live AST again (save/reopen, HTML export, paste) */
          const latex = (e.textContent ?? '').trim();
          return {
            ast: latex ? parseMath(latex) : [{ type: 'ph' }],
            align: (e.getAttribute('data-align') as 'left' | 'center' | 'right') || null,
            display: e.getAttribute('data-display') !== 'inline',
            numbered: e.getAttribute('data-numbered') === 'auto' ? true : (e.getAttribute('data-numbered') ?? false),
            mode: (e.getAttribute('data-mode') as 'professional' | 'linear') ?? 'professional',
          };
        },
      }];
    },
    renderHTML({ node, HTMLAttributes }) {
      const attrs = node.attrs as EquationAttrs;
      /* LaTeX source as text content: plain HTML still SHOWS the equation,
         and the export pipeline (renderEquationsInHtml) renders it with
         KaTeX for professional print/PDF output.
         BUGFIX (seed/paste parity): a raw-JSON AST (imported/seeded docs —
         e.g. {type:'latex',…} legacy payloads) serialized as «□» here
         because toLatex ignores unknown node shapes, while the live view
         repainted it correctly via sanitizeAst → parseMath. Heal the AST
         with the SAME sanitizer the node view uses so getHTML()/exports
         always see the real source. */
      const rawAst = Array.isArray(attrs.ast) ? attrs.ast : [];
      const latex = toLatex(sanitizeAst(rawAst as MathNode[])) || toLatex(rawAst as MathNode[]);
      return [
        inline ? 'span' : 'div',
        mergeAttributes(HTMLAttributes, {
          'data-type': name,
          'data-align': attrs.align,
          'data-display': attrs.display ? 'display' : 'inline',
          'data-mode': attrs.mode,
          'data-numbered': attrs.numbered === true ? 'auto' : attrs.numbered === false ? 'none' : String(attrs.numbered),
          class: `mq-equation${inline ? ' mq-equation-inline' : ''} mq-mode-${attrs.mode}`,
          dir: 'ltr',
        }),
        latex || '\\square',
      ];
    },
    renderText({ node }) {
      const attrs = node.attrs as EquationAttrs;
      return toLatex(Array.isArray(attrs.ast) ? attrs.ast : []);
    },
    addNodeView() {
      return equationView(inline);
    },
  });
}

export const Equation = equationNodeSpec('equation', false);
export const EquationInline = equationNodeSpec('equationInline', true);

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    equation: {
      /** Insert→Equation: a real structured equation object at the cursor */
      insertEquation: (opts?: { display?: boolean; latex?: string }) => ReturnType;
    };
  }
}

export const EquationExtension = Node.create({
  name: 'equationCommands',
  addCommands() {
    return {
      insertEquation:
        (opts?: { display?: boolean; latex?: string }) =>
        ({ chain }) => {
          const display = opts?.display ?? false; // default: INLINE at the caret (Word)
          const ast = opts?.latex ? parseMath(opts.latex) : [phNode()];
          return chain()
            /* A NodeSelection on an existing equation (the Design tab was
               open, user clicks «معادله نمایشی») would make insertContent
               REPLACE that equation. Collapse the selection to after the
               node first — a new equation must be INSERTED, not substituted
               (item ۴: one equation can easily need 10–20 symbols in a row). */
            .command(({ state, tr, dispatch }) => {
              if (dispatch && state.selection instanceof NodeSelection) {
                const { to } = state.selection;
                tr.setSelection(TextSelection.create(state.doc, Math.min(to, state.doc.content.size)));
              }
              return true;
            })
            .insertContent({
              type: display ? 'equation' : 'equationInline',
              attrs: { ast, display },
            } as never)
            .command(({ tr, dispatch }) => {
              /* select the freshly inserted equation (NodeSelection) so the
                 NodeView auto-activates it and the Equation/Design tab opens */
              if (!dispatch) return true;
              const doc = tr.doc;
              const pos = tr.selection.from;
              const $pos = doc.resolve(Math.min(pos, doc.content.size));
              const before = $pos.nodeBefore;
              let eqPos: number | null = null;
              if (before && (before.type.name === 'equation' || before.type.name === 'equationInline')) {
                eqPos = $pos.pos - before.nodeSize;
              } else {
                const at = doc.nodeAt(pos);
                if (at && (at.type.name === 'equation' || at.type.name === 'equationInline')) eqPos = pos;
              }
              if (eqPos !== null) tr.setSelection(NodeSelection.create(doc, eqPos));
              return true;
            })
            .run();
        },
    };
  },
});
