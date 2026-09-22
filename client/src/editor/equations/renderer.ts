/* ────────────────────────────────────────────────────────────────────────
   Renderer — Math AST → professional HTML math layout.

   Pure function AST → DOM. Layout rules follow mathematical typesetting:
   LTR direction always (even inside the RTL Persian document), italic
   variables, upright numbers, stacked fractions with a real bar,
   stretching radicals, limits under large operators, grid matrices.

   EDITING ANNOTATION (the contract with the caret engine):
   • every LIST gets a wrapper span  data-list="<list path>"   ('' = root)
   • every NODE gets                 data-node="<node path>"
   • atoms (run/sym/ph) also carry   data-atom
   • the virtual placeholder of an EMPTY list carries data-virtual-ph and
     data-list-of="<list path>" so clicks in empty space resolve to a caret

   renderCaretIn() inserts the caret element before the offset-th child of
   the list at `path`; caretFromPoint() translates clicks → {path, offset}.
   ──────────────────────────────────────────────────────────────────────── */

import type { MathNode, MathPath, PathSeg } from './ast';

export function mpathAttr(p: MathPath): string {
  return p.join(':');
}

function parseAttr(s: string): MathPath {
  return s.split(':').filter(Boolean).map((seg): PathSeg => (/^\d+$/.test(seg) ? parseInt(seg, 10) : (seg as PathSeg)));
}

/** renders a run of math nodes into an LTR math span (listPath = their path) */
export function renderMath(nodes: MathNode[], editing = false, listPath: MathPath = []): HTMLElement {
  const root = document.createElement('span');
  root.className = 'mq-root';
  root.setAttribute('dir', 'ltr');
  if (editing) root.setAttribute('data-list', mpathAttr(listPath));
  nodes.forEach((n, i) => root.appendChild(renderNode(n, editing, [...listPath, i])));
  if (!nodes.length) {
    /* EMPTY slot: keep a real caret target — a zero-content inline host the
       caret can sit inside and clicks can resolve to (offset 0) */
    root.classList.add('mq-list-empty');
  }
  if (!nodes.length) {
    const el = renderNode({ type: 'ph' }, editing, [0]);
    el.setAttribute('data-virtual-ph', '1');
    el.setAttribute('data-list-of', mpathAttr(listPath));
    root.appendChild(el);
  }
  return root;
}

function span(cls: string, ...kids: (Node | null)[]): HTMLElement {
  const el = document.createElement('span');
  el.className = cls;
  for (const k of kids) if (k) el.appendChild(k);
  return el;
}

function txt(s: string, cls?: string): HTMLElement {
  const el = document.createElement('span');
  if (cls) el.className = cls;
  el.textContent = s;
  return el;
}

