// utils/ensureIndexes.js
// ✅ شغّل هذا الملف مرة واحدة بعد النشر:
//    node utils/ensureIndexes.js
// أو استدعِه في app.js عند الـ startup

const mongoose        = require('mongoose');
const Item            = require('../models/Item');
const Report          = require('../models/Report');
const DonationRequest = require('../models/DonationRequest');
const User            = require('../models/User');

const ensureIndexes = async () => {
  console.log('⏳ إنشاء الـ Indexes...');

  try {
    // ── Item Indexes ─────────────────────────────────────────
    await Item.collection.createIndexes([
      { key: { status: 1, createdAt: -1 },     name: 'status_createdAt'     },
      { key: { donor: 1, status: 1 },           name: 'donor_status'         },
      { key: { bookedBy: 1, status: 1 },        name: 'bookedBy_status'      },
      { key: { category: 1, status: 1 },        name: 'category_status'      },
      { key: { 'waitlist.user': 1 },            name: 'waitlist_user'        },
      { key: { safeHub: 1 },                    name: 'safeHub'              },
    ]);
    console.log('  ✅ Item indexes');

    // ── Report Indexes ───────────────────────────────────────
    await Report.collection.createIndexes([
      { key: { reportedUser: 1, status: 1 },   name: 'reportedUser_status'  },
      { key: { status: 1, createdAt: -1 },      name: 'status_createdAt'     },
      { key: { reporter: 1 },                   name: 'reporter'             },
    ]);
    console.log('  ✅ Report indexes');

    // ── DonationRequest Indexes ──────────────────────────────
    await DonationRequest.collection.createIndexes([
      { key: { status: 1, expiresAt: 1 },             name: 'status_expiresAt'       },
      { key: { requester: 1, status: 1, month: 1 },   name: 'requester_status_month' },
      { key: { category: 1, status: 1 },              name: 'category_status'        },
      { key: { expiresAt: 1 }, expireAfterSeconds: 0, name: 'ttl_expiresAt'          }, // TTL Index
    ]);
    console.log('  ✅ DonationRequest indexes');

    // ── User Indexes ─────────────────────────────────────────
await User.collection.createIndexes([
  // email_1 موجود مسبقاً من Mongoose — تجاهله
  { key: { trustLevel: 1 }, name: 'trustLevel' },
  { key: { isBanned: 1 },   name: 'isBanned'   },
]);
    console.log('  ✅ User indexes');

    console.log('✅ جميع الـ Indexes تم إنشاؤها بنجاح!');
  } catch (err) {
    console.error('❌ خطأ في إنشاء الـ Indexes:', err.message);
  }
};

// تشغيل مباشر
if (require.main === module) {
  const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/aoun';
  mongoose.connect(MONGODB_URI).then(async () => {
    await ensureIndexes();
    await mongoose.disconnect();
    process.exit(0);
  });
} else {
  module.exports = ensureIndexes;
}
