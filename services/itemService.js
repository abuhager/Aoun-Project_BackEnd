// services/itemService.js
const mongoose = require('mongoose');
const Item = require('../models/Item');
const User = require('../models/User');
const Report = require('../models/Report');
const SystemSettings = require('../models/SystemSettings');
const { getSettings } = require('./settingsService');

const itemRepository = require('../repositories/itemRepository');
const AppError = require('../utils/AppError');
const SafeHub = require('../models/SafeHub');

const { fireSendEmail } = require('../utils/sendEmail');
const { uploadToCloudinary } = require('../utils/uploadToCloudinary');
const notifyUser = require('../utils/notifyUser');
const { toPublicItem } = require('../dtos/itemDto');

// ─── [FIX-4] دالة مشتركة لفحص الصورة — تُستخدم في createItemLogic وأي مكان آخر ──
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB

const validateImageFile = (file) => {
  if (!file) throw new AppError('الصورة مطلوبة', 400, 'IMAGE_REQUIRED');
  if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype))
    throw new AppError('نوع الصورة غير مدعوم (JPEG/PNG/WebP فقط)', 400, 'INVALID_IMAGE_TYPE');
  if (file.size > MAX_IMAGE_SIZE)
    throw new AppError('حجم الصورة يتجاوز 5MB', 400, 'IMAGE_TOO_LARGE');
};

// ─── [FIX-4] دالة مشتركة لبناء room name — بدلاً من template literal متكرر ──────
const getUserRoom = (userId) => `user_${userId}`;

const escapeRegex = (str = '') =>
  String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 100);

// ─────────────────────────────────────────────────────────────────────────────────
// 1. جلب الأغراض المتاحة
// ─────────────────────────────────────────────────────────────────────────────────
exports.getItemsLogic = async (query) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);

  // ✅ [FIX-6] limit مسحوب من SystemSettings بدلاً من hardcoded 20
  const settings = await SystemSettings.getCached();
  const maxPageSize = settings.maxPageSize ?? 20;
  const limit = Math.min(maxPageSize, Math.max(1, parseInt(query.limit, 10) || 10));
  const skip = (page - 1) * limit;

  const filter = { status: 'متاح' };

  if (query.location) filter.location = new RegExp(escapeRegex(query.location), 'i');
  if (query.search)   filter.title    = new RegExp(escapeRegex(query.search),   'i');
  if (query.category && query.category !== 'all') filter.category = query.category;

  const [items, total] = await Promise.all([
    Item.find(filter)
      .populate('donor', 'name avatar trustScore isVerifiedStudent trustLevel')
      .populate('safeHub', 'name address city workingHours')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      // ✅ [FIX-A] حُذف -deliveryOtp من select لأنه لم يعد موجوداً
      .select('-waitlist -__v')
      .lean(),
    Item.countDocuments(filter),
  ]);

  return {
    items: items.map(toPublicItem),
    total,
    page,
    pages: Math.ceil(total / limit),
  };
};

// ─────────────────────────────────────────────────────────────────────────────────
// 2. جلب أغراضي (تبرعاتي + حجوزاتي)
// ─────────────────────────────────────────────────────────────────────────────────
exports.getMyItemsLogic = async (userId) => {
  const [user, myDonations, myRequests] = await Promise.all([
    User.findById(userId).select('name email trustScore quota isVerifiedStudent gamification').lean(),
    Item.find({ donor: userId }).populate('bookedBy', 'name avatar').sort({ createdAt: -1 }).lean(),
    Item.find({ bookedBy: userId }).populate('donor', 'name avatar').sort({ createdAt: -1 }).lean(),
  ]);

  const donationIds = myDonations.map((i) => i._id);
  const requestIds  = myRequests.map((i) => i._id);
  const allItemIds  = [...donationIds, ...requestIds];

  const reports = await Report.find({
    relatedItem:  { $in: allItemIds },
    reportedUser: userId,
    status:       { $in: ['pending', 'actioned'] },
  }).select('relatedItem').lean();

  const reportMap = new Map(reports.map((r) => [r.relatedItem.toString(), r._id.toString()]));

  return {
    user,
    myDonations: myDonations.map((item) => ({ ...item, reportId: reportMap.get(item._id.toString()) ?? null })),
    myRequests:  myRequests.map((item)  => ({ ...item, reportId: reportMap.get(item._id.toString()) ?? null })),
  };
};

