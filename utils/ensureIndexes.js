// utils/ensureIndexes.js — نسخة محصّنة ضد تعارض الأسماء
const mongoose        = require('mongoose');
const Item            = require('../models/Item');
const Report          = require('../models/Report');
const DonationRequest = require('../models/DonationRequest');
const User            = require('../models/User');

// ✅ دالة آمنة: تنشئ index واحد وتتجاهل تعارض الاسم بهدوء (index موجود مسبقاً بنفس الحقول)
const safeCreateIndex = async (collection, indexSpec, label) => {
  try {
    await collection.createIndexes([indexSpec]);
    console.log(`    ✓ ${indexSpec.name}`);
  } catch (err) {
    // 85 = IndexOptionsConflict · 86 = IndexKeySpecsConflict
    // تعني: index بنفس الحقول موجود مسبقاً باسم مختلف — لا داعي للفشل، هو موجود فعلياً ويؤدي نفس الغرض
    if (err.code === 85 || err.code === 86) {
      console.log(`    ⏭️  ${indexSpec.name} — موجود مسبقاً بنفس الحقول (تم التجاوز)`);
    } else {
      console.error(`    ❌ ${indexSpec.name} فشل:`, err.message);
    }
  }
};

const ensureIndexes = async () => {
  console.log('⏳ إنشاء الـ Indexes...');

  // ── Item Indexes ─────────────────────────────────────────
  const itemIndexes = [
    { key: { status: 1, createdAt: -1 }, name: 'status_createdAt' },
    { key: { donor: 1, status: 1 },      name: 'donor_status' },
    { key: { bookedBy: 1, status: 1 },   name: 'bookedBy_status' },
    { key: { category: 1, status: 1 },   name: 'category_status' },
    { key: { 'waitlist.user': 1 },       name: 'waitlist_user' },
    { key: { safeHub: 1 },               name: 'safeHub' },
  ];
  for (const idx of itemIndexes) await safeCreateIndex(Item.collection, idx);
  console.log('  ✅ Item indexes');

  // ── Report Indexes ───────────────────────────────────────
  const reportIndexes = [
    { key: { reportedUser: 1, status: 1 }, name: 'reportedUser_status' },
    { key: { status: 1, createdAt: -1 },    name: 'status_createdAt' },
    { key: { reporter: 1 },                 name: 'reporter' },
  ];
  for (const idx of reportIndexes) await safeCreateIndex(Report.collection, idx);
  console.log('  ✅ Report indexes');

  // ── DonationRequest Indexes ──────────────────────────────
  const donationIndexes = [
    { key: { status: 1, expiresAt: 1 },           name: 'status_expiresAt' },
    { key: { requester: 1, status: 1, month: 1 }, name: 'requester_status_month' },
    { key: { category: 1, status: 1 },            name: 'category_status' },
    { key: { expiresAt: 1 }, expireAfterSeconds: 0, name: 'ttl_expiresAt' },
  ];
  for (const idx of donationIndexes) await safeCreateIndex(DonationRequest.collection, idx);
  console.log('  ✅ DonationRequest indexes');

  // ── User Indexes ─────────────────────────────────────────
  const userIndexes = [
    { key: { trustLevel: 1 }, name: 'trustLevel' },
    { key: { isBanned: 1 },   name: 'isBanned' },
  ];
  for (const idx of userIndexes) await safeCreateIndex(User.collection, idx);
  console.log('  ✅ User indexes');

  console.log('✅ جميع الـ Indexes تم التحقق منها (تم إنشاء الجديد وتجاوز الموجود)!');
};

if (require.main === module) {
  const MONGODB_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/aoun';
  mongoose.connect(MONGODB_URI).then(async () => {
    await ensureIndexes();
    await mongoose.disconnect();
    process.exit(0);
  });
} else {
  module.exports = ensureIndexes;
}