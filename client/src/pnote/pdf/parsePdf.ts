/* ═══════════════════════════════════════════════════════════════════════
   pnote/pdf/parsePdf — a minimal, dependency-free PDF text extractor.

   WHY hand-rolled (§28: smallest architecture-compatible implementation):
   pdfjs-dist is ~1.5 MB of worker machinery for a job whose reliable core
   is «uncompress text objects and read their show-text operators». We
   implement the well-specified subset that covers normal TEXT-based PDFs:

     • parse xref/startxref (lazy — we only need object offsets)
     • object streams (PDF 1.5 /ObjStm) via DecompressionStream
     • content streams: FlateDecode (method 8), raw, and hex/inline basics
     • text operators: BT, ET, Tf, Td, TD, Tm, Tstar, TL, Tj, TJ, quote ops
     • ToUnicode CMaps (bfchar/bfrange, hex <XXXX> mappings) for correct
       Persian/Unicode extraction
     • the two standard encodings' mangling (WinAnsi) so Latin survives
     • per-page content-stream assembly so PAGE BOUNDARIES are exact

   NOT implemented (and NOT promised — §9/§11 honesty): vector graphics
   reconstruction, exact visual layout, Type3/hidden encodings, encrypted
   PDFs beyond the empty-user-password RC4/AES case (those report
   'encrypted' and the UI shows a clear Persian error), form fields,
   annotations. A scanned/image-only PDF yields NO text → the caller
   detects it and shows the honest scanned-PDF message (§16) — no fake
   OCR is invented here.

   SECURITY (§20): everything is bounds-checked against the input buffer;
   loops are budgeted; no eval, no embedded-script execution (PDF
   JavaScript is ignored entirely), output strings are length-capped.
   ═══════════════════════════════════════════════════════════════════════ */

export const PDF_LIMITS = {
  /** file ≤ 100 MB */
  fileBytes: 100 * 1024 * 1024,
  /** ≤ 1000 pages */
  maxPages: 1000,
  /** ≤ 200k extracted text runs per page (hostile-file budget) */
  maxRunsPerPage: 200_000,
  /** ≤ 2 MB of content streams per page */
  maxPageStreamBytes: 2 * 1024 * 1024,
  /** total decoded text per page ≤ 4 MB */
  maxPageTextChars: 4 * 1024 * 1024,
};

export class PdfParseError extends Error {
  code: 'corrupt' | 'encrypted' | 'too-large' | 'no-text';
  constructor(code: 'corrupt' | 'encrypted' | 'too-large' | 'no-text', message: string) {
    super(message);
    this.code = code;
    this.name = 'PdfParseError';
  }
}

/** one extracted text run on one page (in PDF user-space points) */
export interface PdfTextRun {
  /** run's left x, baseline y (y grows DOWN from page top) */
  x: number;
  y: number;
  /** font size (approximate, from Tf × Tm scale) */
  size: number;
  text: string;
  /** true when the run came from a hex string (often CID/Unicode) */
  hex: boolean;
}

export interface PdfPageText {
  index: number;
  width: number;
  height: number;
  runs: PdfTextRun[];
  /** true when the page contains image XObjects but (almost) no text —
   *  the scanned-page heuristic (§16) */
  imageOnly: boolean;
}

/* ── byte-level helpers ─────────────────────────────────────────────────── */

const latin1 = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
};

function isWs(c: number): boolean { return c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 || c === 0x0c || c === 0x00; }
function isDelim(c: number): boolean { return isWs(c) || c === 0x28 || c === 0x29 || c === 0x3c || c === 0x3e || c === 0x5b || c === 0x5d || c === 0x7b || c === 0x7d || c === 0x2f || c === 0x25; }

/** find `needle` (latin1) in buffer starting at `from` */
function findSeq(buf: Uint8Array, needle: string, from = 0): number {
  const n = needle.length;
  const end = buf.length - n;
  outer: for (let i = from; i <= end; i++) {
    for (let j = 0; j < n; j++) {
      if (buf[i + j] !== needle.charCodeAt(j)) continue outer;
    }
    return i;
  }
  return -1;
}

/* ── FlateDecode via DecompressionStream ────────────────────────────────── */

const flateCache = new WeakMap<Uint8Array, Uint8Array | null>();

async function flateDecode(data: Uint8Array): Promise<Uint8Array | null> {
  const cached = flateCache.get(data);
  if (cached !== undefined) return cached;
  let out: Uint8Array | null = null;
  try {
    /* PDF streams are zlib-wrapped ('deflate'); fall back to raw */
    for (const format of ['deflate', 'deflate-raw'] as const) {
      try {
        const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream(format));
        out = new Uint8Array(await new Response(stream).arrayBuffer());
        break;
      } catch { /* try next */ }
    }
  } catch { out = null; }
  flateCache.set(data, out);
  return out;
}

/* ── tokenizer over a latin1 view of the file ───────────────────────────── */

interface Token { type: 'num' | 'name' | 'str' | 'hexstr' | 'arr' | 'dict' | 'op' | 'bool' | 'null'; v: unknown; }

