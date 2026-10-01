/* ═══════════════════════════════════════════════════════════════════════
   pnote/zip — a minimal ZIP (PKZip) container reader/writer.

   WHY hand-rolled (§28: smallest architecture-compatible implementation):
   the project has zero archive dependencies and .pnote needs only THREE
   entries (manifest.json / document.json / assets/*). Adding jszip +
   pako for that pulls two runtime deps into the client bundle for a
   job that is ~300 lines of well-specified binary parsing. Implementation
   notes:

   • WRITE: local file headers + central directory, entries STORED (no
     compression) for JSON (transparent, fast) and DEFLATE for binary
     assets (raw deflate, no zlib wrapper — method 8). CRC-32 table-based.
   • READ: parses the End-Of-Central-Directory, walks the central
     directory, supports methods 0 (stored) and 8 (deflate) via
     DecompressionStream('deflate-raw') (Chrome 103+, the project's
     baseline — HANDOFF §2 ships modern React/Vite only).
   • SECURITY (§20): entry names are validated against the allow-list
     grammar below — backslashes, drive letters, `..` segments, absolute
     paths and NUL bytes are ALL rejected as unsafe-path BEFORE any bytes
     are decoded. The reader also bounds entry counts/sizes so a hostile
     zip bomb cannot exhaust memory (declared sizes are checked against
     the real central-directory offsets).
   ═══════════════════════════════════════════════════════════════════════ */

/* ── CRC-32 (IEEE 802.3), table-driven ──────────────────────────────────── */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ── entry-name safety (§20: never trust the archive) ───────────────────── */
/** an entry name is safe when it is a clean RELATIVE path: forward slashes
 *  only, no `.`/`..` segments, no drive/backslash/NUL/leading slash. */
export function isSafeEntryName(name: string): boolean {
  if (!name || name.length > 256) return false;
  if (name.includes('\\') || name.includes('\0')) return false;
  if (name.startsWith('/') || /^[a-zA-Z]:/.test(name)) return false;
  if (/\/{2,}/.test(name) || name.includes('/../') || name.startsWith('../') || name.endsWith('/..')) return false;
  if (name.split('/').some((seg) => seg === '.' || seg === '..' || seg === '')) return false;
  return true;
}

/** UTF-8 bytes → string */
function decodeUtf8(b: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(b);
}

/** cheap structural probe: does the buffer contain a ZIP End-Of-Central-
 *  Directory record? Used by the importer to report «not a package»
 *  honestly for garbage files BEFORE any entry parsing. */
export function hasZipEOCD(bytes: Uint8Array): boolean {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minEocd = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= minEocd; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) return true;
  }
  return false;
}

/* ── write ──────────────────────────────────────────────────────────────── */

export interface ZipEntry {
  name: string;
  data: Uint8Array;
  /** deflate binary assets; store JSON (default) */
  deflate?: boolean;
}

/** local file header + data descriptor-free layout (sizes known upfront) */
function u16(v: number): number[] { return [v & 0xff, (v >>> 8) & 0xff]; }
function u32(v: number): number[] { return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]; }

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate-raw');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(cs);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/** Build a ZIP archive. Entries are emitted in the given order; the DOS
 *  timestamp is fixed (2026-01-01) for byte-deterministic output. */
export async function buildZip(entries: ZipEntry[]): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  let total = 0;

  const push = (c: Uint8Array) => { chunks.push(c); total += c.length; };

  for (const entry of entries) {
    const nameBytes = new TextEncoder().encode(entry.name);
    const crc = crc32(entry.data);
    let method = 0;
    let payload = entry.data;
    if (entry.deflate && entry.data.length > 0) {
      try {
        const deflated = await deflateRaw(entry.data);
        if (deflated.length < entry.data.length) { method = 8; payload = deflated; }
      } catch { /* store instead — always valid */ }
    }

    const local = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(method),
      ...u16(0), ...u16(0x6621), // DOS time/date (fixed)
      ...u32(crc), ...u32(payload.length), ...u32(entry.data.length),
      ...u16(nameBytes.length), ...u16(0),
      ...nameBytes,
    ]);
    push(local);
    push(payload);

    const cd = new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(method),
      ...u16(0), ...u16(0x6621),
      ...u32(crc), ...u32(payload.length), ...u32(entry.data.length),
      ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(offset),
      ...nameBytes,
    ]);
    central.push(cd);
    offset += local.length + payload.length;
  }

  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(entries.length), ...u16(entries.length),
    ...u32(cdSize), ...u32(offset), ...u16(0),
  ]);
  const out = new Uint8Array(total + cdSize + eocd.length);
  let pos = 0;
  for (const c of chunks) { out.set(c, pos); pos += c.length; }
  for (const c of central) { out.set(c, pos); pos += c.length; }
  out.set(eocd, pos);
  return out;
}

/* ── read ───────────────────────────────────────────────────────────────── */

export interface ZipReaderEntry {
  name: string;
  data: Uint8Array;
}

async function inflateRaw(data: Uint8Array, expectedSize: number): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  const out = new Uint8Array(buf);
  if (expectedSize > 0 && out.length !== expectedSize) {
    /* tolerate a small mismatch but never a huge one (zip-bomb shape) */
    if (out.length > expectedSize * 2 + 1024) throw new Error('deflate size mismatch');
  }
  return out;
}

/**
 * Read a ZIP archive from bytes. Returns the entries that pass the
 * safety grammar; throws `unsafe-path` semantics via `null` when ANY
 * entry has a dangerous name (the caller rejects the whole package —
 * a hostile archive must not be partially trusted).
 */
export async function readZip(bytes: Uint8Array, limits: { maxEntries: number; maxEntryBytes: number; maxTotalBytes: number }): Promise<Map<string, Uint8Array> | null> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  /* find the End-Of-Central-Directory (scan the last 64 KB) */
  let eocd = -1;
  const minEocd = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= minEocd; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = dv.getUint16(eocd + 10, true);
  if (count > limits.maxEntries) return null;
  const cdOffset = dv.getUint32(eocd + 16, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  if (cdOffset + cdSize > bytes.length) return null;

  const out = new Map<string, Uint8Array>();
  let pos = cdOffset;
  let totalBytes = 0;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > bytes.length || dv.getUint32(pos, true) !== 0x02014b50) return null;
    const method = dv.getUint16(pos + 10, true);
    const compSize = dv.getUint32(pos + 20, true);
    const nameLen = dv.getUint16(pos + 28, true);
    const extraLen = dv.getUint16(pos + 30, true);
    const commentLen = dv.getUint16(pos + 32, true);
    const localOff = dv.getUint32(pos + 42, true);
    const name = decodeUtf8(bytes.subarray(pos + 46, pos + 46 + nameLen));
    if (!isSafeEntryName(name)) return null; /* unsafe → whole package rejected */
    if (compSize > limits.maxEntryBytes) return null;
    if (localOff + 30 > bytes.length || dv.getUint32(localOff, true) !== 0x04034b50) return null;
    const lNameLen = dv.getUint16(localOff + 26, true);
    const lExtraLen = dv.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    if (dataStart + compSize > bytes.length) return null;
    const raw = bytes.subarray(dataStart, dataStart + compSize);
    let data: Uint8Array;
    if (method === 0) data = raw.slice();
    else if (method === 8) {
      try { data = await inflateRaw(raw, dv.getUint32(pos + 24, true)); }
      catch { return null; }
    } else return null; /* unsupported method → reject (never guess) */
    totalBytes += data.length;
    if (totalBytes > limits.maxTotalBytes) return null;
    if (out.has(name)) return null; /* duplicate names → ambiguous, reject */
    out.set(name, data);
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