// ─────────────────────────────────────────────────────────────────────────────────
// 3. جلب غرض بالـ ID
// ─────────────────────────────────────────────────────────────────────────────────
exports.getItemByIdLogic = async (itemId, requesterId) => {
  const item = await itemRepository.findItemDetails(itemId);
  if (!item) throw Object.assign(new Error('الغرض غير موجود'), { status: 404 });

  // ✅ [FIX-A] لا يوجد deliveryOtp لحذفه — الكود مبسَّط
  return item.toObject ? item.toObject() : { ...item };
};

// ─────────────────────────────────────────────────────────────────────────────────
// 4. إضافة غرض جديد
// ─────────────────────────────────────────────────────────────────────────────────
exports.createItemLogic = async (body, userId, file) => {
  // ✅ [FIX-3 + FIX-4] فحص الصورة عبر الدالة المشتركة
  validateImageFile(file);

  const [user, settings, activeCount, safeHub] = await Promise.all([
    User.findById(userId).select('isVerified trustLevel quota').lean(),
    SystemSettings.getCached(),
    Item.countDocuments({ donor: userId, status: { $in: ['متاح', 'محجوز'] } }),
    SafeHub.findOne({ _id: body.safeHub, isActive: true }).lean(),
  ]);

  if (!user) throw new AppError('المستخدم غير موجود', 404, 'USER_NOT_FOUND');
  if (!user.isVerified) throw new AppError('يجب تفعيل الحساب أولاً ✅', 403, 'ACCOUNT_NOT_VERIFIED');
  if (!safeHub) throw new AppError('نقطة الاستلام غير موجودة أو غير مفعّلة', 400, 'INVALID_SAFE_HUB');

  if (body.category && !settings.categories?.includes(body.category)) {
    throw new AppError(`التصنيف "${body.category}" غير مدعوم`, 400, 'INVALID_CATEGORY');
  }

  const maxItems =
    user.trustLevel >= 2
      ? (settings.level2Quota ?? settings.maxActiveItems ?? 4)
      : (settings.defaultQuota ?? settings.maxActiveItems ?? 2);

  if (activeCount >= maxItems) {
    throw new AppError(
      `لا يمكنك نشر أكثر من ${maxItems} غرض نشط في نفس الوقت`,
      429,
      'MAX_ACTIVE_ITEMS_REACHED'
    );
  }

  const uploadResult = await uploadToCloudinary(file.buffer);

  const item = await Item.create({
    title:       body.title?.trim(),
    description: body.description?.trim(),
    category:    body.category,
    location:    body.location?.trim(),
    condition:   body.condition,
    safeHub:     body.safeHub,
    donor:       userId,
    imageUrl:    uploadResult.secure_url,
    cloudinaryId: uploadResult.public_id,
  });

  return { msg: 'تم إضافة الغرض بنجاح 🎉', item };
};

// ─────────────────────────────────────────────────────────────────────────────────
// 5. حجز غرض
// ─────────────────────────────────────────────────────────────────────────────────
exports.bookItemLogic = async (itemId, userId) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const item = await Item.findById(itemId).session(session);

    if (!item) throw new AppError('الغرض غير موجود', 404, 'ITEM_NOT_FOUND');
    if (item.donor.toString() === userId)
      throw new AppError('لا يمكنك حجز غرضك الخاص 🚫', 400, 'CANNOT_BOOK_OWN_ITEM');
    if (item.cancelledBy?.some((id) => id.toString() === userId))
      throw new AppError('لا يمكنك الحجز مجدداً 🛑', 400, 'BOOKING_RETRY_NOT_ALLOWED');

    const settings = await getSettings();

    const activeBookingsCount = await Item.countDocuments({
      bookedBy: userId,
      status: 'محجوز',
    }).session(session);

    const maxQuota = (await User.findById(userId).select('trustLevel').lean())?.trustLevel >= 2
      ? settings.level2Quota
      : settings.defaultQuota;

    if (activeBookingsCount >= maxQuota) {
      throw new AppError(
        `عذراً، استهلكت الحد الأقصى (${maxQuota}) غرض 🚫`,
        403,
        'NO_AVAILABLE_QUOTA'
      );
    }

    // ✅ مسار الحجز المباشر
    if (item.status === 'متاح') {
      // ✅ [FIX-A] حُذف generateOtp بالكامل — لا OTP في الحجز
      const booked = await Item.findOneAndUpdate(
        { _id: itemId, status: 'متاح' },
        {
          $set: {
            status:   'محجوز',
            bookedBy: userId,
            bookedAt: new Date(),
          },
        },
        { returnDocument: 'after', session }
      ).populate('safeHub', 'name address city workingHours');

      if (booked) {
        // ✅ [FIX-C1] خصم quota ذري مع filter حماية — بدلاً من user.save()
        const updatedUser = await User.findOneAndUpdate(
          { _id: userId, quota: { $gt: 0 } },
          { $inc: { quota: -1 } },
          { session, new: true }
        );

        if (!updatedUser) {
          // لو وصلنا هنا معناه quota = 0 رغم الفحص → race condition نادر
          await session.abortTransaction();
          session.endSession();
          throw new AppError('لا تملك حصة كافية 🚫', 403, 'NO_AVAILABLE_QUOTA');
        }

        await session.commitTransaction();
        session.endSession();

        // إشعارات بعد commit — بدون OTP
        triggerBookingNotifications(booked, updatedUser);
        return { status: 'booked', msg: 'تم الحجز بنجاح 🎉' };
      }

      // Concurrency: فشل الحجز — abort ثم Waitlist خارجها
      await session.abortTransaction();
      session.endSession();
      return await handleWaitlistOutside(itemId, userId);
    }

    // الغرض محجوز مسبقاً — abort ثم Waitlist
    await session.abortTransaction();
    session.endSession();
    return await handleWaitlistOutside(itemId, userId);

  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    if (!session.hasEnded) session.endSession();
    throw err;
  }
};

