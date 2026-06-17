// jobs/cronJobs.js
// ✅ DC-08 FIX: يوم تصفير الكوتا الآن ديناميكي من settings.quotaResetDayOfMonth
// ✅ DC-09 FIX: مهلة انتهاء الحجز الآن ديناميكية من settings.bookingExpiryHours
// لا يوجد أي رقم hardcoded في هذا الملف

const cron          = require('node-cron');
const User          = require('../models/User');
const Item          = require('../models/Item');
const SystemSettings = require('../models/SystemSettings');
const { settingsEvents } = require('../models/SystemSettings'); // DC-08
const { fireSendEmail }  = require('../utils/sendEmail');
const { generateOtp }    = require('../utils/otp');
const DonationRequest    = require('../models/DonationRequest');

// ══════════════════════════════════════════════════════════════
// Error Isolation Wrapper
// ══════════════════════════════════════════════════════════════
const runSafe = async (name, fn) => {
  try {
    console.log(`[Cron] ⏳ بدأت مهمة: [${name}]`);
    await fn();
    console.log(`[Cron] ✅ اكتملت مهمة: [${name}]`);
  } catch (err) {
    console.error(`[Cron] ❌ فشلت مهمة [${name}]:`, err.message);
  }
};

// ══════════════════════════════════════════════════════════════
// ✅ DC-08 FIX: Cron Task مُعاد جدولتها ديناميكياً
// عند تغيير quotaResetDayOfMonth يُعاد إنشاء الـ task تلقائياً
// ══════════════════════════════════════════════════════════════
let _quotaTask = null; // المهمة الحالية المُسجَّلة

function scheduleQuotaReset(dayOfMonth) {
  // إيقاف المهمة القديمة إن وُجدت
  if (_quotaTask) {
    _quotaTask.stop();
    _quotaTask = null;
    console.log('[Cron] ♻️  إعادة جدولة تصفير الكوتا على يوم:', dayOfMonth);
  }

  // ✅ DC-08: الجدول الآن يقرأ dayOfMonth من الـ settings وليس hardcoded
  const cronExpr = `0 0 ${dayOfMonth} * *`;

  _quotaTask = cron.schedule(cronExpr, () => {
    runSafe('reset-monthly-quotas', async () => {
      const settings = await SystemSettings.getCached();

      const [r1, r2] = await Promise.all([
        User.updateMany(
          { trustLevel: { $lte: 1 }, isBanned: false },
          { $set: { quota: settings.defaultQuota } }
        ),
        User.updateMany(
          { trustLevel: { $gte: 2 }, isBanned: false },
          { $set: { quota: settings.level2Quota } }
        ),
      ]);

      const totalUpdated = r1.modifiedCount + r2.modifiedCount;
      console.log(
        `[Cron] 📊 تجديد الكوتا: ${totalUpdated} مستخدم` +
        ` (L0-L1: ${r1.modifiedCount}, L2+: ${r2.modifiedCount})`
      );

      SystemSettings.invalidateCache();
    });
  }, { scheduled: true, timezone: 'Asia/Amman' });
}

// ══════════════════════════════════════════════════════════════
// helper: معالجة حجز منتهٍ
// ══════════════════════════════════════════════════════════════
async function processExpiredItem(item) {
  const previousBookerId = item.bookedBy;
  let luckyUser = null;
  const skippedUsers = [];

  if (item.waitlist?.length > 0) {
    for (const entry of item.waitlist) {
      const candidate = await User.findOneAndUpdate(
        { _id: entry.user, quota: { $gt: 0 }, isBanned: false },
        { $inc: { quota: -1 } },
        { returnDocument: 'after' }
      );
      if (candidate) {
        luckyUser = candidate;
        break;
      } else {
        skippedUsers.push(entry.user);
      }
    }
  }

  if (skippedUsers.length > 0) {
    await Item.findByIdAndUpdate(item._id, {
      $pull: { waitlist: { user: { $in: skippedUsers } } },
    });
  }

  if (luckyUser) {
    const newOtp = generateOtp();
    try {
      await Item.findByIdAndUpdate(item._id, {
        $set: {
          bookedBy:           luckyUser._id,
          status:             'محجوز',
          deliveryOtp:        newOtp,
          bookedAt:           new Date(),
          recipientConfirmed: false,
        },
        $pull:    { waitlist:    { user: luckyUser._id } },
        $addToSet: { cancelledBy: previousBookerId },
      });
    } catch (updateErr) {
      await User.findByIdAndUpdate(luckyUser._id, { $inc: { quota: 1 } });
      console.error(`[Cron] ❌ فشل تحديث الغرض ${item._id}:`, updateErr.message);
      return;
    }

    fireSendEmail({
      email:   luckyUser.email,
      subject: `وصل دورك في: ${item.title} 🎉`,
      message: `
        <div dir="rtl">
          <h2>مرحباً ${luckyUser.name}!</h2>
          <p>انتهى وقت المستلم السابق — الدور وصل لك الآن في <strong>${item.title}</strong>.</p>
          <p>⏱️ لديك مهلة محددة لإتمام الاستلام.</p>
          <p>يرجى التواصل مع المتبرع لتنسيق الاستلام.</p>
        </div>
      `,
    }).catch((emailErr) =>
      console.warn(`[Cron] ⚠️ تعذّر إرسال بريد:`, emailErr.message)
    );
  } else {
    await Item.findByIdAndUpdate(item._id, {
      $set: {
        status:             'متاح',
        bookedBy:           null,
        deliveryOtp:        null,
        bookedAt:           null,
        recipientConfirmed: false,
      },
      $addToSet: { cancelledBy: previousBookerId },
    });
  }
}

