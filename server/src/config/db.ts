import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { env } from './env.js';

/* ══════════════════════════════════════════════════════════════════════════
   Dev database fallback — PERSISTENT, not in-memory.

   History: the fallback used MongoMemoryServer, whose data lives only for
   the lifetime of the server process. Every restart WIPED every registered
   account, so after a while users got «نشست شما منقضی شده است» (the user
   document their token points at no longer existed) and logging in with the
   SAME credentials failed with «ایمیل یا رمز عبور اشتباه است» — the account
   itself was gone. That was the auth bug, not the tokens.

   Now the fallback spawns the mongod binary (already downloaded once by
   mongodb-memory-server into ~/.cache/mongodb-binaries, or MONGOMS_SYSTEM_
   BINARY / MONGO_DEV_BINARY) against a project-local data directory, so
   users, notes and settings survive restarts like a real install.
   ══════════════════════════════════════════════════════════════════════════ */

const DEV_DB_PORT = Number(process.env.MONGO_DEV_PORT) || 27017;
const DEV_DB_HOST = '127.0.0.1';

let mongodProc: ChildProcess | null = null;

function probePort(port: number, host: string, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect(port, host);
    s.setTimeout(timeoutMs);
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    s.on('timeout', () => { s.destroy(); resolve(false); });
  });
}

/** locate a mongod executable: explicit env → memory-server's cache → fail */
function findMongodBinary(): string | null {
  const candidates = [
    process.env.MONGO_DEV_BINARY,
    process.env.MONGOMS_SYSTEM_BINARY,
  ].filter((v): v is string => Boolean(v));
  const cacheDir = path.join(process.env.USERPROFILE || process.env.HOME || '.', '.cache', 'mongodb-binaries');
  if (existsSync(cacheDir)) {
    /* readdirSync via the top-level node:fs import — this module is ESM
       (package "type": "module"), where require() does not exist and
       crashed the whole dev fallback with ReferenceError */
    for (const f of readdirSync(cacheDir)) {
      if (f.endsWith('.exe') && f.startsWith('mongod')) candidates.push(path.join(cacheDir, f));
    }
  }
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

/** spawn a persistent mongod for development with a project-local data dir */
function startPersistentMongod(): boolean {
  const bin = findMongodBinary();
  if (!bin) return false;
  /* data lives INSIDE the repo tree (server/.mongo-data) so it is obvious,
     portable with the checkout and survives restarts */
  const dbPath = path.resolve(process.cwd(), '.mongo-data');
  try { mkdirSync(dbPath, { recursive: true }); } catch { return false; }
  try {
    mongodProc = spawn(bin, [
      '--dbpath', dbPath,
      '--port', String(DEV_DB_PORT),
      '--bind_ip', DEV_DB_HOST,
      /* '--nojournal' removed: mongod 7.x REJECTS it ('unrecognised option')
         and exits instantly, which made the whole dev fallback fail */
    ], { stdio: 'ignore', windowsHide: true });
    mongodProc.on('error', () => { mongodProc = null; });
    mongodProc.on('exit', () => { mongodProc = null; });
  } catch {
    return false;
  }
  return mongodProc !== null;
}

/** wait until something answers on the dev port (an existing mongod OR ours) */
async function waitUntilReachable(timeoutMs = 20000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probePort(DEV_DB_PORT, DEV_DB_HOST, 600)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

/** One-time index migration for the User collection.
 *
 *  The username unique constraint used to be `sparse: true`. A sparse
 *  index still indexes explicit `null` values, so the SECOND registered
 *  user (whose username defaults to null) hit E11000 on username_1 and
 *  every later registration failed with «این ایمیل یا آیدی قبلاً استفاده
 *  شده است» (surfaced by the groups test suite after the email
 *  normalization fix made multi-register tests actually reach it).
 *
 *  The model now declares a PARTIAL unique index (username unique only
 *  when $type:string) named `username_unique_partial`. Older databases
 *  still carry the legacy sparse `username_1`; it must be DROPPED, or the
 *  partial index cannot take its role (duplicate-name uniqueness would be
 *  enforced by the broken null-dense index instead). syncIndexes alone
 *  cannot do this cleanly while the old index exists under the same name. */
async function migrateUserIndexes(): Promise<void> {
  try {
    const coll = mongoose.connection.collection('users');
    const info = (await coll.indexes()) as Array<{ name?: string; sparse?: boolean; partialFilterExpression?: Record<string, unknown> }>;
    const legacy = info.find((i) => i.name === 'username_1' && i.sparse === true && !i.partialFilterExpression);
    if (legacy) {
      await coll.dropIndex('username_1');
      console.log('✓ ایندکس قدیمی username_1 (sparse) حذف شد — ایندکس یکتای partial جایگزین شد.');
    }
    /* idempotent: creates/repairs the partial index declared in the schema */
    await User.syncIndexes();
  } catch (err) {
    /* index maintenance must never block boot */
    console.warn('⚠ مهاجرت ایندکس users ناموفق بود:', (err as Error).message);
  }
}

export async function connectDB(): Promise<void> {
  try {
    await mongoose.connect(env.mongoUri);
    console.log(`✓ متصل به MongoDB: ${mongoose.connection.host}/${mongoose.connection.name}`);
    await migrateUserIndexes();
    return;
  } catch (err) {
    if (!env.allowDbFallback || env.nodeEnv === 'production') {
      console.error('✗ اتصال به MongoDB برقرار نشد:', (err as Error).message);
      throw err;
    }
    /* dev fallback: is something already listening (a previous run's mongod,
       or a real install)? connect to it directly — data persists either way */
    if (await probePort(DEV_DB_PORT, DEV_DB_HOST)) {
      try {
        await mongoose.connect(`mongodb://${DEV_DB_HOST}:${DEV_DB_PORT}/persian-notes`);
        console.log(`✓ متصل به MongoDB محلیِ در حال اجرا: ${DEV_DB_HOST}:${DEV_DB_PORT}/persian-notes`);
        return;
      } catch { /* fall through and try spawning */ }
    }
    console.warn('⚠ MongoDB در دسترس نیست — راه‌اندازی MongoDB محلیِ پایدار برای توسعه...');
    if (!startPersistentMongod() || !(await waitUntilReachable())) {
      console.error('✗ راه‌اندازی MongoDB توسعه ناموفق بود — هیچ mongod قابل استفاده پیدا نشد.');
      throw new Error('dev MongoDB unavailable');
    }
    await mongoose.connect(`mongodb://${DEV_DB_HOST}:${DEV_DB_PORT}/persian-notes`);
    console.log(`✓ MongoDB پایدار (توسعه) آماده است — داده‌ها در server/.mongo-data نگهداری می‌شوند و با ری‌استارت پاک نمی‌شوند.`);
    await migrateUserIndexes();
  }
}

export async function disconnectDB(): Promise<void> {
  await mongoose.disconnect();
  /* the spawned mongod keeps running so the NEXT server start reuses the
     same data — only SIGINT/SIGTERM cleanup actually stops it */
  if (mongodProc && !mongodProc.killed) {
    try { mongodProc.kill(); } catch { /* already gone */ }
    mongodProc = null;
  }
}

export function isMemoryDB(): boolean {
  return false;
}
