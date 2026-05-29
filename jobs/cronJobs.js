// utils/cronJobs.js
// ✅ النسخة النهائية المدمجة — ديناميكية بالكامل
// الدمج بين: النسخة القديمة (hardcoded quota=2) + الـ fix الديناميكي + DonationRequest cleanup

const cron            = require('node-cron');
const User            = require('../models/User');
const Item            = require('../models/Item');
const SystemSettings  = require('../models/SystemSettings');
const { fireSendEmail } = require('../utils/sendEmail');
const { generateOtp }   = require('../utils/otp');

// ══════════════════════════════════════════════════════════════
// helper: معالجة حجز منتهٍ (72 ساعة بدون تسليم)
// ══════════════════════════════════════════════════════════════
async function processExpiredItem(item) {
  const previousBookerId = item.bookedBy;

  let luckyUser      = null;
  const skippedUsers = [];

  // ─── ابحث في الطابور عن أول شخص عنده quota ──────────────
  if (item.waitlist?.length > 0) {
    for (const entry of item.waitlist) {
      const candidate = await User.findOneAndUpdate(
        { _id: entry.user, quota: { $gt: 0 }, isBanned: false },
        { $inc: { quota: -1 } },
        { new: true }
      );
      if (candidate) { luckyUser = candidate; break; }
      else skippedUsers.push(entry.user);
    }
  }

  // ─── احذف المتجاوَزين من الطابور ──────────────────────────
  if (skippedUsers.length > 0) {
    await Item.findByIdAndUpdate(item._id, {
      $pull: { waitlist: { user: { $in: skippedUsers } } },
    });
  }

  // ─── ✅ ATOMIC: يوجد شخص في الطابور ──────────────────────
  if (luckyUser) {
    // ✅ Double Confirmation — لا OTP مطلوب في التسليم
    // لكن لو الـ item لا يزال يستخدم deliveryOtp (نسخة قديمة) نوفره هنا
    const newOtp = generateOtp();

    try {
      await Item.findByIdAndUpdate(item._id, {
        $set: {
          bookedBy:           luckyUser._id,
          status:             'محجوز',
          deliveryOtp:        newOtp,       // سيُزال لاحقاً بعد التحول للـ Double Confirmation
          bookedAt:           new Date(),
          recipientConfirmed: false,        // ✅ إعادة تعيين لـ Double Confirmation
        },
        $pull:     { waitlist:    { user: luckyUser._id } },
        $addToSet: { cancelledBy: previousBookerId        },
      });
    } catch (updateErr) {
      // ✅ استرداد quota إذا فشل تحديث الـ Item
      await User.findByIdAndUpdate(luckyUser._id, { $inc: { quota: 1 } });
      console.error(`[Cron] ❌ فشل تحديث Item ${item._id}، تم استرداد quota:`, updateErr.message);
      return;
    }

    // ✅ إرسال إيميل للمستخدم المحظوظ
    fireSendEmail({
      email:   luckyUser.email,
      subject: `وصل دورك في: ${item.title} 🎉`,
      message: `<div dir="rtl">
        <h2>مرحباً ${luckyUser.name}!</h2>
        <p>انتهى وقت المستلم السابق — الدور وصل لك الآن في <strong>${item.title}</strong>.</p>
        <p>⏱️ لديك <strong>72 ساعة</strong> لإتمام الاستلام من خلال التطبيق.</p>
        <p>تواصل مع المتبرع عبر المنصة لتحديد موعد الاستلام في أقرب Safe Hub.</p>
      </div>`,
    }).catch((emailErr) =>
      console.warn(`[Cron] ⚠️ تعذّر إرسال إيميل للمستخدم ${luckyUser._id}:`, emailErr.message)
    );

  } else {
    // ✅ لا أحد في الطابور → أعد الغرض متاحاً
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

    console.log(`[Cron] 🔄 الغرض "${item.title}" (${item._id}) أُعيد للمتاح — لا يوجد أحد في الطابور`);
  }
}

