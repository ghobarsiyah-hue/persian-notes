import type { ReactNode } from 'react';
import type { Editor } from '@tiptap/core';

/* ══════════════════════════════════════════════════════════════════════════
   Contextual Ribbon — core contracts.

   SELECTION ≠ OBJECT ≠ CONTEXT RESOLUTION ≠ RIBBON RENDERING ≠ COMMANDS.

   1. A `SelectionProbe` decides WHAT is selected (per selection source).
   2. A `ContextProvider` declares, per OBJECT TYPE, which contextual tab(s)
      and capability-driven tools exist. Registration is open: any current or
      future object type registers itself without touching the Ribbon.
   3. The resolver intersects capabilities across the selection (multi-select)
      and applies the deterministic priority (most specific object wins).
   4. The Ribbon only renders resolved tabs; every action executes against
      the resolved selection through real editor/document state.

   NOTHING in this file knows about images, tables or shapes — those are
   registrations, not architecture.
   ══════════════════════════════════════════════════════════════════════════ */

/** The editor surfaces that can currently host a selection. */
export type SelectionSource =
  /** the TipTap document editor of the active A4 page */
  | 'document'
  /** absolutely-positioned floating objects over a page (shapes, text boxes…) */
  | 'floating';

/**
 * A selectable object, independent of where it lives. The document model of
 * each source adapts its native selection into this shape.
 */
export interface SelectableObject {
  /** stable id, unique within its source (node pos for document nodes) */
  id: string;
  /** object-type discriminator — providers register against these */
  type: string;
  /** which surface the object lives on (defines how commands run) */
  source: SelectionSource;
  /** nested chain from the document root, MOST SPECIFIC FIRST (cell → table) */
  ancestors: Array<{ id: string; type: string }>;
  /** current properties, enough for tools to render their active state */
  attrs: Record<string, unknown>;
  /** the A4 page the object lives on (page-local ids, never global) */
  pageId: string;
}

/* ── capabilities ──────────────────────────────────────────────────────────
   Capability flags are the vocabulary of the framework: providers describe
   what an object CAN do and tools are gated on flags instead of types. A
   future object type that can rotate simply declares `canRotate`.        */

export interface ObjectCapabilities {
  canResize?: boolean;
  canRotate?: boolean;
  canMove?: boolean;
  canCrop?: boolean;
  canChangeColor?: boolean;
  canChangeBorder?: boolean;
  canChangeOpacity?: boolean;
  canAlign?: boolean;
  canGroup?: boolean;
  canDuplicate?: boolean;
  canDelete?: boolean;
  canEditText?: boolean;
  canChangeFont?: boolean;
  canChangeLayout?: boolean;
  canChangeSpacing?: boolean;
  canChangePosition?: boolean;
  canChangeBackground?: boolean;
  /** escape hatch for provider-specific capabilities */
  [flag: string]: boolean | undefined;
}

/** An executable contextual command bound to the CURRENT selection. */
export interface ContextualAction {
  /** unique action key (namespaced: `image.setSize`) */
  key: string;
  title: string;
  icon?: ReactNode;
  /** aria/tooltip label shown next to the icon */
  label?: string;
  /** shown as pressed/active */
  active?: boolean;
  disabled?: boolean;
  /** runs against the resolved selection — never DOM scraping */
  run: () => void;
}

/** Small visual separator inside a tool row. */
export interface ContextualSeparator {
  separator: true;
  key: string;
}

/**
 * A dropdown tool: renders as a ribbon button that opens an in-app panel
 * (pickers with previews — symbols, structures, matrix sizes…). The panel
 * content is declarative; the host owns open/close and positioning.
 */
export interface ContextualDropdown {
  key: string;
  title: string;
  icon?: ReactNode;
  label?: string;
  disabled?: boolean;
  dropdown: {
    /** panel width in px */
    width: number;
    /** panel content; `close` dismisses it */
    render: (close: () => void) => ReactNode;
    /** persistent pickers (equation symbols/structures) stay OPEN across
     *  outside clicks — Word-style: insert, click into the formula, insert
     *  again. Closed only by the toggle button, Escape, or tab change. */
    persistent?: boolean;
    /** LIVE panels (object formatting) re-render from the current selection
     *  on every change — they must NOT freeze the resolved context while
     *  open (a frozen context serves a stale element snapshot, so consecutive
     *  patches overwrite each other and live preview breaks). The freeze
     *  stays reserved for pickers whose SELECTION changes while open
     *  (equation editing), which is the original reason it exists. */
    live?: boolean;
  };
}

export type ContextualTool = ContextualAction | ContextualSeparator | ContextualDropdown;

export interface ContextualGroup {
  /** group key */
  key: string;
  /** group caption under the tools (RibbonGroup label) */
  label?: string;
  tools: ContextualTool[];
}

/**
 * A contextual tab. `priority` breaks ties between providers (lower wins;
 * the most specific object wins by construction). Tabs may also opt into
 * `mergesWith` to fold their tools into an existing standard tab instead of
 * creating a new one (text → خانه).
 */
export interface ContextualTab {
  id: string;
  label: string;
  icon?: ReactNode;
  priority: number;
  /** render this tab's groups inside an existing standard tab (e.g. 'home') */
  mergesWith?: string;
  groups: ContextualGroup[];
}

/**
 * Per-object-type registration. `match` decides which resolved object this
 * provider handles (one provider may cover a family of types).
 */
export interface ContextProvider {
  /** unique registration id */
  id: string;
  /** object types this provider covers */
  matches: (obj: SelectableObject) => boolean;
  /** human label for the family (used in the multi-select chip) */
  label: string;
  /** capabilities of one object of this family (from its attrs) */
  capabilities: (obj: SelectableObject) => ObjectCapabilities;
  /** contextual tab(s) this provider contributes */
  tabs: (obj: SelectableObject) => ContextualTab[];
}

/** Everything the Ribbon needs to render contextual UI. */
export interface ResolvedSelectionContext {
  /** primary (most specific) selected object */
  primary: SelectableObject;
  /** all selected objects (multi-select); primary is first */
  selection: SelectableObject[];
  /** intersection of every selected object's capabilities */
  capabilities: ObjectCapabilities;
  /** contributing providers, best-first (deduped by id) */
  providers: ContextProvider[];
  /** merged contextual tabs of all providers, priority-sorted */
  tabs: ContextualTab[];
}
