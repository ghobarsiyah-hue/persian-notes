#!/usr/bin/env node
/* Production smoke test — the deploy-readiness gate.
 *
 * Boots a REAL production server exactly like the deployment does:
 *   • compiled output (server/dist), NOT tsx
 *   • NODE_ENV=production (dev mongod fallback OFF, JWT_SECRET required)
 *   • an in-memory MongoDB on 127.0.0.1:27037 via mongodb-memory-server
 *
 * Checks (fail fast, Persian messages like the app):
 *   1. GET  /api/health
 *   2. POST /api/auth/register  → 200/201 with a JWT
 *   3. POST /api/notes          → note created
 *   4. GET  /notes (SPA)        → 200 + HTML containing <div id="root">
 *
 * Run: node scripts/deploy-smoke.mjs
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { existsSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const serverDist = path.join(root, 'server', 'dist', 'index.js');
const clientIndex = path.join(root, 'client', 'dist', 'index.html');

if (!existsSync(serverDist) || !existsSync(clientIndex)) {
  console.error('✗ خروجی build پیدا نشد — اول `npm run build -w client -w server` را اجرا کنید.');
  process.exit(1);
}

const PORT = 4100;
const JWT = 'smoke-test-secret-0123456789abcdef0123456789abcdef';

function waitPort(port, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const probe = () => {
      const s = net.connect(port, '127.0.0.1');
      s.setTimeout(800);
      s.on('connect', () => { s.destroy(); resolve(); });
      s.on('error', () => {
        s.destroy();
        if (Date.now() > deadline) reject(new Error('سرور روی پورت پاسخ نداد'));
        else setTimeout(probe, 400);
      });
      s.on('timeout', () => {
        s.destroy();
        if (Date.now() > deadline) reject(new Error('سرور روی پورت پاسخ نداد'));
        else setTimeout(probe, 400);
      });
    };
    probe();
  });
}

const mem = await MongoMemoryServer.create({ instance: { port: 27037, ip: '127.0.0.1' } });
const uri = mem.getUri('persian-notes');
console.log(`✓ MongoDB در حافظه آماده شد: ${uri}`);

const server = spawn(process.execPath, [serverDist], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(PORT),
    MONGODB_URI: uri,
    ALLOW_DB_FALLBACK: 'false',
    JWT_SECRET: JWT,
    SEED_ON_START: 'false',
  },
});
let out = '';
server.stdout.on('data', (c) => { out += c.toString(); });
server.stderr.on('data', (c) => { out += c.toString(); });

let failed = false;
try {
  await waitPort(PORT);

  const base = `http://127.0.0.1:${PORT}`;

  // 1. health
  const health = await fetch(`${base}/api/health`);
  if (!health.ok) throw new Error(`health → ${health.status}`);
  console.log('✓ /api/health');

  // 2. register
  const reg = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'کاربر تست دیپلوی',
      email: `smoke-${Date.now()}@pernote.local`,
      password: 'smoke-test-1234',
    }),
  });
  const regBody = await reg.json().catch(() => ({}));
  if (!reg.ok || !regBody?.token) throw new Error(`register → ${reg.status} ${JSON.stringify(regBody)}`);
  console.log('✓ /api/auth/register (توکن صادر شد)');

  // 3. create a note with the JWT
  const note = await fetch(`${base}/api/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${regBody.token}` },
    body: JSON.stringify({ title: 'یادداشت تست دیپلوی' }),
  });
  const noteBody = await note.json().catch(() => ({}));
  if (!note.ok) throw new Error(`notes → ${note.status} ${JSON.stringify(noteBody)}`);
  console.log('✓ /api/notes (ایجاد یادداشت)');

  // 4. SPA fallback for a client route
  const spa = await fetch(`${base}/notes`, { redirect: 'manual' });
  const html = await spa.text();
  if (!spa.ok || !html.includes('id="root"')) throw new Error(`SPA fallback → ${spa.status}`);
  console.log('✓ /notes (SPA fallback سرو شد)');
} catch (err) {
  failed = true;
  console.error(`✗ ${(err).message}`);
  console.error('---- server output ----');
  console.error(out);
} finally {
  server.kill('SIGTERM');
  setTimeout(() => { try { server.kill('SIGKILL'); } catch { /* already dead */ } }, 3000);
  await mem.stop().catch(() => {});
}

process.exit(failed ? 1 : 0);
