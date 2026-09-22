/* One-shot asset fetcher: downloads premium vector icon sets so the icon
   picker shows recolorable duotone artwork instead of raw platform emoji.
   - premium: Phosphor duotone icons (MIT) via the Iconify API
     (fallback: `-bold` monochrome variant when no duotone exists)
   - brands:  Simple Icons (brand logos) from jsDelivr
   Reads the curated icon ids from `client/src/components/editor/iconAssets.ts`.
   Writes:
     client/src/assets/icons/premium/*.svg
     client/src/assets/icons/brands/*.svg
     client/src/components/editor/iconFileMaps.ts  (slug→file)
*/
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const premiumDir = join(root, '..', 'client', 'src', 'assets', 'icons', 'premium');
const brandsDir = join(root, '..', 'client', 'src', 'assets', 'icons', 'brands');
mkdirSync(premiumDir, { recursive: true });
mkdirSync(brandsDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url) {
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (res.status === 429) { await sleep(1500 * (i + 1)); continue; } /* rate limited */
      if (res.ok) {
        const text = await res.text();
        if (text.trimStart().startsWith('<svg') || text.trimStart().startsWith('{')) return text;
        return null; /* 404-ish: no such icon */
      }
    } catch { await sleep(500); }
  }
  return null;
}

/* ── premium (Phosphor) — ids come from the curated metadata module ── */
/* alternate phosphor names where the curated id does not exist verbatim */
const RENAMES = {
  'chat-teardrop-text': 'chat-teardrop-dots',
  'music-notes': 'music-note',
  'globe-hemisphere-west': 'globe',
  'envelope-simple': 'envelope',
  'wrench': 'pipe-wrench',
};

const assetsSrc = readFileSync(join(root, '..', 'client', 'src', 'components', 'editor', 'iconAssets.ts'), 'utf8');
const ids = [...new Set([...assetsSrc.matchAll(/\{ id: '([^']+)', cat: '/g)].map((m) => m[1]))];
console.log(`premium ids found: ${ids.length}`);

/* phosphor stores BASE names + a `suffixes` list of style suffixes
   (e.g. -duotone / -bold) — valid icons are base + one of those */
const colJson = JSON.parse(await fetchText('https://api.iconify.design/collection?prefix=ph'));
const phNames = new Set();
if (Array.isArray(colJson.uncategorized)) for (const n of colJson.uncategorized) phNames.add(n);
for (const alias of Object.keys(colJson.aliases ?? {})) phNames.add(alias);
const suffixes = Array.isArray(colJson.suffixes) ? colJson.suffixes : ['-duotone', '-bold'];
console.log(`phosphor base names: ${phNames.size}, suffixes: ${suffixes.join(' ')}`);

const premiumFailed = [];
let done = 0;
for (let i = 0; i < ids.length; i += 6) {
  await Promise.all(ids.slice(i, i + 6).map(async (id) => {
    if (existsSync(join(premiumDir, `${id}.svg`))) { done++; return; } /* idempotent rerun */
    const base = phNames.has(id) ? id : RENAMES[id];
    if (!base || !phNames.has(base)) { premiumFailed.push(id); return; }
    /* prefer the duotone style, then bold monochrome, then regular */
    const styles = ['-duotone', '-bold', ''].filter((s) => suffixes.includes(s) || s === '');
    for (const s of styles) {
      const svg = await fetchText(`https://api.iconify.design/ph/${base}${s}.svg`);
      if (svg) { writeFileSync(join(premiumDir, `${id}.svg`), svg); done++; return; }
    }
    premiumFailed.push(id);
  }));
  await sleep(300); /* stay friendly to the Iconify API */
}
console.log(`premium downloaded/total: ${done}/${ids.length}`);
console.log(`premium ok: ${ids.length - premiumFailed.length}, failed: ${premiumFailed.length}${premiumFailed.length ? ' -> ' + premiumFailed.join(' ') : ''}`);

