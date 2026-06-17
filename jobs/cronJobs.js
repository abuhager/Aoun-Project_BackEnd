// jobs/cronJobs.js
// ✅ DC-08 FIX (Flow10): يوم تصفير الكوتا ديناميكي من settings.quotaResetDayOfMonth
// ✅ DC-09 FIX (Flow10): مهلة انتهاء الحجز من settings.bookingExpiryHours
// ✅ NJ-18 FIX (Flow11): إضافة Cron لإرسال إشعار تذكير قبل انتهاء الحجز بساعة
// ✅ NJ-19 FIX (Flow11): تسجيل سجل مركزي لحالة كل Cron Job
// ✅ NJ-20 FIX (Flow11): processExpiredItem تُرسل إشعار notifyUser للمستخدم المحظوظ

const cron       = require('node-cron');
const User       = require('../models/User');
const Item       = require('../models/Item');
const SystemSettings  = require('../models/SystemSettings');
const { settingsEvents } = require('../models/SystemSettings');
const { fireSendEmail }  = require('../utils/sendEmail');
const { generateOtp }    = require('../utils/otp');
const DonationRequest    = require('../models/DonationRequest');
const notifyUser         = require('../utils/notifyUser');  // ✅ NJ-20

// ══════════════════════════════════════════════════════════════
// ✅ NJ-19: سجل حالة Cron Jobs — يُساعد في Debugging
// ══════════════════════════════════════════════════════════════
const cronStatus = {
  'quota-reset':              { lastRun: null, lastStatus: 'pending' },
  'expire-old-bookings':      { lastRun: null, lastStatus: 'pending' },
  'booking-reminder':         { lastRun: null, lastStatus: 'pending' },
  'expire-donation-requests': { lastRun: null, lastStatus: 'pending' },
};

const runSafe = async (name, fn) => {
  const start = Date.now();
  cronStatus[name] = { lastRun: new Date(), lastStatus: 'running' };
  console.log(`[Cron] ⏳ [${name}] بدأت`);
  try {
    await fn();
    cronStatus[name].lastStatus = 'success';
    console.log(`[Cron] ✅ [${name}] اكتملت في ${Date.now() - start}ms`);
  } catch (err) {
    cronStatus[name].lastStatus = 'failed';
    console.error(`[Cron] ❌ [${name}] فشلت:`, err.message);
  }
};

// ✅ للاستخدام في healthcheck endpoint
exports.getCronStatus = () => ({ ...cronStatus });

// ══════════════════════════════════════════════════════════════
// DC-08: Cron تصفير الكوتا — ديناميكية الجدولة
// ══════════════════════════════════════════════════════════════
let _quotaTask = null;

function scheduleQuotaReset(dayOfMonth) {
  if (_quotaTask) { _quotaTask.stop(); _quotaTask = null; }

  const cronExpr = `0 0 ${dayOfMonth} * *`;
  console.log(`[Cron] 📅 جدولة تصفير الكوتا: "${cronExpr}"`);

  _quotaTask = cron.schedule(cronExpr, () => {
    runSafe('quota-reset', async () => {
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
      console.log(
        `[Cron] 📊 تجديد الكوتا: L0-L1=${r1.modifiedCount}, L2+=${r2.modifiedCount}`
      );
      SystemSettings.invalidateCache();
    });
  }, { scheduled: true, timezone: 'Asia/Amman' });
}

