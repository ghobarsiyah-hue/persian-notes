/* ────────────────────────────────────────────────────────────────────────
   Bridge — the registry of the ACTIVE equation.

   The ribbon's Design tab must operate on the equation the user is editing
   WITHOUT DOM scraping: a NodeView registers itself here when the caret
   enters its equation and unregisters when it leaves. The contextual
   provider (and Insert-tab commands) resolve the target through
   getActiveEquation() — always the real, current EquationObject.
   ──────────────────────────────────────────────────────────────────────── */

export interface ActiveEquation {
  id: string;
  /** focus the equation and apply an AST-level operation through its surface */
  apply: (fn: () => void) => void;
  /** enter caret-editing mode (Edit Equation command) */
  requestEdit: () => void;
  /** run an arbitrary command inside the equation's editing context */
  runCommand: (cmd: string) => void;
  /** insert a structure by catalog key at the caret */
  insertStructureKey: (key: string) => void;
  /** insert a symbol from the library at the caret */
  insertSymbol: (ch: string) => void;
  /** current view mode ('professional' | 'linear') — for ribbon active states */
  mode: () => 'professional' | 'linear';
  setMode: (m: 'professional' | 'linear') => void;
  /** alignment of the display equation — null = inherit paragraph align */
  align: () => 'left' | 'center' | 'right' | null;
  setAlign: (a: 'left' | 'center' | 'right') => void;  /* re-click resets to inherit (null) */
  /** equation numbering */
  number: () => boolean;
  setNumber: (n: boolean) => void;
  /** display mode (display vs inline) */
  display: () => boolean;
  setDisplay: (d: boolean) => void;
  /** open the linear-source editor (Convert ▸ Linear) */
  openLinearEditor: () => void;
}

let active: ActiveEquation | null = null;
const listeners = new Set<() => void>();

export function setActiveEquation(eq: ActiveEquation | null): void {
  active = eq;
  listeners.forEach((l) => l());
}

export function getActiveEquation(): ActiveEquation | null {
  return active;
}

/** React-friendly subscription (ribbon refreshes when the active equation changes) */
export function subscribeActiveEquation(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
