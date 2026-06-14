// services/itemService.js
const mongoose = require('mongoose');
const Item = require('../models/Item');
const User = require('../models/User');
const Report = require('../models/Report');
const SystemSettings = require('../models/SystemSettings');
const { getSettings } = require('./settingsService');
const DonationRequest = require('../models/DonationRequest');

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
  if (!item) throw new AppError('الغرض غير موجود', 404, 'ITEM_NOT_FOUND');

  const settings = await SystemSettings.getCached();
  const obj = item.toObject ? item.toObject() : { ...item };

  obj.expiryHours = settings.bookingExpiryHours ?? 72;

  // ✅ [WARN-2 FIX] الـ waitlist يُكشف للمتبرع فقط — باقي الزوار يحصلون على العدد فقط
  // كان: يُرسل waitlist كاملاً (بأسماء المنتظرين) لأي زائر
  const isOwner =
    requesterId &&
    obj.donor?._id?.toString() === requesterId.toString();

  obj.waitlistCount = obj.waitlist?.length ?? 0;
  if (!isOwner) delete obj.waitlist;

  return obj;
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
    ? (settings.maxActiveDonationsLevel2Plus ?? 4)
    : (settings.maxActiveDonationsPerUser    ?? 2);

  if (activeCount >= maxItems) {
    throw new AppError(
      `لا يمكنك نشر أكثر من ${maxItems} غرض نشط في نفس الوقت`,
      429,
      'MAX_ACTIVE_ITEMS_REACHED'
    );
  }

  const uploadResult = await uploadToCloudinary(file.buffer);

  const item = await Item.create({
    title:        body.title?.trim(),
    description:  body.description?.trim(),
    category:     body.category,
    location:     body.location?.trim(),
    condition:    body.condition,
    safeHub:      body.safeHub,
    donor:        userId,
    imageUrl:     uploadResult.secure_url,
    cloudinaryId: uploadResult.public_id,
  });

  // ✅ [FEATURE] بعد إنشاء الغرض — إشعار أصحاب طلبات التبرع النشطة بنفس الفئة (غير محجوب للعملية الرئيسية)
    setImmediate(() => {
    DonationRequest.find({
      category:  item.category,
      status:    'active',
      expiresAt: { $gt: new Date() },
      requester: { $ne: userId },
    })
      .select('requester')
      .limit(50)
      .lean()
      .then((matchingRequests) => {
        const { getIO } = require('../socket');
        const io = getIO();

        Promise.allSettled(
          matchingRequests.map((req) => {
            io.to(`user_${req.requester}`).emit('notification', {
              type:     'MATCHING_ITEM_AVAILABLE',
              itemId:   item._id,
              title:    item.title,
              category: item.category,
              message:  'غرض جديد يتطابق مع طلبك 🎁',
            });
            return notifyUser(req.requester, {
              type:   'matching_item',
              title:  'غرض متاح يناسبك! 🎁',
              body:   `"${item.title}" — ${item.category}`,
              itemId: item._id,
            });
          })
        );
      })
      .catch((err) =>
        console.warn('[MatchNotify] فشل إشعار الطلبات المتطابقة:', err.message)
      );
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

    if (item.status === 'متاح') {
  const booked = await Item.findOneAndUpdate(
    { _id: itemId, status: 'متاح' },
    { $set: { status: 'محجوز', bookedBy: userId, bookedAt: new Date() } },
    { returnDocument: 'after', session }
  ).populate('safeHub', 'name address city workingHours');

  if (booked) {
    // ✅ جلب email + quota في عملية واحدة — القيد الوحيد الموثوق
    const updatedUser = await User.findOneAndUpdate(
      { _id: userId, quota: { $gt: 0 } },
      { $inc: { quota: -1 } },
      { session, returnDocument: 'after', select: '+email' } // ← email مطلوب للإيميل
    );

    if (!updatedUser) {
      await session.abortTransaction();
      try { session.endSession(); } catch (_) {}
      throw new AppError('لا تملك حصة كافية 🚫', 403, 'NO_AVAILABLE_QUOTA');
    }

    await session.commitTransaction();
    try { session.endSession(); } catch (_) {}

    triggerBookingNotifications(booked, updatedUser).catch(console.warn);
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
    { returnDocument: 'after' }
  );

  if (!waitlistUpdated) {
    throw new AppError('أنت بالفعل في قائمة الانتظار ⏳', 409, 'ALREADY_IN_WAITLIST');
  }

  return { status: 'waitlist', msg: 'تمت إضافتك لقائمة الانتظار ⏳' };
}

async function triggerBookingNotifications(bookedItem, user) {
  try {
    const settings = await SystemSettings.getCached(); // ✅ await صريح

    const hubSection = bookedItem.safeHub
      ? `<hr/>
         <p>📍 <b>نقطة التسليم:</b> ${bookedItem.safeHub.name}</p>
         <p>🏙️ ${bookedItem.safeHub.city} — ${bookedItem.safeHub.address}</p>
         <p>🕐 أوقات العمل: ${bookedItem.safeHub.workingHours || 'غير محدد'}</p>`
      : `<p>📦 سيتم التنسيق مع المتبرع مباشرة</p>`;

    await Promise.all([
      notifyUser(bookedItem.donor, {
        type:   'item_booked',
        title:  'تم حجز غرضك! 🎉',
        body:   `قام شخص ما بحجز "${bookedItem.title}"`,
        itemId: bookedItem._id,
      }),
      fireSendEmail({
        email:   user.email,
        subject: 'تم حجز الغرض 🎉',
        message: `
          <div dir="rtl">
            <p>تم حجز <b>${bookedItem.title}</b> بنجاح!</p>
            <p>⏱️ لديك <b>${settings.bookingExpiryHours ?? 72} ساعة</b> لاستلام الغرض</p>
            <p>📌 توجّه إلى نقطة التسليم وأكّد الاستلام من التطبيق</p>
            ${hubSection}
          </div>
        `,
      }),
    ]);
  } catch (err) {
    console.error('[triggerBookingNotifications] فشل:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// 6. إلغاء الحجز
// ─────────────────────────────────────────────────────────────────────────────────
exports.cancelBookingLogic = async (itemId, userId) => {
  const item = await itemRepository.findItemForAction(itemId);
  if (!item) throw new AppError('الغرض غير موجود', 404, 'ITEM_NOT_FOUND');

  const isBooker = item.bookedBy?.toString() === userId;
  const isDonor  = item.donor.toString()     === userId;
  const inWait   = item.waitlist?.some((w) => w.user.toString() === userId);

  if (!isBooker && !isDonor && !inWait)
    throw new AppError('غير مصرح لك', 403, 'FORBIDDEN');

  // ─── انسحاب من Waitlist فقط ────────────────────────────────
  if (inWait && !isBooker && !isDonor) {
    await Item.findByIdAndUpdate(item._id, { $pull: { waitlist: { user: userId } } });
    return { msg: 'تم انسحابك من قائمة الانتظار 🚶‍♂️' };
  }

  const previousBooker = item.bookedBy;

  // ─── محاولة ترقية أول شخص valid من الـ waitlist ───────────
  if (item.waitlist?.length > 0) {
    // ✅ نجرّب واحداً في كل مرة فقط — لا loop بمتعدد sessions
    for (const waiting of item.waitlist) {
      const session = await mongoose.startSession();
      session.startTransaction();
      try {
        // ✅ atomic: حسم quota + تغيير status + إزالة من waitlist في transaction واحدة
        const nextUser = await User.findOneAndUpdate(
          { _id: waiting.user, quota: { $gt: 0 } },
          { $inc: { quota: -1 } },
          { session, returnDocument: 'after' }
        );
        if (!nextUser) { await session.abortTransaction(); session.endSession(); continue; }

        const promoted = await Item.findOneAndUpdate(
          {
            _id:              item._id,
            status:           'محجوز',   // ✅ guard: لم يتغير الـ status بينما نعمل
            'waitlist.user':  nextUser._id,
          },
          {
            $set:       { status: 'محجوز', bookedBy: nextUser._id, bookedAt: new Date() },
            $pull:      { waitlist: { user: nextUser._id } },
            $addToSet:  { cancelledBy: previousBooker },
          },
          { session, returnDocument: 'after' }
        ).populate('safeHub', 'name address city workingHours');

        if (!promoted) { await session.abortTransaction(); session.endSession(); continue; }

        // ✅ إعادة quota للحاجز السابق داخل نفس الـ session
        if (previousBooker && previousBooker.toString() !== item.donor.toString()) {
          await User.findByIdAndUpdate(previousBooker, { $inc: { quota: 1 } }, { session });
        }

        await session.commitTransaction();
        session.endSession();

        // notifications خارج الـ transaction (لا تُؤثر على الـ commit)
        triggerBookingNotifications(promoted, nextUser).catch(console.warn);
        notifyUser(previousBooker, { type: 'booking_cancelled', title: 'تم إلغاء حجزك',
          body: `تم إلغاء حجز "${item.title}"`, itemId: item._id })
          .catch(console.warn);

        return { msg: 'تم إلغاء الحجز ومُرِّر لأول شخص في القائمة ✅' };

      } catch (err) {
        if (session.inTransaction()) await session.abortTransaction();
        try { session.endSession(); } catch (_) {}
        throw err; // ✅ رمي الخطأ فوراً — لا نكمل الـ loop على خطأ حقيقي
      }
    }
  }
  // في حالة عدم وجود waitlist أو فشل الجميع
  const fallbackSession = await mongoose.startSession();
  fallbackSession.startTransaction();
  try {
    await Item.findByIdAndUpdate(
      item._id,
      {
        $set: { status: 'متاح', bookedBy: null, bookedAt: null },
        ...(previousBooker && { $addToSet: { cancelledBy: previousBooker } }),
      },
      { session: fallbackSession }
    );

    if (previousBooker && previousBooker.toString() !== item.donor.toString()) {
      await User.findByIdAndUpdate(
        previousBooker,
        { $inc: { quota: 1 } },
        { session: fallbackSession }
      );
    }

    await fallbackSession.commitTransaction();
  } catch (err) {
    if (fallbackSession.inTransaction()) await fallbackSession.abortTransaction();
    throw err;
  } finally {
    try { fallbackSession.endSession(); } catch (_) {}
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
    { returnDocument: 'after' }
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

  return { msg: 'تم تأكيد استلامك ✅ — بانتظار تأكيد المتبرع' ,
    status: 'waiting_donor'
  };
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
    donorConfirmed:   true,       // ← هذا السطر مفقود
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

  // ✅ [LOGIC-5 FIX] تحديث حالة طلب التبرع (DonationRequest) إلى 'fulfilled' إذا كان موجوداً
  if (item.linkedRequestId) {
  // الحالة الذكية: الـ Item منشأ من استجابة طلب محدد
  await DonationRequest.findOneAndUpdate(
    {
      _id:       item.linkedRequestId,
      requester: item.bookedBy._id,
      status:    'active',
    },
    {
      $set: {
        status:         'fulfilled',
        fulfilledByItem: item._id,
      },
    }
  ).catch((err) => console.warn('[DonationRequest] فشل تحديث الطلب المرتبط:', err.message));
} else {
  // الحالة القديمة fallback: بحث بالـ category (يُبقى للتوافقية)
  await DonationRequest.findOneAndUpdate(
    {
      requester: item.bookedBy._id,
      category:  item.category,
      status:    'active',
    },
    {
      $set: { status: 'fulfilled' },
    }
  ).catch((err) => console.warn('[DonationRequest] fallback فشل:', err.message));
}

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

  return { msg: 'تم إتمام التسليم بنجاح 🎉' 
    ,status: 'delivered'
  };
};
// 8. تعديل غرض
// ─────────────────────────────────────────────────────────────────────────────────
// services/itemService.js

exports.updateItemLogic = async (itemId, userId, body, file) => {
  const item = await Item.findById(itemId);
  if (!item) throw new AppError('الغرض غير موجود', 404, 'ITEM_NOT_FOUND');
  
  if (item.donor.toString() !== userId.toString())
    throw new AppError('غير مصرح لك بتعديل هذا الغرض', 403, 'FORBIDDEN');
    
  if (item.status === 'محجوز')
    throw new AppError('لا يمكن تعديل غرض محجوز — يرجى إلغاء الحجز أولاً', 400, 'ITEM_IS_BOOKED');

  const settings = await SystemSettings.getCached();

  // 1. التحقق من صحة التصنيف
  if (body.category && !settings.categories?.includes(body.category)) {
    throw new AppError(`التصنيف "${body.category}" غير مدعوم`, 400, 'INVALID_CATEGORY');
  }

  // ✅ 2. التحقق من صحة نقطة الاستلام (SafeHub) في حال إرسالها للتحديث
  if (body.safeHub) {
    const SafeHub = require('../models/SafeHub'); // تأكد من استيراد الموديل إذا لم يكن مستورداً في أعلى الملف
    const validHub = await SafeHub.findOne({ _id: body.safeHub, isActive: true }).lean();
    if (!validHub) {
      throw new AppError('نقطة الاستلام غير موجودة أو غير مفعّلة', 400, 'INVALID_SAFE_HUB');
    }
  }

  // 3. معالجة وتحديث الصورة إن وجدت
  if (file) {
    validateImageFile(file);
    // حذف الصورة القديمة من Cloudinary قبل رفع الجديدة
    if (item.cloudinaryId) {
      const { deleteFromCloudinary } = require('../utils/uploadToCloudinary');
      await deleteFromCloudinary(item.cloudinaryId).catch((err) =>
        console.warn('[Cloudinary] فشل حذف الصورة القديمة:', err.message)
      );
    }
    const uploadResult = await uploadToCloudinary(file.buffer);
    item.imageUrl     = uploadResult.secure_url;
    item.cloudinaryId = uploadResult.public_id;
  }

  // 4. تحديث باقي الحقول المسموحة
  const allowedFields = ['title', 'description', 'category', 'location', 'condition', 'safeHub'];
  allowedFields.forEach((key) => {
    if (body[key] !== undefined) item[key] = typeof body[key] === 'string' ? body[key].trim() : body[key];
  });

  await item.save();
  return { msg: 'تم تحديث الغرض بنجاح ✅', item };
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

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    // ✅ الحذف وإعادة الـ quota في نفس الـ transaction
    await Item.findByIdAndUpdate(item._id, { $set: { status: 'مخفي' } }, { session });

    if (item.bookedBy) {
      await User.findByIdAndUpdate(
        item.bookedBy._id,
        { $inc: { quota: 1 } },
        { session }
      );
    }
    await session.commitTransaction();
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    throw err;
  } finally {
    try { session.endSession(); } catch (_) {}
  }

  // ✅ حذف الوثيقة الفعلي بعد الـ commit (أو Soft Delete بـ status: 'مخفي')
  await item.deleteOne();

  // notifications بعد النجاح الكامل فقط
  if (item.bookedBy) {
    notifyUser(item.bookedBy._id, { type: 'item_deleted', title: 'تم حذف غرض كنت قد حجزته',
      body: `"${item.title}" لم يعد متاحاً`, itemId: item._id }).catch(console.warn);
    fireSendEmail({ email: item.bookedBy.email, subject: 'تنبيه: تم حذف غرض محجوز',
      message: `<div dir="rtl"><p>تم حذف "<b>${item.title}</b>"</p></div>` }).catch(console.error);
  }

  return { msg: 'تم حذف الغرض ✅' };
};