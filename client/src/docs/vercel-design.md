<!-- Local reference of the Vercel Web Interface & Design System Guidelines used to restyle the Persian Notes client. -->
# Vercel Web Interface & Design System — Reference

> Source of truth kept in-repo so the Vercel aesthetic stays consistent after this restyle.
> **RTL + Vazirmatn (Persian) are preserved.** Latin/code glyphs fall back to `Geist Sans/Mono` in the font stack.

## 1. Visual Theme & Atmosphere

- Near-pure white canvas (`#ffffff` / `color-scheme: light dark`) with `#171717` text — gallery-like emptiness; every pixel earns its place.
- **Geist** (Vazirmatn first in the stack) is the crown jewel. Display headings use **extreme negative letter-spacing** (`tracking-tight = -0.02em`, `tracking-tighter = -0.03em`).
- **Shadow-as-border philosophy** — replace CSS borders with layered `box-shadow` (crisp ring + ambient depth + inner white highlight). Keeps edge clarity and smoother transitions.
- **Optical alignment** — nudge ±1px when perception beats geometry.

## 2. Color Palette & Roles

### Primary & Backgrounds

| Role | Token (Tailwind) | Hex |
|------|------------------|-----|
| Vercel Black (text / headings) | `ink-900` | `#171717` |
| Pure White (page / cards) | `bg-white` | `#ffffff` |
| Gallery surface (raised cards) | `bg-ink-50` | `#fafafa` |

The `ink` ramp (`ink-50 … ink-950`) is a **near-monochrome neutral gallery**. `dark:` variants flip surfaces/text via Tailwind `darkMode: 'class'`.

### Workflow & Console Colors

| Role | Token | Hex |
|------|-------|-----|
| Ship Red (destructive / danger) | `ship` | `#ff5b4f` |
| Preview / draft | `preview` | `#de1d8d` |
| Develop / accent | `develop` | `#0a72ef` |
| Success | `text-green-600` | — |
| Warning / ambient | `text-amber-600` | — |

## 3. Shadow-as-Border Tokens

Defined in `tailwind.config.ts` → `boxShadow`:

| Token | Usage |
|-------|-------|
| `ring` | `0 0 0 1px rgba(0,0,0,0.08)` — default edge for inputs/cards/buttons |
| `ring-strong` | `0 0 0 1px rgba(0,0,0,0.16)` — stronger edge on focus/selection |
| `card` | ring + ambient `0 1px 2px` + inner white highlight — card surfaces |
| `card-hover` | ring + `0 4px 12px` depth — hover state of cards |
| `popover` | ring + `0 24px 48px` + `0 2px 6px` — floating panels/modals |
| `focus` | `hsla(212,100%,48%,0.5)` 2px ring + `1px` base ring — focus-visible outline |

Apply `shadow-ring` instead of `border`; use `focus-visible:shadow-focus` for focus states.

## 4. Typography

```tailwind
fontFamily: {
  sans: ['Vazirmatn', 'Geist', 'Tahoma', 'Segoe UI', 'sans-serif'],
  mono: ['Vazirmatn', 'Geist Mono', 'Consolas', 'monospace'],
}
```

- Display headings: `tracking-tight` / `tracking-tighter`.
- Persian body copy uses Vazirmatn at `text-base`/`text-sm`.
- Code blocks: `font-mono`.

## 5. Spacing & Layout

- Cards/surfaces: `rounded-card` (12px) for containers, `rounded-field` (8px) for inputs/buttons.
- Page shell: `min-w-0` on scrollable columns so flexbox overflow doesn't lock; `overscroll-behavior-contain` on panels to prevent scroll chaining.
- Editor page: header pinned (`shadow-ring` bottom edge implied via shadow), main area `flex-row-reverse` so the editor sits RTR-LTR and the AI panel reads RTL.

## 6. Components

### Buttons

```tsx
// icon button (toolbar)
<button className="flex h-9 min-w-9 items-center justify-center rounded-lg text-base
                   shadow-ring hover:bg-ink-100 dark:hover:bg-ink-800 text-ink-600 dark:text-ink-300" />
```

- Active/selected: `bg-ink-900 text-white dark:bg-ink-100 dark:text-ink-900` (ship/develop inversion).
- Destructive: `hover:text-ship`.
- Disabled: `disabled:cursor-not-allowed opacity-60`.

### Inputs & Selects

```tsx
className="min-h-8 rounded-lg bg-transparent px-2 text-xs
          shadow-ring placeholder:text-ink-400
          focus-visible:shadow-focus dark:bg-ink-900 dark:text-ink-100"
```

### Tabs (segmented)

```tsx
// selected: surface fill + bold; idle: muted text
<button className={tab === id
  ? 'bg-ink-100 text-ink-900 dark:bg-ink-800 dark:text-white'
  : 'text-ink-500 hover:bg-ink-50 hover:text-ink-700 dark:text-ink-400 dark:hover:bg-ink-800/60 dark:hover:text-ink-200'} />
```

### List items / cards

- Use `shadow-ring` instead of `border`.
- `hover:bg-ink-100 dark:hover:bg-ink-800` for selectable rows.
- Separators implied by `divide-y divide-ink-200 dark:divide-ink-800`.

## 7. Focus & Accessibility

- All interactive elements: `focus-visible:shadow-focus` (the blue 2px halo) — never rely on `outline`.
- Icon buttons: always set `title` + `aria-label`/`aria-pressed`/`aria-expanded` as appropriate.
- RTL: `dir="rtl"` on `<html>` (set via `htmlClass` / AppProvider theme). Text aligns right by default.

## 8. Dark Mode

- `darkMode: 'class'` — toggled via AppProvider (persists to `localStorage`).
- Surfaces flip: `bg-white dark:bg-ink-900`, text `text-ink-900 dark:text-ink-100`.
- Edges deepen: `shadow-ring` stays legible in both; `dark:` hover surfaces use `dark:bg-ink-800`.

## 9. Micro-Interactions

- State transitions are instant (no JS animation libs); Tailwind `transition-colors` is implied by `shadow-ring` + `hover:` swaps.
- `spin` keyframe (`0.7s linear infinite`) used only for AI "running" indicators.

## 10. Applied To

- `RightPanel` — shadow-as-border tabs, AI action buttons disable/ghost states.
- `EditorPage` header — tag pills, favorite ★, export/version/toggle icon cluster.
- `NoteCard`, `DashboardPage`, `AppLayout` — card shadows, ink ramps.