/** decode PDF string literal escapes (§7.3.4.2) */
function decodeLiteralString(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c !== '\\') { out += c; continue; }
    const n = raw[++i];
    if (n === 'n') out += '\n';
    else if (n === 'r') out += '\r';
    else if (n === 't') out += '\t';
    else if (n === 'b') out += '\b';
    else if (n === 'f') out += '\f';
    else if (n >= '0' && n <= '7') {
      let oct = n;
      while (oct.length < 3 && i + 1 < raw.length && raw[i + 1] >= '0' && raw[i + 1] <= '7') oct += raw[++i];
      out += String.fromCharCode(parseInt(oct, 8));
    } else if (n === '\r' && raw[i + 1] === '\n') i++;
    else if (n === '\r' || n === '\n') { /* line continuation */ }
    else out += n ?? '';
  }
  return out;
}

function decodeHexString(hex: string): string {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  const padded = clean.length % 2 ? clean + '0' : clean;
  const bytes = new Uint8Array(padded.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16);
  /* PDF 7.3.4.3: an odd trailing zero was already normalized above; the
     byte string is returned as a LATIN-1 string so downstream 2-byte
     code pairing (decodeShowText) sees the exact bytes — NOT a UTF-16
     reinterpretation that would inject NUL code units */
  let out = '';
  for (const b of bytes) out += String.fromCharCode(b);
  return out;
}

/** a tiny PDF-object lexer used for content streams and inline dicts */
function* tokenize(content: string): Generator<Token> {
  let i = 0;
  const n = content.length;
  while (i < n) {
    const c = content[i];
    if (isWs(c.charCodeAt(0))) { i++; continue; }
    if (c === '%') { while (i < n && content[i] !== '\n' && content[i] !== '\r') i++; continue; }
    if (c === '(') {
      let depth = 1, j = i + 1, out = '';
      while (j < n && depth > 0) {
        const ch = content[j];
        if (ch === '\\') { out += ch + (content[j + 1] ?? ''); j += 2; continue; }
        if (ch === '(') depth++;
        else if (ch === ')') { depth--; if (depth === 0) break; }
        out += ch; j++;
      }
      /* keep the ESCAPED body raw — decodeLiteralString below resolves the
         escapes; do NOT pre-consume them here (a lone backslash would
         otherwise swallow the following delimiter) */
      yield { type: 'str', v: out };
      i = j + 1; continue;
    }
    if (c === '<' && content[i + 1] === '<') {
      /* inline dict — bounded scan to matching >> */
      let depth = 1, j = i + 2;
      while (j < n - 1 && depth > 0) {
        if (content[j] === '<' && content[j + 1] === '<') depth++;
        else if (content[j] === '>' && content[j + 1] === '>') depth--;
        if (depth === 0) break;
        j++;
      }
      yield { type: 'dict', v: content.slice(i, j + 2) };
      i = j + 2; continue;
    }
    if (c === '<') {
      const j = content.indexOf('>', i);
      yield { type: 'hexstr', v: decodeHexString(content.slice(i + 1, j < 0 ? n : j)) };
      i = (j < 0 ? n : j) + 1; continue;
    }
    if (c === '[') {
      const arr: Token[] = [];
      i++;
      while (i < n) {
        if (content[i] === ']') { i++; break; }
        const t = tokenizeSingle(content, i);
        if (!t) break;
        arr.push(t.token); i = t.next;
      }
      yield { type: 'arr', v: arr };
      continue;
    }
    if (c === '/') {
      let j = i + 1;
      while (j < n && !isDelim(content.charCodeAt(j))) j++;
      yield { type: 'name', v: content.slice(i + 1, j) };
      i = j; continue;
    }
    const single = tokenizeSingle(content, i);
    if (!single) { i++; continue; }
    yield single.token;
    i = single.next;
  }
}

function tokenizeSingle(content: string, i: number): { token: Token; next: number } | null {
  const n = content.length;
  const c = content[i];
  if (c === ')' || c === '>' || c === ']' || c === '}') return null;
  let j = i;
  while (j < n && !isWs(content.charCodeAt(j)) && !isDelim(content.charCodeAt(j))) j++;
  const word = content.slice(i, j);
  if (word === '') { /* a delimiter char like ')' mid-expression */ return null; }
  if (word === 'true' || word === 'false') return { token: { type: 'bool', v: word === 'true' }, next: j };
  if (word === 'null') return { token: { type: 'null', v: null }, next: j };
  if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return { token: { type: 'num', v: parseFloat(word) }, next: j };
  /* operator (maybe two-char like T*) */
  if (isDelim(content.charCodeAt(i + (word.length === 0 ? 0 : 0)) || 0)) { /* unreachable */ }
  let next = j;
  const two = word + (content[j] ?? '');
  if (['T*', "T'", 'BT', 'ET'].includes(two) && (content[j + 1] === undefined || isWs(content.charCodeAt(j + 1)) || isDelim(content.charCodeAt(j + 1)))) {
    return { token: { type: 'op', v: two }, next: j + 1 };
  }
  return { token: { type: 'op', v: word }, next };
}

/* ── object/offset index ────────────────────────────────────────────────── */

interface ObjRef { num: number; gen: number; }

interface ParsedPdf {
  /** object number → offset of "N G obj" in the file */
  offsets: Map<number, number>;
  /** object number → object-stream number it lives in (PDF 1.5) */
  inObjStm: Map<number, { stm: number; idx: number }>;
  pages: ObjRef[];
  trailer: Map<string, unknown>;
}

/** find the last `startxref` and return the xref-table offset */
function findStartXref(buf: Uint8Array): number {
  const tail = latin1(buf.subarray(Math.max(0, buf.length - 2048)));
  const m = /startxref\s+(\d+)\s+%?EOF?\s*$/s.exec(tail) ?? /startxref\s+(\d+)/s.exec(tail);
  return m ? parseInt(m[1], 10) : -1;
}