function renderNode(n: MathNode, editing: boolean, path: MathPath): HTMLElement {
  let el: HTMLElement;
  switch (n.type) {
    case 'ph': {
      el = span('mq-ph', txt('□'));
      break;
    }
    case 'run': {
      const t = n.text ?? '';
      const italic = !n.upright && /^[a-zA-Z]+$/.test(t);
      el = txt(t, italic ? 'mq-var' : 'mq-op');
      break;
    }
    case 'sym': {
      el = txt(n.text ?? '', SYM_CLASS[n.sym ?? ''] ?? 'mq-op');
      break;
    }
    case 'frac': {
      el = span('mq-frac',
        span('mq-frac-num', renderMath(n.parts![0], editing, [...path, 'p', 0])),
        span('mq-frac-den', renderMath(n.parts![1], editing, [...path, 'p', 1])),
      );
      break;
    }
    case 'script': {
      const both = !!(n.parts![1] && n.parts![2]);
      const elS = span('mq-script');
      elS.appendChild(renderMath(n.parts![0], editing, [...path, 'p', 0]));
      if (both) {
        /* sup+sub stack in one column (x₁²) like real typesetting */
        const stack = span('mq-scripts-stack');
        stack.appendChild(span('mq-sup', renderMath(n.parts![1], editing, [...path, 'p', 1])));
        stack.appendChild(span('mq-sub', renderMath(n.parts![2], editing, [...path, 'p', 2])));
        elS.appendChild(stack);
      } else {
        if (n.parts![1]) elS.appendChild(span('mq-sup', renderMath(n.parts![1], editing, [...path, 'p', 1])));
        if (n.parts![2]) elS.appendChild(span('mq-sub', renderMath(n.parts![2], editing, [...path, 'p', 2])));
      }
      el = elS;
      break;
    }
    case 'sqrt': {
      const elS = span('mq-sqrt');
      if (n.parts![1]) elS.appendChild(span('mq-sqrt-idx', renderMath(n.parts![1], editing, [...path, 'p', 1])));
      elS.appendChild(txt('√', 'mq-sqrt-glyph'));
      elS.appendChild(span('mq-sqrt-body', renderMath(n.parts![0], editing, [...path, 'p', 0])));
      el = elS;
      break;
    }
    case 'bigop': {
      const elS = span('mq-bigop');
      elS.appendChild(txt(n.name ?? '∑', 'mq-bigop-glyph'));
      if (n.lower) elS.appendChild(span('mq-lim-under', renderMath(n.lower, editing, [...path, 'l'])));
      if (n.upper) elS.appendChild(span('mq-lim-under', renderMath(n.upper, editing, [...path, 'u'])));
      el = elS;
      break;
    }
    case 'accent': {
      el = span('mq-accent',
        span(`mq-accent-mark mq-accent-${n.kind}`, txt('')),
        renderMath(n.parts![0], editing, [...path, 'p', 0]),
      );
      break;
    }
    case 'delim': {
      const [l, r] = DELIM_CHARS[n.kind ?? 'paren'] ?? ['(', ')'];
      el = span('mq-delim',
        txt(l, 'mq-delimiter'),
        span('mq-delim-body', renderMath(n.parts![0], editing, [...path, 'p', 0])),
        txt(r, 'mq-delimiter'),
      );
      break;
    }
    case 'func': {
      const elS = span('mq-func');
      elS.appendChild(txt(n.name ?? '', 'mq-func-name'));
      if (n.lower) elS.appendChild(span('mq-sub', renderMath(n.lower, editing, [...path, 'l'])));
      if (n.upper) elS.appendChild(span('mq-sup', renderMath(n.upper, editing, [...path, 'u'])));
      if (n.children) elS.appendChild(renderMath(n.children, editing, [...path, 'c']));
      el = elS;
      break;
    }
    case 'matrix': {
      const elS = span('mq-matrix');
      const rows = n.rows ?? [];
      const cols = n.cols ?? rows[0]?.length ?? 1;
      elS.style.gridTemplateColumns = `repeat(${cols}, auto)`;
      for (let r = 0; r < rows.length; r++) {
        for (let c = 0; c < cols; c++) {
          /* each cell is a `row` node — its children list is editable */
          const cell = rows[r][c];
          const kids = cell?.type === 'row' ? (cell.children ?? []) : cell ? [cell] : [];
          elS.appendChild(span('mq-mcell', renderMath(kids, editing, [...path, 'r', r, c, 'c'])));
        }
      }
      el = elS;
      break;
    }
    case 'cases': {
      const elS = span('mq-cases');
      elS.appendChild(txt('{', 'mq-delimiter mq-cases-brace'));
      const rowsEl = span('mq-cases-rows');
      (n.rows ?? []).forEach((r, ri) => rowsEl.appendChild(span('mq-mrow', renderMath(r, editing, [...path, 'r', ri]))));
      elS.appendChild(rowsEl);
      el = elS;
      break;
    }
    case 'numbered': {
      const elS = span('mq-numbered');
      elS.appendChild(renderMath(n.children ?? [], editing, [...path, 'c']));
      if (n.numbered) {
        const no = typeof n.numbered === 'string' ? n.numbered : '(۱)';
        elS.appendChild(txt(no, 'mq-eq-no'));
      }
      el = elS;
      break;
    }
    case 'row': {
      el = span('mq-row', ...((n.children ?? []).map((c, i) => renderNode(c, editing, [...path, 'c', i]))));
      break;
    }
    default:
      el = txt('');
  }
  if (editing) {
    el.setAttribute('data-node', mpathAttr(path));
    if (n.type === 'ph' || n.type === 'run' || n.type === 'sym') el.setAttribute('data-atom', '1');
    if (n.color) el.style.color = n.color;
  }
  return el;
}

const DELIM_CHARS: Record<string, [string, string]> = {
  paren: ['(', ')'], brack: ['[', ']'], brace: ['{', '}'], abs: ['|', '|'],
  norm: ['‖', '‖'], floor: ['⌊', '⌋'], ceil: ['⌈', '⌉'], angle: ['⟨', '⟩'], none: ['', ''],
};

const SYM_CLASS: Record<string, string> = {
  plus: 'mq-op', minus: 'mq-op', times: 'mq-op', div: 'mq-op', eq: 'mq-op',
  pm: 'mq-op', mp: 'mq-op', cdot: 'mq-op', ast: 'mq-op', slash: 'mq-op',
  neq: 'mq-rel', approx: 'mq-rel', equiv: 'mq-rel', leq: 'mq-rel', geq: 'mq-rel',
  in: 'mq-rel', notin: 'mq-rel', subset: 'mq-rel', 'subset-strict': 'mq-rel',
  supset: 'mq-rel', supseteq: 'mq-rel', propto: 'mq-rel',
  to: 'mq-rel', gets: 'mq-rel', implies: 'mq-rel', iff: 'mq-rel', mapsto: 'mq-rel',
  forall: 'mq-op', exists: 'mq-op', infty: 'mq-op', partial: 'mq-op', nabla: 'mq-op',
};

