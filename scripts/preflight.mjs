/* Dev pre-flight — runs before `npm run dev` (see root package.json "predev").
 *
 * Fresh-checkout pitfalls this removes (the "I gave the folder to a friend
 * and npm run dev exploded" class of bug):
 *   1. wrong/old Node version        → clear message instead of cryptic syntax errors
 *   2. .env missing                  → auto-created from .env.example
 *   3. node_modules never installed  → auto `npm install` (root workspaces)
 *   4. stale processes from a previous session still holding :4000/:5173/:27017
 *                                    → detected and (only if they belong to THIS
 *                                      project) killed automatically
 *
 * Everything is best-effort: any unexpected failure here must never block the
 * dev server — it just logs and exits 0.
 */

import { spawn, execSync } from 'node:child_process';
import { existsSync, copyFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const ok = (m) => console.log(`[preflight] ✓ ${m}`);
const warn = (m) => console.log(`[preflight] ⚠ ${m}`);
const step = (m) => console.log(`[preflight] … ${m}`);

function fail(m) {
  console.error(`[preflight] ✗ ${m}`);
  process.exit(1);
}

/* ── 1. Node version ──────────────────────────────────────────────────── */
const major = Number(process.versions.node.split('.')[0]);
if (major < 18) {
  fail(`Node ${process.versions.node} قدیمی است — این پروژه Node ≥ 18 می‌خواهد. از nodejs.org نصب/آپدیت کنید.`);
}
ok(`Node ${process.versions.node}`);

/* ── 2. .env ──────────────────────────────────────────────────────────── */
if (!existsSync(path.join(root, '.env'))) {
  if (existsSync(path.join(root, '.env.example'))) {
    copyFileSync(path.join(root, '.env.example'), path.join(root, '.env'));
    ok('.env وجود نداشت — از .env.example ساخته شد (پیش‌فرض‌های توسعه کافی است).');
  } else {
    warn('نه .env نه .env.example — سرور با پیش‌فرض‌های داخلی بالا می‌آید.');
  }
}

/* ── 3. dependencies (workspaces) ─────────────────────────────────────── */
function depsInstalled() {
  for (const marker of [
    path.join(root, 'node_modules', 'tsx'),
    path.join(root, 'node_modules', 'vite'),
    path.join(root, 'node_modules', '.bin', isWin ? 'concurrently.cmd' : 'concurrently'),
  ]) {
    if (!existsSync(marker)) return false;
  }
  return true;
}
if (!depsInstalled()) {
  step('node_modules ناقص/نصب‌نشده است — npm install اجرا می‌شود (بار اول چند دقیقه طول می‌کشد)…');
  try {
    execSync('npm install', { cwd: root, stdio: 'inherit' });
    ok('وابستگی‌ها نصب شدند.');
  } catch {
    fail('npm install ناموفق بود — اینترنت/پراکسی را چک کنید و دستی `npm install` بزنید.');
  }
} else {
  ok('وابستگی‌ها از قبل نصب‌اند.');
}

/* ── 4. stale processes on dev ports ──────────────────────────────────── */
const PORTS = [4000, 5173, 27017];
const KEY = 'persian-notes'; // only ever kill processes whose cmdline mentions our project

function pidsOnPort(port) {
  try {
    if (isWin) {
      const out = execSync(`netstat -ano -p tcp`, { encoding: 'utf8' });
      const pids = new Set();
      for (const line of out.split('\n')) {
        const cols = line.trim().split(/\s+/);
        // TCP  0.0.0.0:4000  0.0.0.0:0  LISTENING  1234
        if (cols.length >= 5 && cols[3] === 'LISTENING' && cols[1].endsWith(`:${port}`)) {
          const pid = Number(cols[4]);
          if (Number.isInteger(pid) && pid > 0) pids.add(pid);
        }
      }
      return [...pids];
    }
    const out = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { encoding: 'utf8' });
    return out.split('\n').map(Number).filter(Number.isInteger);
  } catch {
    return [];
  }
}

function cmdlineOf(pid) {
  try {
    if (isWin) {
      return String(
        execSync(`powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine"`,
          { encoding: 'utf8' }),
      );
    }
    return String(execSync(`ps -p ${pid} -o command=`, { encoding: 'utf8' }));
  } catch {
    return '';
  }
}

function killPid(pid) {
  try {
    if (isWin) execSync(`taskkill /PID ${pid} /F /T`, { stdio: 'ignore' });
    else process.kill(pid, 'SIGKILL');
    return true;
  } catch {
    return false;
  }
}

let anyStale = false;
for (const port of PORTS) {
  for (const pid of pidsOnPort(port)) {
    if (pid === process.pid) continue;
    const cmd = cmdlineOf(pid);
    if (!cmd.toLowerCase().includes(KEY)) {
      // different app on the port — do NOT touch it; vite/api will report the clash
      warn(`پورت ${port} توسط پروسهٔ دیگری (PID ${pid}) اشغال است — دست نزدم:`.trim());
      console.log(`            ${cmd.trim().slice(0, 120) || '(بدون اطلاعات)'}`);
      console.log(`            اگر مال همین پروژه است، خودتان ببندیدش یا با PORT/PNBIND_VITE_PORT پورت عوض کنید.`);
      anyStale = true;
      continue;
    }
    if (killPid(pid)) {
      ok(`پروسهٔ جاماندهٔ این پروژه (PID ${pid} روی پورت ${port}) بسته شد.`);
      anyStale = true;
    } else {
      warn(`پروسهٔ این پروژه (PID ${pid} روی پورت ${port}) بسته نشد — اگر ارور پورت گرفتید دستی ببندیدش.`);
    }
  }
}
if (!anyStale) ok('پورت‌های 4000/5173/27017 آزادند.');

/* brief settle so freed ports are actually reusable (Windows TIME_WAIT) */
await new Promise((r) => setTimeout(r, 300));

/* sanity check the dev entrypoints resolve so we can fail BEFORE
 * concurrently spawns and interleaves the error with vite output */
const devEntries = [
  path.join(root, 'server', 'src', 'index.ts'),
  path.join(root, 'client', 'index.html'),
];
for (const f of devEntries) {
  if (!existsSync(f)) fail(`فایل ورودی پیدا نشد: ${path.relative(root, f)} — پوشه ناقص کپی شده؟`);
}
ok('همه‌چیز آماده است — سرور و کلاینت بالا می‌آیند…');