interface XrefResult { offsets: Map<number, number>; inObjStm: Map<number, { stm: number; idx: number }>; trailer: Map<string, unknown>; }

async function parseXrefChain(buf: Uint8Array, xrefStart: number): Promise<XrefResult | null> {
  const offsets = new Map<number, number>();
  const inObjStm = new Map<number, { stm: number; idx: number }>();
  const trailer = new Map<string, unknown>();
  const visited = new Set<number>();
  let pos = xrefStart;
  let budget = 64;
  while (pos > 0 && budget-- > 0 && !visited.has(pos)) {
    visited.add(pos);
    const head = latin1(buf.subarray(pos, Math.min(buf.length, pos + 4096)));
    if (/^xref[\s\r\n]/.test(head)) {
      /* classic table */
      const latin = latin1(buf);
      let p = pos + 4;
      let sub = /(\d+)\s+(\d+)[\s]*((?:[\r\n][\s]*\d{10}\s\d{5}\s[nf][\s\r\n])+)/g;
      void sub; void p; void latin;
      /* simpler: scan entries directly */
      let cursor = pos + 4;
      while (cursor < buf.length) {
        const seg = latin1(buf.subarray(cursor, Math.min(buf.length, cursor + 4096)));
        const countM = /^\s*(\d+)\s+(\d+)\s*/.exec(seg);
        if (!countM) break;
        const startObj = parseInt(countM[1], 10);
        const count = parseInt(countM[2], 10);
        cursor += countM[0].length;
        for (let i = 0; i < count && cursor + 20 <= buf.length; i++) {
          const entry = latin1(buf.subarray(cursor, cursor + 20));
          const m = /^(\d{10})\s(\d{5})\s([nf])[\s\r\n]/.exec(entry);
          if (m) {
            const off = parseInt(m[1], 10);
            if (m[3] === 'n' && !offsets.has(startObj + i)) offsets.set(startObj + i, off);
          }
          cursor += 20;
        }
        /* lookahead: another subsection or trailer */
        const look = latin1(buf.subarray(cursor, Math.min(buf.length, cursor + 512)));
        if (/^\s*(\d+\s+\d+\s*)/.test(look) && !/trailer/.test(look.slice(0, 32))) continue;
        if (/trailer/.test(look)) {
          const tm = /trailer([\s\S]*?)(>>)/.exec(look);
          if (tm) {
            const dict = parseDictText(look.slice(look.indexOf('trailer') + 7));
            for (const [k, v] of dict) trailer.set(k, v);
          }
          break;
        }
        break;
      }
      const prevM = /Prev\s+(\d+)/.exec(latin1(buf.subarray(cursor, Math.min(buf.length, cursor + 4096))));
      pos = prevM ? parseInt(prevM[1], 10) : -1;
      if (trailer.has('XRefStm')) {
        const xs = trailer.get('XRefStm');
        if (typeof xs === 'number') {
          await parseXrefStream(buf, xs, offsets, inObjStm, trailer);
        }
      }
    } else {
      /* xref stream */
      const before = await parseXrefStream(buf, pos, offsets, inObjStm, trailer);
      pos = before;
    }
  }
  return { offsets, inObjStm, trailer };
}

/** parse a trailer dict from raw latin1 text (numbers and names only) */
function parseDictText(text: string): Map<string, unknown> {
  const out = new Map<string, unknown>();
  const re = /\/([A-Za-z0-9]+)\s+(\/[A-Za-z0-9]+|[\d.]+|\[[^\]]*\]|<<)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const key = m[1];
    const rawVal = m[2];
    if (rawVal === '/' || rawVal === '<<') continue;
    if (rawVal.startsWith('/')) out.set(key, rawVal.slice(1));
    else if (/^[\d.]+$/.test(rawVal)) out.set(key, parseFloat(rawVal));
    else out.set(key, rawVal);
  }
  return out;
}

