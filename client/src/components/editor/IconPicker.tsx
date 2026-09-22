import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import {
  CATEGORIES, BRANDS, PREMIUM_AVAILABLE, PREMIUM_ICONS,
  premiumSvg, brandSvgRaw, colorize, svgToDataUri, brandDataUri,
} from './iconAssets';

/* ────────────────────────────────────────────────────────────────────────
   IconPicker — premium recolorable icon picker (افزودن → آیکون).

   • Premium vector set: Phosphor duotone/mono icons — no raw emoji.
   • Color palette: the chosen color is baked into the inserted SVG.
   • «برنامه‌های معروف» tab carries famous-app logos (official brand color
     by default; recolors to the picked color).
   • Recently used icons surface first — persisted per browser.
   • Search matches Persian/English keywords across ALL tabs at once.
   ──────────────────────────────────────────────────────────────────────── */

export interface PickedIcon { svg: string; name: string }

type Recent = { kind: 'icon'; id: string } | { kind: 'brand'; id: string };

const COLORS: Array<{ value: string; label: string }> = [
  { value: '#171717', label: 'مشکی (پیش‌فرض)' },
  { value: '#6b7280', label: 'خاکستری' },
  { value: '#1e3a5f', label: 'سرمه‌ای' },
  { value: '#0070f3', label: 'آبی' },
  { value: '#1f7396', label: 'آبی نفتی' },
  { value: '#d97706', label: 'کهربایی' },
  { value: '#dc2626', label: 'قرمز' },
  { value: '#db2777', label: 'صورتی' },
  { value: '#7c3aed', label: 'بنفش' },
];

const CAT_TABS = [
  { id: 'all', label: 'همه' },
  ...CATEGORIES.map(({ id, label }) => ({ id, label })),
  { id: 'apps', label: 'برنامه‌های معروف' },
];

const RECENTS_KEY = 'pn.iconRecents';
const RECENTS_LIMIT = 10;

function loadRecents(): Recent[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]') as Recent[];
    return Array.isArray(raw) ? raw.slice(0, RECENTS_LIMIT) : [];
  } catch { return []; }
}

interface Cell { key: string; svg: string; title: string; kw: string }

/* module-level — the asset pools never change at runtime */
const PREMIUM_CELLS: Cell[] = PREMIUM_AVAILABLE.map((p) => ({
  key: p.id, svg: premiumSvg(p.id)!, title: p.name, kw: `${p.kw} ${p.name}`,
}));
const APP_CELLS: Cell[] = BRANDS.flatMap((b) => {
  const svg = brandSvgRaw(b.slug);
  return svg ? [{ key: b.slug, svg, title: b.name, kw: `${b.kw} ${b.name} برنامه لوگو` }] : [];
});

const RECENTS_LOOKUP: Record<string, Cell> = {};
for (const c of PREMIUM_CELLS) RECENTS_LOOKUP[c.key] = c;
for (const c of APP_CELLS) RECENTS_LOOKUP[c.key] = c;

