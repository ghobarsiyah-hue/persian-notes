/* ═════════════════════════════════════════════════════════════════════════
   Vercel Serverless entry — Persian Notes API.

   Same Express app as the self-hosted server (server/src/app.ts) with:
     • serveClient: false — the CDN serves client/dist (see vercel.json);
       the serverless filesystem is read-only + immutable.
     • NODE_ENV forced to production BEFORE any server import — env.ts
       computes nodeEnv at import time; this keeps the dev-mongod fallback
       OFF and the JWT_SECRET requirement ON.

   LIMITATION (documented in DEPLOY-VERCEL.md): the WebSocket collaboration
   hub (server/src/collab/hub.ts) requires a long-lived HTTP server and
   cannot run on serverless — group-note real-time sync is disabled here;
   personal notes and REST autosave are unaffected.
   ═════════════════════════════════════════════════════════════════════════ */

process.env.NODE_ENV = 'production';

const { createApp } = await import('../server/dist/app.js');
const { connectDB } = await import('../server/dist/config/db.js');
const { ensureSeedTemplates } = await import('../server/dist/seed/index.js');

let app;
let bootPromise = null;

async function ensureReady() {
  if (app) return app;
  if (!bootPromise) {
    bootPromise = (async () => {
      await connectDB();
      await ensureSeedTemplates();
      app = createApp({ serveClient: false });
    })();
  }
  await bootPromise;
  return app;
}

export default async function handler(req, res) {
  try {
    const a = await ensureReady();
    return a(req, res);
  } catch (err) {
    console.error('✗ serverless boot failed:', err);
    if (!res.headersSent) {
      res.status(503).json({ error: 'سرور موقتاً در دسترس نیست. چند لحظه بعد دوباره تلاش کنید.' });
    }
  }
}