// ─── دالة مساعدة: إضافة المستخدم لقائمة الانتظار بشكل آمن ───────────────────
async function handleWaitlistOutside(itemId, userId) {
  const waitlistUpdated = await Item.findOneAndUpdate(
    { _id: itemId, 'waitlist.user': { $ne: userId } },
    { $push: { waitlist: { user: userId, joinedAt: new Date() } } },
    { new: true }
  );

  if (!waitlistUpdated) {
    throw new AppError('أنت بالفعل في قائمة الانتظار ⏳', 409, 'ALREADY_IN_WAITLIST');
  }

  return { status: 'waitlist', msg: 'تمت إضافتك لقائمة الانتظار ⏳' };
}

// ─── [FIX-A] دالة الإشعارات — بدون OTP ──────────────────────────────────────
function triggerBookingNotifications(bookedItem, user) {
  const settings = SystemSettings.getCached();

  const hubSection = bookedItem.safeHub
    ? `<hr/>
       <p>📍 <b>نقطة التسليم:</b> ${bookedItem.safeHub.name}</p>
       <p>🏙️ ${bookedItem.safeHub.city} — ${bookedItem.safeHub.address}</p>
       <p>🕐 أوقات العمل: ${bookedItem.safeHub.workingHours || 'غير محدد'}</p>`
    : `<p>📦 سيتم التنسيق مع المتبرع مباشرة</p>`;

  Promise.all([
    notifyUser(bookedItem.donor, {
      type:   'item_booked',
      title:  'تم حجز غرضك! 🎉',
      body:   `قام شخص ما بحجز "${bookedItem.title}"`,
      itemId: bookedItem._id,
    }),
    // ✅ [FIX-6] مدة الاستلام مسحوبة من settings بدلاً من "72 ساعة" hardcoded
    settings.then((s) =>
      fireSendEmail({
        email:   user.email,
        subject: 'تم حجز الغرض 🎉',
        message: `
          <div dir="rtl">
            <p>تم حجز <b>${bookedItem.title}</b> بنجاح!</p>
            <p>⏱️ لديك <b>${s.bookingExpiryHours ?? 72} ساعة</b> لاستلام الغرض</p>
            <p>📌 توجّه إلى نقطة التسليم وأكّد الاستلام من التطبيق</p>
            ${hubSection}
          </div>
        `,
      }).catch((err) => console.error('[Email] فشل إرسال إشعار الحجز:', err.message))
    ),
  ]).catch((err) => console.error('[Notifications] فشل إرسال الإشعارات:', err.message));
}

