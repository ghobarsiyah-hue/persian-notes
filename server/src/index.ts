import { createApp } from './app.js';
import { connectDB, disconnectDB } from './config/db.js';
import { env } from './config/env.js';
import { ensureSeedTemplates, seedSampleDataForUser } from './seed/index.js';
import { User } from './models/User.js';
import { Settings } from './models/Settings.js';
import bcrypt from 'bcryptjs';
import type { Server as HttpServer } from 'node:http';
import { deleteOrphanMemberships } from './services/groups/groupService.js';
import { attachCollabHub, shutdownCollabHub } from './collab/hub.js';

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

  const app = createApp({ serveClient: true });

  const server = app.listen(env.port, () => {
    console.log(`✓ سرور روی http://localhost:${env.port} اجرا شد`);
  });

  /* Real-time collaboration transport — WS upgrades on /api/collab only.
     Registered AFTER app.listen so the HTTP server exists; it does not
     touch the Express middleware chain (§13 invariant 8 intact). */
  attachCollabHub(server as HttpServer);

  /* graceful shutdown (§ reliability milestone): the collab layer flushes
     every dirty room BOUNDED (SERVER_SHUTDOWN_FLUSH_TIMEOUT_MS) BEFORE Mongo
     goes away, sockets are closed with the SERVER_SHUTDOWN code (clients
     reconnect after restart), then Mongo + the dev mongod close cleanly.
     A second signal force-exits (a hung flush can never wedge the box). */
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) { process.exit(1); }
    shuttingDown = true;
    console.log('⏻ در حال خاموشی… (flush فضاهای همگام‌سازی)');
    try { await shutdownCollabHub(); } catch (err) { console.error('[collab] shutdown error:', (err as Error)?.message); }
    try { await disconnectDB(); } catch { /* already down */ }
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err) => {
  /* EADDRINUSE is by far the most common «سرور ران نمی‌شود» cause: a previous
     dev session (or a second copy of the repo) still owns the port. Say it
     plainly instead of a raw stack trace nobody can act on. */
  const msg = (err as { message?: string; code?: string }).message ?? '';
  const code = (err as { code?: string }).code;
  if (code === 'EADDRINUSE' || msg.includes('EADDRINUSE') || msg.includes('listen EADDR')) {
    console.error(
      [`✗ پورت ${env.port} اشغال است — یک نسخهٔ دیگر از سرور احتمالاً هنوز در حال اجراست.`,
       '  کافیه آن ترمینال/پروسه را ببندید (Ctrl+C) و دوباره npm run dev بزنید.',
       '  اگر پروسه را پیدا نمی‌کنید:',
       `  • ویندوز:  netstat -ano | findstr :${env.port}  سپس  taskkill /PID <شماره> /F`,
       `  • مک/لینوکس:  lsof -ti :${env.port} | xargs kill -9`,
       '  • یا برای این اجرا پورت دیگری بدهید:  PORT=4001 npm run dev',
      ].join('\n'),
    );
    process.exit(1);
  }
  console.error('✗ سرور شروع نشد:', err);
  process.exit(1);
});
