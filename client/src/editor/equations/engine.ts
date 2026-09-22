/* ────────────────────────────────────────────────────────────────────────
   Engine — the mutation layer between the equation Surface and the Math AST.

   PATH CONVENTION (single source of truth — matches getListAt in ast.ts):

   • A CHILD-LIST path is  [i₀, m₀, s₀?, i₁, m₁, s₁?, …]  — pairs of
     (node index, slot marker, slot index for 'p'/'r'):
        []               the equation root list
        [3,'c']          children of root[3]
        [3,'p',1]        parts[1] of root[3]
        [3,'p',1,2,'r',0] rows[0] of the node at parts[1][2]
   • A NODE path is a list path + [index]:  [3,'p',1,2]  = parts[1][2].
   • A caret is { path: childListPath, offset: index INTO that list }.

   Every edit is expressed as "splice into the list at path", so structures
   stay editable in place forever — the engine NEVER serializes an equation
   to text to edit it. Undo/redo stays in the editor's ONE history: the
   Surface snapshots the AST before each discrete operation and dispatches
   the whole new AST as a single TipTap transaction (see EquationNode).
   ──────────────────────────────────────────────────────────────────────── */

import {
  type MathNode, type MathPath, ph, run, sym, frac, script,
  getListAt, findFirstPlaceholder, isSlotEmpty, hasContent,
} from './ast';
import { SYMBOLS } from './symbols';

export interface Caret { path: MathPath; offset: number }

/* ── tree helpers over the path model ─────────────────────────────── */

/** the node a NODE path points at (list path + trailing index) */
function nodeAtPath(root: MathNode[], nodePath: MathPath): MathNode | null {
  const list = getListAt(root, nodePath.slice(0, -1));
  const idx = nodePath[nodePath.length - 1];
  if (!list || typeof idx !== 'number') return null;
  return list[idx] ?? null;
}

/** node path of the node that OWNS the caret's list.
 *  List-path shapes: [] (root), […, 'c'|'l'|'u'] (marker last),
 *  […, 'p'|'r', slotIndex] (marker + slot index last). */
function ownerNodePathOf(listPath: MathPath): MathPath | null {
  if (listPath.length === 0) return null; // the root list has no owner node
  const last = listPath[listPath.length - 1];
  if (typeof last === 'number') {
    const marker = listPath[listPath.length - 2];
    if (marker === 'p' || marker === 'r') return listPath.slice(0, -2);
    return listPath.slice(0, -1);
  }
  return listPath.slice(0, -1); // 'c' | 'l' | 'u'
}

/** which slot of the owner node does the caret's list live in */
function slotOf(listPath: MathPath): { kind: string; index: number } {
  const last = listPath[listPath.length - 1];
  if (typeof last === 'number') {
    const marker = listPath[listPath.length - 2];
    if (marker === 'p' || marker === 'r') return { kind: marker, index: last };
    return { kind: String(marker ?? 'root'), index: -1 };
  }
  return { kind: String(last), index: -1 };
}

/** all editable slots of a node, in reading order, with their list paths.
 *  Matrix cells are `row` nodes — their CHILDREN lists are the editable
 *  slots (matching the renderer's data-list annotation contract). */
function slotsOf(root: MathNode[], nodePath: MathPath): Array<{ list: MathNode[]; path: MathPath }> {
  const n = nodeAtPath(root, nodePath);
  if (!n) return [];
  const out: Array<{ list: MathNode[]; path: MathPath }> = [];
  const push = (l: MathNode[] | null | undefined, p: MathPath) => { if (l) out.push({ list: l, path: p }); };
  if (n.type === 'bigop' || n.type === 'func') {
    push(n.lower, [...nodePath, 'l']);
    push(n.upper, [...nodePath, 'u']);
    if (n.type === 'func' && n.children) push(n.children, [...nodePath, 'c']);
    return out;
  }
  if (n.type === 'matrix') {
    (n.rows ?? []).forEach((r, ri) =>
      r.forEach((cell, ci) => {
        if (cell?.type === 'row') push(cell.children ?? [], [...nodePath, 'r', ri, ci, 'c']);
      }),
    );
    return out;
  }
  if (n.parts) n.parts.forEach((p, i) => push(p, [...nodePath, 'p', i]));
  if (n.rows) n.rows.forEach((r, i) => push(r, [...nodePath, 'r', i]));
  if (n.children && n.type !== 'row' && n.type !== 'numbered') push(n.children, [...nodePath, 'c']);
  return out;
}

