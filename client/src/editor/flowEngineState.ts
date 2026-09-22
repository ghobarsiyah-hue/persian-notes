/**
 * Shared (module-singleton) flag for the automatic pagination engine.
 *
 * True while the engine is dispatching its bookkeeping transactions
 * (content moves between page editors). Those dispatches would otherwise
 * fire every page editor's `onUpdate`, which re-entered React state churn
 * (setPages + autosave timer + flow re-schedule + thumbnail re-render) on
 * EVERY cascade step — a visible performance tax exactly when a page fills
 * up. The engine reconciles the `pages` mirror itself; the user's own
 * typing (the edit that triggered the flow) already scheduled the save.
 *
 * A plain mutable object — deliberately NOT React state: it must be
 * readable synchronously inside ProseMirror's onUpdate callback.
 */
export const flowEngineActiveRef: { current: boolean } = { current: false };