// ══════════════════════════════════════════════════════════════
// تهيئة جميع الـ Cron Jobs
// ══════════════════════════════════════════════════════════════
const initCronJobs = () => {

  // ─── 1. تصفير الكوتا شهرياً — ديناميكي ────────────────────
  // يعمل في أول يوم من كل شهر الساعة 00:00 (توقيت عمّان)
  cron.schedule('0 0 1 * *', async () => {
    try {
      // ✅ جلب الإعدادات الديناميكية بدل hardcoded 2
      const settings = await SystemSettings.getCached();

      const [r1, r2, r3] = await Promise.all([
        // Level 1 وما دون
        User.updateMany(
          { trustLevel: { $lte: 1 }, isBanned: false },
          { $set: { quota: settings.defaultQuota } }
        ),
        // Level 2
        User.updateMany(
          { trustLevel: 2, isBanned: false },
          { $set: { quota: settings.level2Quota } }
        ),
        // Level 3 وما فوق
        User.updateMany(
          { trustLevel: { $gte: 3 }, isBanned: false },
          { $set: { quota: settings.level3Quota } }
        ),
      ]);

      const totalUpdated = r1.modifiedCount + r2.modifiedCount + r3.modifiedCount;
      console.log(
        `[Cron] ✅ تصفير الكوتا: ${totalUpdated} مستخدم` +
        ` (L1: ${r1.modifiedCount}, L2: ${r2.modifiedCount}, L3+: ${r3.modifiedCount})`
      );

      // أبطل cache الإعدادات بعد الانتهاء
      SystemSettings.invalidateCache();

    } catch (err) {
      console.error('[Cron] ❌ خطأ في تصفير الكوتا:', err.message);
    }
  }, { scheduled: true, timezone: 'Asia/Amman' });


  // ─── 2. فحص الحجوزات المنتهية — كل ساعة ───────────────────
  cron.schedule('0 * * * *', async () => {
    try {
      const threshold    = new Date(Date.now() - 72 * 60 * 60 * 1000); // 72 ساعة
      const expiredItems = await Item.find({
        status:   'محجوز',
        bookedAt: { $lt: threshold },
      }).select('_id bookedBy waitlist donor title').lean();

      if (expiredItems.length === 0) return;

      console.log(`[Cron] 🔍 حجوزات منتهية: ${expiredItems.length}`);

      // ✅ Promise.allSettled — لو item فشل لا يوقف الباقين
      const results = await Promise.allSettled(
        expiredItems.map((item) => processExpiredItem(item))
      );

      const failed  = results.filter((r) => r.status === 'rejected').length;
      const success = expiredItems.length - failed;
      console.log(`[Cron] ✅ عولج ${success}/${expiredItems.length} حجز`);
      if (failed > 0) {
        console.error(`[Cron] ❌ فشل ${failed} حجز`);
        results
          .filter((r) => r.status === 'rejected')
          .forEach((r) => console.error('  >', r.reason?.message));
      }

    } catch (err) {
      console.error('[Cron] ❌ خطأ عام في فحص الحجوزات:', err.message);
    }
  }, { scheduled: true, timezone: 'Asia/Amman' });


  // ─── 3. تنظيف طلبات التبرع المنتهية — يومياً ─────────────
  // يعمل كل يوم الساعة 02:00 صباحاً
  cron.schedule('0 2 * * *', async () => {
    try {
      const DonationRequest = require('../models/DonationRequest');

      const result = await DonationRequest.updateMany(
        { status: 'active', expiresAt: { $lt: new Date() } },
        { $set: { status: 'expired' } }
      );

      if (result.modifiedCount > 0) {
        console.log(`[Cron] ✅ طلبات تبرع منتهية: ${result.modifiedCount}`);
      }
    } catch (err) {
      console.error('[Cron] ❌ خطأ في تنظيف طلبات التبرع:', err.message);
    }
  }, { scheduled: true, timezone: 'Asia/Amman' });

};

module.exports = { initCronJobs };