/* ── basic splicing ───────────────────────────────────────────────── */

/** insert nodes at the caret; the caret lands AFTER the inserted nodes */
export function insertAtCaret(root: MathNode[], caret: Caret, nodes: MathNode[]): Caret {
  const list = getListAt(root, caret.path);
  if (!list) return caret;
  list.splice(caret.offset, 0, ...nodes);
  return { path: caret.path, offset: caret.offset + nodes.length };
}

/* ── typing ───────────────────────────────────────────────────────── */

/**
 * Type one character at the caret. A placeholder at the caret is REPLACED.
 * Letters become italic variable runs, digits upright runs, library symbols
 * real `sym` nodes. ^ _ / are structural: they wrap the previous atom into
 * superscript / subscript / fraction (Word's linear idioms, applied to the
 * real tree — not text).
 */
export function typeChar(root: MathNode[], caret: Caret, ch: string): Caret {
  if (ch === '^') return wrapPreviousAtom(root, caret, (c) => script(c.length ? c : [ph()], [ph()]));
  if (ch === '_') return wrapPreviousAtom(root, caret, (c) => script(c.length ? c : [ph()], undefined, [ph()]));
  if (ch === '/') return wrapPreviousAtom(root, caret, (c) => frac(c.length ? c : undefined));

  const list = getListAt(root, caret.path);
  if (!list) return caret;
  let node: MathNode;
  const s = SYMBOLS.find((x) => x.ch === ch);
  if (s && !/[a-zA-Z0-9]/.test(ch)) node = sym(s.ch, s.cmd ?? s.id);
  else if (/[0-9.]/.test(ch)) node = run(ch, true);
  else if (/[a-zA-Z]/.test(ch)) node = run(ch);
  else node = run(ch, true);

  /* typing over a placeholder consumes it */
  if (list[caret.offset]?.type === 'ph') {
    list.splice(caret.offset, 1, node);
    return { path: caret.path, offset: caret.offset + 1 };
  }
  list.splice(caret.offset, 0, node);
  return { path: caret.path, offset: caret.offset + 1 };
}

/** paste linear / LaTeX source at the caret — parsed by the real parser */
export function insertLinearAtCaret(
  root: MathNode[], caret: Caret, parseMath: (src: string) => MathNode[], src: string,
): Caret {
  const nodes = parseMath(src);
  return insertAtCaret(root, caret, nodes.length ? nodes : [ph()]);
}

/* ── structure insertion ──────────────────────────────────────────── */

/**
 * Insert a structure at the caret. The caret ENTERS the structure's first
 * placeholder (Word behavior: type immediately). A placeholder at the caret
 * is consumed so `□ + fraction` yields one fraction, not two boxes.
 */
export function insertStructure(root: MathNode[], caret: Caret, make: () => MathNode): { caret: Caret; node: MathNode } {
  const list = getListAt(root, caret.path);
  if (list && list[caret.offset]?.type === 'ph') list.splice(caret.offset, 1);

  const node = make();
  if (!list) return { caret, node };
  const selfIdx = caret.offset;
  list.splice(selfIdx, 0, node);

  const selfPath: MathPath = [...caret.path, selfIdx];
  const fp = findFirstPlaceholder([node]);
  if (!fp) return { caret: { path: caret.path, offset: selfIdx + 1 }, node };

  /* fp = [0, marker, slot?, …, phIdx] relative to [node]; the caret goes
     into the placeholder's list, BEFORE the placeholder (typing replaces it) */
  const route = fp.slice(1);
  const phIdx = route[route.length - 1] as number;
  const slotPath: MathPath = [...selfPath, ...route.slice(0, -1)];
  return { caret: { path: slotPath, offset: phIdx }, node };
}

/** wrap the atom BEFORE the caret into a structure (x + ^ → x□²);
 *  the caret ENTERS the new structure's first placeholder so the user
 *  types the exponent immediately (Word behavior) */
