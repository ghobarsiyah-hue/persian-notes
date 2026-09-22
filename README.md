# پرشین‌نوت — Persian Study-Note Editor

A production-oriented Persian (RTL) note-taking and study-note editor:
Notion-style block editing, education-specific blocks, AI-assisted editing,
version history, global search, and professional A4 print/PDF export.

## Stack

| Layer     | Tech |
|-----------|------|
| Frontend  | React 18 + TypeScript + Vite + Tailwind CSS + TipTap v2 + KaTeX |
| Backend   | Node.js + Express + TypeScript |
| Database  | MongoDB (Mongoose). Dev fallback: in-memory MongoDB if none reachable |
| AI        | Modular provider system (`local` rule-based Persian proofreader, or any OpenAI-compatible API) |
| Font      | Vazirmatn |

## Quick start

```bash
# 1. install everything (npm workspaces: client + server)
npm install

# 2. configure (optional — sensible dev defaults exist)
cp .env.example .env

# 3. run both server (http://localhost:4000) and client (http://localhost:5173)
npm run dev
```

Register an account in the UI, or create the demo user + sample notes:

```bash
npm run seed        # demo user: demo@pernote.local / demo1234
```

The login page has a one-click **demo login** button.

### MongoDB

The server connects to `MONGODB_URI` (default `mongodb://127.0.0.1:27017/persian-notes`).
If MongoDB is not installed and `ALLOW_DB_FALLBACK=true`, the server starts an
**in-memory MongoDB** and clearly logs it — data is lost on restart. For real
persistence, install MongoDB or point `MONGODB_URI` at Atlas.

## AI configuration (server-side only)

In `.env`:

```ini
AI_PROVIDER=local    # 'local' = built-in rule-based Persian proofreader (offline)
AI_PROVIDER=openai   # any OpenAI-compatible API
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
```

- `local` genuinely fixes Persian orthography (نیم‌فاصله، فاصله‌گذاری، علائم،
  حروف عربی→فارسی، فعل‌های محاوره‌ای رایج) without changing meaning. Other AI
  actions are honestly marked **غیرفعال** until a provider is configured —
  there are no fake AI responses.
- The API key lives only in server env vars; the browser never sees it.
- Before every AI transformation, a version snapshot is taken automatically.

## Features

- **Editor**: TipTap-based, full RTL, Persian UI, mixed Persian/Latin text,
  bold/italic/underline/strike, colors, highlights, font size, headings,
  lists, checklists, tables, images, links, quotes, code, undo/redo,
  superscript/subscript, keyboard shortcuts (Ctrl+S/Z/Shift+Z/B/I/U/K,
  Ctrl+Shift+A for the AI panel).
- **Slash command** (`/`): عنوان، تیتر، متن، لیست، چک‌لیست، جدول، تعریف،
  نکته مهم، نکته امتحانی، توجه، سوال، مثال، خلاصه، اصطلاح کلیدی، فرمول،
  تصویر، جداکننده، نقل‌قول، کد.
- **Educational blocks**: definition, important, exam point, warning,
  question+answer, example, summary, key term (flashcard), and LaTeX
  formula blocks rendered with KaTeX — all styled for print.
- **AI assistant**: ۱۱ actionها (اصلاح نگارشی، حرفه‌ای‌سازی، خلاصه، ساده‌سازی،
  نکات مهم/امتحانی، ساخت سوال، فلش‌کارت، جدول، ادامه بده، مرتب‌سازی) with
  scope awareness (selection / paragraph / section / document) and
  document context (subject, chapter). Results are shown as a diff and
  **never applied without explicit confirmation**; Q&A/flashcard/table
  outputs are converted into real editor blocks.
- **Autosave**: debounced autosave with explicit ذخیره state
  («در حال ذخیره…» / «ذخیره شد ✓»); offline edits are kept in localStorage
  and synced automatically when the connection returns.
- **Version history**: automatic periodic snapshots + restore (a backup is
  snapshotted before any restore).
- **Organization**: subjects (with nested chapters), tags, favorites,
  trash, document outline in the right panel with click-to-scroll.
- **Search**: global search across titles, content, headings, subjects and
  tags with highlighted snippets and filters.
- **Export**: print preview with real A4 pagination (page numbers, header,
  footer, margin/typography settings) → print-to-PDF; Word (.doc) and
  HTML exports.

## Project structure

```
server/src
  config/        env + database (with dev fallback)
  models/        User, Note, Subject, Tag, Template, Version, Settings
  routes/        auth, notes, subjects, tags, templates, versions, ai,
                 search, settings, export, seed
  services/ai/   provider interface + local rule engine + OpenAI provider
  middleware/    auth (JWT), errors (zod validation)
  seed/          built-in templates + realistic sample notes
client/src
  api/           typed REST client
  editor/        TipTap setup, educational blocks, slash command, toolbar
  components/    layout, editor panels, AI diff modal, print preview
  pages/         Dashboard, lists, subjects, templates, search, settings, login
  utils/         Persian digits/dates, document analysis, A4 pagination
```

## Sample data

Sample notes (Physiology — cardiac cycle, Biology — mitochondria,
Biochemistry — glycolysis) can be loaded/removed from **تنظیمات ← داده‌های
نمونه** at any time; they never mix with your own notes (flagged internally).

## Scripts

| Command         | Purpose                          |
|-----------------|----------------------------------|
| `npm run dev`   | server + client concurrently     |
| `npm run seed`  | demo user + templates + samples  |
| `npm run build` | production client build          |
| `npm start`     | production server (serves client)|
