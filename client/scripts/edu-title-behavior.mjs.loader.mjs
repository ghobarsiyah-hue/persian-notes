/**
 * Loader shim so `blocks.ts` (which imports iconAssets.ts → Vite's
 * import.meta.glob, unavailable under tsx/node) can load in probes:
 * a load hook serves a STUB for iconAssets.ts only and forwards
 * everything else to the next loader (tsx).
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

const hookSource = `
const STUB_MARKER = 'iconAssets.ts';
const STUB = [
  "const premiumRaw = {};",
  "const brandRaw = {};",
  "const FALLBACK = '<svg xmlns=\\"http://www.w3.org/2000/svg\\" width=\\"1em\\" height=\\"1em\\" viewBox=\\"0 0 256 256\\" fill=\\"currentColor\\"><circle cx=\\"128\\" cy=\\"128\\" r=\\"96\\"/></svg>';",
  "export function premiumSvg(id) { return FALLBACK; }",
  "export function brandSvg(id) { return FALLBACK; }",
  "export const PREMIUM_ICONS = [];",
  "export const BRAND_ICONS = [];",
  "export const ICON_STUB = true;",
].join('\\n');
export async function load(url, context, next) {
  if (url.includes(STUB_MARKER)) {
    return { format: 'module', source: STUB, shortCircuit: true };
  }
  return next(url, context);
}
`;

register(`data:text/javascript,${encodeURIComponent(hookSource)}`, { parentURL: pathToFileURL(new URL('.', import.meta.url).pathname.replace(/^\\([A-Za-z]:)/, '$1')) });
