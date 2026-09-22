import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { connectDB, disconnectDB } from '../config/db.js';
import { User } from '../models/User.js';
import { ensureSeedTemplates, seedSampleDataForUser } from './index.js';

// CLI: npm run seed  →  creates demo user + templates + sample notes
const DEMO_EMAIL = 'demo@pernote.local';
const DEMO_PASSWORD = 'demo1234';

async function main() {
  await connectDB();
  await ensureSeedTemplates();

  let user = await User.findOne({ email: DEMO_EMAIL });
  if (!user) {
    user = await User.create({
      name: 'کاربر نمونه',
      email: DEMO_EMAIL,
      passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10),
    });
    console.log(`✓ کاربر نمونه ساخته شد: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  }

  const { created } = await seedSampleDataForUser(String(user._id));
  console.log(created ? `✓ ${created} یادداشت نمونه ساخته شد.` : 'یادداشت‌های نمونه از قبل موجود بودند.');
  await disconnectDB();
  process.exit(0);
}

main().catch((err) => {
  console.error('✗ خطا در اجرای seed:', err);
  process.exit(1);
});