// ══════════════════════════════════════════════════════════════
// تهيئة الـ Cron Jobs
// ══════════════════════════════════════════════════════════════
const initCronJobs = async () => {

  // ── 1. تصفير الكوتا — ديناميكي ──────────────────────────────────────────
  // ✅ DC-08: قراءة اليوم من الإعدادات عند بدء التشغيل
  const initSettings = await SystemSettings.getCached();
  scheduleQuotaReset(initSettings.quotaResetDayOfMonth);

  // ✅ DC-08: إعادة الجدولة عند تغيير الإعدادات — يستمع لـ settingsEvents
  settingsEvents.on('invalidated', async () => {
    try {
      const fresh = await SystemSettings.getCached();
      scheduleQuotaReset(fresh.quotaResetDayOfMonth);
    } catch (err) {
      console.error('[Cron] ❌ فشل تحديث جدول تصفير الكوتا:', err.message);
    }
  });


  // ── 2. فحص الحجوزات المنتهية (كل ساعة) ─────────────────────────────────
  // ✅ DC-09: مهلة الحجز الآن تُقرأ من settings.bookingExpiryHours
  cron.schedule('0 * * * *', () => {
    runSafe('expire-old-bookings', async () => {
      // ✅ DC-09 FIX: بدل 72 * 60 * 60 * 1000 hardcoded
      const settings  = await SystemSettings.getCached();
      const expiryMs  = settings.bookingExpiryHours * 60 * 60 * 1000;
      const threshold = new Date(Date.now() - expiryMs);

      const expiredItems = await Item.find({
        status:   'محجوز',
        bookedAt: { $lt: threshold },
      }).select('_id bookedBy waitlist donor title').lean();

      if (expiredItems.length === 0) return;

      console.log(`[Cron] 🔍 حجوزات منتهية: ${expiredItems.length}`);

      const results = await Promise.allSettled(
        expiredItems.map((item) => processExpiredItem(item))
      );

      const failed  = results.filter((r) => r.status === 'rejected').length;
      const success = expiredItems.length - failed;

      console.log(`[Cron] 🦾 اكتمل الفحص: نجح ${success}/${expiredItems.length}`);
      if (failed > 0) {
        results
          .filter((r) => r.status === 'rejected')
          .forEach((r) => console.error('  > سبب الفشل:', r.reason?.message));
      }
    });
  }, { scheduled: true, timezone: 'Asia/Amman' });


  // ── 3. أرشفة طلبات التبرع المنتهية (يومياً 2 ص) ──────────────────────────
  cron.schedule('0 2 * * *', () => {
    runSafe('cleanup-expired-donation-requests', async () => {
      const result = await DonationRequest.updateMany(
        { status: 'active', expiresAt: { $lt: new Date() } },
        { $set: { status: 'expired' } }
      );
      if (result.modifiedCount > 0) {
        console.log(`[Cron] 🧹 ${result.modifiedCount} طلب تبرع انتهت صلاحيته`);
      }
    });
  }, { scheduled: true, timezone: 'Asia/Amman' });

};

module.exports = { initCronJobs };