export function wrapPreviousAtom(root: MathNode[], caret: Caret, make: (content: MathNode[]) => MathNode): Caret {
  const list = getListAt(root, caret.path);
  if (!list || caret.offset === 0) {
    /* nothing before the caret: insert an empty structure instead */
    return insertStructure(root, caret, () => make([])).caret;
  }
  const idx = caret.offset - 1;
  const atom = list[idx];
  if (!atom) return caret;
  const content = atom.type === 'ph' ? [] : [atom];
  const node = make(content);
  list.splice(idx, 1, node);
  /* enter the structure's first placeholder, if any */
  const fp = findFirstPlaceholder([node]);
  if (fp) {
    const route = fp.slice(1);
    const phIdx = route[route.length - 1] as number;
    const slotPath: MathPath = [...caret.path, idx, ...route.slice(0, -1)];
    return { path: slotPath, offset: phIdx };
  }
  return { path: caret.path, offset: idx + 1 };
}

/* ── deletion ─────────────────────────────────────────────────────── */

export interface DeleteResult { caret: Caret; atStart: boolean }

/**
 * Backspace at the caret.
 * • A placeholder to the left is consumed silently.
 * • Content/structure to the left is deleted whole (Word behavior).
 * • At the start of a slot: DISSOLVE the structure — remaining slot
 *   contents flatten into the parent list at the owner's position.
 * • At the very start of the equation: report atStart so the Surface can
 *   merge the (now empty) equation back into the paragraph.
 */
export function deleteBackward(root: MathNode[], caret: Caret): DeleteResult {
  const list = getListAt(root, caret.path);
  if (!list) return { caret, atStart: true };

  if (caret.offset > 0) {
    list.splice(caret.offset - 1, 1);
    return { caret: { path: caret.path, offset: caret.offset - 1 }, atStart: false };
  }

  /* at the start of a slot — dissolve the owner structure.
     EXCEPTION: matrix cells (row nodes) never dissolve — backspace at a
     cell's start is a no-op, exactly like Word. */
  const ownerPath = ownerNodePathOf(caret.path);
  if (!ownerPath || ownerPath.length === 0) return { caret, atStart: true };
  const owner = nodeAtPath(root, ownerPath);
  if (!owner || owner.type === 'row') return { caret, atStart: false };

  const parentList = getListAt(root, ownerPath.slice(0, -1));
  const pIdx = ownerPath[ownerPath.length - 1] as number;
  if (!parentList || typeof pIdx !== 'number') return { caret, atStart: true };

  const caretList = getListAt(root, caret.path);
  const slots = slotsOf(root, ownerPath);
  const caretSlotIdx = slots.findIndex((s) => s.list === caretList);
  if (caretSlotIdx < 0) return { caret, atStart: true };

  const strip = (kids: MathNode[]) => (isSlotEmpty(kids) ? [] : kids.filter((n) => n.type !== 'ph'));
  const before = slots.slice(0, caretSlotIdx).flatMap((s) => strip(s.list));
  const after = slots.slice(caretSlotIdx + 1).flatMap((s) => strip(s.list));

  parentList.splice(pIdx, 1, ...before, ...after);
  return { caret: { path: ownerPath.slice(0, -1), offset: pIdx + before.length }, atStart: false };
}

/** Delete (forward) at the caret — mirror image of deleteBackward */
export function deleteForward(root: MathNode[], caret: Caret): DeleteResult {
  const list = getListAt(root, caret.path);
  if (!list) return { caret, atStart: false };

  if (caret.offset < list.length) {
    list.splice(caret.offset, 1);
    return { caret: { ...caret }, atStart: false };
  }

  const ownerPath = ownerNodePathOf(caret.path);
  if (!ownerPath || ownerPath.length === 0) return { caret, atStart: false };
  const owner = nodeAtPath(root, ownerPath);
  if (!owner || owner.type === 'row') return { caret, atStart: false }; // matrix cells never dissolve

  const parentList = getListAt(root, ownerPath.slice(0, -1));
  const pIdx = ownerPath[ownerPath.length - 1] as number;
  if (!parentList || typeof pIdx !== 'number') return { caret, atStart: false };

  const caretList = getListAt(root, caret.path);
  const slots = slotsOf(root, ownerPath);
  const caretSlotIdx = slots.findIndex((s) => s.list === caretList);
  if (caretSlotIdx < 0) return { caret, atStart: false };

  const strip = (kids: MathNode[]) => (isSlotEmpty(kids) ? [] : kids.filter((n) => n.type !== 'ph'));
  const before = slots.slice(0, caretSlotIdx).flatMap((s) => strip(s.list));
  const after = slots.slice(caretSlotIdx + 1).flatMap((s) => strip(s.list));

  parentList.splice(pIdx, 1, ...before, ...after);
  return { caret: { path: ownerPath.slice(0, -1), offset: pIdx + before.length }, atStart: false };
}

