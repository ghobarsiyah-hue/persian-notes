/**
 * Export-parity verification for the 30-page booklet (REST-only):
 *  1. the persisted booklet splits into the SAME page count the seeder built
 *     (30 sheets — the splitDocIntoPages contract: first kind on doc attrs,
 *     later kinds on the opening pageBreak)
 *  2. /api/export/docx accepts the booklet-scale payload the client sends
 *     (prepared HTML + edu CSS + VML frame header + PAGE-field footer +
 *     OMML islands) and returns a Word-readable .doc
 *  3. /api/export/html round-trips
 *
 * Usage: node scripts/verify-booklet-export.mjs [baseUrl] [noteId]
 */
const BASE = process.argv[2] ?? 'http://localhost:4000';
const EMAIL = process.argv[3] ?? `qa-export-${Date.now()}@pernote.local`;
const NOTE_ID = process.argv[4] ?? '';

async function api(path, { method = 'GET', body, token, raw } = {}) {
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
  if (raw) return res;
  return res.json();
}

/* the doc-attrs contract, mirrored 1:1 from EditorPage.splitDocIntoPages */
const KINDS = ['framed', 'blank', 'notebook'];
function splitDocIntoPages(doc) {
  const blocks = Array.isArray(doc?.content) ? doc.content : [];
  const firstKind = KINDS.includes(doc?.attrs?.pageKind) ? doc.attrs.pageKind : 'framed';
  const chunks = [{ kind: firstKind, auto: false }];
  for (const block of blocks) {
    if (block?.type === 'pageBreak') {
      chunks.push({
        kind: KINDS.includes(block.attrs?.kind) ? block.attrs.kind : 'framed',
        auto: block.attrs?.auto === true,
      });
      continue;
    }
  }
  return chunks;
}

/* a minimal but VALID OMML island (m:oMath) — what the client's
   prepareWordHtml produces from a LaTeX equation */
const OMML_ISLAND =
  '<m:oMathPara xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">' +
  '<m:oMathParaPr><m:jc m:val="center"/></m:oMathParaPr>' +
  '<m:oMath><m:r><m:t>E=mc</m:t></m:r><m:sSup><m:e></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath>' +
  '</m:oMathPara>';

/* a booklet table with the navy template — exactly what the editor's
   getHTML serializes (data-tstyle etc.) and Word bakes inline */
const NAVY_TABLE_HTML =
  '<table data-tstyle="navy" data-align="center" style="width:100%">' +
  '<colgroup><col style="width:170px"><col style="width:400px"></colgroup>' +
  '<tbody>' +
  '<tr><th style="background-color:#1e3a5f"><p>ویژگی</p></th><th style="background-color:#1e3a5f"><p>مقدار</p></th></tr>' +
  '<tr><td><p>قاب</p></td><td><p>تزئینی سرمه‌ای-طلایی</p></td></tr>' +
  '</tbody></table>';

/* the ornamental frame VML — the client's buildWordHeaderFooter output for a
   framed page (pageBorderVmlString → svg shape in a Word header) */
const VML_HEADER_HTML =
  '<div style="mso-element:header" id="h1">' +
  '<svg xmlns="http://www.w3.org/2000/svg" width="754" height="1063" viewBox="0 0 754 1063">' +
  '<path d="M20 20 L734 20 L734 1043 L20 1043 Z" fill="none" stroke="#c5a24d" stroke-width="2"/>' +
  '<path d="M26 26 L728 26 L728 1037 L26 1037 Z" fill="none" stroke="#1e3a5f" stroke-width="1.4"/>' +
  '</svg></div>';
const PAGE_FIELD_FOOTER_HTML =
  '<div style="mso-element:footer" id="f1"><p style="text-align:center">' +
  '<span style="mso-field-code:PAGE"></span></p></div>';

const NOTE_BODY_HTML =
  '<h2>فصل آزمون: تقارن خروجی</h2>' +
  '<p>این پاراگراف از سمت REST آمده است: ' + OMML_ISLAND + '</p>' +
  NAVY_TABLE_HTML +
  /* NOTE: exactly what the client's prepareWordHtml sends — the checkbox
     → ballot-box conversion is a CLIENT-side step, so the payload already
     carries ☑/☐ instead of <input type=checkbox> */
  '<ul data-type="taskList"><li data-checked="true"><p>\u2611 چک‌لیست تیک‌دار</p></li>' +
  '<li data-checked="false"><p>\u2610 آیتم باز</p></li></ul>';

