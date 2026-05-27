// utils/cronJobs.js ✅ Fixed
const cron            = require('node-cron');
const User            = require('../models/User');
const Item            = require('../models/Item');
const sendEmail       = require('../utils/sendEmail');
const { generateOtp } = require('../utils/otp');

// ─── معالجة item منتهٍ — دالة منفصلة للوضوح ────────────────
async function processExpiredItem(item) {
  const previousBookerId = item.bookedBy;

  // ─── ابحث عن أول شخص في الطابور عنده quota ──────────────
  let luckyUser      = null;
  const skippedUsers = [];

  if (item.waitlist?.length > 0) {
    for (const entry of item.waitlist) {
      const candidate = await User.findOneAndUpdate(
        { _id: entry.user, quota: { $gt: 0 } },
        { $inc: { quota: -1 } },
        { new: true }
      );
      if (candidate) { luckyUser = candidate; break; }
      else skippedUsers.push(entry.user);
    }
  }

  // ─── حذف المتجاوَزين من الطابور ───────────────────────────
  if (skippedUsers.length > 0) {
    await Item.findByIdAndUpdate(item._id, {
      $pull: { waitlist: { user: { $in: skippedUsers } } },
    });
  }

  // ─── ✅ ATOMIC: كل العمليات في query واحد ─────────────────
  if (luckyUser) {
    const newOtp = generateOtp();

    try {
      await Item.findByIdAndUpdate(item._id, {
        $set: {
          bookedBy:    luckyUser._id,
          status:      'محجوز',
          deliveryOtp: newOtp,
          bookedAt:    new Date(),
        },
        $pull:     { waitlist:     { user: luckyUser._id } },
        $addToSet: { cancelledBy:  previousBookerId ?? [] },
      });
    } catch (err) {
      // ✅ استرداد quota إذا فشل تحديث الـ Item
      await User.findByIdAndUpdate(luckyUser._id, { $inc: { quota: 1 } });
      console.error(`❌ فشل تحديث Item ${item._id}، تم استرداد quota:`, err.message);
      return;
    }

    sendEmail({
      email:   luckyUser.email,
      subject: `وصل دورك في: ${item.title} 🎉`,
      message: `<div dir="rtl">انتهى وقت المستلم السابق، الدور لك!<br>
                رمز الاستلام: <b>${newOtp}</b>
                <p>لديك 72 ساعة لإتمام الاستلام ⏱️</p></div>`,
    }).catch(console.error);

  } else {
    // ✅ لا يوجد أحد في الطابور أو لا أحد عنده quota → أعد الغرض للمتاح
    await Item.findByIdAndUpdate(item._id, {
      $set:      { status: 'متاح', bookedBy: null, deliveryOtp: null, bookedAt: null },
      $addToSet: { cancelledBy: previousBookerId ?? [] },
    });
  }
}

// ─────────────────────────────────────────────────────────────
const initCronJobs = () => {

  // ─── 1. تصفير الكوتا شهرياً (أول يوم بالشهر) ─────────────
  cron.schedule('0 0 1 * *', async () => {
    try {
      await User.updateMany({ isBanned: false }, { $set: { quota: 2 } });
      console.log('✅ تم تصفير الكوتا');
    } catch (err) {
      console.error('❌ خطأ في تصفير الكوتا:', err);
    }
  }, { scheduled: true, timezone: 'Asia/Amman' });

  // ─── 2. فحص الحجوزات المنتهية كل ساعة ────────────────────
  cron.schedule('0 * * * *', async () => {
    try {
      const threshold    = new Date(Date.now() - 72 * 60 * 60 * 1000);
      const expiredItems = await Item.find({
        status:   'محجوز',
        bookedAt: { $lt: threshold },
      }).select('_id bookedBy waitlist donor title');

      if (expiredItems.length === 0) return;

      console.log(`🔍 حجوزات منتهية: ${expiredItems.length}`);

      // ✅ BUG-CRON-3: معالجة متوازية — لو item واحد فشل لا يوقف الباقين
      const results = await Promise.allSettled(
        expiredItems.map(item => processExpiredItem(item))
      );

      const failed = results.filter(r => r.status === 'rejected').length;
      console.log(`✅ عولج ${expiredItems.length - failed}/${expiredItems.length} حجز`);
      if (failed > 0) console.error(`❌ فشل ${failed} حجز`);

    } catch (err) {
      console.error('❌ خطأ عام في cron الحجوزات:', err);
    }
  }, { scheduled: true, timezone: 'Asia/Amman' });

};

module.exports = { initCronJobs };