export function IconPicker({ onPick }: { onPick: (icon: PickedIcon) => void }) {
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState('all');
  const [color, setColor] = useState('#171717');
  const [recents, setRecents] = useState<Recent[]>(loadRecents);

  const pick = (cell: Cell, recent: Recent) => {
    setRecents((prev) => {
      const next = [recent, ...prev.filter((r) => !(r.kind === recent.kind && r.id === recent.id))]
        .slice(0, RECENTS_LIMIT);
      try { localStorage.setItem(RECENTS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
    /* apps keep their official brand color unless the user picked one —
       colorize() with the stock black previously force-filled brand SVGs
       that have no fill attribute of their own, killing their brand color */
    const isBrand = APP_CELLS.some((c) => c.key === cell.key);
    const stock = color === '#171717';
    onPick({ svg: isBrand && stock ? cell.svg : colorize(cell.svg, color), name: cell.title });
  };

  const q = query.trim().toLowerCase();

  const items = useMemo<Cell[]>(() => {
    if (q) {
      const pool = [...PREMIUM_CELLS, ...APP_CELLS];
      return pool.filter((i) => i.kw.toLowerCase().includes(q) || i.title.toLowerCase().includes(q));
    }
    if (cat === 'apps') return APP_CELLS;
    if (cat === 'all') return [...PREMIUM_CELLS, ...APP_CELLS];
    return PREMIUM_ICONS.filter((p) => p.cat === cat && premiumSvg(p.id))
      .map((p) => PREMIUM_CELLS.find((c) => c.key === p.id)!)
      .filter(Boolean);
  }, [q, cat]);

  const recentCells = useMemo(
    () => recents.map((r) => RECENTS_LOOKUP[r.id]).filter((c): c is Cell => c !== null).slice(0, RECENTS_LIMIT),
    [recents],
  );

  /* effective preview/insert color — brands fall back to their brand color */
  const previewUri = (cell: Cell): string => {
    const isBrand = APP_CELLS.some((c) => c.key === cell.key);
    if (isBrand) return brandDataUri(cell.key, color) ?? '';
    return svgToDataUri(colorize(cell.svg, color));
  };

  const renderCell = (cell: Cell, onClick: () => void) => (
    <button
      key={cell.key}
      type="button"
      title={cell.title}
      aria-label={`درج ${cell.title}`}
      /* keep the editor's selection: mousedown would blur the editor and the
         icon would insert at the wrong spot (or nowhere) */
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="group flex h-9 w-9 items-center justify-center rounded-lg border border-transparent transition-[background,border-color,transform] duration-100 hover:border-accent-200 hover:bg-accent-50 active:scale-90 dark:hover:border-ink-600 dark:hover:bg-ink-800"
    >
      <img
        src={previewUri(cell)}
        alt=""
        width={22}
        height={22}
        draggable={false}
        loading="lazy"
        className="transition-transform duration-100 group-hover:scale-110"
      />
    </button>
  );

  return (
    /* data-keep-open — the dropdown host closes panels on any click that is
       not inside a [data-keep-open] section; the picker (search box, tabs,
       palette, grid) must survive clicks so the user can browse and
       multi-insert with different colors */
    <div data-keep-open className="flex w-full flex-col gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400 dark:text-ink-500" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="جستجو بین همهٔ آیکون‌ها…"
          className="h-9 w-full rounded-lg border border-ink-200 bg-white pr-9 pl-3 text-[12.5px] text-ink-700 outline-none placeholder:text-ink-400 focus:border-[#0070f3] focus-visible:ring-2 focus-visible:ring-[#0070f3]/20 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200 dark:placeholder:text-ink-500"
        />
      </div>

      <div className="flex flex-wrap gap-1">
        {CAT_TABS.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setCat(c.id)}
            className={`rounded-full px-2.5 py-1 text-[10.5px] font-medium transition-colors ${
              cat === c.id
                ? 'bg-accent-gradient text-white shadow-sm'
                : 'text-ink-500 hover:bg-ink-100 dark:text-ink-400 dark:hover:bg-ink-800'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* رنگ آیکون — the chosen color is baked into the inserted SVG */}
      <div className="flex items-center gap-2 rounded-lg bg-ink-50 px-2.5 py-2 dark:bg-ink-900/60">
        <span className="shrink-0 text-[11px] font-medium text-ink-500 dark:text-ink-400">رنگ:</span>
        <div className="flex flex-1 items-center justify-between gap-1">
          {COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              title={c.label}
              aria-label={`رنگ ${c.label}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setColor(c.value)}
              className={`h-6 w-6 rounded-full transition-transform hover:scale-110 ${
                color === c.value ? 'ring-2 ring-[#0070f3] ring-offset-1 ring-offset-white dark:ring-offset-ink-900' : ''
              }`}
              style={{ background: c.value, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.08)' }}
            />
          ))}
        </div>
      </div>

      {!q && recentCells.length > 0 && (
        <div>
          <div className="px-0.5 pb-1 text-[10px] font-semibold tracking-wide text-ink-400 dark:text-ink-500">
            اخیر
          </div>
          <div className="flex flex-wrap gap-1">
            {recentCells.map((c) => renderCell(c, () => pick(c, { kind: APP_CELLS.some((a) => a.key === c.key) ? 'brand' : 'icon', id: c.key })))}
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <div className="py-10 text-center text-[12px] text-ink-400 dark:text-ink-500">آیکونی پیدا نشد</div>
      ) : (
        <div
          className="grid max-h-72 grid-cols-9 gap-0.5 overflow-y-auto p-1"
          style={{ scrollbarWidth: 'thin' }}
        >
          {items.map((i) => renderCell(i, () => pick(i, { kind: APP_CELLS.some((a) => a.key === i.key) ? 'brand' : 'icon', id: i.key })))}
        </div>
      )}
    </div>
  );
}
