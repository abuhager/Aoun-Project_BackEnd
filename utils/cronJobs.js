// utils/cronJobs.js
const cron     = require('node-cron');
const User     = require('../models/User');
const Item     = require('../models/Item');
const sendEmail = require('../utils/sendEmail');
const { generateOtp } = require('../utils/otp');

const initCronJobs = () => {

    // ─── 1. تصفير الكوتا شهرياً (أول يوم بالشهر) ───
    cron.schedule('0 0 1 * *', async () => {
        try {
            await User.updateMany({}, { $set: { quota: 2 } });
            console.log('✅ تم تصفير الكوتا بنجاح!');
        } catch (err) {
            console.error('❌ خطأ في تصفير الكوتا:', err);
        }
    }, { scheduled: true, timezone: "Asia/Amman" });

    // ─── 2. فحص الحجوزات المنتهية كل ساعة ───
    cron.schedule('0 * * * *', async () => {
        try {
            // ✅ إصلاح 1: bookedAt بدل updatedAt
            const threshold    = new Date(Date.now() - 72 * 60 * 60 * 1000);
            const expiredItems = await Item.find({
                status:   'محجوز',
                bookedAt: { $lt: threshold }
            });

            console.log(`🔍 حجوزات منتهية: ${expiredItems.length}`);

            for (const item of expiredItems) {
                const previousBookerId = item.bookedBy;

                // 🛑 عقوبة: حظر المستلم المهمل بدون استرداد كوتاه
                if (previousBookerId) {
                    if (!item.cancelledBy) item.cancelledBy = [];

                    // ✅ إصلاح 2: some() بدل includes() للمقارنة الصحيحة مع ObjectId
                    const alreadyBanned = item.cancelledBy.some(
                        id => id.toString() === previousBookerId.toString()
                    );
                    if (!alreadyBanned) item.cancelledBy.push(previousBookerId);
                }

                // ─── تمرير الدور للشخص التالي ───
                if (item.waitlist && item.waitlist.length > 0) {
                    const nextInLine = item.waitlist.shift();
                    const luckyUser  = await User.findOne({
                        _id:   nextInLine.user,
                        quota: { $gt: 0 }   // ✅ فحص الكوتا بالـ query مباشرة
                    });

                    if (luckyUser) {
                        const newOtp     =  generateOtp();
                        item.bookedBy    = luckyUser._id;
                        item.status      = 'محجوز';
                        item.deliveryOtp = newOtp;
                        item.bookedAt    = new Date(); // ✅ إصلاح 4: عداد جديد للشخص الجديد
                        luckyUser.quota -= 1;
                        await luckyUser.save();

                        sendEmail({
                            email:   luckyUser.email,
                            subject: `وصل دورك في: ${item.title} 🎉`,
                            message: `<div dir="rtl">انتهى وقت المستلم السابق، الدور لك الآن! الرمز: <b>${newOtp}</b></div>`
                        }).catch(console.error);

                    } else {
                        // كوتا الشخص التالي 0 → الغرض يرجع متاح
                        item.status      = 'متاح';
                        item.bookedBy    = null;
                        item.deliveryOtp = undefined;
                        item.bookedAt    = undefined;
                    }
                } else {
                    // لا يوجد انتظار → الغرض يرجع متاح
                    item.status      = 'متاح';
                    item.bookedBy    = null;
                    item.deliveryOtp = undefined;
                    item.bookedAt    = undefined;
                }

                await item.save();
            }

            if (expiredItems.length > 0)
                console.log(`✅ تمت معالجة ${expiredItems.length} حجز منتهي`);

        } catch (err) {
            console.error('❌ خطأ في فحص الحجوزات:', err);
        }
    }, { scheduled: true, timezone: "Asia/Amman" });
};

module.exports = initCronJobs;