/* ── navigation ───────────────────────────────────────────────────── */

export interface MoveResult { caret: Caret; atStart: boolean; atEnd: boolean }

/** total ordering of path arrays (numeric segments compare numerically) */
export function comparePaths(a: MathPath, b: MathPath): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i], y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x < y ? -1 : 1;
    return String(x) < String(y) ? -1 : 1;
  }
  return 0;
}

/** caret just inside `node`'s first (or last) slot, recursed to the bottom */
function entryCaretOf(node: MathNode, selfPath: MathPath, fromEnd: boolean): Caret | null {
  if (node.type === 'ph' || node.type === 'run' || node.type === 'sym') return null;
  const slots = slotsOf([node], [0]).map((s) => ({ ...s, path: [...selfPath, ...s.path.slice(1)] }));
  if (!slots.length) return null;
  const target = fromEnd ? slots[slots.length - 1] : slots[0];
  if (fromEnd) return { path: target.path, offset: target.list.length };
  const firstNode = target.list[0];
  if (firstNode && (firstNode.type === 'run' || firstNode.type === 'sym' || firstNode.type === 'ph')) {
    /* land before a ph so typing replaces it; after atoms otherwise */
    return { path: target.path, offset: firstNode.type === 'ph' ? 0 : target.list.length };
  }
  const inner = firstNode ? entryCaretOf(firstNode, [...target.path, 0], fromEnd) : null;
  return inner ?? { path: target.path, offset: fromEnd ? target.list.length : 0 };
}

/** ArrowLeft / ArrowRight — walks INTO structures, then ACROSS slot edges */
export function moveHorizontal(root: MathNode[], caret: Caret, dir: -1 | 1): MoveResult {
  const list = getListAt(root, caret.path);
  if (!list) return { caret, atStart: true, atEnd: true };

  if (dir === 1) {
    if (caret.offset < list.length) {
      const n = list[caret.offset];
      if (n) {
        const entry = entryCaretOf(n, [...caret.path, caret.offset], false);
        if (entry) return { caret: entry, atStart: false, atEnd: false };
      }
      return { caret: { path: caret.path, offset: caret.offset + 1 }, atStart: false, atEnd: caret.offset + 1 >= list.length };
    }
    return exitSlot(root, caret, dir);
  }

  if (caret.offset > 0) {
    const n = list[caret.offset - 1];
    if (n) {
      const entry = entryCaretOf(n, [...caret.path, caret.offset - 1], true);
      if (entry) return { caret: entry, atStart: false, atEnd: false };
    }
    return { caret: { path: caret.path, offset: caret.offset - 1 }, atStart: false, atEnd: false };
  }
  return exitSlot(root, caret, dir);
}

/** leave the current slot into the parent list at the owner's edge */
function exitSlot(root: MathNode[], caret: Caret, dir: -1 | 1): MoveResult {
  const ownerPath = ownerNodePathOf(caret.path);
  if (!ownerPath || ownerPath.length === 0) {
    return { caret, atStart: dir === -1, atEnd: dir === 1 };
  }
  const pIdx = ownerPath[ownerPath.length - 1] as number;
  const parentPath = ownerPath.slice(0, -1);
  const parentList = getListAt(root, parentPath);
  const offset = dir === 1 ? pIdx + 1 : pIdx;
  return {
    caret: { path: parentPath, offset },
    atStart: dir === -1 && offset === 0,
    atEnd: dir === 1 && !!parentList && offset >= parentList.length,
  };
}

