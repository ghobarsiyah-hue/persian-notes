/* Shared "recently used colors" memory.
 *
 * Every color picker in the app (Ribbon text/highlight color, floating-layer
 * properties bar, …) shares ONE list persisted in localStorage: after the
 * user picks a color it jumps to the front of the list, so the next time a
 * color menu opens the last-used color is the FIRST/default suggestion.
 *
 * Keeps the legacy `pn_recent_colors` key so colors chosen before this
 * module existed are not lost.
 */

const RECENT_COLORS_KEY = 'pn_recent_colors';
const MAX_RECENT = 8;

export function loadRecentColors(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_COLORS_KEY) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((c): c is string => typeof c === 'string' && c.length > 0)
      : [];
  } catch {
    return [];
  }
}

/** Move `color` to the front of the recents (deduped), persist, return the new list. */
export function rememberColor(color: string): string[] {
  const next = [
    color,
    ...loadRecentColors().filter((c) => c.toLowerCase() !== color.toLowerCase()),
  ].slice(0, MAX_RECENT);
  try { localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  return next;
}