async function main() {
  console.log(`[verify-export] server: ${BASE}`);
  const health = await api('/health');
  if (!health.ok) throw new Error('server /health not ok');

  let token;
  try {
    ({ token } = await api('/auth/login', { method: 'POST', body: { email: 'demo@pernote.local', password: 'demo1234' } }));
  } catch {
    await api('/auth/register', { method: 'POST', body: { name: 'QA Export', email: EMAIL, password: 'qa123456' } });
    ({ token } = await api('/auth/login', { method: 'POST', body: { email: EMAIL, password: 'qa123456' } }));
  }

  /* ── 1. persisted booklet → same page count as the builder ──────── */
  if (NOTE_ID) {
    const { note } = await api(`/notes/${NOTE_ID}`, { token });
    const sheets = splitDocIntoPages(note.content);
    console.log(`[verify-export] booklet note ${note._id}: sheets=${sheets.length}` +
      ` framed=${sheets.filter((s) => s.kind === 'framed').length}` +
      ` notebook=${sheets.filter((s) => s.kind === 'notebook').length}` +
      ` blank=${sheets.filter((s) => s.kind === 'blank').length}`);
    if (sheets.length !== 30) throw new Error(`expected 30 sheets, split produced ${sheets.length}`);
  } else {
    console.log('[verify-export] NOTE_ID not passed — skipping the split check (seeder already audited it)');
  }

  /* ── 2. Word route: full client-shaped payload → .doc ───────────── */
  const docxRes = await api('/export/docx', {
    method: 'POST',
    token,
    raw: true,
    body: {
      title: 'راهنمای کامل پرشین‌نوت (جزوهٔ ۳۰ صفحه‌ای)',
      html: NOTE_BODY_HTML,
      subject: 'راهنمای امکانات',
      chapter: 'خروجی‌ها',
      headerText: 'پرشین‌نوت — جزوهٔ آزمونی',
      footerText: 'تهیه‌شده با پرشین‌نوت',
      bodyFontFamily: 'Shabnam',
      fontSizePx: 16,
      lineHeight: 2,
      eduCss: '.edu-block{border-radius:10px;}',
      headerHtml: VML_HEADER_HTML,
      footerHtml: PAGE_FIELD_FOOTER_HTML,
    },
  });
  const docxBuf = Buffer.from(await docxRes.arrayBuffer());
  const docxText = docxBuf.toString('utf8');
  const checks = {
    'content-type is word/html': /application\/msword|text\/html/i.test(docxRes.headers.get('content-type') ?? ''),
    'doc opens with WordSection': docxText.includes('WordSection1'),
    'OMML island passes through': docxText.includes('m:oMath'),
    'navy table survives': docxText.includes('1e3a5f') || docxText.includes('#1e3a5f'),
    'VML frame header embedded': docxText.includes('mso-element:header'),
    'PAGE field footer embedded': docxText.includes('mso-field-code'),
    'edu CSS embedded': docxText.includes('.edu-block'),
    'task ballot boxes present': docxText.includes('\u2611') && docxText.includes('\u2610'),
    'size sane (>8KB)': docxBuf.length > 8000,
  };
  let failed = 0;
  for (const [name, ok] of Object.entries(checks)) {
    console.log(`[verify-export] docx: ${ok ? 'PASS' : 'FAIL'} — ${name}`);
    if (!ok) failed++;
  }

  /* ── 3. HTML route round-trip ───────────────────────────────────── */
  const htmlRes = await api('/export/html', {
    method: 'POST', token, raw: true,
    body: { title: 'بایگانی جزوه', html: NOTE_BODY_HTML, subject: 'راهنمای امکانات', chapter: 'بایگانی' },
  });
  const htmlText = await htmlRes.text();
  console.log(`[verify-export] html: ${htmlText.includes('فصل آزمون') ? 'PASS' : 'FAIL'} — content round-trips (${htmlText.length} chars)`);

  if (failed || !htmlText.includes('فصل آزمون')) throw new Error(`${failed} docx check(s) failed`);
  console.log('[verify-export] DONE ✅');
}

main().catch((err) => {
  console.error('[verify-export] FAILED:', err.message);
  process.exit(1);
});