/** ArrowUp/Down across stacked slots of the SAME node (frac num↔den,
 *  bigop lower↔upper, matrix rows). Returns null when there is no
 *  vertical neighbor — the Surface then falls through to document arrows. */
export function moveVertical(root: MathNode[], caret: Caret, dir: -1 | 1): Caret | null {
  const ownerPath = ownerNodePathOf(caret.path);
  if (!ownerPath) return null;
  const owner = nodeAtPath(root, ownerPath);
  if (!owner) return null;
  const slot = slotOf(caret.path);

  /* fractions: numerator ↑↓ denominator */
  if (owner.type === 'frac' && slot.kind === 'p') {
    const other = slot.index === 0 ? 1 : 0;
    const target = getListAt(root, [...ownerPath, 'p', other]);
    if (target) return { path: [...ownerPath, 'p', other], offset: Math.min(caret.offset, target.length) };
    return null;
  }

  /* big operators & lim-funcs: lower ↑↓ upper */
  if ((owner.type === 'bigop' || owner.type === 'func') && (slot.kind === 'l' || slot.kind === 'u')) {
    const other = slot.kind === 'l' ? 'u' : 'l';
    const target = getListAt(root, [...ownerPath, other]);
    if (target) return { path: [...ownerPath, other], offset: Math.min(caret.offset, target.length) };
    return null;
  }

  /* matrix cells: the caret's list is a CELL's children — its owner is the
     cell's `row` node; the matrix lives one level further up.
     Cell-children list path shape: […matrix, 'r', ri, ci, 'c']
     ownerPath (the cell row node) = […matrixIdx, 'r', ri, ci] */
  if (owner.type === 'row') {
    const mp = ownerPath.slice(0, -3);
    const m = nodeAtPath(root, mp);
    if (m?.type === 'matrix') {
      const ci = ownerPath[ownerPath.length - 1] as number;
      const ri = ownerPath[ownerPath.length - 2] as number;
      const target = ri + dir;
      const rows = m.rows ?? [];
      if (target >= 0 && target < rows.length) {
        const cell = rows[target][ci];
        if (cell?.type === 'row') {
          const list = cell.children ?? [];
          return { path: [...mp, 'r', target, ci, 'c'], offset: Math.min(caret.offset, list.length) };
        }
      }
    }
    return null;
  }

  /* cases rows: ↑↓ between rows */
  if (owner.type === 'cases' && slot.kind === 'r') {
    const target = slot.index + dir;
    const rows = owner.rows ?? [];
    if (target >= 0 && target < rows.length) {
      return { path: [...ownerPath, 'r', target], offset: Math.min(caret.offset, rows[target].length) };
    }
  }

  return null;
}

/* ── placeholders (Tab cycling) ───────────────────────────────────── */

/** every placeholder position in document order — caret sits BEFORE it so
 *  the first keystroke replaces the box */
function collectPlaceholders(root: MathNode[]): Caret[] {
  const out: Caret[] = [];
  const walk = (list: MathNode[], path: MathPath) => {
    list.forEach((n, i) => {
      if (n.type === 'ph') out.push({ path, offset: i });
      const self: MathPath = [...path, i];
      if (n.children) walk(n.children, [...self, 'c']);
      if (n.parts) n.parts.forEach((p, pi) => p && walk(p, [...self, 'p', pi]));
      if (n.lower) walk(n.lower, [...self, 'l']);
      if (n.upper) walk(n.upper, [...self, 'u']);
      if (n.rows) n.rows.forEach((r, ri) => r && walk(r, [...self, 'r', ri]));
    });
  };
  walk(root, []);
  return out;
}

/** next placeholder after the caret (Tab) — wraps around at the end */
export function nextPlaceholder(root: MathNode[], caret: Caret): Caret | null {
  const order = collectPlaceholders(root);
  for (const p of order) {
    const c = comparePaths(p.path, caret.path);
    if (c > 0 || (c === 0 && p.offset >= caret.offset)) return p;
  }
  return order[0] ?? null;
}