/* ── caret drawing ─────────────────────────────────────────────────── */

/** insert the caret element before the offset-th child of the list at `path` */
export function renderCaretIn(container: HTMLElement, path: MathPath, offset: number): void {
  container.querySelectorAll('.mq-caret').forEach((c) => c.remove());
  const attr = mpathAttr(path);
  const host =
    container.querySelector<HTMLElement>(`[data-list="${attr}"]`) ??
    container.querySelector<HTMLElement>('[data-list=""]');
  if (!host) return;
  const caretEl = document.createElement('span');
  caretEl.className = 'mq-caret';
  caretEl.setAttribute('contenteditable', 'false');
  const kids = Array.from(host.children).filter((c) => !c.classList.contains('mq-caret'));
  if (offset >= kids.length) host.appendChild(caretEl);
  else host.insertBefore(caretEl, kids[Math.max(0, offset)] ?? null);
}

/* ── click → caret ─────────────────────────────────────────────────── */

function listCaret(listEl: HTMLElement | null, x: number): { path: MathPath; offset: number } | null {
  if (!listEl) return null;
  const p = parseAttr(listEl.dataset.list ?? '');
  const kids = Array.from(listEl.children).filter((c) => !c.classList.contains('mq-caret'));
  for (let i = 0; i < kids.length; i++) {
    const r = kids[i].getBoundingClientRect();
    if (x < r.left + r.width / 2) return { path: p, offset: i };
  }
  return { path: p, offset: kids.length };
}

/** deepest list element inside/being `el` (slot wrappers contain a mq-root) */
function listElOf(el: HTMLElement): HTMLElement | null {
  return el.matches('[data-list]') ? el : el.querySelector<HTMLElement>('[data-list]');
}

/** hit-test a click inside a rendered equation → caret {path, offset} */
export function caretFromPoint(container: HTMLElement, x: number, y: number): { path: MathPath; offset: number } | null {
  /* 1) deepest node under the point */
  const nodeEls = Array.from(container.querySelectorAll<HTMLElement>('[data-node],[data-virtual-ph]'));
  let best: HTMLElement | null = null;
  let bestLen = -1;
  for (const el of nodeEls) {
    const r = el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      const len = (el.dataset.node ?? '').length + (el.hasAttribute('data-virtual-ph') ? 0.5 : 0);
      if (len > bestLen) { best = el; bestLen = len; }
    }
  }

  if (best) {
    if (best.hasAttribute('data-virtual-ph')) {
      return { path: parseAttr(best.getAttribute('data-list-of') ?? ''), offset: 0 };
    }
    const nodePath = parseAttr(best.dataset.node ?? '');
    const parentPath = nodePath.slice(0, -1);
    const idx = nodePath[nodePath.length - 1] as number;

    if (best.hasAttribute('data-atom')) {
      const r = best.getBoundingClientRect();
      return { path: parentPath, offset: x >= r.left + r.width / 2 ? idx + 1 : idx };
    }

    /* structural node: choose the slot the click is closest to */
    const slotEls = Array.from(best.children).filter(
      (c) => (c as HTMLElement).classList && !(c as HTMLElement).classList.contains('mq-caret'),
    ) as HTMLElement[];
    if (!slotEls.length) return { path: parentPath, offset: idx + 1 };

    const stacked = best.classList.contains('mq-frac') || best.classList.contains('mq-bigop') || best.classList.contains('mq-cases') || best.classList.contains('mq-matrix');
    if (stacked) {
      for (const s of slotEls) {
        const r = s.getBoundingClientRect();
        if (y < r.bottom) return listCaret(listElOf(s), x) ?? { path: parentPath, offset: idx + 1 };
      }
      return listCaret(listElOf(slotEls[slotEls.length - 1]), x) ?? { path: parentPath, offset: idx + 1 };
    }
    for (const s of slotEls) {
      const r = s.getBoundingClientRect();
      if (x < r.right) return listCaret(listElOf(s), x) ?? { path: parentPath, offset: idx };
    }
    return listCaret(listElOf(slotEls[slotEls.length - 1]), x) ?? { path: parentPath, offset: idx + 1 };
  }

  /* 2) no node hit (whitespace): deepest LIST under the point */
  const listEls = Array.from(container.querySelectorAll<HTMLElement>('[data-list]'));
  let bl: HTMLElement | null = null;
  let blLen = -1;
  for (const el of listEls) {
    const r = el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      const len = (el.dataset.list ?? '').length;
      if (len > blLen) { bl = el; blLen = len; }
    }
  }
  if (bl) return listCaret(bl, x);
  return null;
}
