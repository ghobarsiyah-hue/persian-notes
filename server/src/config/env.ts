import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

/* Some shells leak PORT=0 / PORT="" into the environment. Such a value would
   beat every .env file below (dotenv never overrides existing vars) and trip
   the port guard into the 4000 default — the exact EADDRINUSE case when a
   second copy of the app runs beside the first. Drop a non-numeric/zero PORT
   BEFORE the files load so the .env value applies; a REAL port still wins. */
if (process.env.PORT !== undefined && !(Number(process.env.PORT) > 0)) {
  delete process.env.PORT;
}

/* Load the project-root .env FIRST (the location the README documents:
   `cp .env.example .env` at the repo root), then the cwd .env. In dev the
   cwd is server/, so a root .env used to be silently ignored — a root-level
   PORT (e.g. a deploy copy running beside the main checkout) never applied.
   dotenv does not override already-set vars, so first file wins per key. */
const envDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), // server/src/config | server/dist/config
  '..',
  '..',
); // …/server
for (const candidate of [path.join(envDir, '.env'), path.join(path.resolve(envDir, '..'), '.env')]) {
  if (existsSync(candidate)) dotenv.config({ path: candidate });
}
dotenv.config();


function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`متغیر محیطی ${name} تنظیم نشده است`);
  return v;
}

/** seed the demo account on startup by default in development (the in-memory
 *  DB is wiped on every restart, so without this the demo login always fails) */
function env_nodeEnv(): string {
  return process.env.NODE_ENV ?? 'development';
}

export const env = {
  /* guard against PORT=0 / PORT="" leaking into the environment (Number("")
     is 0, and ?? only covers undefined) — fall back to the real dev port */
  port: Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 4000,
  nodeEnv: process.env.NODE_ENV ?? 'development',
  mongoUri: process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/persian-notes',
  allowDbFallback: (process.env.ALLOW_DB_FALLBACK ?? 'true') === 'true',
  seedOnStart: (process.env.SEED_ON_START ?? (env_nodeEnv() === 'production' ? 'false' : 'true')) === 'true',
  /* JWT_SECRET must be explicit in production — the well-known dev fallback
     would let anyone forge session tokens on a deployed instance (the token
     is the ONLY identity proof in this API, so its secret is crown jewels). */
  jwtSecret: (() => {
    const v = process.env.JWT_SECRET ?? 'dev-only-secret-change-me';
    if (env_nodeEnv() === 'production' && v === 'dev-only-secret-change-me') {
      throw new Error('JWT_SECRET must be set to a strong random value in production');
    }
    return v;
  })(),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  ai: {
    provider: (process.env.AI_PROVIDER ?? 'local') as 'local' | 'openai',
    openai: {
      apiKey: process.env.OPENAI_API_KEY ?? '',
      baseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
      model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
      timeoutMs: Number(process.env.OPENAI_TIMEOUT_MS ?? 60000),
    },
  },
};
