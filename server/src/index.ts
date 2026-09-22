import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { existsSync } from 'node:fs';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
import { connectDB, disconnectDB } from './config/db.js';
import { env } from './config/env.js';
import { ensureSeedTemplates, seedSampleDataForUser } from './seed/index.js';
import { User } from './models/User.js';
import { Settings } from './models/Settings.js';
import { errorHandler, notFound } from './middleware/error.js';

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
import { attachCollabHub } from './collab/hub.js';
import { deleteOrphanMemberships } from './services/groups/groupService.js';
import type { Server as HttpServer } from 'node:http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  await connectDB();
  await ensureSeedTemplates();

  // Group housekeeping: sweep provisional membership rows whose group was
  // never created (possible only in the no-transaction fallback path after
  // a crash between the two writes). Cheap, index-backed, runs once.
  try {
    const swept = await deleteOrphanMemberships();
    if (swept > 0) console.log(`✓ ${swept} عضویت ناقص گروه پاک‌سازی شد.`);
  } catch { /* never block startup on housekeeping */ }

  // dev convenience: create the demo user + sample notes when SEED_ON_START=true
  if (env.seedOnStart) {
    const DEMO_EMAIL = 'demo@pernote.local';
    let demoUser = await User.findOne({ email: DEMO_EMAIL });
    if (!demoUser) {
      try {
        demoUser = await User.create({
          name: 'کاربر نمونه',
          email: DEMO_EMAIL,
          passwordHash: await bcrypt.hash('demo1234', 10),
        });
        await Settings.create({ userId: demoUser._id });
        console.log('✓ کاربر نمونه ساخته شد: demo@pernote.local / demo1234');
      } catch (err) {
        /* duplicate-key race (double server start / restart overlap): the
           demo user exists — re-read it instead of CRASHING the server */
        if ((err as { code?: number })?.code === 11000) {
          demoUser = await User.findOne({ email: DEMO_EMAIL });
          if (!demoUser) throw err;
        } else {
          throw err;
        }
      }
    }
    const { created } = await seedSampleDataForUser(String(demoUser._id));
    if (created) console.log(`✓ ${created} یادداشت نمونه ساخته شد.`);
  }

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

  // 404 only for unmatched /api routes (so the SPA still receives everything else)
  app.use('/api', notFound);

  // Central error handler must be registered last
  app.use(errorHandler);

  const server = app.listen(env.port, () => {
    console.log(`✓ سرور روی http://localhost:${env.port} اجرا شد`);
  });

  /* Real-time collaboration transport — WS upgrades on /api/collab only.
     Registered AFTER app.listen so the HTTP server exists; it does not
     touch the Express middleware chain (§13 invariant 8 intact). */
  attachCollabHub(server as HttpServer);

  /* graceful shutdown — stops the dev mongod WE spawned so the next run
     reuses the same persistent data (users/notes survive restarts) */
  const shutdown = async () => {
    try { await disconnectDB(); } catch { /* already down */ }
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err) => {
  console.error('✗ سرور شروع نشد:', err);
  process.exit(1);
});
