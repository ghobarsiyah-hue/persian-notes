# HANDOFF — پرشین‌نوت (persian-notes) · Project Brief for the Next AI

> **Purpose.** Everything the next AI needs to work on this codebase *without
> re-discovering it by trial and error*: architecture, data contracts, the
> load-bearing mechanisms, the invariants you must not break, and the current
> known-issues list. If you change a contract, update this file **in the same
> change**.
>
> UI language: **Persian, strict RTL.** Technical terms in code and in this
> document stay English. Code comments follow the existing convention:
> short English rationale for *why*, Persian for user-facing strings.

---

## ۱. What the product is

**پرشین‌نوت** is a production-oriented Persian note-taking / booklet-writing
app for students (medical curriculum origin, but content-agnostic):

- TipTap v2 block editor, **strict RTL**, Vercel-clean design language
- **Real A4 sheets** (multi-page documents) with a Word-like automatic
  pagination engine (currently gated — see §5)
- Educational blocks: definition, exam tip, question, flashcard, comparison,
  timeline, code+output, long answer, …
- **Structured equation editor** — a real math AST in the node, not an image
  and not raw LaTeX text (§8)
- AI assistant with explicit user acceptance (diff-based, never auto-applied)
- Version history, global search, subjects/chapters/tags organization
- Export: Print/PDF as a **1:1 copy of the editor sheets**, plus Word and HTML
- Groups (members, roles, group-owned notes) and per-user settings

---

## ۲. Stack & how to run

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript + Vite 5 + Tailwind 3 + TipTap 2.6 + KaTeX + lucide-react + react-router-dom 6 |
| Backend | Node.js ≥18 + Express 4 + TypeScript (ESM; dev runs with tsx) |
| DB | MongoDB + Mongoose 8; dev fallback auto-launches a **persistent** `mongod` (see below) |
| Auth | JWT (Bearer) + bcryptjs + `tokenVersion` server-side session invalidation |
| Validation | zod on every route, Persian error messages |

- npm workspaces: `client/` and `server/`
- Ports: server **4000**, client dev **5173** (`/api` proxied → 4000). In
  production Express serves `client/dist` itself (SPA fallback BEFORE the api
  404/error handlers — **the middleware order in `server/src/index.ts` must
  not change**).
- Scripts: `npm run dev` (both workspaces via concurrently), `npm run seed`
  (demo user + sample data), `npm run build`, `npm start`, `npm run typecheck`
  (client + server — **must pass before any hand-off**).
- **Non-technical launcher (added 0.9.x+):** `START-WINDOWS.bat` at the repo
  root is the «double-click and it runs» entry: checks Node (opens the
  download page if absent), runs `npm run dev` (predev preflight auto-creates
  `.env`, installs deps, frees the project's stale ports), and spawns
  `scripts/open-when-ready.ps1` which polls the loopback (v6 `::1` FIRST —
  vite on modern Node binds ONLY ::1; a 127.0.0.1-only probe hangs forever
  while the app is up) and opens the browser at :5173. The .bat MUST stay
  UTF-8 **without BOM** + CRLF (chcp 65001 decodes the Persian lines).
  `README-RUN.txt` is the Persian one-liner guide shipped with the zip.
- Demo user: `demo@pernote.local` / `demo1234`
- Env (see `.env.example`): `PORT`, `MONGODB_URI`, `ALLOW_DB_FALLBACK`,
  `MONGO_DEV_PORT`, `MONGO_DEV_BINARY`, `SEED_ON_START`, `JWT_SECRET`,
  `JWT_EXPIRES_IN`, `AI_PROVIDER` (`local`|`openai`), `OPENAI_API_KEY`,
  `OPENAI_BASE_URL`, `OPENAI_MODEL`, `OPENAI_TIMEOUT_MS`.
- **DB fallback is persistent since 0.9.x:** if `MONGODB_URI` is unreachable,
  `server/src/config/db.ts` launches the cached `mongod` binary as a real
  process (dev only; clean shutdown wired in `index.ts`). Data survives
  restarts. The old in-memory fallback is gone — accounts no longer vanish.
  **Since the OneDrive-fassert fix, the data dir lives in the local AppData
  (`%LOCALAPPDATA%\persian-notes\mongo-data`), NOT in the repo** — WiredTiger
  is incompatible with OneDrive/Dropbox file-lock storms and died with random
  `fassert()` crashes when the checkout sat inside OneDrive (six .mdmp dumps
  proved it). The legacy in-repo `server/.mongo-data` is copied to the new
  location once at boot; override with `MONGO_DEV_DBPATH`. mongod stderr is
  now captured so real binary errors surface in the console, and one retry
  absorbs transient boot crashes.
- API keys are server-side only; the browser never sees them.

---

## ۳. Code map (annotated)

```
server/src
  index.ts            boot: connectDB → ensureSeedTemplates → Express → routes → static SPA → error handler
  config/             env.ts (zod-parsed) + db.ts (connect + persistent mongod fallback)
  models/             User, Note, Subject, Tag, Template, Version, Settings, Group, GroupMembership  (all userId-scoped)
  routes/             auth, notes, subjects, tags, templates, versions, ai, search, settings, export, seed, groups
  services/groups/    groupService.ts + permissions.ts (single source of truth for group capabilities)
  collab/             ★ real-time collaboration server (§16): hub.ts (WS upgrade + frame
                        dispatch), sessionStore.ts (seat leases, MAX_ACTIVE_EDITORS=4,
                        atomic acquire), rooms.ts (one Y.Doc per note + seed + persist),
                        roomDoc.ts (room → §4 doc projection), seedJson.ts (TipTap JSON →
                        yjs XML), auth.ts (upgrade auth + resolveCollabAccess), routes.ts
                        (POST /api/collab/preflight), constants.ts (the ONE policy source)
  services/ai/        index.ts (factory) + types.ts + prompts.ts + localProvider.ts + openaiProvider.ts
  middleware/         auth.ts (requireAuth + AuthRequest), error.ts (asyncHandler, ApiError, zod → Persian 400)
  seed/               index.ts (idempotent) + data.ts + builders.ts + run.ts

client/src
  api/                client.ts (fetch wrapper + ApiRequestError + token mgmt), endpoints.ts (authApi, notesApi, groupsApi, …)
  store/              AppProvider.tsx — the ONLY global context (user, subjects, tags, templates,
                      settings, toasts, online) + normalizeSettings() merging server settings with defaults
  pages/              App.tsx routes: /login, / (dashboard), /notes, /favorites, /trash, /recent, /subjects,
                      /templates, /settings, /search, /groups, /groups/:id, /editor/:id (all inside RequireAuth + AppLayout)
                      /editor/new is part of the same route — see §11 noteIdRef
  editor/             ★ the technical core:
    overflowFlow.ts         measurement + split/backflow decisions between sheets
    paginationPolicy.ts     declarative per-node-type break policy REGISTRY
    paginationMode.ts       policy gate — 'manualFixedPage' (current) vs 'smart'
    pageCapacity.ts         the ONLY source of sheet geometry constants (794×1123 + paddings)
    importCapacity.ts       import/table pre-clamping against remaining sheet space
    flowEngineState.ts      singleton flag «engine running»
    editorScope.ts          AI text scopes (selection/paragraph/section/document)
    aiInsert.ts             AI text → structured TipTap nodes
    extensions/             PagedDoc, PageBreak, blocks.ts (edu blocks), EquationNode, SlashCommand,
                            DragHandle, FontSize/FontFamily, Indent, InlineIcon, ListMarker,
                            TableRowResizing, TableEscape, FixedPageGuard
    equations/              ast.ts, engine.ts, parser.ts, renderer.ts, serializer.ts, bridge.ts,
                            structures.ts, symbols.ts
    ribbon/                 ribbonCommands.tsx (main ribbon + tabs), RibbonUI.tsx, FindPanel, SelectionToolbar,
                            AccountChip/AccountPanel/AccountBadge, PageTypePicker usage,
                            contextual/ (smart right-click menu + contextual tabs:
                            text/table/image/link/equation/eduBlock/block contexts)
  components/
    editor/           Page.tsx (one A4 sheet + one TipTap instance; exported buildEditorExtensions is
                      ALSO the static-schema source), PageSidebar (live thumbnails + add-page picker),
                      PageTypePicker, IconPicker + iconAssets, FloatingLayer (canvas objects),
                      RightPanel (AI + metadata), AIDiffModal, EduBlocksModal, VersionsModal,
                      SelectPopover, ColorPalette, BotAvatar (fallback avatars)
    border/           PageBorder.tsx — ornamental SVG frame + page number
                        + the booklet page template (BookletChrome,
                        bookletSvgString — قالب جزوه, see §4b)
    export/           PrintPreviewModal + PreviewBody
    groups/           CreateGroupModal, GroupNotesPanel, GroupMembersPanel, GroupSettingsPanel, GroupAvatar
    layout/           AppLayout.tsx (app sidebar + navbar)
    notes/ , ai/ , ui.tsx (Button/Input/Modal/Toaster/Spinner primitives)
  utils/              pageModelExport.ts (★ page-model export), print.ts, printCss.ts (1:1 mirror of
                      editor CSS for print), wordExport.ts, eduBlocks.ts, fa.ts, recentColors.ts,
                      staticSchema.ts (JSON→HTML without a mounted editor)
  wiki/articles.ts    in-app help articles (Persian) — rendered inside Settings → راهنما
  types/index.ts      shared types (Note, AppSettings, BorderSettings, PageKind, AIActionId, …)
  collab/             ★ real-time collaboration client (group notes only — §16):
                        session.ts (CollabTransport ws + CollabSession yjs doc/seat/presence),
                        useCollabSession.ts (React seam: preflight + session lifecycle),
                        editorSync.ts (adapter: doc observer fan-out, structure publish, seeding)
  pnote/              ★ native file formats (§۶ب): format/zip/assets/exportPnote/
                        importPnote/validate (the .pnote package) + pdf/ (parsePdf,
                        reconstruct, importPdf — best-effort external import);
                        UI: components/editor/ImportFileModal.tsx + EditorPage exportPnoteFile

client/harness/       React-free harness for the pagination engine (Chrome --dump-dom)
scripts/              seed-booklet.mjs, fetch-icons.mjs, qa-*.mjs (regression probes)
```

---

## ۴. ★ Mechanism 1 — Multi-page storage model (the critical data contract)

Breaking this loses user pages. Read it twice.

- **A saved document is one TipTap JSON. Top-level `pageBreak` nodes separate
  the sheets.** (Backward-compatible with the legacy single-sheet format.)
- Sheet visual kind (`PageKind = 'framed' | 'blank' | 'notebook' | 'cover' | 'toc' | 'booklet'`):
  - first sheet: `doc.attrs.pageKind`
  - later sheets: attrs of the `pageBreak` node **before** that sheet
    (`attrs.kind`), plus `attrs.auto === true` when the engine created it
- Why `PagedDoc` exists: the stock TipTap `doc` node has no attributes, so
  `pageKind` was silently stripped on load. The chain is
  `StarterKit.configure({ document: false }) + PagedDoc`.
- `EditorPage` calls `splitDocIntoPages()` on load and `mergePagesIntoDoc()`
  on save. `pageBreak` nodes that ended up INSIDE a sheet's content (already
  consumed by the engine) are dropped during merge — never let a «phantom
  empty page» persist.