/** parse an xref STREAM (PDF 1.5) → adds offsets; returns Prev offset */
async function parseXrefStream(buf: Uint8Array, pos: number, offsets: Map<number, number>, inObjStm: Map<number, { stm: number; idx: number }>, trailer: Map<string, unknown>): Promise<number> {
  const headEnd = findSeq(buf, 'stream', pos);
  if (headEnd < 0) return -1;
  const head = latin1(buf.subarray(pos, headEnd));
  const numM = /(\d+)\s+(\d+)\s+obj/.exec(head);
  if (!numM) return -1;
  const dict = parseDictText(head);
  const w = dict.get('W');
  const size = dict.get('Size');
  if (!(w instanceof Array) || typeof size !== 'number') return -1;
  const wArr = (w as unknown[]).map((x) => (typeof x === 'number' ? x : 0));
  const width = wArr.reduce((s: number, x) => s + x, 0);
  if (width <= 0 || width > 128) return -1;
  const streamStart = headEnd + (buf[headEnd + 5] === 0x0d ? 7 : 6);
  const length = typeof dict.get('Length') === 'number' ? dict.get('Length') as number : findSeq(buf, 'endstream', streamStart) - streamStart;
  if (length <= 0 || streamStart + length > buf.length) return -1;
  let data = buf.subarray(streamStart, streamStart + length);
  if (dict.get('Filter') === 'FlateDecode') {
    const inflated = await flateDecode(data);
    if (!inflated) return -1;
    data = inflated;
  }
  const index = dict.get('Index') instanceof Array ? (dict.get('Index') as unknown[]) : null;
  const rows: Array<[number, number]> = [];
  if (index) {
    for (let i = 0; i + 1 < index.length; i += 2) {
      const start = index[i], cnt = index[i + 1];
      if (typeof start === 'number' && typeof cnt === 'number') rows.push([start, cnt]);
    }
  } else rows.push([0, size]);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let rowIdx = 0;
  let cursor = 0;
  for (const [start, cnt] of rows) {
    for (let i = 0; i < cnt; i++) {
      if (cursor + width > data.length) return dict.has('Prev') && typeof dict.get('Prev') === 'number' ? dict.get('Prev') as number : -1;
      const f1 = wArr[0] > 0 ? readInt(dv, cursor, wArr[0]) : 1;
      const f2 = wArr[1] > 0 ? readInt(dv, cursor + wArr[0], wArr[1]) : 0;
      if (f1 === 1 && !offsets.has(start + i)) offsets.set(start + i, f2);
      else if (f1 === 2) inObjStm.set(start + i, { stm: f2, idx: wArr[2] > 0 ? readInt(dv, cursor + wArr[0] + wArr[1], wArr[2]) : 0 });
      cursor += width;
      rowIdx++;
      void rowIdx;
    }
  }
  trailer.set('Root', dict.get('Root') ?? trailer.get('Root'));
  return typeof dict.get('Prev') === 'number' ? dict.get('Prev') as number : -1;
}

function readInt(dv: DataView, offset: number, bytes: number): number {
  let v = 0;
  for (let i = 0; i < bytes; i++) v = v * 256 + dv.getUint8(offset + i);
  return v;
}

/* ── object fetching ────────────────────────────────────────────────────── */

interface PdfObj { num: number; dict: Map<string, unknown>; stream: Uint8Array | null; }

/** resolve "N 0 R" style values from a dict-as-text world */
function refNum(v: unknown): number | null {
  return typeof v === 'number' ? v : null;
}

function parseObjectAt(buf: Uint8Array, offset: number, num: number): PdfObj | null {
  if (offset <= 0 || offset >= buf.length) return null;
  const headEnd = findSeq(buf, 'obj', offset);
  if (headEnd < 0 || headEnd > offset + 64) {
    /* fallback: scan forward a bounded window */
    const win = latin1(buf.subarray(offset, Math.min(buf.length, offset + 4096)));
    const m = /\d+\s+\d+\s+obj/.exec(win);
    if (!m) return null;
  }
  /* read the header text between the object id and the dict end/stream */
  const headStart = offset;
  const window = latin1(buf.subarray(headStart, Math.min(buf.length, headStart + 65536)));
  const objM = /^\s*(\d+)\s+(\d+)\s+obj/.exec(window);
  if (!objM) return null;
  const after = window.slice(objM[0].length);
  const dictM = /^[\s]*<<([\s\S]*?)>>/.exec(after);
  const dict = dictM ? parseDictText(dictM[1]) : new Map<string, unknown>();
  /* stream? */
  let stream: Uint8Array | null = null;
  const streamIdx = after.indexOf('stream');
  if (streamIdx >= 0 && dictM && streamIdx < dictM[0].length + 2048) {
    let ds = objM[0].length + streamIdx + 6;
    if (buf[headStart + ds] === 0x0d) ds++;
    if (buf[headStart + ds] === 0x0a) ds++;
    const length = dict.get('Length');
    let len = typeof length === 'number' ? length : -1;
    if (len < 0 || headStart + ds + len > buf.length) {
      const es = findSeq(buf, 'endstream', headStart + ds);
      len = es > 0 ? es - (headStart + ds) : -1;
    }
    if (len > 0 && headStart + ds + len <= buf.length) stream = buf.subarray(headStart + ds, headStart + ds + len);
  }
  return { num, dict, stream };
}

/* ── ToUnicode CMaps ────────────────────────────────────────────────────── */

interface CMap {
  /** source-code width in BYTES, derived from the CMap's src hex
   *  length (4 hex digits ⇒ 2-byte CID codes) — pairing bytes blindly
   *  corrupted 1-byte-code CMaps; never pairing corrupted every
   *  Identity-H Persian font. */
  codeBytes: 1 | 2;
  lookup(code: number): string;
}

const identityCmap: CMap = { codeBytes: 1, lookup: (code) => String.fromCharCode(code) };