// ─────────────────────────────────────────────────────────────────────────────────
// 6. إلغاء الحجز
// ─────────────────────────────────────────────────────────────────────────────────
exports.cancelBookingLogic = async (itemId, userId) => {
  const item = await itemRepository.findItemForAction(itemId);

  if (!item) throw new AppError('الغرض غير موجود', 404, 'ITEM_NOT_FOUND');

  const isBooker = item.bookedBy && item.bookedBy.toString() === userId;
  const isDonor  = item.donor.toString() === userId;
  const inWait   = item.waitlist?.some((w) => w.user.toString() === userId);

  if (!isBooker && !isDonor && !inWait) {
    throw new AppError('غير مصرح لك', 403, 'FORBIDDEN');
  }

  // الانسحاب من قائمة الانتظار فقط
  if (inWait && !isBooker && !isDonor) {
    await Item.findByIdAndUpdate(item._id, {
      $pull: { waitlist: { user: userId } },
    });
    return { msg: 'تم انسحابك من قائمة الانتظار 🚶‍♂️' };
  }

  const previousBooker = item.bookedBy;

  // ✅ [FIX-C2] تمرير Waitlist داخل Transaction كاملة
  if (item.waitlist?.length > 0) {
    const topWaiting = item.waitlist.slice(0, 3);

    for (const waiting of topWaiting) {
      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        const nextValidUser = await User.findOneAndUpdate(
          { _id: waiting.user, quota: { $gt: 0 } },
          { $inc: { quota: -1 } },
          { session, new: true }
        );

        if (!nextValidUser) {
          await session.abortTransaction();
          session.endSession();
          continue;
        }

        const updated = await Item.findOneAndUpdate(
          { _id: item._id, 'waitlist.user': nextValidUser._id },
          {
            $set: {
              status:   'محجوز',
              bookedBy: nextValidUser._id,
              bookedAt: new Date(),
            },
            $pull: { waitlist: { user: nextValidUser._id } },
            ...(previousBooker && {
              $addToSet: { cancelledBy: previousBooker },
            }),
          },
          { session, new: true }
        ).populate('safeHub', 'name address city workingHours');

        if (!updated) {
          await session.abortTransaction();
          session.endSession();
          continue;
        }

        // إعادة quota للمحجوز السابق (إن وُجد)
        if (previousBooker && previousBooker.toString() !== item.donor.toString()) {
          await User.findByIdAndUpdate(
            previousBooker,
            { $inc: { quota: 1 } },
            { session }
          );
        }

        await session.commitTransaction();
        session.endSession();

        // ✅ إشعارات بعد commit — بدون OTP
        triggerBookingNotifications(updated, nextValidUser);
        notifyUser(previousBooker, {
          type:   'booking_cancelled',
          title:  'تم إلغاء حجزك',
          body:   `تم إلغاء حجز "${item.title}"`,
          itemId: item._id,
        }).catch((err) => console.warn('[Notify] فشل إشعار الإلغاء:', err.message));

        return { msg: 'تم إلغاء الحجز ومُرِّر لأول شخص في القائمة ✅' };

      } catch (err) {
        if (session.inTransaction()) await session.abortTransaction();
        if (!session.hasEnded) session.endSession();
        throw err;
      }
    }
  }

  // لا يوجد waitlist — أعِد الغرض لـ "متاح"
  await Item.findByIdAndUpdate(item._id, {
    $set: { status: 'متاح', bookedBy: null, bookedAt: null },
    ...(previousBooker && { $addToSet: { cancelledBy: previousBooker } }),
  });

  if (previousBooker && previousBooker.toString() !== item.donor.toString()) {
    await User.findByIdAndUpdate(previousBooker, { $inc: { quota: 1 } });
  }

  return { msg: 'تم إلغاء الحجز ✅' };
};

// ─────────────────────────────────────────────────────────────────────────────────
// 7. تأكيد استلام المستلم (Recipient Confirm)
// ─────────────────────────────────────────────────────────────────────────────────
exports.confirmReceiptLogic = async (itemId, userId) => {
  const item = await Item.findOne({
    _id:      itemId,
    bookedBy: userId,
    status:   'محجوز',
    recipientConfirmed: false,
  });

  if (!item) throw new AppError('الغرض غير موجود أو تم تأكيده مسبقاً', 404, 'ITEM_NOT_FOUND');

  await Item.findByIdAndUpdate(itemId, {
    $set: {
      recipientConfirmed:   true,
      recipientConfirmedAt: new Date(),
    },
  });

  // ✅ [FIX-2] Socket emit مع logging عند الفشل
  try {
    const { getIO } = require('../socket');
    getIO().to(getUserRoom(item.donor.toString())).emit('delivery:recipient_confirmed', {
      itemId:    item._id,
      title:     item.title,
      bookedBy:  userId,
    });
  } catch (socketErr) {
    console.warn('[Socket] فشل إرسال delivery:recipient_confirmed:', socketErr.message);
  }

  notifyUser(item.donor, {
    type:   'recipient_confirmed',
    title:  'المستلم أكّد الاستلام ✅',
    body:   `يرجى تأكيد تسليم "${item.title}" من جهتك`,
    itemId: item._id,
  }).catch((err) => console.warn('[Notify] فشل إشعار تأكيد الاستلام:', err.message));

  return { msg: 'تم تأكيد استلامك ✅ — بانتظار تأكيد المتبرع' };
};

