// utils/cronJobs.js
const cron = require('node-cron');
const User = require('../models/User');
const Item = require('../models/Item');
const SystemSettings = require('../models/SystemSettings');
const { fireSendEmail } = require('../utils/sendEmail');
const { generateOtp } = require('../utils/otp');

// ══════════════════════════════════════════════════════════════
// 🛡️ دالة عزل الأخطاء المركزية (Error Isolation Wrapper)
// ══════════════════════════════════════════════════════════════
const runSafe = async (name, fn) => {
  try {
    console.log(`[Cron] ⏳ بدأت مهمة: [${name}]`);
    await fn();
    console.log(`[Cron] ✅ اكتملت مهمة: [${name}] بنجاح`);
  } catch (err) {
    console.error(`[Cron] ❌ فشلت مهمة [${name}]:`, err.message);
  }
};

// ══════════════════════════════════════════════════════════════
// helper: معالجة حجز منتهٍ (72 ساعة بدون تسليم)
// ══════════════════════════════════════════════════════════════
async function processExpiredItem(item) {
  const previousBookerId = item.bookedBy;
  let luckyUser = null;
  const skippedUsers = [];

  // ─── ابحث في الطابور عن أول شخص عنده كوتا متاحة ──────────────
  if (item.waitlist?.length > 0) {
    for (const entry of item.waitlist) {
      const candidate = await User.findOneAndUpdate(
        { _id: entry.user, quota: { $gt: 0 }, isBanned: false },
        { $inc: { quota: -1 } },
        { new: true }
      );
      if (candidate) { 
        luckyUser = candidate; 
        break; 
      } else {
        skippedUsers.push(entry.user);
      }
    }
  }

  // ─── تنظيف المتجاوَزين من الطابور (الذين ليس لديهم كوتا) ──────────
  if (skippedUsers.length > 0) {
    await Item.findByIdAndUpdate(item._id, {
      $pull: { waitlist: { user: { $in: skippedUsers } } },
    });
  }

  // ─── ✅ حالة ذرية (Atomic): يوجد شخص مستحق في الطابور ──────────────
  if (luckyUser) {
    const newOtp = generateOtp();

    try {
      await Item.findByIdAndUpdate(item._id, {
        $set: {
          bookedBy: luckyUser._id,
          status: 'محجوز',
          deliveryOtp: newOtp,
          bookedAt: new Date(),
          recipientConfirmed: false,
        },
        $pull: { waitlist: { user: luckyUser._id } },
        $addToSet: { cancelledBy: previousBookerId },
      });
    } catch (updateErr) {
      await User.findByIdAndUpdate(luckyUser._id, { $inc: { quota: 1 } });
      console.error(`[Cron] ❌ فشل تحديث الغرض ${item._id}، تم استرداد الكوتا للمستخدم:`, updateErr.message);
      return;
    }

    fireSendEmail({
      email: luckyUser.email,
      subject: `وصل دورك في: ${item.title} 🎉`,
      message: `
        <div dir="rtl">
          <h2>مرحباً ${luckyUser.name}!</h2>
          <p>انتهى وقت المستلم السابق — الدور وصل لك الآن في <strong>${item.title}</strong>.</p>
          <p>⏱️ لديك <strong>72 ساعة</strong> لإتمام الاستلام وتأكيده عبر المنصة.</p>
          <p>يرجى التواصل مع المتبرع لتنسيق الاستلام.</p>
        </div>
      `,
    }).catch((emailErr) =>
      console.warn(`[Cron] ⚠️ تعذّر إرسال بريد للمستخدم الجديد ${luckyUser._id}:`, emailErr.message)
    );

  } else {
    await Item.findByIdAndUpdate(item._id, {
      $set: {
        status: 'متاح',
        bookedBy: null,
        deliveryOtp: null,
        bookedAt: null,
        recipientConfirmed: false,
      },
      $addToSet: { cancelledBy: previousBookerId },
    });

    console.log(`[Cron] 🔄 الغرض "${item.title}" (${item._id}) متاح للجميع الآن — القائمة فارغة`);
  }
}

// ══════════════════════════════════════════════════════════════
// تهيئة وتوزيع الـ Cron Jobs
// ══════════════════════════════════════════════════════════════
const initCronJobs = () => {

  // ─── 1. تصفير وتجديد الكوتا شهرياً (ديناميكي) ────────────────────
  cron.schedule('0 0 1 * *', () => {
    runSafe('reset-monthly-quotas', async () => {
      const settings = await SystemSettings.getCached();

      const [r1, r2, r3] = await Promise.all([
        User.updateMany(
          { trustLevel: { $lte: 1 }, isBanned: false },
          { $set: { quota: settings.defaultQuota } }
        ),
        User.updateMany(
          { trustLevel: 2, isBanned: false },
          { $set: { quota: settings.level2Quota } }
        ),
      ]);

      const totalUpdated = r1.modifiedCount + r2.modifiedCount + r3.modifiedCount;
      console.log(
        `[Cron] 📊 إحصائيات تجديد الكوتا شهرياً للـ Users: ${totalUpdated} مستخدم` +
        ` (L1: ${r1.modifiedCount}, L2: ${r2.modifiedCount}, L3+: ${r3.modifiedCount})`
      );

      SystemSettings.invalidateCache();
    });
  }, { scheduled: true, timezone: 'Asia/Amman' });


  // ─── 2. فحص ومعالجة الحجوزات المنتهية (كل ساعة) ───────────────────
  cron.schedule('0 * * * *', () => {
    runSafe('expire-old-bookings', async () => {
      const threshold = new Date(Date.now() - 72 * 60 * 60 * 1000);
      
      const expiredItems = await Item.find({
        status: 'محجوز',
        bookedAt: { $lt: threshold },
      }).select('_id bookedBy waitlist donor title').lean();

      if (expiredItems.length === 0) return;

      console.log(`[Cron] 🔍 تم رصد حجوزات تجاوزت المهلة المحددة: ${expiredItems.length}`);

      const results = await Promise.allSettled(
        expiredItems.map((item) => processExpiredItem(item))
      );

      const failed = results.filter((r) => r.status === 'rejected').length;
      const success = expiredItems.length - failed;
      
      console.log(`[Cron] 🦾 اكتمال فحص الحجوزات: نجح معالجة ${success}/${expiredItems.length}`);
      
      if (failed > 0) {
        console.error(`[Cron] 🚨 تفاصيل الفشل في الحجوزات: واجه ${failed} غرض مشاكل أثناء التحديث الآلي`);
        results
          .filter((r) => r.status === 'rejected')
          // ✅ تم إزالة الـ :any من السطر التالي ليعمل كـ جافا سكريبت حرة وبدون أخطاء
          .forEach((r) => console.error('  > سبب الفشل الإجرائي:', r.reason?.message));
      }
    });
  }, { scheduled: true, timezone: 'Asia/Amman' });


  // ─── 3. تنظيف وأرشفة طلبات التبرع المنتهية صلاحيتها (يومياً) ─────────────
  cron.schedule('0 2 * * *', () => {
    runSafe('cleanup-expired-donation-requests', async () => {
      const DonationRequest = require('../models/DonationRequest');

      const result = await DonationRequest.updateMany(
        { status: 'active', expiresAt: { $lt: new Date() } },
        { $set: { status: 'expired' } }
      );

      if (result.modifiedCount > 0) {
        console.log(`[Cron] 🧹 تم تحويل ${result.modifiedCount} طلب تبرع نشط إلى منتهي الصلاحية`);
      }
    });
  }, { scheduled: true, timezone: 'Asia/Amman' });

};

module.exports = { initCronJobs };