/** previous placeholder (Shift+Tab) — wraps around at the start */
export function prevPlaceholder(root: MathNode[], caret: Caret): Caret | null {
  const order = collectPlaceholders(root);
  for (let i = order.length - 1; i >= 0; i--) {
    const p = order[i];
    const c = comparePaths(p.path, caret.path);
    if (c < 0 || (c === 0 && p.offset <= caret.offset)) return p;
  }
  return order[order.length - 1] ?? null;
}

/* ── matrix / cases surgery (AST-level, used by the ribbon) ───────── */

function nodeAtPathPub(root: MathNode[], p: MathPath): MathNode | null { return nodeAtPath(root, p); }
export { nodeAtPathPub as findNodeAtPath };

export function matrixAddRow(root: MathNode[], mPath: MathPath, at: number): void {
  const m = nodeAtPath(root, mPath);
  if (!m || m.type !== 'matrix') return;
  const cols = m.cols ?? 1;
  m.rows!.splice(at, 0, Array.from({ length: cols }, () => cellRow()));
}

export function matrixDeleteRow(root: MathNode[], mPath: MathPath, at: number): void {
  const m = nodeAtPath(root, mPath);
  if (!m || m.type !== 'matrix' || (m.rows?.length ?? 0) <= 1) return;
  m.rows!.splice(at, 1);
}

export function matrixAddCol(root: MathNode[], mPath: MathPath): void {
  const m = nodeAtPath(root, mPath);
  if (!m || m.type !== 'matrix') return;
  m.rows!.forEach((r) => r.push(cellRow()));
  m.cols = (m.cols ?? 1) + 1;
}

export function matrixDeleteCol(root: MathNode[], mPath: MathPath): void {
  const m = nodeAtPath(root, mPath);
  if (!m || m.type !== 'matrix' || (m.cols ?? 1) <= 1) return;
  m.rows!.forEach((r) => r.pop());
  m.cols = (m.cols ?? 1) - 1;
}

/** a matrix cell: an editable `row` node holding one placeholder */
function cellRow(): MathNode {
  return { type: 'row', children: [ph()] };
}

export function casesAddRow(root: MathNode[], cPath: MathPath, at: number): void {
  const c = nodeAtPath(root, cPath);
  if (!c || c.type !== 'cases') return;
  c.rows!.splice(at, 0, [ph()]);
}

export function casesDeleteRow(root: MathNode[], cPath: MathPath, at: number): void {
  const c = nodeAtPath(root, cPath);
  if (!c || c.type !== 'cases' || (c.rows?.length ?? 0) <= 1) return;
  c.rows!.splice(at, 1);
}

/* ── housekeeping ─────────────────────────────────────────────────── */

/** post-edit cleanup: strip empty runs/script shells, restore placeholders
 *  in emptied matrix cells, drop stray placeholders from non-empty lists */
export function normalize(root: MathNode[]): void {
  const walk = (list: MathNode[]) => {
    for (let i = list.length - 1; i >= 0; i--) {
      const n = list[i];
      if (n.parts) n.parts.forEach(walk);
      if (n.lower) walk(n.lower);
      if (n.upper) walk(n.upper);
      if (n.rows) n.rows.forEach(walk);
      if (n.children && n.type !== 'row' && n.type !== 'numbered') walk(n.children);
      if (n.type === 'run' && !n.text) { list.splice(i, 1); continue; }
      if (n.type === 'script' && !(n.parts![1] || n.parts![2])) { list.splice(i, 1); continue; }
      if (n.type === 'matrix') {
        n.rows = (n.rows ?? []).map((r) =>
          r.map((cell) =>
            cell?.type === 'row'
              ? { ...cell, children: cell.children?.length ? cell.children : [ph()] }
              : cell?.type === 'ph' ? { type: 'row', children: [ph()] } as MathNode : cell,
          ),
        );
      }
      if (n.type === 'cases') {
        n.rows = (n.rows ?? []).map((r) => (r.length ? r : [ph()]));
      }
      /* a placeholder among real content is noise — remove it */
      if (n.type === 'ph' && list.length > 1) list.splice(i, 1);
    }
  };
  walk(root);
  if (root.length === 0) root.push(ph());
}

/** does the equation hold anything real? (empty equations self-remove) */
export function isEmptyRoot(root: MathNode[]): boolean {
  return !hasContent(root);
}
