import type { Editor } from '@tiptap/core';
import type {
  SelectableObject,
  ObjectCapabilities,
  ContextProvider,
  ContextualTab,
  ResolvedSelectionContext,
} from './types';
import { getSourceSelections } from './selectionStore';
import { probeDocumentSelection } from './documentProbe';
import { FLOAT_CONTEXT_ID, floatProvider } from './contexts/floating';
import { IMAGE_CONTEXT_ID, imageProvider } from './contexts/image';
import { TABLE_CONTEXT_ID, tableProvider } from './contexts/table';
import { LINK_CONTEXT_ID, linkProvider } from './contexts/link';
import { BLOCK_CONTEXT_ID, blockProvider } from './contexts/block';
import { EDUBLOCK_CONTEXT_ID, eduBlockProvider } from './contexts/eduBlock';
import { TEXT_CONTEXT_ID, textProvider } from './contexts/text';
import { EQUATION_CONTEXT_ID, equationProvider } from './contexts/equation';

/* ══════════════════════════════════════════════════════════════════════════
   Contextual Ribbon registry — an OPEN registry of per-object-type context
   providers plus the deterministic resolver used by the Ribbon.

   Adding a future object type (chart, video, audio…) = one `registerContext`
   call. The Ribbon, selection system and document model never change.
   ══════════════════════════════════════════════════════════════════════════ */

const providers: ContextProvider[] = [];

/** Register a context provider. Later registrations win on duplicate ids. */
export function registerContext(provider: ContextProvider) {
  const idx = providers.findIndex((p) => p.id === provider.id);
  if (idx >= 0) providers[idx] = provider;
  else providers.push(provider);
}

/** Unregister (hot reload / cleanup). */
export function unregisterContext(id: string) {
  const idx = providers.findIndex((p) => p.id === id);
  if (idx >= 0) providers.splice(idx, 1);
}

export function listContexts(): readonly ContextProvider[] {
  return providers;
}

/* ── capability intersection for multi-selection ──────────────────────────
   A capability survives only when EVERY selected object has it, so tools
   never operate on an object that cannot do the thing. Flags missing from
   one object are simply not intersected (undefined ≠ false).             */

function intersectCapabilities(caps: ObjectCapabilities[]): ObjectCapabilities {
  if (caps.length === 0) return {};
  if (caps.length === 1) return { ...caps[0] };
  const out: ObjectCapabilities = {};
  for (const flag of Object.keys(caps[0])) {
    if (caps.every((c) => c[flag] === true)) out[flag] = true;
  }
  return out;
}

/** Deterministic sort: more specific (deeper in the hierarchy) first, then
 *  provider priority, then document order. */
function specificity(obj: SelectableObject): number {
  return obj.ancestors.length;
}

/**
 * Resolve the CURRENT selection into a contextual context.
 *
 * Priority: the most specific selected object (deepest ancestors — an image
 * inside a cell beats its table) wins and becomes `primary`; ancestors of
 * the primary never contribute competing tabs. Additional selected objects
 * intersect their capabilities. Page identity is irrelevant to resolution —
 * the same object produces the same context on any A4 page.
 */
export function resolveSelectionContext(editor: Editor | null): ResolvedSelectionContext | null {
  const objects: SelectableObject[] = [];

  if (editor) objects.push(...probeDocumentSelection(editor));
  const floats = getSourceSelections().floating;
  if (floats) objects.push(...floats);

  if (objects.length === 0) return null;

  /* most specific first (nested: image > cell > table) */
  objects.sort((a, b) => specificity(b) - specificity(a));
  const primary = objects[0];

  const primaryProviders = providers.filter((p) => p.matches(primary));

  /* ancestors of the primary must not fight it for tabs (child priority) */
  const primaryAncestorIds = new Set(primary.ancestors.map((a) => a.id));

  const others = objects.slice(1).filter((o) => !primaryAncestorIds.has(o.id));

  const providerList: ContextProvider[] = [...primaryProviders];
  const caps: ObjectCapabilities[] = primaryProviders.map((p) => p.capabilities(primary));

  for (const obj of others) {
    for (const p of providers) {
      if (!p.matches(obj)) continue;
      caps.push(p.capabilities(obj));
      if (!providerList.some((q) => q.id === p.id)) providerList.push(p);
    }
  }

  /* merge tabs: same id → groups concatenated (priority of the first wins) */
  const byId = new Map<string, ContextualTab>();
  for (const p of providerList) {
    for (const t of p.tabs(primary)) {
      const existing = byId.get(t.id);
      if (existing) existing.groups = [...existing.groups, ...t.groups];
      else byId.set(t.id, { ...t, groups: [...t.groups] });
    }
  }
  const tabs = [...byId.values()].sort((a, b) => a.priority - b.priority);

  return {
    primary,
    selection: [primary, ...others],
    capabilities: intersectCapabilities(caps),
    providers: providerList,
    tabs,
  };
}

/* ── built-in registrations ───────────────────────────────────────────────
   The framework ships with contexts for every object type the editor
   currently has. New types call registerContext — nothing else changes.  */

export {
  FLOAT_CONTEXT_ID,
  IMAGE_CONTEXT_ID,
  TABLE_CONTEXT_ID,
  LINK_CONTEXT_ID,
  BLOCK_CONTEXT_ID,
  EDUBLOCK_CONTEXT_ID,
  TEXT_CONTEXT_ID,
  EQUATION_CONTEXT_ID,
};

let builtinRegistered = false;
export function registerBuiltinContexts() {
  if (builtinRegistered) return;
  builtinRegistered = true;
  registerContext(floatProvider);
  registerContext(imageProvider);
  registerContext(tableProvider);
  registerContext(linkProvider);
  registerContext(eduBlockProvider);
  registerContext(blockProvider);
  registerContext(textProvider);
  registerContext(equationProvider);
}
