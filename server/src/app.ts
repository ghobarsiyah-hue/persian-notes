import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import authRoutes from './routes/auth.js';
import noteRoutes from './routes/notes.js';
import subjectRoutes from './routes/subjects.js';
import tagRoutes from './routes/tags.js';
import templateRoutes from './routes/templates.js';
import versionRoutes from './routes/versions.js';
import aiRoutes from './routes/ai.js';
import searchRoutes from './routes/search.js';
import settingsRoutes from './routes/settings.js';
import exportRoutes from './routes/export.js';
import seedRoutes from './routes/seed.js';
import notificationRoutes from './routes/notifications.js';
import groupRoutes from './routes/groups.js';
import collabRoutes from './collab/routes.js';
import { errorHandler, notFound } from './middleware/error.js';

export interface CreateAppOptions {
  /** Serve the built client (SPA) from this Express app. TRUE for the
   *  self-hosted Node server (`npm start`); FALSE on serverless (Vercel):
   *  the CDN serves client/dist there and the function filesystem is
   *  read-only, so the static middleware would be dead weight. */
  serveClient?: boolean;
}

/**
 * Build the Express app (routes + middleware + optional SPA static serving).
 *
 * Deliberately FREE of boot side effects: no connectDB, no seeding, no
 * listen. The standalone server (index.ts) and the serverless entry
 * (api/index.mjs) both compose this — so the middleware order, the API
 * surface and the SPA fallback stay byte-identical between deployments
 * (§ invariant: static/SPA serving MUST come before the API 404/error
 * handlers; this order lives here and nowhere else).
 */
export function createApp(opts: CreateAppOptions = {}): express.Express {
  const serveClient = opts.serveClient ?? true;

  const app = express();
  /* CORS: the client is served by THIS server (same origin) and the dev
     server proxies /api, so browsers never need cross-origin access.
     Restrict origins to an explicit allowlist (CORS_ORIGINS) — the old
     reflect-any-origin policy combined with Authorization headers let any
     website read a logged-in user's API responses. */
  const corsOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  app.use(cors(
    corsOrigins.length
      ? { origin: corsOrigins }
      : { origin: false } /* same-origin only */
  ));
  app.use(express.json({ limit: '20mb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  app.use('/api/auth', authRoutes);
  app.use('/api/notes', noteRoutes);
  app.use('/api/subjects', subjectRoutes);
  app.use('/api/tags', tagRoutes);
  app.use('/api/templates', templateRoutes);
  app.use('/api/versions', versionRoutes);
  app.use('/api/ai', aiRoutes);
  app.use('/api/search', searchRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/export', exportRoutes);
  app.use('/api/seed', seedRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/groups', groupRoutes);
  app.use('/api/collab', collabRoutes);

  // Serve the built client (SPA). This MUST come before the API 404/error
  // handlers — otherwise non-API requests (dashboard, deep links like /notes,
  // and static assets) are intercepted and return 404 «page not found».
  // Two supported layouts (first match wins):
  //   • repo/dev:        server/dist → ../../client/dist   (sibling workspace)
  //   • deploy bundle:   server/dist → ../public/client     (self-contained folder)
  if (serveClient) {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const clientDist =
      [
        path.resolve(__dirname, '../../client/dist'),
        path.resolve(__dirname, '../public/client'),
      ].find((p) => existsSync(path.join(p, 'index.html'))) ??
      path.resolve(__dirname, '../../client/dist');
    app.use(express.static(clientDist));
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  // 404 only for unmatched /api routes (so the SPA still receives everything else)
  app.use('/api', notFound);

  // Central error handler must be registered last
  app.use(errorHandler);

  return app;
}