- Floating decorative objects (shapes/boxes/sticky/images) are stored in the
  SAME `content` under the `floatingElements` key; `splitContent()` /
  `mergeContent()` move that key in and out (TipTap must never see the
  foreign key itself).
- Each sheet in the UI owns an **independent TipTap instance**
  (`components/editor/Page.tsx`); the page array mirror lives in `EditorPage`
  (`pagesRef`/`pages` state).
- `DocPage`: `id`, `pageNumber`, `content`, `floatingElements`, `kind`,
  `auto`. `auto` pages self-delete when empty; manual pages never.
- **Page ids are STABLE and cross-client (collab invariant, §16):** load
  derives ids deterministically — first page `p1`, later pages the
  `pageBreak` attr `pid` when present else the ordinal `p<N>`;
  `mergePagesIntoDoc` persists the id back on the break as `attrs.pid`.
  Only runtime-created pages get random ids (persisted on next save).
  Server seeding (`collab/rooms.ts`) uses the SAME derivation.

### §4b — Booklet page template (قالب جزوه, kind = 'booklet')

A sixth PageKind implementing a quiet study-booklet frame (fine double
line, top flourish, bottom page-number circle + waveform strokes, right
edge ornament = 007.png rotated 90° — the white tab/box + hatch +
LogoT.png were REMOVED by user request; the ornament is boxless art).
Deliberately NOT a parallel system — every concern rides an
existing source of truth:

- **Rendering:** page chrome only. `buildBookletArt` → pure SVG in the
  sheet's own viewBox (0 0 794 1123), rendered by `BookletChrome` as an
  aria-hidden background layer (same `.page-border` layer as the framed
  sheet), tiled per A4 sheet like PageBorder. Never enters ProseMirror:
  no nodes/text/floating elements, no undo steps, no transactions.
- **Right ornament (007.png):** the real asset
  (`@/assets/brand/007.png?inline`, 740×624), embedded as a data URI
  INSIDE the chrome SVG, fitted into a 46×46 slot and rotated +90° about
  the slot center (face right). Not recolored, not an object, never
  draggable. (The old LogoT tab/box/hatch no longer renders anywhere.)