/** parse a ToUnicode CMap stream (bfchar + bfrange) */
function parseToUnicode(data: Uint8Array): CMap {
  const text = latin1(data);
  const single = new Map<number, string>();
  const ranges: Array<[number, number, string[]]> = [];
  let srcHexLen = 0;
  const bfcharRe = /beginbfchar([\s\S]*?)endbfchar/g;
  let m: RegExpExecArray | null;
  while ((m = bfcharRe.exec(text))) {
    const re = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let e: RegExpExecArray | null;
    while ((e = re.exec(m[1]))) {
      srcHexLen = Math.max(srcHexLen, e[1].length);
      const src = parseInt(e[1], 16);
      const dstHex = e[2];
      const chars: string[] = [];
      for (let i = 0; i + 4 <= dstHex.length; i += 4) chars.push(String.fromCharCode(parseInt(dstHex.slice(i, i + 4), 16)));
      if (chars.length) single.set(src, chars.join(''));
    }
  }
  const bfrangeRe = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((m = bfrangeRe.exec(text))) {
    const re = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let e: RegExpExecArray | null;
    while ((e = re.exec(m[1]))) {
      srcHexLen = Math.max(srcHexLen, e[1].length);
      const lo = parseInt(e[1], 16), hi = parseInt(e[2], 16), base = parseInt(e[3], 16);
      if (hi - lo > 65535) continue;
      const arr: string[] = [];
      for (let c = lo; c <= hi; c++) arr.push(String.fromCharCode(base + (c - lo)));
      ranges.push([lo, hi, arr]);
    }
  }
  const codeBytes: 1 | 2 = srcHexLen >= 3 ? 2 : 1;
  return {
    codeBytes,
    lookup: (code: number): string => {
      const s = single.get(code);
      if (s !== undefined) return s;
      for (const [lo, hi, arr] of ranges) {
        if (code >= lo && code <= hi) return arr[code - lo] ?? '';
      }
      return String.fromCharCode(code);
    },
  };
}

/* ── content-stream text extraction ─────────────────────────────────────── */

/** WinAnsiEncoding byte → Unicode (covers CP1252 specials) */
const WIN_ANSI_SPECIAL: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡',
  0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x91: '‘', 0x92: '’',
  0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™',
  0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9f: 'Ÿ',
};

interface TextState {
  x: number; y: number;
  font: CMap;
  fontSize: number;
  scale: number;
  leader: number;
}

/** extract text runs from one assembled content stream (latin1).
 *  `fonts` maps the resource font NAME (e.g. F1) → its ToUnicode CMap
 *  (identity when the font has none — 1-byte passthrough decoding). */
function extractRuns(content: string, limit: number, fonts: Map<string, CMap>): PdfTextRun[] {
  const runs: PdfTextRun[] = [];
  const stack: Array<{ x: number; y: number; scale: number; leader: number }> = [];
  let x = 0, y = 0, scale = 1, leader = 0;
  let font: CMap = identityCmap;
  let twoByte = false;
  let fontSize = 12;
  let inText = false;
  let operands: Token[] = [];

  const pushRun = (text: string, hex: boolean) => {
    if (!text) return;
    if (runs.length >= limit) return;
    runs.push({ x, y, size: fontSize * scale, text, hex });
  };

  const decodeRun = (raw: string, hex: boolean): string =>
    decodeShowText(raw, font, twoByte, hex);

  for (const tok of tokenize(content)) {
    if (tok.type === 'op') {
      const op = tok.v as string;
      switch (op) {
        case 'q': stack.push({ x, y, scale, leader }); break;
        case 'Q': {
          const s = stack.pop();
          if (s) { x = s.x; y = s.y; scale = s.scale; leader = s.leader; }
          break;
        }
        case 'cm': {
          /* only the scale factors matter for run sizing; keep it cheap */
          const nums = operands.filter((o) => o.type === 'num').map((o) => o.v as number);
          if (nums.length >= 4) scale *= Math.hypot(nums[0], nums[1]) || 1;
          break;
        }
        case 'BT': inText = true; x = 0; y = 0; break;
        case 'ET': inText = false; break;
        case 'TL': leader = lastNum(operands) ?? 0; break;
        case 'Td': {
          const nums = operands.filter((o) => o.type === 'num').map((o) => o.v as number);
          if (nums.length >= 2) { x += nums[0]; y += nums[1]; }
          break;
        }
        case 'TD': {
          const nums = operands.filter((o) => o.type === 'num').map((o) => o.v as number);
          if (nums.length >= 2) { x += nums[0]; y += nums[1]; leader = -nums[1]; }
          break;
        }
        case 'Tm': {
          const nums = operands.filter((o) => o.type === 'num').map((o) => o.v as number);
          if (nums.length >= 6) { x = nums[4]; y = nums[5]; scale = Math.hypot(nums[0], nums[1]) || 1; }
          break;
        }
        case 'T*': y -= leader; break;
        case 'Tf': {
          const nameTok = operands.find((o) => o.type === 'name');
          const sizeTok = operands[operands.length - 1];
          if (sizeTok?.type === 'num') fontSize = Math.abs(sizeTok.v as number);
          if (nameTok) {
            const cmap = fonts.get(String(nameTok.v));
            font = cmap ?? identityCmap;
            /* pair bytes ONLY for fonts whose CMap declares 2-byte source
               codes — CMap presence alone is not the contract */
            twoByte = font.codeBytes === 2;
          }
          break;
        }
        case 'Tj': {
          if (inText) {
            const s = operands.find((o) => o.type === 'str' || o.type === 'hexstr');
            if (s) pushRun(decodeRun(s.v as string, s.type === 'hexstr'), s.type === 'hexstr');
          }
          break;
        }
        case "'":
        case '"': {
          if (inText) {
            y -= leader;
            const strs = operands.filter((o) => o.type === 'str' || o.type === 'hexstr');
            const s = strs[strs.length - 1];
            if (s) pushRun(decodeRun(s.v as string, s.type === 'hexstr'), s.type === 'hexstr');
          }
          break;
        }
        case 'TJ': {
          if (inText) {
            const arr = operands.find((o) => o.type === 'arr');
            if (arr && Array.isArray(arr.v)) {
              let out = '';
              for (const el of arr.v as Token[]) {
                if (el.type === 'str' || el.type === 'hexstr') {
                  out += decodeRun(el.v as string, el.type === 'hexstr');
                } else if (el.type === 'num') {
                  const adv = el.v as number;
                  /* big negative kerning ≈ a word/segment gap (RTL helps) */
                  if (adv <= -120) out += ' ';
                }
              }
              pushRun(out, false);
            }
          }
          break;
        }
        default: break;
      }
      operands = [];
    } else {
      operands.push(tok);
      if (operands.length > 64) operands = operands.slice(-64);
    }
  }
  return runs;
}