// ══════════════════════════════════════════════════════════════
// ✅ NJ-20 FIX: processExpiredItem ترسل إشعار للمستخدم المحظوظ
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
      if (candidate) { luckyUser = candidate; break; }
      else            { skippedUsers.push(entry.user); }
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
        $pull:     { waitlist:    { user: luckyUser._id } },
        $addToSet: { cancelledBy: previousBookerId },
      });
    } catch (updateErr) {
      await User.findByIdAndUpdate(luckyUser._id, { $inc: { quota: 1 } });
      console.error(`[Cron] ❌ فشل تحديث الغرض ${item._id}:`, updateErr.message);
      return;
    }

    // ✅ NJ-20: إشعار داخل التطبيق + بريد إلكتروني
    await notifyUser(luckyUser._id, { // ✅ تعديل: تمرير الـ ID الصريح
      type:      'booking_promoted',
      title:     '🎉 وصل دورك!',
      body:      `انتهى وقت المستلم السابق — الدور وصل لك الآن في "${item.title}".`,
      itemId:    item._id,
      email:     luckyUser.email,
      actionUrl: `/items/${item._id}`,
    }).catch((err) =>
      console.warn('[Cron] notifyUser فشل:', err.message)
    );

    fireSendEmail({
      email:   luckyUser.email,
      subject: `وصل دورك في: ${item.title} 🎉`,
      message: `
        <div dir="rtl" style="font-family:sans-serif;line-height:1.8;max-width:540px;margin:auto;">
          <h2>مرحباً ${luckyUser.name}!</h2>
          <p>انتهى وقت المستلم السابق — الدور وصل لك الآن في <strong>${item.title}</strong>.</p>
          <p>⏱️ لديك مهلة محددة لإتمام الاستلام.</p>
          <p>يرجى التواصل مع المتبرع لتنسيق الاستلام.</p>
        </div>
      `,
    }).catch((err) => console.warn('[Cron] فشل إرسال بريد الترقية:', err.message));

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
// تهيئة كل الـ Cron Jobs
// ══════════════════════════════════════════════════════════════
const initCronJobs = async () => {

  // ── 1. تصفير الكوتا (ديناميكي) ─────────────────────────────
  const initSettings = await SystemSettings.getCached();
  scheduleQuotaReset(initSettings.quotaResetDayOfMonth);

  settingsEvents.on('invalidated', async () => {
    try {
      const fresh = await SystemSettings.getCached();
      scheduleQuotaReset(fresh.quotaResetDayOfMonth);
    } catch (err) {
      console.error('[Cron] ❌ فشل تحديث جدول الكوتا:', err.message);
    }
  });


  // ── 2. فحص الحجوزات المنتهية (كل ساعة) ─────────────────────
  cron.schedule('0 * * * *', () => {
    runSafe('expire-old-bookings', async () => {
      const settings  = await SystemSettings.getCached();
      const expiryMs  = settings.bookingExpiryHours * 60 * 60 * 1000;
      const threshold = new Date(Date.now() - expiryMs);

      // ✅ تحصين الفحص: جلب المستندات التي تحتوي على تاريخ حقيقي وصالح فقط لمنع الـ Cast Error
      const expiredItems = await Item.find({
        status:   'محجوز',
        bookedAt: { $exists: true, $type: 'date', $lt: threshold },
      }).select('_id bookedBy waitlist donor title').lean();

      if (!expiredItems.length) return;

      console.log(`[Cron] 🔍 حجوزات منتهية: ${expiredItems.length}`);

      const results = await Promise.allSettled(
        expiredItems.map((item) => processExpiredItem(item))
      );

      const failed = results.filter((r) => r.status === 'rejected').length;
      console.log(`[Cron] اكتمل: نجح ${expiredItems.length - failed}/${expiredItems.length}`);
      if (failed) {
        results
          .filter((r) => r.status === 'rejected')
          .forEach((r) => console.error('  > فشل:', r.reason?.message));
      }
    });
  }, { scheduled: true, timezone: 'Asia/Amman' });


 // ── 3. ✅ NJ-18: تذكير قبل انتهاء الحجز بساعة (كل ساعة) ─────
  cron.schedule('30 * * * *', () => {
    runSafe('booking-reminder', async () => {
      const settings = await SystemSettings.getCached();
      
      // تأمين القيمة وحمايتها في حال لم تكن رقماً صالحاً
      const expiryHours = Number(settings.bookingExpiryHours) || 24; 
      const expiryMs   = expiryHours * 60 * 60 * 1000;
      
      const windowFrom = new Date(Date.now() - expiryMs + 60 * 60 * 1000); 
      const windowTo   = new Date(Date.now() - expiryMs + 90 * 60 * 1000); 

      // 🛑 التحقق من صلاحية التواريخ قبل إرسال الاستعلام لقاعدة البيانات لمنع الـ Cast Error
      if (isNaN(windowFrom.getTime()) || isNaN(windowTo.getTime())) {
        throw new Error(`حسابات النطاق الزمني غير صالحة: windowFrom=${windowFrom}, windowTo=${windowTo}`);
      }

      // ✅ تحصين الفحص للتذكير أيضاً من الحقول المشوهة وجودة الـ Date
      const soonExpiring = await Item.find({
        status:             'محجوز',
        bookedAt:           { $exists: true, $type: 'date', $gte: windowFrom, $lt: windowTo },
        reminderSent:       { $ne: true } // تعديل بسيط لضمان الفلترة بشكل أدق بدلاً من السلوك الافتراضي المشوه
      }).populate('bookedBy', 'name email').lean();

      if (!soonExpiring.length) return;

      console.log(`[Cron] ⏰ حجوزات قاربت الانتهاء: ${soonExpiring.length}`);

      await Promise.allSettled(
        soonExpiring.map(async (item) => {
          if (!item.bookedBy || !item.bookedBy._id) return;

          // ✅ إصلاح تمرير المعامل الأول لـ notifyUser
          await notifyUser(item.bookedBy._id, {
            type:      'booking_expiry_reminder',
            title:     '⏰ تذكير: حجزك على وشك الانتهاء',
            body:      `لديك ساعة تقريباً لإتمام استلام "${item.title}" — تواصل مع المتبرع الآن.`,
            itemId:    item._id,
            email:     item.bookedBy.email,
            actionUrl: `/items/${item._id}`,
          }).catch((err) => console.warn('[Cron] فشل إشعار التذكير:', err.message));

          await Item.findByIdAndUpdate(item._id, { $set: { reminderSent: true } });
        })
      );
    });
  }, { scheduled: true, timezone: 'Asia/Amman' });

  // ── 4. أرشفة طلبات التبرع المنتهية (يومياً 2 ص) ───────────
  cron.schedule('0 2 * * *', () => {
    runSafe('expire-donation-requests', async () => {
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

module.exports = { initCronJobs, getCronStatus: exports.getCronStatus };