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

// ─── دالة مشتركة لفحص الصورة ──
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB

const validateImageFile = (file) => {
  if (!file) throw new AppError('الصورة مطلوبة', 400, 'IMAGE_REQUIRED');
  if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype))
    throw new AppError('نوع الصورة غير مدعوم (JPEG/PNG/WebP فقط)', 400, 'INVALID_IMAGE_TYPE');
  if (file.size > MAX_IMAGE_SIZE)
    throw new AppError('حجم الصورة يتجاوز 5MB', 400, 'IMAGE_TOO_LARGE');
};

// ─── دالة مشتركة لبناء اسم الغرفة للسوكيت ──────
const getUserRoom = (userId) => `user_${userId}`;

const escapeRegex = (str = '') =>
  String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 100);

// ─────────────────────────────────────────────────────────────────────────────────
// 1. جلب الأغراض المتاحة
// ─────────────────────────────────────────────────────────────────────────────────
exports.getItemsLogic = async (query) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);

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

  return item.toObject ? item.toObject() : { ...item };
};

// ─────────────────────────────────────────────────────────────────────────────────
// 4. إضافة غرض جديد
// ─────────────────────────────────────────────────────────────────────────────────
exports.createItemLogic = async (body, userId, file) => {
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

    // ✅ [LOGIC-3] الاعتماد بالكامل على حقل user.quota كمصدر وحيد للحقيقة بدلاً من الحساب من الـ countDocuments
    const user = await User.findById(userId).select('quota').session(session);
    if (!user || user.quota <= 0) {
      throw new AppError('عذراً، لا تملك حصة (Quota) كافية للحجز حالياً 🚫', 403, 'NO_AVAILABLE_QUOTA');
    }

    // مسار الحجز المباشر
    if (item.status === 'متاح') {
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
        // ✅ [FIX-C1] حسم الحصة بشكل ذري ومحمي بفلتر أمان داخل الجلسة
        const updatedUser = await User.findOneAndUpdate(
          { _id: userId, quota: { $gt: 0 } },
          { $inc: { quota: -1 } },
          { session, new: true }
        );

        if (!updatedUser) {
          await session.abortTransaction();
          try { session.endSession(); } catch (_) {}
          throw new AppError('لا تملك حصة كافية 🚫', 403, 'NO_AVAILABLE_QUOTA');
        }

        await session.commitTransaction();
        try { session.endSession(); } catch (_) {}

        triggerBookingNotifications(booked, updatedUser);
        return { status: 'booked', msg: 'تم الحجز بنجاح 🎉' };
      }

      await session.abortTransaction();
      try { session.endSession(); } catch (_) {}
      return await handleWaitlistOutside(itemId, userId);
    }

    await session.abortTransaction();
    try { session.endSession(); } catch (_) {}
    return await handleWaitlistOutside(itemId, userId);

  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    // ✅ [BUG-3 FIX] إغلاق آمن للجلسة عبر كتلة try/catch لمنع مشاكل الخصائص غير الرسمية
    try { session.endSession(); } catch (_) {}
    throw err;
  }
};

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

  if (inWait && !isBooker && !isDonor) {
    await Item.findByIdAndUpdate(item._id, {
      $pull: { waitlist: { user: userId } },
    });
    return { msg: 'تم انسحابك من قائمة الانتظار 🚶‍♂️' };
  }

  const previousBooker = item.bookedBy;

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
          try { session.endSession(); } catch (_) {}
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
          try { session.endSession(); } catch (_) {}
          continue;
        }

        if (previousBooker && previousBooker.toString() !== item.donor.toString()) {
          await User.findByIdAndUpdate(
            previousBooker,
            { $inc: { quota: 1 } },
            { session }
          );
        }

        await session.commitTransaction();
        try { session.endSession(); } catch (_) {}

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
        // ✅ [BUG-3 FIX] إغلاق آمن للجلسة عبر كتلة try/catch لمنع مشاكل الخصائص غير الرسمية
        try { session.endSession(); } catch (_) {}
        throw err;
      }
    }
  }

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
// 7. توجيه وإتمام التسليم الذكي (المستقبل للمُعامل الثالث من الـ Controller)
// ─────────────────────────────────────────────────────────────────────────────────
exports.completeDeliveryLogic = async (itemId, userId, confirmationType) => {
  // [BUG-1 FIX] توجيه آمن وبناءً على الواجهة المحددة من الطلب
  if (confirmationType === 'recipient_confirm') {
    return exports.confirmReceiptLogic(itemId, userId);
  }
  if (confirmationType === 'donor_confirm') {
    return exports.completeDonorDeliveryLogic(itemId, userId);
  }
  
  throw new AppError('نوع التأكيد غير صالح', 400, 'INVALID_CONFIRMATION_TYPE');
};