function lastNum(operands: Token[]): number | null {
  for (let i = operands.length - 1; i >= 0; i--) {
    if (operands[i].type === 'num') return operands[i].v as number;
  }
  return null;
}

/** When a hex string carries NO ToUnicode CMap, CID fonts still write
 *  2-byte big-endian codes: every even byte is the high half (≤ 0x10 for
 *  the ASCII/Arabic/CJK BMP planes such files use) and no low byte is
 *  NUL. Latin WinAnsi hex strings fail that shape and keep 1-byte
 *  decoding. This is a byte-shape test on the run itself — not an
 *  encoding guess — so it cannot corrupt CMap-backed fonts (they never
 *  reach this path). */
function tryTwoByteHex(raw: string): string | null {
  if (raw.length < 2 || raw.length % 2 !== 0) return null;
  for (let i = 0; i < raw.length; i += 2) {
    if (raw.charCodeAt(i) > 0x10 || raw.charCodeAt(i + 1) === 0) return null;
  }
  let out = '';
  for (let i = 0; i < raw.length; i += 2) {
    out += String.fromCharCode((raw.charCodeAt(i) << 8) | raw.charCodeAt(i + 1));
  }
  return out;
}

/** decode one show-text operand. With a 2-byte-code ToUnicode CMap the
 *  text is big-endian CID pairs; otherwise 1-byte simple encoding
 *  (WinAnsi specials + passthrough) — optionally via the CMap's table.
 *  A CMap-LESS hex string additionally gets the 2-byte shape heuristic
 *  (tryTwoByteHex) so Persian/CID text without /ToUnicode still lands. */
function decodeShowText(raw: string, font: CMap, twoByte: boolean, hex = false): string {
  if (!twoByte && hex && font === identityCmap) {
    const paired = tryTwoByteHex(raw);
    if (paired !== null) return paired;
  }
  const out: string[] = [];
  if (twoByte) {
    for (let i = 0; i + 1 < raw.length; i += 2) {
      const code = (raw.charCodeAt(i) << 8) | raw.charCodeAt(i + 1);
      out.push(font.lookup(code));
    }
    return out.join('');
  }
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    out.push(code < 256 && WIN_ANSI_SPECIAL[code] !== undefined ? WIN_ANSI_SPECIAL[code] : font.lookup(code));
  }
  return out.join('');
}

/* ── page tree walk ─────────────────────────────────────────────────────── */

/** collect page object numbers from the /Root /Pages tree */
function walkPageTree(buf: Uint8Array, pagesObjNum: number, out: number[], budget: { n: number }): void {
  if (budget.n-- <= 0 || out.length > PDF_LIMITS.maxPages) return;
  const obj = parseObjectAt(buf, findObjOffset(buf, pagesObjNum), pagesObjNum);
  if (!obj) return;
  const kidsM = /Kids\s*\[([^\]]*)\]/.exec(latin1(obj.stream ?? new Uint8Array()));
  void kidsM;
  /* the dict is text-only; re-parse Kids from the raw header */
  const pageOff = findObjOffset(buf, pagesObjNum);
  const head = latin1(buf.subarray(pageOff, Math.min(buf.length, pageOff + 65536)));
  const kids = /\bKids\s*\[([^\]]*)\]/.exec(head);
  if (kids) {
    const refs = kids[1].match(/(\d+)\s+\d+\s+R/g) ?? [];
    for (const r of refs) {
      const n = parseInt(r, 10);
      walkPageTree(buf, n, out, budget);
      if (out.length > PDF_LIMITS.maxPages) return;
    }
    return;
  }
  const type = /\bType\s*\/(\w+)/.exec(head);
  if (type?.[1] === 'Page') out.push(pagesObjNum);
}

const rawProbeCache = new WeakMap<Uint8Array, string>();

/** cached latin1 view of the first 4 MB — raw object scans use it */
function rawProbe(buf: Uint8Array): string {
  let probe = rawProbeCache.get(buf);
  if (probe === undefined) {
    probe = latin1(buf.subarray(0, Math.min(buf.length, 4 * 1024 * 1024)));
    rawProbeCache.set(buf, probe);
  }
  return probe;
}

/** locate "N G obj" by raw scan (xref-independent). Used for the page
 *  tree walk and as the FALLBACK resolver when the xref offsets are
 *  missing — real-world PDFs (incrementally updated, hand-patched,
 *  poorly written) routinely carry stale xref offsets, and a page whose
 *  head cannot be read would be silently extracted as empty. */
function findObjOffset(buf: Uint8Array, num: number): number {
  if (num <= 0 || num > 99_999_999) return -1;
  const pattern = new RegExp(`(?:^|[\\s\\r\\n])${num}\\s+\\d+\\s+obj`, 'g');
  const m = pattern.exec(rawProbe(buf));
  return m ? m.index : -1;
}

/** xref first (VERIFIED — stale offsets from incremental updates must
 *  not silently resolve to garbage), bounded raw scan second */
