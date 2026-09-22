/**
 * Seed the 30-page feature-tour booklet (scripts/booklet-content.mjs) through
 * the REST API and sanity-check the persisted pagination format:
 *   • pageBreak nodes separate the pages (multi-page storage format)
 *   • the first page's kind lives in doc attrs.pageKind
 *   • every following page's kind rides on the pageBreak that OPENS it
 *   • the one manual hard-break has NO kind
 *   • equation nodes carry latex payloads; tables carry tstyle/align
 *
 * Usage: node scripts/seed-feature-booklet.mjs [baseUrl]
 */
import { buildBookletPages, buildBookletDoc } from './booklet-content.mjs';

const BASE = process.argv[2] ?? 'http://localhost:4000';
const EMAIL = process.argv[3] ?? `qa-booklet-${Date.now()}@pernote.local`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg += ': ' + (await res.json())?.error; } catch { /* ignore */ }
    throw new Error(`${path} → ${msg}`);
  }
  return res.json();
}

/* ── storage-format audit of the built doc ────────────────────────── */
function auditBooklet(doc) {
  const blocks = doc.content ?? [];
  const breaks = blocks.filter((b) => b?.type === 'pageBreak');
  const kinds = ['framed'];
  let manualBreaks = 0;
  for (const b of breaks) {
    const k = b.attrs?.kind;
    if (k) kinds.push(k);
    else manualBreaks++;
  }
  const expectPages = buildBookletPages().length + manualBreaks; // manual hard-break adds one real sheet
  const eqs = blocks.filter((b) => b?.type === 'equation' || b?.type === 'equationInline');
  const tables = blocks.filter((b) => b?.type === 'table');
  const eduTypes = new Set([
    'calloutBlock', 'questionBlock', 'exampleBlock', 'keyTermBlock', 'formulaBlock',
    'comparisonTable', 'timeline', 'footnoteBlock', 'longAnswerBlock', 'highlightBox',
    'referenceBlock', 'proConBlock', 'codeOutputBlock',
  ]);
  const eduKinds = new Set(blocks.filter((b) => eduTypes.has(b?.type)).map((b) => b.type));
  const tasks = blocks.filter((b) => b?.type === 'taskList');
  const icons = JSON.stringify(blocks).includes('inlineIcon');
  const okKinds = kinds.every((k) => ['framed', 'blank', 'notebook'].includes(k));
  return {
    blocks: blocks.length,
    sheets: breaks.length + 1,
    expectPages,
    manualBreaks,
    kindsFramed: kinds.filter((k) => k === 'framed').length,
    kindsNotebook: kinds.filter((k) => k === 'notebook').length,
    kindsBlank: kinds.filter((k) => k === 'blank').length,
    equations: eqs.length,
    tables: tables.length,
    tableStyles: [...new Set(tables.map((t) => t.attrs?.tstyle).filter(Boolean))],
    eduBlockKinds: eduKinds.size,
    taskLists: tasks.length,
    inlineIcons: icons,
    okPages: breaks.length + 1 === expectPages,
    okKinds,
    /* sheets alias used by the reload check */
    pages: breaks.length + 1,
  };
}

async function main() {
  console.log(`[seed-booklet] server: ${BASE}`);
  const health = await api('/health');
  if (!health.ok) throw new Error('server /health not ok');
  console.log('[seed-booklet] health ok');

  let token;
  try {
    ({ token } = await api('/auth/login', { method: 'POST', body: { email: 'demo@pernote.local', password: 'demo1234' } }));
    console.log('[seed-booklet] logged in as demo@pernote.local');
  } catch {
    await api('/auth/register', { method: 'POST', body: { name: 'QA Booklet', email: EMAIL, password: 'qa123456' } });
    ({ token } = await api('/auth/login', { method: 'POST', body: { email: EMAIL, password: 'qa123456' } }));
    console.log(`[seed-booklet] registered new user ${EMAIL}`);
  }

  const doc = buildBookletDoc();
  const audit = auditBooklet(doc);
  console.log('[seed-booklet] doc audit:', JSON.stringify(audit, null, 2));
  if (!audit.okPages || !audit.okKinds) throw new Error('booklet structure mismatch');
  if (audit.eduBlockKinds < 13) throw new Error('not all 13 edu block kinds used');
  if (audit.equations < 6) throw new Error('not enough equation nodes');

  const { note } = await api('/notes', { method: 'POST', token, body: {
    title: 'راهنمای کامل پرشین‌نوت (جزوهٔ ۳۰ صفحه‌ای)',
    chapter: 'راهنمای امکانات',
    content: doc,
    html: '<p>(booklet — rendered on the client)</p>',
    plainText: 'راهنمای کامل پرشین‌نوت — جزوهٔ سی‌صفحه‌ای معرفی امکانات',
  } });
  console.log(`[seed-booklet] created note ${note._id}`);
  console.log(`[seed-booklet] open in editor: http://localhost:5173/editor/${note._id}`);

  await sleep(400);
  const { note: reloaded } = await api(`/notes/${note._id}`, { token });
  const persisted = reloaded.content?.type === 'doc';
  const persistedAudit = auditBooklet(reloaded.content);
  console.log(`[seed-booklet] reload ok=${persisted} pages=${persistedAudit.pages} blocks=${persistedAudit.blocks}`);
  if (!persisted || persistedAudit.pages !== audit.pages) throw new Error('persisted content mismatch');
  console.log('[seed-booklet] DONE ✅');
}

main().catch((err) => {
  console.error('[seed-booklet] FAILED:', err.message);
  process.exit(1);
});