// ─── دالة تأكيد الاستلام الخاصة بالمستلم (Recipient Logic) ───
exports.confirmReceiptLogic = async (itemId, userId) => {
  const item = await Item.findById(itemId);

  if (!item) throw new AppError('الغرض غير موجود', 404, 'ITEM_NOT_FOUND');
  if (item.status !== 'محجوز') throw new AppError('الغرض غير محجوز حالياً', 400, 'ITEM_NOT_BOOKED');
  if (item.bookedBy?.toString() !== userId.toString()) throw new AppError('أنت لستَ الحاجز لهذا الغرض', 403, 'NOT_BOOKER');
  if (item.recipientConfirmed) throw new AppError('لقد أكّدت الاستلام مسبقاً ⏳', 400, 'RECIPIENT_ALREADY_CONFIRMED');

  const updatedItem = await Item.findOneAndUpdate(
    {
      _id: itemId,
      status: 'محجوز',
      bookedBy: userId,
      recipientConfirmed: { $ne: true },
    },
    {
      $set: {
        recipientConfirmed: true,
        recipientConfirmedAt: new Date(),
      },
    },
    { new: true }
  ).lean();

  if (!updatedItem) {
    throw new AppError('تعذّر تسجيل تأكيد الاستلام — حاول مرة أخرى', 409, 'RECIPIENT_CONFIRM_CONFLICT');
  }

  try {
    const { getIO } = require('../socket');
    getIO().to(getUserRoom(item.donor.toString())).emit('delivery:recipient_confirmed', {
      itemId:   item._id,
      title:    item.title,
      bookedBy: userId,
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

// ─── دالة التأكيد النهائي الخاصة بالمتبرع (Donor Logic) ───
exports.completeDonorDeliveryLogic = async (itemId, userId) => {
  const item = await Item.findOne({
    _id:    itemId,
    donor:  userId,
    status: 'محجوز',
    recipientConfirmed: true,
  }).populate('bookedBy', 'name email');

  if (!item) {
    throw new AppError('الغرض غير موجود أو لم يؤكد المستلم بعد أو أنك لست المتبرع الرسمي', 404, 'ITEM_NOT_FOUND');
  }

  const settings = await SystemSettings.getCached();
  const now = new Date();

  await Item.findByIdAndUpdate(itemId, {
    $set: {
      status:           'تم التسليم',
      donorConfirmedAt: now,
      deliveredAt:      now,
    },
  });

  await User.findByIdAndUpdate(userId, {
    $inc: {
      trustScore: settings.trustScorePerDonation ?? 10,
      quota:      settings.donorQuotaReward       ?? 1,
    },
  });

  // ✅ [LOGIC-1 FIX] إطلاق حدث السوكيت الحاسم لإعلام المستلم فوراً باكتمال العملية وتحديث واجهته
  try {
    const { getIO } = require('../socket');
    getIO()
      .to(getUserRoom(item.bookedBy._id.toString()))
      .emit('delivery:completed', {
        itemId:  item._id,
        message: `تم تأكيد تسليم "${item.title}" 🎉`,
      });
  } catch (socketErr) {
    console.warn('[Socket] فشل إرسال delivery:completed:', socketErr.message);
  }

  notifyUser(item.bookedBy._id, {
    type:   'delivery_completed',
    title:  'تم إتمام التسليم 🎉',
    body:   `"${item.title}" — تم التسليم بنجاح`,
    itemId: item._id,
  }).catch((err) => console.warn('[Notify] فشل إشعار إتمام التسليم:', err.message));

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

  if (item.bookedBy) {
    notifyUser(item.bookedBy._id, {
      type:   'item_deleted',
      title:  'تم حذف غرض كنت قد حجزته',
      body:   `"${item.title}" لم يعد متاحاً`,
      itemId: item._id,
    }).catch((err) => console.warn('[Notify] فشل إشعار الحذف:', err.message));

    fireSendEmail({
      email:   item.bookedBy.email,
      subject: 'تنبيه: تم حذف غرض محجوز',
      message: `<div dir="rtl"><p>تم حذف "<b>${item.title}</b>" الذي كنت قد حجزته.</p></div>`,
    }).catch((err) => console.error('[Email] فشل إرسال إشعار حذف الغرض:', err.message));

    await User.findByIdAndUpdate(item.bookedBy._id, { $inc: { quota: 1 } });
  }

  await item.deleteOne();
  return { msg: 'تم حذف الغرض ✅' };
};