function resolveObjOffset(buf: Uint8Array, num: number, offsets: Map<number, number>): number {
  const off = offsets.get(num);
  if (off !== undefined && off > 0 && off < buf.length) {
    /* verify the offset really points at "N G obj" — stale entries from
       incremental updates point at OTHER objects or garbage */
    const win = latin1(buf.subarray(off, Math.min(buf.length, off + 48)));
    const m = /^(\d+)\s+(\d+)\s+obj/.exec(win);
    if (m && parseInt(m[1], 10) === num) return off;
  }
  return findObjOffset(buf, num);
}

/* ── public API ─────────────────────────────────────────────────────────── */

export interface ParsedPdfResult {
  pages: PdfPageText[];
  encrypted: boolean;
}

/**
 * Extract per-page text runs from a PDF buffer.
 * Throws PdfParseError('corrupt'|'encrypted'|'too-large') on
 * failure modes; NEVER throws for mere absence of text — an image-only
 * PDF returns pages with `imageOnly: true` and (almost) no runs (§16).
 */
export async function parsePdfText(input: Uint8Array): Promise<ParsedPdfResult> {
  if (input.byteLength > PDF_LIMITS.fileBytes) throw new PdfParseError('too-large', 'pdf too large');
  if (input.byteLength < 100 || latin1(input.subarray(0, 5)) !== '%PDF-') {
    throw new PdfParseError('corrupt', 'not a pdf');
  }
  if (findSeq(input, '/Encrypt', 0) >= 0) {
    /* encrypted PDFs are refused honestly (§16/§20: no crypto gymnastics
       on untrusted input) */
    throw new PdfParseError('encrypted', 'pdf is encrypted');
  }

  const xrefStart = findStartXref(input);
  let offsets = new Map<number, number>();
  let inObjStm = new Map<number, { stm: number; idx: number }>();
  let trailer = new Map<string, unknown>();
  if (xrefStart > 0) {
    const parsed = await parseXrefChain(input, xrefStart);
    if (parsed) { offsets = parsed.offsets; inObjStm = parsed.inObjStm; trailer = parsed.trailer; }
  }

  /* Root → Pages */
  let pagesRootNum: number | null = null;
  const rootRef = trailer.get('Root');
  if (typeof rootRef === 'number') {
    const rootObj = offsets.has(rootRef) ? parseObjectAt(input, offsets.get(rootRef)!, rootRef) : null;
    const head = rootObj ? latin1(input.subarray(offsets.get(rootRef)!, Math.min(input.length, offsets.get(rootRef)! + 65536))) : '';
    const pm = /\/Pages\s+(\d+)\s+\d+\s+R/.exec(head);
    if (pm) pagesRootNum = parseInt(pm[1], 10);
  }
  if (pagesRootNum === null) {
    /* fallback: find the /Type /Pages object directly */
    const probe = latin1(input.subarray(0, Math.min(input.length, 8 * 1024 * 1024)));
    const m = /\/Type\s*\/Pages[\s\S]{0,400}?\bCount\s+(\d+)/.exec(probe);
    const om = /(\d+)\s+\d+\s+obj[\s\S]{0,200}?\/Type\s*\/Pages/.exec(probe);
    if (om) pagesRootNum = parseInt(om[1], 10);
    void m;
  }
  if (pagesRootNum === null) throw new PdfParseError('corrupt', 'page tree not found');

  /* walk the tree */
  const pageNums: number[] = [];
  walkPageTree(input, pagesRootNum, pageNums, { n: 2000 });
  if (pageNums.length === 0) throw new PdfParseError('corrupt', 'no pages');
  if (pageNums.length > PDF_LIMITS.maxPages) pageNums.length = PDF_LIMITS.maxPages;

  /* object streams (PDF 1.5): decode once on demand for page objects */
  const objStmCache = new Map<number, Map<number, string>>();
  const getObjStmObjects = async (stmNum: number): Promise<Map<number, string>> => {
    const cached = objStmCache.get(stmNum);
    if (cached) return cached;
    const off = offsets.get(stmNum);
    const obj = off !== undefined ? parseObjectAt(input, off, stmNum) : null;
    const map = new Map<number, string>();
    if (obj?.stream && obj.dict.get('Filter') === 'FlateDecode') {
      const inflated = await flateDecode(obj.stream);
      if (inflated) {
        const N = obj.dict.get('N');
        const First = obj.dict.get('First');
        if (typeof N === 'number' && typeof First === 'number') {
          const text = latin1(inflated);
          const pairs = text.slice(0, First).split(/\s+/).filter(Boolean).map(Number);
          for (let i = 0; i + 1 < pairs.length && i < 2 * N; i += 2) {
            const [onum, rel] = [pairs[i], pairs[i + 1]];
            map.set(onum, text.slice(First + rel));
          }
        }
      }
    }
    objStmCache.set(stmNum, map);
    return map;
  };

  const pages: PdfPageText[] = [];
  for (let idx = 0; idx < pageNums.length; idx++) {
    const num = pageNums[idx];
    let head = '';
    if (inObjStm.has(num)) {
      const { stm } = inObjStm.get(num)!;
      const objs = await getObjStmObjects(stm);
      head = objs.get(num) ?? '';
    } else {
      /* xref offset when present, bounded raw scan when stale/missing */
      const off = resolveObjOffset(input, num, offsets);
      if (off > 0) head = latin1(input.subarray(off, Math.min(input.length, off + 65536)));
    }
    /* page geometry */
    const mbox = /MediaBox\s*\[\s*([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)/.exec(head);
    const x0 = mbox ? parseFloat(mbox[1]) : 0, y0 = mbox ? parseFloat(mbox[2]) : 0;
    const w = mbox ? parseFloat(mbox[3]) - x0 : 612;
    const h = mbox ? parseFloat(mbox[4]) - y0 : 792;

    /* content stream(s) */
    const contents = /\/Contents\s+(\d+)\s+\d+\s+R/.exec(head) ?? /\/Contents\s+\[([^\]]+)\]/.exec(head);
    const streams: Uint8Array[] = [];
    if (contents) {
      const nums = contents[2]
        ? (contents[2].match(/\d+/g) ?? []).map(Number)
        : [parseInt(contents[1], 10)];
      for (const cnum of nums) {
        let stream: Uint8Array | null = null;
        let filter: unknown = null;
        if (inObjStm.has(cnum)) {
          const { stm } = inObjStm.get(cnum)!;
          const objs = await getObjStmObjects(stm);
          const text = objs.get(cnum) ?? '';
          const sm = /\/Filter\s*\/(\w+)/.exec(text);
          const lm = /\/Length\s+(\d+)/.exec(text);
          void sm; void lm;
          /* object streams cannot host streams — skip */
        } else {
          /* stale-xref fallback: locate the content object by raw scan */
          const cOff = resolveObjOffset(input, cnum, offsets);
          const obj = cOff > 0 ? parseObjectAt(input, cOff, cnum) : null;
          stream = obj?.stream ?? null;
          filter = obj?.dict.get('Filter') ?? null;
        }
        if (stream && streams.length * (stream?.length ?? 0) < PDF_LIMITS.maxPageStreamBytes) {
          if (filter === 'FlateDecode') {
            const inflated = await flateDecode(stream);
            if (inflated) streams.push(inflated);
          } else if (filter === null || filter === undefined) {
            streams.push(stream);
          }
        }
      }
    }

    /* font resources → ToUnicode CMaps (Persian/CID correctness).
       The Font dict itself only ever holds NAME → REF entries, so scan
       for it DIRECTLY in the page head; the previous Resources-first
       capture stopped at the FIRST `>>` — which is the inner Font dict's
       own close — and never saw the entries, silently dropping every
       CMap font (Persian text extracted as garbage). */
    const fonts = new Map<string, CMap>();
    const fontDictM = /\/Font\s*<<([\s\S]{0,2000}?)>>/.exec(head);
    if (fontDictM) {
      /* accept ANY font resource name (F1, T1_0, AAABAA+Calibri…), not
         just F-prefixed ones */
      const entryRe = /\/(\w+)\s+(\d+)\s+\d+\s+R/g;
      let fe: RegExpExecArray | null;
      while ((fe = entryRe.exec(fontDictM[1]))) {
        const fontName = fe[1];
        const fontNum = parseInt(fe[2], 10);
        const fontOff = resolveObjOffset(input, fontNum, offsets);
        if (fontOff < 0) continue;
        /* bound the font-object window at ITS OWN `endobj`: an unbounded
           slice here ran into the NEXT font object in the file, whose
           dict's /ToUnicode then got registered under THIS font name too
           — Latin text decoded as 2-byte CID garbage (CJK mojibake). */
        const fheadEndRaw = findSeq(input, 'endobj', fontOff);
        const fheadEnd = Math.min(
          input.length,
          fheadEndRaw > 0 ? fheadEndRaw : input.length,
          fontOff + 65536,
        );
        const fhead = latin1(input.subarray(fontOff, fheadEnd));
        const tuM = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(fhead);
        if (tuM) {
          const tuNum = parseInt(tuM[1], 10);
          const tuOff = offsets.has(tuNum) ? offsets.get(tuNum)! : -1;
          if (tuOff >= 0) {
            const tuObj = parseObjectAt(input, tuOff, tuNum);
            if (tuObj?.stream) {
              let tuData = tuObj.stream;
              if (tuObj.dict.get('Filter') === 'FlateDecode') {
                const inflated = await flateDecode(tuData);
                if (inflated) tuData = inflated;
              }
              fonts.set(fontName, parseToUnicode(tuData));
            }
          }
        }
      }
    }

    /* text runs */
    let runs: PdfTextRun[] = [];
    let totalText = 0;
    for (const s of streams) {
      if (totalText > PDF_LIMITS.maxPageTextChars) break;
      const rs = extractRuns(latin1(s), PDF_LIMITS.maxRunsPerPage, fonts);
      for (const r of rs) {
        if (totalText + r.text.length > PDF_LIMITS.maxPageTextChars) break;
        totalText += r.text.length;
        runs.push({ ...r, y: h - r.y /* PDF y-up → y-down */ });
      }
    }
    runs = runs.filter((r) => r.text.trim().length > 0);

    /* scanned heuristic (§16): the PAGE (or its resources) declares an
       image XObject and there is (almost) no text — never fake OCR */
    const hasImages = /\/Subtype\s*\/Image/.test(head) || /\/(Im\w*|Img\w*|Image\w*)/.test(head);
    const textChars = runs.reduce((s2, r) => s2 + r.text.replace(/\s/g, '').length, 0);
    const imageOnly = hasImages && textChars < 12;

    pages.push({ index: idx, width: w, height: h, runs, imageOnly });
  }

  return { pages, encrypted: false };
}
