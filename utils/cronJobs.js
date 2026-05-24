// utils/cronJobs.js
const cron            = require('node-cron');
const User            = require('../models/User');
const Item            = require('../models/Item');
const sendEmail       = require('../utils/sendEmail');
const { generateOtp } = require('../utils/otp');

const initCronJobs = () => {

  // ─── 1. تصفير الكوتا شهرياً (أول يوم بالشهر) ───
  cron.schedule('0 0 1 * *', async () => {
    try {
      await User.updateMany({ isBanned: false }, { $set: { quota: 2 } });
      console.log('✅ تم تصفير الكوتا بنجاح!');
    } catch (err) {
      console.error('❌ خطأ في تصفير الكوتا:', err);
    }
  }, { scheduled: true, timezone: 'Asia/Amman' });

  // ─── 2. فحص الحجوزات المنتهية كل ساعة ───
  cron.schedule('0 * * * *', async () => {
    try {
      const threshold    = new Date(Date.now() - 72 * 60 * 60 * 1000);
      const expiredItems = await Item.find({
        status:   'محجوز',
        bookedAt: { $lt: threshold },
      }).select('_id bookedBy waitlist donor title');

      console.log(`🔍 حجوزات منتهية: ${expiredItems.length}`);

      for (const item of expiredItems) {
        const previousBookerId = item.bookedBy;

        if (previousBookerId) {
          await Item.findByIdAndUpdate(item._id, {
            $addToSet: { cancelledBy: previousBookerId },
          });
        }

        // ─── تمرير الدور للشخص التالي ───
        if (item.waitlist && item.waitlist.length > 0) {
          let luckyUser      = null;
          const skippedUsers = [];

          for (const entry of item.waitlist) {
            const candidate = await User.findOneAndUpdate(
              { _id: entry.user, quota: { $gt: 0 } },
              { $inc: { quota: -1 } },
              { returnDocument: 'after' } // ✅
            );
            if (candidate) {
              luckyUser = candidate;
              break;
            } else {
              skippedUsers.push(entry.user);
            }
          }

          if (skippedUsers.length > 0) {
            await Item.findByIdAndUpdate(item._id, {
              $pull: { waitlist: { user: { $in: skippedUsers } } },
            });
          }

          if (luckyUser) {
            const newOtp = generateOtp();
            await Item.findByIdAndUpdate(item._id, {
              $set: {
                bookedBy:    luckyUser._id,
                status:      'محجوز',
                deliveryOtp: newOtp,
                bookedAt:    new Date(),
              },
              $pull: { waitlist: { user: luckyUser._id } },
            });
            sendEmail({
              email:   luckyUser.email,
              subject: `وصل دورك في: ${item.title} 🎉`,
              message: `<div dir="rtl">انتهى وقت المستلم السابق، الدور لك الآن!<br>رمز الاستلام: <b>${newOtp}</b><p>لديك 72 ساعة لإتمام الاستلام ⏱️</p></div>`,
            }).catch(console.error);
          } else {
            await Item.findByIdAndUpdate(item._id, {
              $set: { status: 'متاح', bookedBy: null, deliveryOtp: null, bookedAt: null },
            });
          }

        } else {
          await Item.findByIdAndUpdate(item._id, {
            $set: { status: 'متاح', bookedBy: null, deliveryOtp: null, bookedAt: null },
          });
        }
      }

      if (expiredItems.length > 0)
        console.log(`✅ تمت معالجة ${expiredItems.length} حجز منتهٍ`);

    } catch (err) {
      console.error('❌ خطأ في فحص الحجوزات:', err);
    }
  }, { scheduled: true, timezone: 'Asia/Amman' });

};

module.exports = { startCronJobs: initCronJobs };