/* ── brands (Simple Icons) — slug candidates + brand colors live in iconAssets.ts ── */
const BRANDS = [
  { slugs: ['whatsapp'], color: '#25D366' },
  { slugs: ['telegram'], color: '#26A5E4' },
  { slugs: ['instagram'], color: '#E4405F' },
  { slugs: ['x'], color: '#0F1419' },
  { slugs: ['facebook'], color: '#0866FF' },
  { slugs: ['messenger'], color: '#00B2FF' },
  { slugs: ['linkedin'], color: '#0A66C2' },
  { slugs: ['youtube'], color: '#FF0000' },
  { slugs: ['tiktok'], color: '#25F4EE' },
  { slugs: ['snapchat'], color: '#F7D200' },
  { slugs: ['pinterest'], color: '#BD081C' },
  { slugs: ['reddit'], color: '#FF4500' },
  { slugs: ['discord'], color: '#5865F2' },
  { slugs: ['slack'], color: '#8C4FEB' },
  { slugs: ['zoom'], color: '#0B5CFF' },
  { slugs: ['signal'], color: '#3A76F0' },
  { slugs: ['viber'], color: '#7360F2' },
  { slugs: ['line'], color: '#00C300' },
  { slugs: ['wechat'], color: '#07C160' },
  { slugs: ['github'], color: '#181717' },
  { slugs: ['gitlab'], color: '#FC6D26' },
  { slugs: ['stackoverflow', 'stack-overflow'], color: '#F48027' },
  { slugs: ['figma'], color: '#F24E1E' },
  { slugs: ['canva'], color: '#00C4CC' },
  { slugs: ['googlechrome'], color: '#4285F4' },
  { slugs: ['firefox'], color: '#FF7139' },
  { slugs: ['safari'], color: '#006CFF' },
  { slugs: ['microsoftedge', 'edge'], color: '#0078D7' },
  { slugs: ['gmail'], color: '#EA4335' },
  { slugs: ['googledrive'], color: '#4285F4' },
  { slugs: ['googledocs'], color: '#4285F4' },
  { slugs: ['googlesheets'], color: '#34A853' },
  { slugs: ['googlemaps'], color: '#4285F4' },
  { slugs: ['googlemeet'], color: '#00897B' },
  { slugs: ['dropbox'], color: '#0061FF' },
  { slugs: ['onedrive', 'microsoftonedrive'], color: '#0078D4' },
  { slugs: ['microsoftword', 'word'], color: '#2B579A' },
  { slugs: ['microsoftexcel', 'excel'], color: '#217346' },
  { slugs: ['microsoftpowerpoint', 'powerpoint'], color: '#D24726' },
  { slugs: ['microsoftoutlook', 'outlook'], color: '#0078D4' },
  { slugs: ['microsoftteams', 'teams'], color: '#6264A7' },
  { slugs: ['spotify'], color: '#1DB954' },
  { slugs: ['soundcloud'], color: '#FF5500' },
  { slugs: ['twitch'], color: '#9146FF' },
  { slugs: ['steam'], color: '#0B1B28' },
  { slugs: ['playstation', 'sonyplaystation'], color: '#003791' },
  { slugs: ['apple'], color: '#0B0B0B' },
  { slugs: ['android'], color: '#3DDC84' },
];

const SI_BASES = [
  'https://cdn.jsdelivr.net/npm/simple-icons@14/icons/',
  'https://cdn.jsdelivr.net/npm/simple-icons@13/icons/',
  'https://cdn.jsdelivr.net/npm/simple-icons@11/icons/',
];

const brandMap = {};
const brandFailed = [];
for (let i = 0; i < BRANDS.length; i += 12) {
  await Promise.all(BRANDS.slice(i, i + 12).map(async (b) => {
    for (const slug of b.slugs) {
      for (const base of SI_BASES) {
        const svg = await fetchText(base + slug + '.svg');
        if (svg) {
          writeFileSync(join(brandsDir, slug + '.svg'), svg);
          brandMap[b.slugs[0]] = slug + '.svg';
          return;
        }
      }
    }
    brandFailed.push(b.slugs[0]);
  }));
}
console.log(`brands ok: ${Object.keys(brandMap).length}, failed: ${brandFailed.length}${brandFailed.length ? ' -> ' + brandFailed.join(' ') : ''}`);

/* ── generated lookup map (brands only; premium keys are the file names) ── */
const out = `/* AUTO-GENERATED by scripts/fetch-icons.mjs — do not edit by hand.
   Maps brand slugs to downloaded SVG asset filenames. */

export const BRAND_FILE_BY_SLUG: Record<string, string> = ${JSON.stringify(brandMap, null, 2)};
`;
const outFile = join(root, '..', 'client', 'src', 'components', 'editor', 'iconFileMaps.ts');
writeFileSync(outFile, out);
console.log(`wrote ${outFile}`);
