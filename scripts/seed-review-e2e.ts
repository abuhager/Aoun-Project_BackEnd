import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import Item from '../models/Item.js';
import SystemSettings from '../models/SystemSettings.js';
import ensureIndexes from '../utils/ensureIndexes.js';

const uri = process.env.MONGO_URI;
if (process.env.NODE_ENV !== 'test' || !uri || !/^mongodb:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(uri)) {
  throw new Error('E2E fixtures require NODE_ENV=test and a loopback MongoDB replica set');
}
await mongoose.connect(uri, { dbName: 'aoun_review_e2e', autoIndex: false });
try {
  if (mongoose.connection.name !== 'aoun_review_e2e') throw new Error('Unexpected E2E database');
  await mongoose.connection.dropDatabase();
  await ensureIndexes();
  const password = await bcrypt.hash('ReviewSynthetic123!', 10);
  const accounts = [
    ['super', 'super_admin', false], ['admin', 'admin', false],
    ['user', 'user', false], ['outsider', 'user', false], ['demo', 'super_admin', true],
  ] as const;
  for (const [index, [name, role, isDemo]] of accounts.entries()) {
    await User.create({
      name: `E2E ${name}`, email: `${name}@aoun.invalid`, password, role, isDemo,
      phone: `+962790${String(index + 1).padStart(6, '0')}`, isVerified: true, trustLevel: 2,
    });
  }
  const donor = await User.findOne({ email: 'super@aoun.invalid' });
  await Item.create({ donor: donor!._id, title: 'غرض اصطناعي للاختبار', condition: 'جديد', category: 'كتب', location: 'عمان' });
  await SystemSettings.create({ _id: 'global', requireHubForBooking: false });
  console.log('Synthetic E2E fixture ready');
} finally { await mongoose.disconnect(); }