- **Color:** the SAME `BorderSettings` every template uses (قالب tab →
  the existing picker, `patchBorder` → `saveSettings`). Only the two
  DEFAULT stock values (#1E3A5F/#C5A24D) remap to the booklet's soft
  blueprint blue so a user-chosen color always passes through untouched;
  the second line derives via `blendToward`. No parallel state.
- **Page number:** real page index via `faDigits(pageNumber)` — no
  parallel numbering (editor `Page.tsx`, sidebar thumbnails and
  `pageModelExport` all pass `i+1`).
- **Geometry:** ONE contract — `pageCapacity.BOOKLET_GEOMETRY`
  (frameInset 18 / frameGap 6 / safeAir 10 / rightOrnW 46 / rightOrnGapFrame
  4). `.page-booklet` padding is DERIVED (18+6+10 = 34 base;
  right = 34 + 46 + 4 = 84): the whole ornament slot lives INSIDE the
  reserved right margin, its right edge 4px inside the inner frame line,
  and the text edge stops exactly `safeAir` (10px) left of the slot — text,
  floats and import clamping can never collide with the ornament whatever
  the user types. Mirrors: index.css `.page-booklet` (34/84/34/34),
  `pageModelExport.PAD_OF` (reads BOOKLET_PADDING → mmpx),
  `pageContentBounds('booklet')` via `bookletContentRect()`. Frame lines
  are the hand-drawn wobble (±0.9px) — decorative chrome, not layout.
- **Export:** print/PDF via `bookletSvgString` in `buildPagesHtml`
  (real index per sheet); Word keeps its continuous-document policy
  (borders stripped — intentional). QA: `scripts/qa-booklet-template.mjs`,
  `scripts/qa-booklet-color.mjs`, `scripts/qa-booklet-print.mjs`,
  `scripts/qa-booklet-logo-isolation.mjs`, `scripts/qa-booklet-style-option.mjs`
  (print probe opens the preview via the `pn:open-print-preview` event).
- **Autosave identity (§11):** all save paths read the live note id from
  `noteIdRef` (a ref, not the route param), so the `/editor/new → real-id`
  redirect never leaves a scheduler writing to `/api/notes/new`.

## ۵. ★ Mechanism 2 — Pagination engine (currently gated)

> **Current product mode = ManualFixedPagePolicy.** The gate is
> `client/src/editor/paginationMode.ts` (`CURRENT_PAGINATION_MODE =
> 'manualFixedPage'`): the flow engine is bypassed (`scheduleAutoFlow`
> gated), overflow is **rejected** by the `FixedPageGuard` extension
> (fit-or-reject; a page never becomes read-only), images/shapes are
> scale-to-fit on insert (`pageCapacity.ts`), the table modal pre-clamps
> against remaining capacity, and manual page breaks are converted by the
> host (`consumeManualBreaks`). To re-enable automatic pagination set
> `CURRENT_PAGINATION_MODE = 'smart'` — the engine, the policy table and the
> measurement layer all sit intact under the gate.

Architecture: document model → layout → object-aware fragmentation → A4
viewports. Engine: `overflowFlow.ts`; decisions: `paginationPolicy.ts`.

**Unit of truth:** one sheet is exactly **794×1123 CSS px** (A4 @96dpi).
Pagination never counts characters — only real DOM measurement
(`getBoundingClientRect`, `offsetTop`, `coordsAtPos`).

**Policy registry (paginationPolicy.ts) — declarative per node type:**

| kind | behavior | examples |
|---|---|---|
| `line` | break at rendered line boundaries (binary search on `coordsAtPos`), never mid-word | paragraph, blockquote, formulaBlock |
| `item` | list items move whole; `orderedList` continues numbering via `attrs.start` | bulletList, orderedList, taskList |
| `rows` | table rows move; the **header row repeats** on the continuation | table |
| `container` | edu blocks are FLOW containers: inner content splits by its own rules and the **frame redraws on both pages** | calloutBlock, questionBlock, exampleBlock, keyTermBlock, comparisonTable, timeline, footnoteBlock, longAnswerBlock, highlightBox, referenceBlock, proConBlock, codeOutputBlock, matrixCompareBlock, orderStepsBlock |
| `atomic` | never split — the object moves as a whole | image, equation (display), equationInline, inlineIcon, pageBreak, horizontalRule |

Special rules: widow/orphan control (Word-style, never <2 lines each side);
`keepWithNext` on headings/codeBlock; manual `pageBreak` = hard boundary
that beats every heuristic; **backflow** pulls content up when deleting
(`measureFreeSpace` + `findBackflowSplit`, list numbering re-aligned,
repeated header removed); over-tall atomic objects get `max-height` + a
one-time warning; container frames measure with a bottom inset so a page
holding one huge container cannot deadlock.

**Stability notes:** overflow tolerance 4px; `USER_GESTURE_WINDOW_MS = 3000`
after the user's last interaction during which the engine may move the
active page/caret; during any engine pass the module-singleton
`flowEngineActiveRef.current = true` suppresses autosave/cascading
re-renders (it is a ref, not React state — read it synchronously).
Debug: `window.__layoutDebug = true` (LAYOUT/BLOCK/SPLIT/WIDOW/KEEP channels).

## ۶. ★ Mechanism 3 — Export (Print/PDF/Word/HTML)

Founding principle: **the editor and the PDF share one page model and one
geometry.** Application page N = exactly PDF page N. No print-only option
may ever diverge from the editor.

- `utils/pageModelExport.ts`: each sheet renders as the same HTML inside an
  `@page` 210×297mm box. Unit conversion `mmpx(px) = px × 210/794` — the
  declaration **must use real `mm`** (fake units get dropped by the browser
  and content goes full-bleed). 1123px ≈ 0.5px taller than 297mm; the mm-box
  placement is what kills the trailing blank PDF page.
- Export content = what the user actually styled: ornamental frame
  (`pageBorderSvgString`), notebook ruling, document font settings
  (`fontSize`, `lineHeight`), edu-block styling, and the table design tokens
  (see §9 for `data-tstyle`/`data-striped` mirroring rules).
- The print window loads the same font pack as the editor
  (`public/fonts.css` inlined at build time via `?raw`).
- **Word (`POST /api/export/docx`)**: server-side Word-friendly HTML. Page
  borders are **deliberately removed** (continuous document; Word paginates
  itself) and legacy `pageBreak`s are stripped — intentional (§34/§36), do
  not «fix» it.
- HTML export exists too. `renderMathInHtml = renderEquationsInHtml ∘
  renderFormulasInHtml` — KaTeX formulas first, then structured equations.

## ۶ب. ★ Mechanism 9 — Native `.pnote` package + normal-PDF import

Two ADDITIVE file features with completely separate pipelines — never merge
them (they share nothing but the §4 target shape):

```
NATIVE (lossless):      §4 document → exportPnote → .pnote (ZIP) → importPnote → §4 document
EXTERNAL (best effort): PDF bytes → parsePdfText → reconstruct  → §4 document
```

### .pnote — the native, lossless, editable format (Part A)

- `client/src/pnote/`:
  - `format.ts` — the package contract: `format:'persian-notes'`,
    `formatVersion:1`, limits (128MB package / 32MB document.json / 512
    assets / 16MB per asset), `PnoteError` codes + the Persian user
    messages (`pnoteUserMessage`).
  - `zip.ts` — hand-rolled ZIP reader/writer (STORED + DEFLATE-raw via
    `CompressionStream`/`DecompressionStream`; zero deps). Entry-name
    grammar `isSafeEntryName` rejects `..`, absolute, backslash and drive
    paths; `hasZipEOCD` pre-gates garbage files to a clean
    «not-a-package».
  - `assets.ts` — data-URL ⇄ `pnote-asset:<id>` swap (no filesystem or
    blob URLs ever serialized).
  - `exportPnote.ts` — validate ONCE with the §4 validator, extract assets
    once, build the ZIP once (§23 performance budget).
  - `importPnote.ts` — strict manifest gate; FUTURE formatVersions are
    rejected (`unsupported-version`), never silently reinterpreted (§3);
    missing asset entries reject the whole import (`missing-asset`).
  - `validate.ts` — `pnoteValidateDocument`: the client twin of the §4
    validator autosave/collab already use; the import boundary gate (§21).
- Package layout: `manifest.json` (`{format, formatVersion, createdAt,
  app, documentId — a RANDOM portable id, NOT the Mongo _id, title,
  assets:[{id, file, bytes}]}`) + `document.json` (the §4 content object
  VERBATIM — pageBreak/pid/kind/auto pages, headings, marks, alignment,
  lists, tables + design tokens, equation ASTs, edu-block attrs,
  floatingElements with geometry, noteDesign) + `assets/<id>.<ext>`.
- Privacy (§22): the payload is built ONLY from the §4 content object —
  passwords/tokens/JWT/collab session ids/user ids cannot be inside
  (pinned by test).
- UI: ribbon «خروجی Persian Notes (.pnote)» (EditorPage `exportPnoteFile`);
  «وارد کردن فایل» → `components/editor/ImportFileModal.tsx` (ONE modal,
  two pipelines; import into a NEW note or with EXPLICIT replace
  confirmation). The apply path commits through the EXISTING pipelines
  (`notesApi.create`, or `setPages` + collab `structureCreatePage`/
  `seedPageFragmentFromJson`/`opUpsertFloat`/`commitFloats`) — the binary
  package NEVER travels through yjs (§8).
- BUGFIX («۲ صفحه خروجی گرفتم، صفحهٔ اول خالی ایمپورت شد»): applyImport must
  assign FRESH page ids (`imp-<ts>-<rand>`) to the imported pages, never the
  package's ids. EditorPage mounts per ROUTE (App.tsx) and Page builds its
  TipTap editor ONCE from mount-time content keyed by `page.id` — and every
  note's first page id is `p1`, so an imported `p1` collided with the
  previous note's still-mounted p1 editor: the imported content WAS in
  React state but the live editor kept rendering the old document (page 1
  blank; page 2 remounted because its key differed). Room replace path:
  create the fresh-id chain FIRST, then `structureDeletePage` the old ids
  LAST (creation anchors reference the previous page; stale editors lose
  their old fragment to the room's own delete). SECOND LAYER (covers the
  default «ایجاد جزوهٔ جدید» path AND the latent /editor/new → real-id
  switch): Page keys are NOTE-SCOPED (`key={${id}:${page.id}}`) — page ids
  alone are not unique across notes, and EditorPage persists across
  /editor/:id navigations, so the previous note's mounted p1 editor could
  render over ANY newly loaded/created note. ID CONTRACT: mergePages
  writes no pid for page 1 and split re-normalizes it to `p1` on the next
  load — safe, because that load mounts fresh editors. Probe:
  `client/scripts/pnote-roundtrip.mjs` (export→import→split + id contract).

### Normal-PDF import — best-effort EXTERNAL format (Part B)

- `client/src/pnote/pdf/`:
  - `parsePdf.ts` — hand-rolled, dependency-free extractor: xref chain +
    ObjStm, FlateDecode, the text operators (BT/ET/Tf/Td/TD/Tm/T*/Tj/TJ…),
    ToUnicode CMaps with DERIVED code width (2-byte Identity-H CID pairing
    vs 1-byte WinAnsi — pairing blindly corrupts one of them), font-object
    windows bounded at their own `endobj` (a window bleeding into the next
    font's `/ToUnicode` once mis-decoded Latin as CJK). STALE-XREF FALLBACK:
    every object lookup goes through `resolveObjOffset` — the xref offset is
    VERIFIED to point at `N G obj` (incremental updates leave stale entries)
    and falls back to a bounded raw scan (`findObjOffset`), so hand-patched
    PDFs still extract. CMap-LESS hex strings (CID fonts without /ToUnicode)
    get a byte-shape heuristic (`tryTwoByteHex`: even bytes ≤ 0x10, no NUL
    low bytes → decode as big-endian 2-byte codes) so Persian text lands
    even when the CMap is missing. Per-page content
    assembly → EXACT page boundaries. Limits 100MB/1000 pages; encrypted
    → honest refusal; embedded PDF JS ignored; image-only pages flag
    `imageOnly:true` — NEVER fake OCR (§16).
  - `reconstruct.ts` — runs→lines→paragraphs; headings by size vs the
    modal body size; paragraph split by the page's OWN median leading (a
    fixed pt threshold mis-split normal 15pt-leading text); bullet/ordered
    list merging (ONE list node, not one per line); a mid-block DIRECTION
    flip is a hard block boundary (merging would erase the Persian line's
    rtl); per-line `rtlShare ≥ 0.34` → `dir:'rtl'` (existing RTL
    architecture, no global direction hacks).
  - `importPdf.ts` — entry point + Persian messages; scanned/no-text →
    the clear Persian scanned-PDF error; partial extraction keeps what
    succeeded and reports `partial:true` (§17).
- One PDF page → one Persian Notes page via the EXISTING pageBreak merge
  (no second page system); the merged doc passes `pnoteValidateDocument`
  before commit; empty (scanned) pages keep their boundary as an empty
  page.

### Tests & harness rules

- `server/src/test/pnote.test.mts` (23 tests): complex-doc round-trip
  (page ids p1–p4/kinds/auto, marks, alignment, lists, tables + design
  tokens, equation AST deep-equal, edu-block attrs, floats geometry,
  PNG asset byte-identical, RTL/mixed), integrability via the shared
  validator + `splitDocIntoPages`, corrupt/truncated/future-version/
  path-traversal/bad-manifest/missing-asset rejections, privacy scan.
- `server/src/test/pdfimport.test.mts` (16 tests): fixtures are BUILT
  in-test (uncompressed content streams + a real 2-byte-CID ToUnicode
  CMap): 3-page boundaries, paragraph/heading reconstruction, Persian CID
  extraction + RTL, list merging, scanned detection, corrupt rejection,
  partial import, §4-shape editability/export-readiness.
- `scripts/qa-pnote.test.mts` (32 client-side tests, `npx tsx --test`
  with `TSX_TSCONFIG_PATH=client/tsconfig.json`): the SAME matrix as the
  server suites, driving the CLIENT pipelines directly — pnote round-trip
  against the §4 page projection (`splitDocIntoPages`), security matrix,
  PDF import against REAL flate fixtures, docPages parity. FIXTURE RULE:
  pdf fixtures are built latin1, so a literal `•` (U+2022) cannot appear
  in a content stream — use `·` (U+00B7, matched by BULLET_RE) or octal
  escapes.
- TEST-HARNESS RULE: these suites import client modules at RUNTIME via
  the `clientModule()` URL helper (tsx resolves it). NEVER write
  `typeof import('../../../client/…')` in them — a type-position client
  path drags the file under the server project's `rootDir` (TS6059).
  Use inline structural casts (the collab.test.mts pattern).
- Run: `cd server && npx tsx --test --test-timeout=60000
  src/test/pnote.test.mts src/test/pdfimport.test.mts`.
- ZERO new dependencies for both features (ZIP and PDF parsing are
  hand-rolled on standard streams).

## ۷. ★ Mechanism 4 — AI system

Product rule: **no fake AI.** Actions the current provider cannot perform are
honestly disabled (`GET /api/ai/status` → per-action `available`).

- **11 actions** (`server/src/services/ai/types.ts`): proofread,
  professionalize, summarize, simplify, key_points, exam_points, questions,
  flashcards, table, continue, structure.
- Provider interface with two implementations:
  - `localProvider.ts`: rule-based offline Persian proofreading (Arabic
    ی/ک → Persian, half-space می/نمی + suffixes, punctuation spacing,
    colloquial verbs via a conservative dictionary, year numerals). Only
    `proofread`.
  - `openaiProvider.ts`: any OpenAI-compatible API; Persian system prompt in
    `prompts.ts` with hard rules (no invented facts, keep Latin terms and
    formulas, correct half-space, final text only, academic tone) + per-action
    prompt + document context (subject/chapter/section).
- `POST /api/ai/run` (zod: action, text ≤20000, scope, instruction ≤500,
  noteId) → with noteId the server pulls title/subject/chapter from DB for
  context and takes an **automatic version snapshot** (`maybeCreateVersion`)
  before the transform.
- Scopes (`editorScope.ts`): selection / paragraph / section (previous
  heading → next heading) / document — each with a `range` for replacement.
- Acceptance: output is never applied directly; `AIDiffModal` shows a diff
  and applies on explicit accept. `aiInsert.ts` converts text to structured
  nodes: `پرسش ::: پاسخ` → keyTermBlock (flashcard), `س:/ج:` → questionBlock,
  Markdown table → real table, `#/##` → headings, `-` → list.

## ۸. ★ Mechanism 5 — Structured equations

A full formula editor, independent of input/output LaTeX:

- TipTap nodes `equation` (display) and `equationInline` — the node state
  **is the math AST**, serialized as JSON in attrs (saved with the doc;
  never flattened to text/image).
- `equations/ast.ts` owns the path model: path list `[i₀,'c'|'p'|'r',…]` +
  caret `{path, offset}`; the contract is documented in `engine.ts` and
  `ast.ts` is its single source of truth.
- `engine.ts` is the mutation layer: every edit is a splice in the path
  list; the equation never serializes to edit. Structures: fraction,
  power/index, big operators, matrix, cases, …
- Undo/redo stays in the ONE TipTap history: the NodeView snapshots before
  each discrete operation and dispatches the whole new AST as one
  transaction.
- Interaction: click → exact math caret; typing → real AST nodes; `^ _ /`
  build structures; Tab walks placeholders; backspace at slot start dissolves
  the structure; copy = LaTeX to clipboard; paste LaTeX → parse
  (`parser.ts`).
- Rendering: `renderer.ts` produces professional KaTeX; while the caret is
  inside, the node registers as the active equation (bridge) and the
  contextual Equation tab appears.
- Pagination: display equation atomic; inline equation participates in line
  layout but is itself atomic.

## ۹. ★ Mechanism 6 — Editor surfaces, edu blocks, tables, floating layer

- `extensions/blocks.ts` (~980 lines): all edu blocks are NodeViews with
  **editable title/question/term spans** persisted via `setNodeMarkup`
  (nothing evaporates on re-render) plus a matching static `renderHTML` for
  print/Word. Per-block customization attrs
  `styleBg / styleBorder / styleBorderWidth(-1=family,0=none) /
  styleBorderStyle / styleRadius / styleTitle` flow identically through the
  NodeView and the static renderer. `normalizeLegacyStyleAttrs` migrates
  old `0` values to `-1` (inherit). Global block styling:
  `utils/eduBlocks.ts` (`minimal` | `tinted` | full object) persisted in
  `Settings.editor.eduBlocks` (Mixed — the client owns the shape).
- **NEW edu blocks (user request: «کادرای آموزشی با ویژگی عای بیشتر…
  مثلا مقایسه بین چندتا چیز»):**
  - `matrixCompareBlock` (مقایسهٔ چندگانه) — N columns (چیزها, 2..4,
    Enter in a column header appends) × rows (ویژگی‌ها, up to 12, the
    «+ افزودن ویژگی» button appends). Column/row labels + every cell live
    in ATTRS (`colLabels` / `rowLabels` / `cells` row-major) — persist +
    export for free, same pattern as proCon/MCQ options. Free text under
    the matrix is the real PM contentDOM. Static renderHTML mirrors the
    table for print/Word.
  - `orderStepsBlock` (مراحل به‌ترتیب) — numbered step lines in `steps`
    attrs (Enter inserts a step below the caret, ≤10); PM contentDOM below.
  - Both wired EVERYWHERE the edu family is registered: Page.tsx (BOTH
    extension lists — live editor + static schema), BlockEnter BOX_NODES,
    paginationPolicy (CONTAINER → flow-engine splits them), documentProbe,
    eduBlock contextual tab (convert/type picker + TITLE_ATTR),
    eduBlockStyleModalHost (STYLEABLE + TITLE_ATTR → شخصی‌سازی کادر
    applies), listCommands EDU_BOX_RE (list seam skips them),
    contextMenuItems (درج menu + right-click case), SlashCommand, and
    `index.css` (`.edu-matrix` / `.edu-steps` families + tinted variants).
  - TITLE CONTRACT pinned by probe: the SAME editableTitleView serves the
    whole family — typing into any block's title persists via
    setNodeMarkup, the caret never escapes (MutationObserver + caret
    restore), Enter exits below the block, Backspace in an empty title
    never eats the block. Probe:
    `cd client && npx tsx scripts/edu-title-behavior.mjs` (real TipTap +
    real NodeViews in jsdom; also covers matrix cells/labels and steps).
    PROBE INFRA: iconAssets.ts uses Vite `import.meta.glob` — the probe
    loads `edu-title-behavior.mjs.loader.mjs` FIRST, a node loader hook
    serving an iconAssets STUB, and stubs jsdom layout
    (getClientRects/getComputedStyle/scrollBy) BEFORE importing blocks.ts.
- **Ribbon** (`editor/ribbon/`): main tabs (خانه / افزودن / طراحی / مراجع /
  بازبینی / فایل) + contextual tabs from the resolved selection. Rule: every
  button runs an existing TipTap command or an existing page callback —
  **fake buttons are forbidden**. نقل‌قول lives in خانه (removed from مراجع
  as a duplicate). Page-break button was removed from افزودن.
- **Tables — design attrs and the nodeView bridge:** table design tokens
  (`data-tstyle`, `data-striped`, `data-borderless`, `data-align`,
  `data-cellpad`, `width`) live as TipTap attrs on the `table` node and are
  serialized by `renderHTML` (so HTML/save/export always carry them). The
  LIVE editor DOM however is rendered by a TableView nodeView which ignores
  `renderHTML` — `Page.tsx` therefore wraps TableView in a nodeView whose
  `sync()` writes those attrs onto the `<table>` element, and `update()`
  calls `tv.update(n)` **then** `sync(n)` (prosemirror-tables rewrites
  table.style on update; design attrs must win, and the width style must be
  re-applied after it so the resize grip doesn't bounce). CSS for the
  tokens exists in `index.css` AND `printCss.ts` (kept 1:1); the Word
  exporter bakes them inline. **Every new table token must be added in all
  three places** (Page.tsx attrs + index.css + printCss.ts [ + wordExport if
  bakeable]). `tr:nth-of-type` (not nth-child) is used for striping because
  `<colgroup>` is an element child that shifts nth-child.
  Table presets («قالب آماده») and per-design toggles dispatch via
  `setTableAttrs` in `contextual/contexts/table.tsx`, which patches the
  ancestor table node with `tr.setNodeMarkup` directly (TipTap's
  `updateAttributes` is a no-op for collapsed caret selections inside
  cells).
- **ListMarker extension:** `bulletList`/`orderedList` carry a `marker`
  attr (serialized `data-marker`) selecting the glyph per list
  (disc/circle/square/diamond/dash/none; decimal/fa/paren/alpha/roman/none).
  Custom glyphs render via CSS counters in `index.css` + `printCss.ts`
  (1:1). Change/remove after creation from the فهرست section of the ribbon
  or the right-click تنظیمات پاراگراف.
- **List-vs-box seam (listCommands.toggleListAroundBoxes):** ALL list
  gestures (نقطه‌ای/شماره‌دار/چک‌لیست — ribbon, right-click تنظیمات
  پاراگراف, ویرایش دسته‌ای) go through `listCommands.ts`, which runs the
  stock toggle PER TOP-LEVEL BLOCK and SKIPS edu boxes (کادر آموزشی/سوال)
  entirely — a selection spanning plain lines AND a box used to wrap the
  WHOLE BOX as one giant list item (the box glued under a bullet, title
  swallowed: «متن‌های عادی بزور مینداخت تو باکس»). A selection fully
  inside ONE box still lists the box's own paragraphs (stock; desired).
  Probe: `cd client && npx tsx scripts/list-seam-behavior.mjs`.
- **Flow-engine list-in-box split (overflowFlow.tryContainerSplit):** a
  box whose FIRST inner child is a list now splits at ITEM boundaries (the
  continuation opens a NEW frame marked `pnFlowCont:true` carrying the
  rest); before this, the split gave up (`null` → whole-box move → a lone
  overfull box could never flow → every edit on the full page started
  jumping). The marker is also stamped by the generic container split and
  read by `tryBackflowContinuation` (children re-join the PREVIOUS page's
  frame via the marker-tolerant sameJSON; attrs-twin fragment frames,
  never user content). The `second-block` overflow fallback keeps a
  leading container's frame on the page (`policyFor(...).break ===
  'container'` → cutIndex 1) so the frame alone can never pin the page
  overfull (isOverflowing true forever → the fallback re-fired and
  cascade-evacuated the whole box).
- **InlineIcon:** SVG icons from the picker insert as an inline atomic node
  (`img[data-inline-icon]`), flowing like a character and scaling with
  `em`. After insert the caret is parked AFTER the node (TextSelection) —
  typing continues the sentence instead of replacing the icon. Brand SVGs
  keep their official color when the palette is on the stock black.
- **Right-click menu** (`contextual/`): ONE menu per context (text ±
  selection, image, table, floating object, equation, empty page area).
  Build is pure data (`contextMenuItems.tsx`); the horizontal quick-format
  card (SelectionToolbar) renders ABOVE the vertical menu as one unit.
  Dropdown panels (`SelectPopover`, `ColorPalette`) portal to `document.body`
  with `data-select-popover` / `data-color-palette`; while a ctx-menu
  toolbar is on screen a `body:has(.pn-ctxmenu-toolbar)` CSS rule lifts those
  panels above the menu card (z-index 10000) — that is what keeps the
  font/size dropdowns visible over the menu.
- **FloatingLayer:** canvas objects (rect, roundedRect, ellipse, circle,
  diamond, arrow, callout, sticky, image) with drag/resize/rotate and
  inline text editing on shapes; stored per page under `floatingElements`.
  Cursors are semantic: visible body `move`, invisible body `grab`,
  active drag `grabbing`, handles `*-resize`, rotate handle `grab/grabbing`,
  text surface `text`.
- **Editor left/right surfaces (item ۹):** the editor has ONE side column —
  `PageSidebar` — which carries two quiet tabs in its header (صفحات /
  دستیار) via the optional `aiOpen`/`onTabChange`/`aiSlot` props. When the
  دستیار tab is active the host renders `RightPanel embedded` INSIDE that
  same column (`aiSlot`) and the thumbnails/footer stay hidden. There is no
  second aside anymore — the Ribbon's AI button only switches this tab.
  The print/PDF preview deliberately remains a CENTERED MODAL (a previous
  dock-panel experiment was reverted on user request) — do not re-merge it
  with the AI surface without an explicit ask.
- **Toasts (item ۱۱):** flat solid surfaces + one status dot per kind.
  No glass/blur/gradients on notifications (the old glass toast read as
  «AI vibe»); the app's glass recipe is for editor chrome only.
- **AccountChip / AccountPanel:** the avatar chip beside the فایل menu opens
  a popover (portal via `RibbonUI` `usePanelGeometry`) with identity header,
  status facts and actions (profile, settings, help, logout). The fallback
  avatar honors `settings.avatarPreset` (see §10).
- Keyboard: Ctrl+S/Z/Shift+Z/B/I/U/K, Ctrl+Shift+A (AI panel), Ctrl+F/H
  (find/replace), Ctrl+/ (shortcuts).

## ۱۰. Backend — data model, settings and API

**Every model is userId-scoped; every query must filter by `userId`.**

- `Note`: title, subjectId, chapter, section, `content` (TipTap JSON —
  Mixed), `html` (refreshed on save; used by export/preview/thumbnails),
  `plainText`, `tags[]`, `favorite`, `trashed/trashedAt`, `wordCount`,
  `groupId` (nullable — group-owned note, §10b), `metadata` (includes
  `metadata.seed` marker and pageEstimate). Text indexes on title/plainText.
- `Subject`: name/color/parentId (subject → chapter hierarchy). `Tag`,
  `Template` (built-ins seeded idempotently with `key`).
- `Version`: per-note snapshots, **max 50 per note**, auto-created only if
  ≥10 min since the previous AND content/title changed
  (`maybeCreateVersion`); a restore always backs up the current state first.
- `Settings` (per-user doc): `theme`, `editor{fontSize,lineHeight,
  fontFamily,eduBlocks}`, `export{...}`, `ai{autoVersionBeforeAI}`,
  `border{...}`, `notifications{position,prefs{…}}` and `avatarPreset`
  (string, default `'auto'` — see below). The client's
  `normalizeSettings()` merges server state with `DEFAULT_SETTINGS` so old
  docs load clean; `saveSettings()` PUTs partial patches.
- **Fallback avatars (BotAvatar):** users without an uploaded picture get an
  abstract, genderless robot avatar. 7 distinct profiles (palette + face
  geometry) + `auto` = legacy name-hash pick. The chosen id persists in
  `Settings.avatarPreset` (regex-validated server-side); `BotAvatar`
  components read it wherever they render (AccountChip, AccountPanel,
  Settings).
- **Groups (§10b):** `Group` (name/description/avatar/owner) +
  `GroupMembership` (role: owner|admin|member, status: active…).
  Capabilities live ONLY in `server/src/services/groups/permissions.ts`
  (`group.view`, `group.editAnyNote`, `group.createNote`, …). Group notes
  are normal `Note`s with `groupId`: any active member reads (`group.view`),
  the creator or `group.editAnyNote` holders edit; personal notes remain
  owner-only. Routes: `GET/POST /groups/:id/notes` plus the normal note
  GET/PATCH/DELETE accepting group notes; optimistic concurrency via
  `baseRevision` (mismatch → 409 with server revision).
- Auth: register/login/logout/me. `User.tokenVersion` bumps on logout and
  password change → older JWTs die server-side. Password change invalidates
  other sessions but returns a fresh token for the current session.
- **User ID (آیدی):** `User.username` — an optional public handle
  (latin/digits/_/- , 3–24 chars, unique when present). NOT a login
  credential (login stays email-based). Uniqueness is a **PARTIAL unique
  index** (`partialFilterExpression: username {$type:'string'}`), NOT
  `sparse: true` — a sparse index still indexes explicit `null`s, so the
  second registered user's `username: null` hit E11000 and broke every
  later registration (see §15). `db.ts migrateUserIndexes()` drops the
  legacy sparse index and `syncIndexes()` on boot (idempotent). Set at signup (optional field), changeable via
  `PUT /auth/me` (`username: string | null` — uniqueness checked server-side
  with `_id: { $ne: me }`), returned in every `publicUser`. UI: signup form
  (آیدی اختیاری), Settings → account tab (آیدی کاربر + @handle line),
  AccountPanel identity header shows `@username` when set (else email).
- All routes `requireAuth` + zod; Persian error messages; `asyncHandler` +
  `ApiError` + central `errorHandler` (must stay LAST middleware).
- REST map: `/api/auth/{register,login,logout,me}` + `PUT /me`,
  `/api/notes` (CRUD + `?trashed|subjectId|favorite|tagId` + `/:id/clone`),
  `/api/subjects|tags|templates`, `/api/versions/note/:id` + `/:id/restore`,
  `/api/ai/{status,run}`, `/api/search`, `/api/settings` (GET/PUT),
  `/api/export/docx`, `/api/groups` (+ `/:id/{members,notes,settings}`),
  `/api/seed` (always flags `metadata.seed`; never mixes with real data),
  `/api/health`.

## ۱۱. Critical UX behaviors

- **Autosave:** debounced, with an explicit state machine
  (`SaveState`: idle/dirty/saving/saved/offline/failed) shown in the UI.
  Offline edits queue in localStorage (`pn_pending_<uid>` keyed pending
  store) and flush on reconnect. **All write paths resolve the note id
  through `noteIdRef`** — after `/editor/new` creates the note and the URL
  replaces to the real id, the same component instance keeps running and a
  stale `'new'` id would send PATCHes to `/api/notes/new` → Mongo CastError
  → «شناسه وارد شده نامعتبر است». This was a real bug; do not regress it.
- **Typing hot path:** `Page.onUpdate` emits ONE doc JSON per changed page;
  HTML/plainText derive from live editors only when a save/export actually
  fires (`plainTextOf`, `buildFullHtml`). `save()` has stable identity
  (values from refs) and is single-flight (concurrent PUTs debounce onto the
  next save). Floating elements save via `floatingElementsByPage`.
- **FixedPageGuard fast path:** allows only bounded text-like growth
  (`isBoundedTextLikeGrowth`) with real headroom >2 lines; atoms and
  non-empty blocks always go through the scratch-measure path. Measurement
  trust floor: docs ≤300 content.size → 40px, larger → 200px.
- **DragHandle (six-dot artifact fix):** the ⋮⋮ handle must NEVER be
  appended inside ProseMirror content (a MutationObserver would read it as
  user input and inject literal «⋮⋮» into the undoable document). It lives
  in an overlay sibling to `.ProseMirror`: hover from window-mousemove,
  grab listeners attached lazily on the handle itself, 4px drag threshold
  (touch tap cancels, never dispatches). Positions computed at doc-level
  block boundaries (`posAtDOM` + `resolve().before(1)/after(1)`;
  `posAtCoords` lands at paragraph END in RTL). Probe:
  `scripts/qa-six-dot-artifact.mjs`.
- **Add-page picker positioning:** the sidebar's + button anchors the
  PageTypePicker through `PageTypePickerFloating`, which measures the real
  panel height after mount and lifts it only the few pixels needed to stay
  in the viewport (no guessed offsets, no big flip).
- **Offline/errors:** centralized `ApiRequestError`; 401 → auto-logout via
  `setUnauthorizedHandler`.
- Sample data (physiology/biology/biochemistry) is creatable/deletable from
  Settings and never mixes with user notes.

## ۱۲. Design system (RTL + Vercel-clean)

Reference: `client/src/docs/vercel-design.md`. Summary:

- Near-white background `#ffffff`, text `ink-900`; monochrome `ink-50…950`
  ramp in `tailwind.config.ts`.
- **Shadow-as-border philosophy:** use layered box-shadows instead of CSS
  borders: `shadow-ring` (default edge), `shadow-card`, `shadow-popover`,
  `focus-visible:shadow-focus`. New UI must use these tokens.
- Accents: `develop #0a72ef`, `preview #de1d8d`, `ship #ff5b4f`
  (destructive) + petrol brand accent.
- Font stack `['Sahel','Geist','Tahoma','Segoe UI','sans-serif']`; RTL
  always; negative tracking on headings; darkMode `'class'`.
- Glass surfaces share ONE recipe: `.pn-glass-panel` (low alpha + heavy
  backdrop blur). Floating editor chrome (ctx menu, popovers, sidebar)
  derives from it (`pn-ctxmenu*` classes in `index.css`).
- UI philosophy: MORE INFORMATION, LESS VISIBLE UI — no decorative cards,
  no gradient/glass showpieces, icons over text where possible.
- Logos: `LogoW.png` (white bg), `LogoB.png` (black bg), `LogoT.png`
  (transparent) in `client/src/assets/brand/` — pick by backing surface.

## ۱۳. Invariant list — check before every PR

0. **Collaboration (§16) must never fork the foundations:** one Note model,
   one autosave engine, one SaveState machine; personal notes never open a
   transport; page ids stay stable across clients (§4); seat cap =
   `MAX_ACTIVE_EDITORS` from `collab/constants.ts` (never inline 4s).
1. **Multi-page storage format** (§4): pageBreak separators + pageKind
   attrs + floatingElements key. Backward compatibility with old docs is
   mandatory.
2. Sheet = 794×1123px; pagination only via real DOM measurement, never
   character counts or magic constants.
3. Editor = PDF (page-model export, mmpx units); Word = continuous
   document (page borders stripped).
4. **AI never modifies content without explicit user acceptance**; an
   unavailable action is never faked.
5. While the flow engine runs, `flowEngineActiveRef` is set; any new
   `onUpdate` logic must respect it.
6. Every new model/route: userId-scoped + zod + Persian error messages.
7. UI always RTL; UI strings Persian; technical identifiers English.
8. Middleware order in `server/src/index.ts` (static/SPA → api 404 →
   errorHandler) must not change.
9. New pagination policies enter ONLY via the `REGISTRY` table in
   `paginationPolicy.ts`; in `manualFixedPage` mode the allow/reject verdict
   comes only from `paginationMode.ts`.
10. After changes: `npm run typecheck` (client + server) must pass;
    build: `npm run build` in client; pagination probes live in
    `client/harness/` and `scripts/`.
11. In `manualFixedPage`: no code path may make a page read-only
    (setEditable(false)/pointer-events forbidden), no transaction may be
    rejected except overflow, page creation is manual-only.
12. Sheet geometry (794×1123 + per-kind paddings) is read only from
    `pageCapacity.ts` or CSS — new magic numbers elsewhere are forbidden.
13. **Note ids in write paths flow through `noteIdRef`** — never capture
    the route param `'new'` in a long-lived callback/scheduler.
14. **Table design tokens need all three mirrors** (TipTap attrs + index.css
    + printCss.ts [+ wordExport bake]); the live-DOM bridge is the nodeView
    `sync()` in Page.tsx and must run AFTER `tv.update()`.
15. Group capability checks live only in
    `server/src/services/groups/permissions.ts`; route handlers must not
    re-implement role logic ad hoc.

## ۱۴. Known debts & environment notes

- `.env` is not committed (template: `.env.example`).
- Dev DB fallback requires the first `npm install` to have fetched the
  mongod binary (cached under `~/.cache/mongodb-binaries`); override with
  `MONGO_DEV_BINARY`. Data dir: local AppData `%LOCALAPPDATA%\persian-notes\mongo-data`
  (out of sync folders on purpose — OneDrive + WiredTiger = fassert crashes);
  override with `MONGO_DEV_DBPATH`.
- QA logs/screenshots (`*.log`, `qa-*.png`, `pn_note_tmp*.json`, `_t_*`) are
  dev-environment temporaries, not product files.
- The project lives in a local checkout without accessible git metadata in
  this environment — coordinate version control with the user.
- A release bundle recipe exists: copy `server/dist` + `client/dist` +
  prod `package.json` into a versioned folder (see the 0.9.0 packaging done
  previously); server serves the SPA and needs only `npm install --omit=dev`
  + `npm start`.

## ۱۵. Recent verified fixes (context for «why is it written this way»)

- Registration breaking after the first user: `username` declared
  `unique + sparse + default: null`. A sparse index still indexes explicit
  `null`s, so the SECOND registration hit E11000 on `username_1` (the
  friendly 409 «قبلاً استفاده شده است» mapped the wrong-key violation onto
  registration) — the groups suite exposed it once email normalization
  made its multi-register helper reach the guard. Fixed with a partial
  unique index (`$type:'string'` filter) + boot-time drop of the legacy
  sparse index (`db.ts migrateUserIndexes`, §10).
- Save bug «شناسه وارد شده نامعتبر است»: `/editor/new` → created note → URL
  replaced → same component instance; scheduler kept `noteId:'new'`.
  Fixed via `noteIdRef` threading through scheduler/send/save/patch/trash/
  clone/AI paths (§11).
- Sessions «منقضی شد» + login failures after restarts: in-memory DB fallback
  wiped users on every restart. Replaced by a persistent dev `mongod`
  (§2).
- Right-click quick-format dropdowns rendering UNDER the menu: popovers
  portal to body, so the old descendant z-index rule never matched; fixed
  with `body:has(.pn-ctxmenu-toolbar)` lift (§9).
- Icon insert replaced by the next keystroke: TipTap left a NodeSelection on
  the atomic inline node; caret is now parked after it (§9).
- Table striping appearing only in exports: design attrs were serialized
  but the live TableView DOM lacked them; fixed by the nodeView sync bridge
  with post-update ordering (§9, §13-14).
- Table cell LINES vanishing in the final PDF (reported 3×): the print
  replica reused the SCREEN border color `rgba(0,0,0,0.08)`; the print
  pipeline drops sub-pixel translucent hairlines (worse with
  `border-collapse` + `overflow:hidden` clipping), so the grid disappeared
  while backgrounds/text survived. Fixed by (a) solid print-safe cell
  borders `1px solid #d4d4d8` in `printCss.ts` (same visual weight, opaque),
  (b) `overflow:hidden` removed from the print table rule, (c)
  `print-color-adjust: exact` hoisted to `html/body` as well. Design-attr
  backgrounds (navy/striped) were already solid and only needed (c).
  Keep print hairlines SOLID — never reintroduce alpha borders for print.
- Cover pages blank after reopen + empty covers inside .pnote (user:
  «برگشتم جزوه رو ادامه بدم، عوض صفحات ایمپورت‌شده صفحه سفید بود» + «.pnote
  صفحه اول رو فقط با قالب خالی نشون می‌داد»): ONE root cause, one-line
  fix. `splitDocIntoPages` (utils/docPages.ts) returns the per-page cover
  metadata under the field name `coverAttrs`, but ALL THREE EditorPage
  call sites read `c.cover` — always undefined, so every cover sheet
  loaded as `kind:'cover'` with NO artwork (white sheet + frame only).
  The white sheets then flowed into .pnote exports and version saves;
  the typed pages were intact, but a cover-first note looked wiped on
  every reopen. Fixed by reading `c.coverAttrs` (the wrapper's type was
  also lying — declared `cover?` while the pure function returns
  `coverAttrs?`); verified in-browser: reload keeps COVER artwork +
  titles on both imported covers, and export→import round-trip preserves
  covers WITH artwork and the typed page text (pnote suite 23/23,
  collab 46/46 after the fix).
- Question-box triple bug (user: «باکس سوالا … بک‌اسپیس نداره / cursor نشون
  داده نمی‌شه وقتی دوبار کلیک می‌کنی / حذف فاصله بین دو باکس، ادغام میشن»):
  (1) dblclick word-select in the nested `.edu-title-text` spans produced
  text→PARENT-ELEMENT ranges (Chromium starts the range at the word start
  and extends past the span boundary when the word sits at the span's
  START — RTL titles' first word is nearest the icon) that render as
  NOTHING; fixed with a `dblclick` handler on the span that rebuilds the
  selection INSIDE the text node via `Intl.Segmenter` word boundaries
  (`blocks.ts editableTitleView`). (2/3) Two `Backspace` merge accidents
  lived in `BlockEnter.ts BlockBoundaryGuard`: stock joinBackward at the
  boundary deleted the EMPTY GAP paragraph between two boxes into the box
  above (harmless-looking) and then fused the two box NODES on the next
  press. The guard now handles the gap case explicitly: empty gap
  paragraph → delete the GAP itself (boxes stay separate, caret lands
  after the upper box); non-empty textblock after a box (plain OR lower
  box) → boundary HOP into the upper box's last body paragraph. Verified
  in-browser: Backspace chain through two adjacent boxes never yields one
  box, and dblclick selects a full Persian word (`تستی`, same-node Range).

  **Follow-up report (باکس‌ها هنوز ادغام می‌شدند + تیتر سوال تشریحی
  بدون کرسر/غیرقابل‌حذف):** live reproduction showed the FIRST fix was
  written into the WRONG layer — `BlockEnter.ts BlockBoundaryGuard` —
  while the ACTIVE thrower lives in `Page.tsx buildEditorExtensions →
  editorProps.handleKeyDown` (view props outrun plugins, and ProseMirror
  consults BOTH; the two had drifted). Worse, its condition was
  `depth === 1 && parentOffset === 0`, but the real box-killers resolve
  DEEPER — the caret sits at depth 2 (inside the box's own body
  paragraph) with `nodeBefore = null`, so stock joinBackward reached the
  box node and DELETED THE WHOLE BOX (title + all) on press 2 — exactly
  what the user saw as «باکس‌ها ادغام می‌شوند» / «باکس پاک می‌شود».
  Verified live positions: after deleting the gap text between two
  boxes, the caret lands at the start of the lower box's first body
  paragraph (depth 2, `$from.index(0)-1` = upper box) → press = upper
  box gone; at the END of a box's empty body paragraph (depth 1 inside
  the wrapper) → stock lifts the paragraph out and the box wrapper dies.
  The guard in `Page.tsx` is now depth-agnostic (`empty &&
  parentOffset === 0`, prev doc child via `$from.index(0)-1`) with three
  explicit cases: (a) previous doc child is a box → boundary HOP into
  its last body paragraph (never delete/merge structure); (b) caret
  inside a box's own EMPTY body paragraph → swallow (box survives; the
  حذف menu removes boxes deliberately); (c) plain textboxes untouched →
  stock behavior. `BlockEnter.ts BlockBoundaryGuard` mirrors the same
  rules for the plugin layer so the two surfaces can never disagree.
  Selection visibility in the title spans: `.edu-title-text` now sets
  `caret-color: currentColor` plus an explicit `::selection` paint
  (`rgba(0,112,243,.3)` with `color: inherit`) — Chromium painted NO
  highlight over the family-colored title text, which read as «cursor
  نداره / نمی‌شه متن رو انتخاب کرد». Verified in-browser: word-selection
  ranges land inside the text node AND render visible.

  **Regression + final rule (титр غیرقابل ویرایش شد):** the depth-agnostic
  guard broke TITLE EDITING — while the user types in a title span, PM's
  INTERNAL selection can still sit in the box's EMPTY body paragraph, so
  the guard matched its case and swallowed/hopped every Backspace typed
  in the title («متن روی سوال حذف نمیشه، بک‌اسپیس کار نمی‌کنه»).
  IRON RULE for both guard surfaces (Page.tsx editorProps +
  BlockEnter.ts plugin): the structural Backspace guard must FIRST check
  `window.getSelection().anchorNode` — if the REAL DOM caret lives inside
  a NESTED_EDIT_SPANS contenteditable (edu title, MCQ option, pro/con,
  code area), skip the guard entirely; those keys are content edits
  routed to the span path (execCommand → MutationObserver →
  setNodeMarkup). Verified live after the fix: Backspace deletes title
  chars and syncs attrs, typing works, dblclick word-select visible, and
  all box-merge protections hold.

---

## ۱۶. ★ Mechanism 7 — Real-time collaborative editing (group notes)

> **Scope discipline:** this layer ONLY adds real-time co-editing on top of
> the existing foundations. User/Auth, Groups/GroupMembership/permissions,
> Group Note ownership/access, Note CRUD, the optimistic-concurrency
> (baseRevision/409) REST contract, autosave, SaveState, the A4 page
> system, TipTap, page-local actions, FloatingLayer and the export system
> ALREADY EXISTED and were REUSED — none of them are rebuilt here.

**Architecture (concerns stay separate):**

| Concern | Owner |
|---|---|
| Editor | existing per-page TipTap instances (untouched) |
| Session | `CollabSession` (`client/src/collab/session.ts`) — one user × one note: yjs doc, seat, presence |
| Transport | `CollabTransport` — WebSocket `/api/collab?noteId=…&token=…` (JWT from the upgrade URL; token never in cookies/scripts), reconnect with exponential backoff (600ms→10s cap) |
| Concurrency | yjs CRDT — one `Y.Doc` per note on the server (`collab/rooms.ts`), one mirrored `Y.Doc` per client; concurrent transactions MERGE (no last-write-wins, no full-JSON replacement) |
| Persistence | the EXISTING autosave scheduler stays canonical (REST PATCH with baseRevision/409); the room additionally persists via `persistRoom` (mirrors the REST fields, bumps `revision`) at most every `ROOM_PERSIST_INTERVAL_MS=5s` |
| Presence | yjs awareness relay + throttled `seats` broadcasts (120ms coalescing) |
| Permission | `collab/auth.ts resolveCollabAccess` — re-verifies auth + note + group membership + edit capability on EVERY frame; group capability logic stays only in `services/groups/permissions.ts` |

**Room layout (one Y.Doc per note):** `Y.Map 'structure'` (pages
order/kind/auto mirror + `lastSavedDoc`/`pendingDoc`), one
`Y.XmlFragment 'page:<pageId>'` per A4 sheet, `Y.Map 'floats:<pageId>'`
(commit-oriented float lists — drag/resize commit final geometry, never
pointermove spam).

**Page identity (the load-bearing invariant):** editors bind to
`page:<pageId>` fragments, so ids must be STABLE across clients and
reloads — derivation is duplicated client/server (client
`splitDocIntoPages` ⇄ server `seedRoomFromNote`): `p1` for the first page,
then the persisted `pageBreak` attr `pid` else the ordinal `p<N>`;
`mergePagesIntoDoc` writes `pid` back on save. A test pins the parity
(`collab.test.mts`). Never reintroduce random ids at load — two clients
would bind to different fragments and edits would never converge.

**MAX_ACTIVE_EDITORS = 4 (a SESSION cap, nothing else):** the ONE constant
lives in `server/src/collab/constants.ts` (mirrored client-side). Seat
counts have NOTHING to do with group size or note access: any authorized
member may open/read the note; only ACTIVE editing leases are capped.
Acquisition is ATOMIC — `sessionStore.acquire()` checks capacity and
inserts in one synchronous critical section (no await between check and
insert on the single-threaded loop), so the 2-users-race-for-seat-4 can
never yield 5 editors (pinned by tests, including a 50-competitor race).
When full, an authorized user gets VIEW-ONLY + the Persian banner «در حال
حاضر ۴ نفر در حال ویرایش این یادداشت هستند.» and auto-upgrades when a seat
frees (no page reload).

**Session model & lifecycle:** in-memory lease `{sessionId (128-bit
random), noteId, userId, connectionId, startedAt, lastHeartbeatAt, status,
displayName, avatar}` — NO document content in the session record. Client
heartbeats every `HEARTBEAT_INTERVAL_MS=15s`; a seat older than
`HEARTBEAT_TIMEOUT_MS=45s` is stale and reaped every 10s — a browser crash
or network loss cannot monopolize a seat forever.

**Reconnect / duplicate tabs:** a reconnecting client presenting a live
same-user session re-binds instead of duplicating; `ONE_SEAT_PER_USER`
means a second tab TAKEOVER the seat (deterministic: newest connection
wins) and the old socket is demoted to view-only via `seat.transferred`.
Local edits are never duplicated after reconnect: the client's yjs update
log replays through the sync.step1/step2 state-vector diff.

**Transaction sync (LOCAL/REMOTE/SYSTEM):** local TipTap transactions merge
into yjs via `@tiptap/extension-collaboration` (y-prosemirror); the doc
observer fans out only non-`server`-origin updates (`wireDocObserver`), so
the echo loop is structurally absent. Remote frames apply as REMOTE
transactions (isChangeOrigin). The document NEVER travels as full JSON on
the typing hot path — only binary yjs ops (base64 in a JSON envelope).
Write authority is checked on EVERY mutation frame: only holders of a live
ACTIVE seat may mutate the room; viewers/demoted sockets get a resync
instead.

**Undo/redo:** with collaboration active, StarterKit history is DISABLED
per page (`history: collabFragment ? false : {depth:200}`) — the
Collaboration extension ships its own yjs UndoManager with origin tracking,
so Ctrl+Z undoes MY local history, not another editor's transactions.

**View-only (5th editor):** `denyReason: 'capacity'` → read-only pages
(`collabEditable=false` keeps the yjs binding so the viewer still sees live
edits) + banner + a manual retry button + auto-retry on every `seats`
broadcast showing a free seat. `denyReason: 'forbidden'` (no edit
capability) → permanent read-only + «دسترسی ویرایش ندارید».

**Revocation:** membership removed or edit permission revoked mid-session →
`resolveCollabAccess` fails on the next frame → seat released + `revoked`
frame → client drops to view-only instantly. Server-side authority is
never derived from client claims.

**Server restart:** rooms are memory-only; clients reconnect (backoff),
the room re-seeds from the newest persisted Note, sessions re-acquire
after re-auth. Stale sessions die by heartbeat timeout or process exit.

**Multi-tab policy:** documented above — one seat per user, newest tab
wins, old tab demoted live.

**Persistence relationship:** the existing REST baseRevision contract is
UNTOUCHED and canonical. The room's own persistence (`pendingDoc` from the
seat holder's merged doc, else `docJsonFromYRoom` projection) is a
fallback that keeps Mongo fresh when no seat holder is saving; both write
the SAME §4 storage shape.

**Hardening milestone (September 2026) — what changed on top of the
foundation above (nothing foundational was rebuilt):**

- **Page structure is SEMANTIC (canonical):** `pageOrder` (Y.Array of
  pageIds) + `pageMeta` (Y.Map id → {kind, auto}) are the ordering/attribute
  authority; `structure.pages` remains only a legacy projection mirror.
  CREATE/DELETE/MOVE/KIND/AUTO are entry-level ops
  (`client/src/collab/session.ts` opCreatePage/opDeletePage/opMovePage/
  opUpdatePageMeta; thin wrappers in `collab/structureSync.ts`). pageNumber
  is DERIVED (idx+1) at reconcile — never identity, never synced.
- **Delete/move race hardening:** opMovePage aborts when the page was
  deleted concurrently and falls back to append when its anchor is gone;
  `reconcilePagesFromStructure` collapses duplicate ids (first occurrence
  wins) — no phantom pages, no duplicate editors on one fragment.
- **Page-creation race:** the receiving client's reconcile uses the NEW
  page list for the same-tick float merge, and fragment binding is by
  NAME (`page:<pageId>`), so content ops bind with zero ordering
  assumptions — the old "new pages start empty until text ops arrive"
  limitation is GONE (content follows structure through the normal CRDT
  path, verified by tests).
- **Floats are per-object Y.Maps** (`floatObj:<pageId>` → objectId →
  property Y.Map): property-level merge — A's x change and B's width change
  both survive; same-key conflicts converge via yjs LWW-per-key. Floating
  TEXT rides the same property map (`text` key) — collaborative state, not
  DOM-only. `collab/floatSync.ts` diffs+patches; the `floats:<pageId>`
  'list' key remains the §4 persistence mirror only.
- **TITLE co-editing is WIRED (§13):** local title edits publish through
  `metadataSync.publishTitle` → Y.Map 'metadata' + `metadata` frame
  (seat-gated; Y.Map equality makes same-value keystrokes free); remote
  titles mirror into React without triggering autosave (the room persists
  the title itself via pendingTitle → persistRoom — no per-keystroke
  version snapshots). Concurrent edits converge (yjs); the title rides the
  room state on reconnect. Metadata boundary (§14): ONLY `title` is
  collaborative; subjectId/chapter/section/tags/favorite/trash stay
  server-only (documented in `collab/metadataSync.ts`).
- **Protocol validation (§28):** `server/src/collab/protocol.ts` — zod
  strict schemas for EVERY client→server frame (bounded base64 ≤8 MB,
  id pattern checks, `doc` shape check). The hub dispatches ONLY through
  `parseClientFrame`; malformed/forged frames (unknown types, forged
  userId/canEdit, oversized payloads, bad ids, non-JSON) are dropped
  BEFORE touching room/session state. Identity fields are not even
  accepted by the schemas (server-derived only, §27). Client-side: the
  session shape-checks `seats` entries, `joined` numerics and the
  `restored` payload.
- **Persistence hardening (§15–§17):** room persistence is now
  IDEMPOTENT (skips the Mongo write when canonical state == lastSavedDoc
  and title unchanged — no revision churn, less 409 exposure) and
  RETRY-SAFE (a failed flush keeps `dirtySince` set → retried next tick;
  a transient Mongo failure can no longer silently drop unsaved collab
  state). The stale-snapshot guards are unchanged: client payloads built
  from the room's canonical state (schedulerBuildPayload), server-side
  text-length guard on the `doc` frame.
- **Known limits (honest):** float sync is commit-oriented so live drag
  shadows are local-only (by design, §10); cursor/selection sharing is NOT
  implemented (presence = avatars + count + page — awareness infrastructure
  exists, but wiring caret presence would require invasive EditorPage
  changes; documented decision, correctness > feature count); unsaved
  collaborative state is lost if the server process dies before a flush
  (rooms are memory-only; the flush interval bounds the loss window at
  ROOM_PERSIST_INTERVAL_MS = 5s).

**UX hardening milestone (September 2026) — verified behavior on top of the
above (nothing foundational was rebuilt):**

- **Explicit view-only state model (§2/§31/§33):** `CollabSessionState`
  carries `viewOnlyReason: 'transferred' | 'released' | 'revoked' |
  'note-deleted' | null` — WHY this tab is view-only, distinct from
  `denyReason` (the join-time outcome). The old tab of a takeover shows
  «ویرایش در پنجرهٔ دیگر», a stale-released seat «جایگاه ویرایش آزاد شد»,
  revocation «دسترسی ویرایش ندارید» — each recoverable or terminal
  appropriately: `requestSeat()` is a hard no-op while `denied: forbidden`
  or `note-deleted` (no retry loops against permanent denials), and a
  fresh `joined` frame resets stale mid-session reasons (verified by
  tests driving the frame handler directly).
- **Note deleted/trashed while editing (§29/§45):** `handleCollabNoteRemoved`
  (server/collab/hub.ts, called from routes/notes.ts on trashed-group-note
  PATCH and on DELETE) sends `{t:'note.deleted'}` to every connected
  client, releases all seats, closes sockets with the existing
  `NOTE_DELETED=4006` code, clears room connections and tears the room down
  (no awareness leak, no lingering Y.Doc). `persistRoom` already refused
  trashed notes — now PINNED by a test against a real in-memory Mongo: a
  trashed note receives NO persistence write, so autosave can never
  resurrect it. Clients land in view-only with «این یادداشت حذف شده است».
- **Float drag policy (§23/§24):** a LOCAL gesture (drag/resize/rotate)
  registers the object via `setProtectedFloat` (hooked to the existing
  `onLiveGeometry` channel — gesture start/end only, no pointermove
  traffic); `reconcileFloatsFromSession` skips remote geometry for that
  ONE object while protected and still merges every other object. The
  pointerup commit republishes final geometry → canonical convergence, so
  the skip can never become a permanent divergence (verified by tests).
- **Delete-wins tombstones (§24):** `opDeleteFloat` tombstones the object
  id (session-local `floatTombstones`, bounded at 256/page); the reconcile
  drops local-only copies of tombstoned ids instead of keeping them — the
  race "A deletes while B's mirror lags" can no longer resurrect the
  object into autosave/exports. A deliberate re-create (`opUpsertFloat`)
  clears the tombstone (verified by tests).
- **Presence popover (§6/§7):** the presence chip is now a button opening
  a compact session popover — per collaborator: avatar, name, and their
  current page as «صفحه ۵» derived from the chip's new `pageIds` prop
  (the ordered local page list — pure projection, no new protocol);
  unknown/not-yet-synced ids degrade to «صفحه‌ای دیگر»; empty room shows
  «هم‌ویرایشگری آنلاین نیست». NOT member management (that stays in Group
  surfaces). Remote presence never navigates the local user anywhere.
- **Remote selection stability (§8, verified by code inspection, no change
  needed):** y-prosemirror's binding snapshots the LOCAL selection as
  RELATIVE positions before every remote transaction applies and restores
  it afterwards (`beforeTransactionSelection` + `restoreRelativeSelection`
  in y-prosemirror's sync plugin) — the caret survives unrelated remote
  edits BY CONSTRUCTION, including inside the active equation (its
  NodeView `update()` repaints only when the serialized AST actually
  differs and clamps the caret, never flattening it; §9). The Ribbon's
  contextual freeze (`nonLivePanelOpen`) already prevents open panels from
  unmounting on context switches (§22). No code change was required —
  documented here so nobody "fixes" it later.
- **Resource cleanup (§41, verified by code inspection):** the session's
  `destroy()` clears the heartbeat interval, destroys awareness and closes
  the transport (StrictMode-safe: `useCollabSession` cleans up on unmount);
  FloatingLayer disconnects its ResizeObserver and removes all window
  listeners on unmount; the presence popover's outside-click listener is
  scoped to its open state; the doc observer returns an unsubscribe
  function wired through every effect. `handleCollabNoteRemoved` now also
  clears `awarenessByRoom` on teardown.
- **BUGFIX — unexplained view-only for a late creator/admin (user report,
  September 2026):** joining a note whose 4 seats were ALL taken produced
  only `joined{seat:'view'}` — no `denied` frame, so the client showed a
  bare «فقط مشاهده» with no reason, no banner and no retry (this hit the
  note's CREATOR/ADMIN exactly like anyone else: the seat cap is a SESSION
  cap that applies to everyone). The hub now sends `denied:capacity` BEFORE
  `joined` in that case (both frames in the join path), the chip labels
  the `acquiring` state honestly («در نوبت جایگاه ویرایش…» instead of
  «فقط مشاهده»), and when capacity-blocked the presence popover carries
  the seat-request action («دریافت جایگاه ویرایش») — the honest recovery
  path, NOT an upgrade/downgrade control (permission-denied users never
  see any retry affordance, §33). The popover z-index was lifted to the
  ribbon-panel level (z-[300]) so ribbon dropdowns can't paint over it.
  NOTE on the same report: this codebase contains NO upgrade/downgrade
  modal reachable from the editor chip — the only role-change UI is the
  Group Members panel's role Select (in GroupDetailPage). If a user still
  sees an unexpected panel on chip click, check for a stale client bundle
  (hard refresh) before hunting a bug.
  Regression test: `a creator arriving late (capacity full) gets
  ok:false=full — hub must send denied:capacity` (collab.test.mts).
- **Performance posture (§39/§40, unchanged this milestone by design):**
  the typing hot path is ONE getJSON per changed page + `markDirty()`
  (one boolean + state transition); HTML/plainText derive at save/export
  time; thumbnails re-serialize only pages whose content object identity
  changed (400ms debounce); the sidebar is memoized on page-STRUCTURE
  identity; presence rides the 15s heartbeat + page-change events with a
  120ms server-side coalescing window; float commits are gesture-scoped.
  No JSON.stringify of the full document, no buildFullHtml, no Mongo or
  REST traffic, no thumbnail rebuild, and no presence broadcast happens
  per keystroke (verified by reading the hot path: onEditorUpdate →
  setPages + markDirty only).

**Tests:** `server/src/test/collab.test.mts` (node:test) — seat atomicity
(4 cap, race-for-seat-4, 50-competitor), stale-seat reaping, reconnect
re-bind, multi-tab takeover, revocation, two-client CRDT convergence, echo
suppression, seed idempotency, page-id derivation parity + shared-fragment
convergence; PLUS the hardening matrix: CREATE_PAGE convergence (structure
+ meta + same-fragment binding + immediate content), entry-level
DELETE_PAGE (others untouched), concurrent DELETE+MOVE convergence (no
duplicates/phantoms), page-id stability across room re-seed, per-property
float merge (x vs width both survive), same-key LWW convergence, floating
text collaboration, floats-on-deleted-page never reappear, title
convergence + reconnect persistence + metadata boundary, SYSTEM restore
replacing structure/fragments/floats deterministically, and protocol
validation (forged identity, oversized, malformed); PLUS the UX-milestone
matrix: view-only reason mapping (transfer/release/revocation/note-deleted,
requestSeat gating, fresh-join reset — client session driven through its
frame handler), float drag protection (remote geometry skipped for the
gestured object, others still merge, convergence after pointerup), delete-
wins tombstones (stale mirror dropped, re-create un-tombstones), and
persistRoom refusing a trashed note against a REAL in-memory Mongo (no
resurrection through autosave); PLUS the RELIABILITY matrix (§17
milestone, real in-memory Mongo per test): normal durable persistence
with generation recording, idempotent no-op flush (no revision churn),
Mongo-failure injection (dirty retained, nothing written, retry
converges), REST-race (room write never overwrites a concurrent REST
PATCH; re-capture converges; revision only moves forward), generation
guard (old generation aborts against a newer stored generation),
trash+delayed-flush (no resurrection, no revision bump), corrupt
persisted snapshot refused at room seed, corrupt restore payload rejected
(throw + explicit 400 to the user), restore-bumps-generation (stale flush
cannot resurrect pre-restore content), graceful shutdown flush (bounded,
unsaved collaborative state survives), page-id writeback + re-seed
stability, and structured-content durability (equation AST / edu-block
attrs / table design tokens survive a durable round-trip as nodes).
Run: `cd server && npx tsx --test src/test/collab.test.mts`.

Live-server probe: `node scripts/qa-collab-ws.mjs [baseUrl]` (REAL HTTP +
WS against a running server, default :4000): two users register, a group
is created, B is granted membership + `admin` role directly at the DB
level (membership is service-layer; a plain `member` is read-only BY
RULE, so admin gives the probe two ACTIVE editors), a group note is
created via `POST /api/groups/:id/notes`, both clients join over real
WebSocket (JWT upgrade auth), seed parity over state64 is asserted,
concurrent yjs updates fan out both ways, the `persisted` durability ack
arrives, the durable Note is polled until BOTH edits are stored,
reconnect re-joins with an active seat and answers a real sync.step1
(state-vector diff), and the test note is deleted. Exit code 0 = all
assertions passed.

---

## ۱۷. ★ Mechanism 8 — Durable collaborative persistence (§ reliability

> **What changed:** the room flush is no longer a best-effort read-
> modify-write. It is a MONOTONIC GENERATION-GUARDED, atomically
> conditional write, the shutdown lifecycle flushes dirty rooms boundedly,
> every snapshot boundary validates structure, and clients learn about
> durability through an ack frame. Foundations were NOT rebuilt: same
> Yjs/WebSocket/TipTap/autosave/permission architecture.

### The durability chain (the ONE contract)

```
local edit
  → yjs canonical room state
      (room.doc 'update' event → roomGeneration += 1, markRoomDirty)
  → flush (≤ ROOM_PERSIST_INTERVAL_MS = 5s, single-flight per room)
      → captureSnapshot(): ONE immutable PersistSnapshot
        {generation, doc, plainText, wordCount, title, baseRevision}
        — validateNoteDocument() MUST pass or NOTHING is written
  → Note.updateOne() ATOMIC + CONDITIONAL:
        filter: { _id, trashed: { $ne: true },
                  revision <= snapshot.baseRevision }
        update: { $set: { content, plainText, wordCount, title,
                          roomGeneration: snapshot.generation },
                  $inc: { revision: 1 } }
  → on success: durableGeneration = generation;
    persistedRevision = fresh Note.revision (re-read, never assumed)
  → `persisted` frame {revision, generation} broadcast to the room
  → client folds revision into the autosave scheduler's baseRevision
```

### Generation rules (memorize these)

- `roomGeneration` — monotonic, server-authoritative (one `+1` per
  canonical yjs mutation, one `+1` per SYSTEM restore). Never
  wall-clock, never client-supplied (identity fields are rejected by
  the zod frame schemas by construction).
- `Note.roomGeneration` — the generation that produced the current
  stored content. Missing on legacy notes (= 0): fully backward
  compatible, no migration. If the STORED generation is newer than a
  flush's candidate, the flush ABORTS (the in-memory room lost a race
  against a later writer; no stale resurrection).
- A delayed write for generation 17 that completes after generation 18
  succeeded commits bookkeeping ONLY if
  `snapshot.generation >= room.durableGeneration` — otherwise it is
  dropped (and Mongo-side it could not have landed anyway: the
  conditional filter has moved on).
- A FAILED write (Mongo outage — injected by tests) leaves
  `dirtySince` set and writes nothing; the retry RE-CAPTURES a fresh
  snapshot at the current generation. Failed payloads are never
  replayed.
- `flushDirtyRooms` clears the dirty flag ONLY when
  `durableGeneration >= roomGeneration` — a skipped/aborted flush
  (conditional miss) stays dirty and is retried.

### REST autosave ⇄ room flush interaction

- The REST PATCH contract (baseRevision/409, maybeCreateVersion) is
  UNTOUCHED and canonical for client saves.
- The room flush's conditional update makes the two writers SAFE: if a
  REST PATCH advanced the note first, the room's write misses its
  filter (`modifiedCount: 0`), logs a skip, stays dirty, and the next
  flush re-captures against the new revision. Nobody's content is ever
  silently overwritten by stale state.
- Because the room flush `$inc`s `revision`, a client autosave based on
  the pre-flush revision would 409 — the `persisted` ack frame carries
  the fresh revision and `EditorPage` seeds it into the scheduler via
  `collabSession.onPersisted → scheduler.setBaseRevision()`. ONE
  SaveState machine remains the only save indicator; collab only FEEDS
  it.
- `docJsonFromYRoom` prefers a client-submitted `pendingDoc` ONLY while
  `pendingDocGeneration >= roomGeneration` — a stale client shadow can
   never mask newer room state, and a quiescent room always flushes its
   own canonical projection.

### SYSTEM restore (version restore with a live room)

`applySystemRestore` VALIDATES the restored payload first (`§19`); an
invalid one throws `restore rejected: <reason>` and the restore route
maps that to HTTP 400 «نسخهٔ انتخابی قابل بازیابی نیست…» — the durable
pre-restore Note stays the last-known-good. A valid restore replaces
structure/fragments/floats in ONE transaction, bumps
`roomGeneration` (invalidating any in-flight older flush) and marks the
room dirty, so the next flush persists exactly the restored state.
`lastSavedDoc` is deliberately NOT set by the restore — only a
successful `persistRoom` may advance the durable mirror (the earlier
"restore looked idempotent and was never persisted" bug, caught by the
reliability test, is pinned). Restore still takes the pre-restore
backup version (`maybeCreateVersion force`) and broadcasts `restored`.

### Corruption defense (§19) — `server/src/collab/validateDoc.ts`

ONE lightweight structural validator used at THREE boundaries — room
seed (`createRoom`), flush capture (`captureSnapshot`), restore
(`applySystemRestore`). Detects: non-object/impossible top level,
`type !== 'doc'`, unserializable/oversized (> 32 MB), content not an
array, blocks without a type, malformed pageBreak attrs (bad pid
grammar / unknown kind / non-bool auto), DUPLICATE page ids, invalid
or duplicate float ids, cyclic or >200k-node trees. It NEVER repairs:
an invalid snapshot is rejected with a safe reason (no content logged),
the durable Note is untouched, and the room seeds EMPTY (recoverable).
`sync.step1` with a malformed state vector no longer throws — it falls
back to a full-diff reply (the hub's frame loop cannot be killed by a
bad s64).

### Graceful shutdown (§12)

`SIGTERM`/`SIGINT` → `index.ts` sets a latch, calls
`shutdownCollabHub()` (idempotent): new joins are refused with close
code `SERVER_SHUTDOWN = 4011`, frames are dropped, every socket is
closed with 4011 (clients keep local state + their autosave pending
queue and reconnect to the restarted server), then
`flushAllRoomsOnShutdown()` gives every dirty room ONE bounded final
flush (`SERVER_SHUTDOWN_FLUSH_TIMEOUT_MS = 8s` — a dead Mongo can delay
exit by at most that), outcomes are logged honestly (persisted/skipped/
failed/timed-out), awareness maps are destroyed, and only then does
`disconnectDB()` close Mongo + the dev mongod. A second signal
force-exits.

### Crash/restart recovery

Rooms are memory-only (unchanged). After a restart the first client
join re-seeds the room from the newest DURABLE Note — which, thanks to
the shutdown flush + generation guards, is at most one flush interval
behind the last converged state and can never be OLDER than what
clients already saw. Clients replay unsynced local yjs ops through the
normal state-vector sync; a stale client snapshot cannot overwrite the
newly seeded room (the doc-frame guard + pendingDocGeneration expiry
+ server-side text-length guard). Known honest limitation: a HARD kill
(kill -9 / power loss) can still lose up to ROOM_PERSIST_INTERVAL_MS ≈
5s of room-only state (client REST autosaves are independent and have
their own 1.5s debounce + offline queue).

### What was NOT changed

MAX_ACTIVE_EDITORS = 4, seat lifecycle, view-only reasons, presence,
page identity, float tombstones, title metadata boundary, permission
authority (`resolveCollabAccess` + permissions.ts), the §4 storage
shape, exports, pagination, the editor hot path (a yjs mutation costs
one counter increment + one boolean), and the middleware order in
`index.ts`.

---

*This document reflects the code as of September 2026. If a contract
changes, update this file in the same change — it is the first source every
future AI reads.*