// ─────────────────────────────────────────────────────────────────────────────────
// 8. تأكيد تسليم المتبرع (Donor Confirm = إتمام التسليم)
// ─────────────────────────────────────────────────────────────────────────────────
exports.completeDeliveryLogic = async (itemId, userId) => {
  const item = await Item.findOne({
    _id:    itemId,
    donor:  userId,
    status: 'محجوز',
    recipientConfirmed: true,
  }).populate('bookedBy', 'name email');

  if (!item) throw new AppError('الغرض غير موجود أو لم يؤكد المستلم بعد', 404, 'ITEM_NOT_FOUND');

  const settings = await SystemSettings.getCached();
  const now = new Date();

  // ✅ [FIX-A] حُذف $unset deliveryOtp — لم يعد موجوداً
  await Item.findByIdAndUpdate(itemId, {
    $set: {
      status:           'تم التسليم',
      donorConfirmedAt: now,
      deliveredAt:      now,
    },
  });

  // مكافأة trustScore للمتبرع
  await User.findByIdAndUpdate(userId, {
    $inc: {
      trustScore: settings.trustScorePerDonation ?? 10,
      quota:      settings.donorQuotaReward       ?? 1,
    },
  });

  // إشعار المستلم
  notifyUser(item.bookedBy._id, {
    type:   'delivery_completed',
    title:  'تم إتمام التسليم 🎉',
    body:   `"${item.title}" — تم التسليم بنجاح`,
    itemId: item._id,
  }).catch((err) => console.warn('[Notify] فشل إشعار إتمام التسليم:', err.message));

  // إيميل تأكيد للمستلم
  fireSendEmail({
    email:   item.bookedBy.email,
    subject: 'تم إتمام التسليم 🎉',
    message: `
      <div dir="rtl">
        <p>تم تأكيد استلامك لـ <b>${item.title}</b> بنجاح 🎉</p>
        <p>شكراً لاستخدامك منصة عون!</p>
      </div>
    `,
  }).catch((err) => console.error('[Email] فشل إرسال تأكيد التسليم:', err.message));

  return { msg: 'تم إتمام التسليم بنجاح 🎉' };
};

// ─────────────────────────────────────────────────────────────────────────────────
// 9. حذف غرض
// ─────────────────────────────────────────────────────────────────────────────────
exports.deleteItemLogic = async (itemId, userId, isAdmin = false) => {
  const item = await Item.findById(itemId).populate('bookedBy', 'name email');

  if (!item) throw new AppError('الغرض غير موجود', 404, 'ITEM_NOT_FOUND');
  if (!isAdmin && item.donor.toString() !== userId)
    throw new AppError('غير مصرح لك بحذف هذا الغرض', 403, 'FORBIDDEN');
  if (!isAdmin && item.status === 'محجوز')
    throw new AppError('لا يمكن حذف غرض محجوز — يرجى إلغاء الحجز أولاً', 400, 'ITEM_IS_BOOKED');

  // إشعار المستلم إن وُجد
  if (item.bookedBy) {
    notifyUser(item.bookedBy._id, {
      type:   'item_deleted',
      title:  'تم حذف غرض كنت قد حجزته',
      body:   `"${item.title}" لم يعد متاحاً`,
      itemId: item._id,
    }).catch((err) => console.warn('[Notify] فشل إشعار الحذف:', err.message));

    // ✅ [FIX-5] fireSendEmail مع .catch() — لا يبتلع الخطأ صامتاً
    fireSendEmail({
      email:   item.bookedBy.email,
      subject: 'تنبيه: تم حذف غرض محجوز',
      message: `<div dir="rtl"><p>تم حذف "<b>${item.title}</b>" الذي كنت قد حجزته.</p></div>`,
    }).catch((err) => console.error('[Email] فشل إرسال إشعار حذف الغرض:', err.message));

    // إعادة quota للمستلم
    await User.findByIdAndUpdate(item.bookedBy._id, { $inc: { quota: 1 } });
  }

  await item.deleteOne();
  return { msg: 'تم حذف الغرض ✅' };
};