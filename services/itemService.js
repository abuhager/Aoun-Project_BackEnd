// services/itemService.js
// ✅ PATCHED v3 — إصلاحات Flow 5 Review
// FIX [CANCEL-01]: cancelBookingLogic تستخدم findOneAndUpdate ذري بدل findById + save
// FIX [SESSION-01]: session.endSession() في finally بدل التكرار

const mongoose        = require('mongoose');
const Item            = require('../models/Item');
const User            = require('../models/User');
const Report          = require('../models/Report');
const SystemSettings  = require('../models/SystemSettings');
const DonationRequest = require('../models/DonationRequest');
const SafeHub         = require('../models/SafeHub');

const itemRepository  = require('../repositories/itemRepository');
const AppError        = require('../utils/AppError');

const { fireSendEmail } = require('../utils/sendEmail');
const {
  uploadToCloudinary,
  deleteFromCloudinary,
} = require('../utils/uploadToCloudinary');
const notifyUser             = require('../utils/notifyUser');
const { toPublicItem, toDonorItem, toReceiverItem } = require('../dtos/itemDto');
const { buildGamificationProfile } = require('../utils/gamification');
const { getIO }              = require('../socket');

// ── ✅ ARCH-01: ثوابت مشتركة ────────────────────────────────────────────────
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const validateImageFile = async (file) => {
  const settings       = await SystemSettings.getCached();
  const MAX_IMAGE_SIZE = (settings.maxImageSizeMB ?? 5) * 1024 * 1024;

  if (!file)
    throw new AppError('الصورة مطلوبة', 400, 'IMAGE_REQUIRED');
  if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype))
    throw new AppError('نوع الصورة غير مدعوم (JPEG/PNG/WebP فقط)', 400, 'INVALID_IMAGE_TYPE');
  if (file.size > MAX_IMAGE_SIZE)
    throw new AppError(
      `حجم الصورة يتجاوز ${settings.maxImageSizeMB ?? 5}MB`,
      400,
      'IMAGE_TOO_LARGE'
    );
};

const getUserRoom = (userId) => `user_${userId}`;

// ✅ SEC-01: escapeRegex يمنع ReDoS
const escapeRegex = (str = '') =>
  String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 100);

// ─────────────────────────────────────────────────────────────────────────────
// 1. جلب الأغراض المتاحة
// ─────────────────────────────────────────────────────────────────────────────
exports.getItemsLogic = async (query) => {
  const page        = Math.max(1, parseInt(query.page,  10) || 1);
  const settings    = await SystemSettings.getCached();
  const maxPageSize = settings.maxPageSize ?? 20;
  const limit       = Math.min(maxPageSize, Math.max(1, parseInt(query.limit, 10) || 10));
  const skip        = (page - 1) * limit;

  const filter = { status: { $in: ['متاح', 'محجوز'] } };

  if (query.location)    filter.location = new RegExp(escapeRegex(query.location), 'i');
  if (query.search)      filter.title    = new RegExp(escapeRegex(query.search),    'i');
  if (query.category && query.category !== 'all') filter.category = query.category;

  if (query.availableOnly === 'true') filter.status = 'متاح';

  const [items, total] = await Promise.all([
    Item.find(filter)
      .populate('donor',   'name avatar trustScore isVerifiedStudent trustLevel')
      .populate('safeHub', 'name address city workingHours')
      .sort({ status: 1, createdAt: -1 })
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

// ─────────────────────────────────────────────────────────────────────────────
// 2. جلب أغراضي
// ─────────────────────────────────────────────────────────────────────────────
exports.getMyItemsLogic = async (userId) => {
  const [user, myDonations, myRequests] = await Promise.all([
    User.findById(userId)
      .select(
        'name email avatar trustScore trustLevel quota totalDonations ' +
        'isVerifiedStudent badges'
      )
      .lean(),
    itemRepository.findDonationsByUser(userId),
    itemRepository.findReceivedByUser(userId),
  ]);

  const safeUser = user
    ? {
        ...user,
        gamification: buildGamificationProfile(user.trustScore, user.totalDonations),
      }
    : null;

  return { user: safeUser, myDonations, myRequests };
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. جلب غرض بالـ ID
// ─────────────────────────────────────────────────────────────────────────────
exports.getItemByIdLogic = async (itemId, requesterId) => {
  const item = await itemRepository.findItemDetails(itemId);
  if (!item) throw new AppError('الغرض غير موجود', 404, 'ITEM_NOT_FOUND');

  const settings = await SystemSettings.getCached();
  const obj      = item.toObject ? item.toObject() : { ...item };

  obj.expiryHours   = settings.bookingExpiryHours ?? 72;
  obj.waitlistCount = obj.waitlist?.length ?? 0;

  const isOwner     = requesterId && obj.donor?._id?.toString() === requesterId.toString();
  const isBookerReq = requesterId && obj.bookedBy?._id?.toString() === requesterId.toString();

  if (isOwner) {
    const result = toDonorItem(obj, requesterId);
    delete result.waitlist;
    return result;
  }

  if (isBookerReq) {
    const result = toReceiverItem(obj, requesterId);
    delete result.waitlist;
    return result;
  }

  const result = toPublicItem(obj, requesterId);
  delete result.waitlist;
  return result;
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. إضافة غرض جديد
// ─────────────────────────────────────────────────────────────────────────────
exports.createItemLogic = async (body, userId, file) => {
  await validateImageFile(file);

  const [user, settings, activeCount, safeHub] = await Promise.all([
    User.findById(userId).select('isVerified trustLevel quota').lean(),
    SystemSettings.getCached(),
    Item.countDocuments({ donor: userId, status: { $in: ['متاح', 'محجوز'] } }),
    SafeHub.findOne({ _id: body.safeHub, isActive: true }).lean(),
  ]);

  if (!user)
    throw new AppError('المستخدم غير موجود', 404, 'USER_NOT_FOUND');
  if (!user.isVerified)
    throw new AppError('يجب تفعيل الحساب أولاً ✅', 403, 'ACCOUNT_NOT_VERIFIED');
  if (!safeHub)
    throw new AppError('نقطة الاستلام غير موجودة أو غير مفعّلة', 400, 'INVALID_SAFE_HUB');
  if (body.category && !settings.categories?.includes(body.category))
    throw new AppError(`التصنيف "${body.category}" غير مدعوم`, 400, 'INVALID_CATEGORY');

  const maxItems =
    user.trustLevel >= 2
      ? (settings.maxActiveDonationsLevel2Plus ?? 4)
      : (settings.maxActiveDonationsPerUser    ?? 2);

  if (activeCount >= maxItems)
    throw new AppError(
      `لا يمكنك نشر أكثر من ${maxItems} غرض نشط في نفس الوقت`,
      429,
      'MAX_ACTIVE_ITEMS_REACHED'
    );

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

  setImmediate(async () => {
    try {
      const requests = await DonationRequest.find({
        category: item.category,
        status:   'active',
      }).select('user').lean();

      const uniqueUsers = [...new Set(requests.map((r) => r.user.toString()))];
      await Promise.allSettled(
        uniqueUsers.map((uid) =>
          notifyUser(uid, {
            type:    'new_item_match',
            message: `🎁 غرض جديد من فئة "${item.category}" متاح الآن!`,
            itemId:  item._id,
          })
        )
      );
    } catch (_) {}
  });

  return { item: toPublicItem(item.toObject()) };
};

// ─────────────────────────────────────────────────────────────────────────────
// 5. حجز غرض
// ─────────────────────────────────────────────────────────────────────────────
exports.bookItemLogic = async (itemId, userId) => {
  const [user, settings] = await Promise.all([
    User.findById(userId).select('trustLevel quota bookingCount').lean(),
    SystemSettings.getCached(),
  ]);

  if (!user)
    throw new AppError('المستخدم غير موجود', 404, 'USER_NOT_FOUND');

  if (user.trustLevel < 2)
    throw new AppError(
      'يجب الترقية إلى المستوى الثاني للحجز 🔒',
      403,
      'INSUFFICIENT_TRUST_LEVEL'
    );

  const maxBookings =
    user.trustLevel >= 3
      ? (settings.maxActiveBookingsLevel3  ?? 5)
      : (settings.maxActiveBookingsPerUser ?? 2);

  const currentBookings = await Item.countDocuments({
    bookedBy: userId,
    status:   'محجوز',
  });

  if (currentBookings >= maxBookings)
    throw new AppError(
      `وصلت للحد الأقصى (${maxBookings} حجوزات نشطة)`,
      429,
      'MAX_BOOKINGS_REACHED'
    );

  // ✅ RACE-01: Atomic findOneAndUpdate
  const item = await Item.findOneAndUpdate(
    {
      _id:      itemId,
      status:   'متاح',
      donor:    { $ne: userId },
      bookedBy: null,
    },
    {
      $set: {
        status:   'محجوز',
        bookedBy: userId,
        bookedAt: new Date(),
      },
    },
    { returnDocument: 'after', runValidators: true }
  ).populate('donor', 'name email');

  if (item) {
    setImmediate(async () => {
      try {
        await notifyUser(item.donor._id.toString(), {
          type:    'item_booked',
          message: `📦 تم حجز غرضك "${item.title}" بنجاح`,
          itemId:  item._id,
        });
        getIO()
          .to(getUserRoom(item.donor._id.toString()))
          .emit('item:booked', { itemId: item._id, bookedBy: userId });
      } catch (_) {}
    });

    return {
      msg:        'تم حجز الغرض بنجاح ✅',
      itemId:     item._id,
      status:     item.status,
      waitlisted: false,
    };
  }

  // الحجز فشل — تحليل السبب
  const exists = await Item.findById(itemId)
    .select('status donor bookedBy waitlist cancelledBy')
    .lean();

  if (!exists)
    throw new AppError('الغرض غير موجود', 404, 'ITEM_NOT_FOUND');

  if (exists.donor.toString() === userId.toString())
    throw new AppError('لا يمكنك حجز غرضك الخاص', 400, 'CANNOT_BOOK_OWN_ITEM');

  const wasCancelled = exists.cancelledBy?.some(
    (id) => id.toString() === userId
  );
  if (wasCancelled)
    throw new AppError(
      'ألغيت حجزك لهذا الغرض — لا يمكن حجزه أو الانضمام لقائمة انتظاره مجدداً',
      403,
      'BOOKING_PREVIOUSLY_CANCELLED'
    );

  if (exists.status === 'محجوز') {
    const maxWaitlist = settings.maxWaitlistPerItem ?? 10;

    if (exists.waitlist.length >= maxWaitlist)
      throw new AppError(
        `قائمة الانتظار ممتلئة (الحد الأقصى ${maxWaitlist})`,
        429,
        'WAITLIST_FULL'
      );

    const alreadyIn = exists.waitlist.some(
      (w) => w.user.toString() === userId
    );
    if (alreadyIn)
      throw new AppError(
        'أنت مسجل في قائمة الانتظار بالفعل',
        400,
        'ALREADY_WAITLISTED'
      );

    // ✅ إضافة ذرية للـ Waitlist
    const updated = await Item.findOneAndUpdate(
      {
        _id:             itemId,
        'waitlist.user': { $ne: new mongoose.Types.ObjectId(userId) },
      },
      { $push: { waitlist: { user: userId, joinedAt: new Date() } } },
      { returnDocument: 'after' }
    );

    if (!updated)
      throw new AppError(
        'أنت مسجل في قائمة الانتظار بالفعل',
        400,
        'ALREADY_WAITLISTED'
      );

    const position = updated.waitlist.length;

    return {
      msg:        `✅ تمت إضافتك لقائمة الانتظار (المركز ${position})`,
      waitlisted: true,
      position,
      itemId,
    };
  }

  throw new AppError('الغرض غير متاح للحجز', 409, 'ITEM_NOT_AVAILABLE');
};

// ─────────────────────────────────────────────────────────────────────────────
// 6. إلغاء الحجز / مغادرة الـ Waitlist
// ✅ FIX [CANCEL-01]: كل العمليات الآن ذرية بـ findOneAndUpdate
// ─────────────────────────────────────────────────────────────────────────────
exports.cancelBookingLogic = async (itemId, userId) => {
  const snapshot = await Item.findById(itemId)
    .select('status donor bookedBy waitlist cancelledBy title')
    .lean();

  if (!snapshot) throw new AppError('الغرض غير موجود', 404, 'ITEM_NOT_FOUND');

  const isBooker = snapshot.bookedBy?.toString() === userId;
  const isDonor  = snapshot.donor?.toString()    === userId;
  const inWait   = snapshot.waitlist?.some((w) => w.user.toString() === userId);

  if (!isBooker && !isDonor && !inWait)
    throw new AppError('ليس لديك صلاحية إلغاء هذا الحجز', 403, 'FORBIDDEN');

  // ── مغادرة قائمة الانتظار فقط (ذري) ──────────────────────────────────────
  if (inWait && !isBooker && !isDonor) {
    const updated = await Item.findOneAndUpdate(
      { _id: itemId, 'waitlist.user': new mongoose.Types.ObjectId(userId) },
      { $pull: { waitlist: { user: new mongoose.Types.ObjectId(userId) } } },
      { returnDocument: 'after' }
    );
    if (!updated)
      throw new AppError('لم يتم العثور على تسجيلك في قائمة الانتظار', 400, 'NOT_IN_WAITLIST');
    return { msg: 'تم إلغاء تسجيلك من قائمة الانتظار ✅' };
  }

  // ── إلغاء حجز فعلي مع Waitlist Promotion (ذري) ───────────────────────────
  const nextInWaitlist = snapshot.waitlist?.[0] ?? null;

  if (nextInWaitlist) {
    // ✅ FIX [CANCEL-01]: عملية ذرية تُرقّي أول شخص في الـ Waitlist
    const promoted = await Item.findOneAndUpdate(
      {
        _id:      itemId,
        status:   'محجوز',
        bookedBy: snapshot.bookedBy,
      },
      {
        $set:  { bookedBy: nextInWaitlist.user, bookedAt: new Date(), status: 'محجوز' },
        $pull: { waitlist: { user: nextInWaitlist.user } },
        $push: { cancelledBy: snapshot.bookedBy },
      },
      { returnDocument: 'after' }
    ).populate('donor', 'name email');

    if (!promoted)
      throw new AppError('تعذّر إلغاء الحجز — حاول مرة أخرى', 409, 'CANCEL_CONFLICT');

    setImmediate(async () => {
      try {
        await notifyUser(nextInWaitlist.user.toString(), {
          type:    'waitlist_promoted',
          message: `🎉 أصبح غرض "${promoted.title}" متاحاً لك! تفقّد حجوزاتك.`,
          itemId:  promoted._id,
        });
        getIO()
          .to(getUserRoom(nextInWaitlist.user.toString()))
          .emit('item:waitlist_promoted', { itemId: promoted._id });

        await notifyUser(promoted.donor._id.toString(), {
          type:    'booking_transferred',
          message: `🔄 تم نقل حجز "${promoted.title}" لمستخدم آخر من قائمة الانتظار`,
          itemId:  promoted._id,
        });
        getIO()
          .to(getUserRoom(promoted.donor._id.toString()))
          .emit('item:booking_transferred', { itemId: promoted._id });
      } catch (_) {}
    });

    return { msg: 'تم إلغاء الحجز وتم ترقية أول شخص في قائمة الانتظار ✅' };
  }

  // ── إلغاء حجز بدون Waitlist (ذري) ────────────────────────────────────────
  const released = await Item.findOneAndUpdate(
    {
      _id:      itemId,
      status:   'محجوز',
      bookedBy: snapshot.bookedBy,
    },
    {
      $set:  { status: 'متاح', bookedBy: null, bookedAt: null },
      $push: { cancelledBy: snapshot.bookedBy },
    },
    { returnDocument: 'after' }
  ).populate('donor', 'name email');

  if (!released)
    throw new AppError('تعذّر إلغاء الحجز — حاول مرة أخرى', 409, 'CANCEL_CONFLICT');

  setImmediate(async () => {
    try {
      await notifyUser(released.donor._id.toString(), {
        type:    'booking_cancelled',
        message: `❌ تم إلغاء حجز غرضك "${released.title}"`,
        itemId:  released._id,
      });
      getIO()
        .to(getUserRoom(released.donor._id.toString()))
        .emit('item:booking_cancelled', { itemId: released._id });
    } catch (_) {}
  });

  return { msg: 'تم إلغاء الحجز بنجاح ✅' };
};

// ─────────────────────────────────────────────────────────────────────────────
// 7. تأكيد التسليم المزدوج
// ✅ FIX [SESSION-01]: session.endSession() في finally بدل التكرار
// ─────────────────────────────────────────────────────────────────────────────
exports.completeDeliveryLogic = async (itemId, userId, confirmationType) => {
  if (!userId) throw new AppError('المستخدم غير معرّف', 401, 'UNAUTHORIZED');

  const userObjectId = typeof userId === 'string'
    ? new mongoose.Types.ObjectId(userId)
    : userId;
  const userIdStr = userId.toString();

  // ── تأكيد المستلم ────────────────────────────────────────────────────────
  if (confirmationType === 'recipient_confirm') {
    const item = await Item.findOneAndUpdate(
      {
        _id:                itemId,
        status:             'محجوز',
        bookedBy:           userObjectId,
        recipientConfirmed: false,
      },
      {
        $set: {
          recipientConfirmed:   true,
          recipientConfirmedAt: new Date(),
        },
      },
      { returnDocument: 'after' }
    ).populate('donor', 'name email');

    if (!item) {
      const exists = await Item.findById(itemId)
        .select('status bookedBy recipientConfirmed').lean();
      if (!exists)
        throw new AppError('الغرض غير موجود', 404, 'ITEM_NOT_FOUND');
      if (exists.bookedBy?.toString() === userIdStr && exists.recipientConfirmed)
        throw new AppError('لقد قمت بالتأكيد مسبقاً ✅', 400, 'ALREADY_CONFIRMED');
      if (exists.bookedBy?.toString() !== userIdStr)
        throw new AppError('ليس لديك صلاحية تأكيد الاستلام', 403, 'FORBIDDEN');
      if (exists.status !== 'محجوز')
        throw new AppError('الغرض ليس في حالة الحجز', 400, 'INVALID_STATUS');
      throw new AppError('تعذر تأكيد الاستلام', 400, 'CONFIRM_FAILED');
    }

    setImmediate(() => {
      try {
        getIO()
          .to(`user_${item.donor._id}`)
          .emit('item:recipient_confirmed', {
            itemId:    item._id,
            itemTitle: item.title,
            message:   '✅ المستلم أكّد الاستلام — بانتظار تأكيدك أنت',
          });
        notifyUser(item.donor._id.toString(), {
          type:    'recipient_confirmed',
          message: `📦 "${item.title}" — المستلم أكّد الوصول. أكّد أنت التسليم لإتمام العملية.`,
          itemId:  item._id,
        }).catch(() => {});
      } catch (_) {}
    });

    return {
      status: 'pending_donor',
      msg:    'تم تأكيد الاستلام ✅ — بانتظار تأكيد المتبرع',
      itemId: item._id,
    };
  }

  // ── تأكيد المتبرع (Transaction) ──────────────────────────────────────────
  if (confirmationType === 'donor_confirm') {
    const session = await mongoose.startSession();
    let deliveredItem;

    try {
      session.startTransaction();

      deliveredItem = await Item.findOneAndUpdate(
        {
          _id:                itemId,
          status:             'محجوز',
          donor:              userObjectId,
          recipientConfirmed: true,
          donorConfirmed:     false,
        },
        {
          $set: {
            donorConfirmed:   true,
            donorConfirmedAt: new Date(),
            status:           'تم التسليم',
            deliveredAt:      new Date(),
          },
        },
        { returnDocument: 'after', session }
      ).populate('donor bookedBy', 'name email trustScore gamification');

      if (!deliveredItem) {
        const exists = await Item.findById(itemId)
          .select('status donor recipientConfirmed donorConfirmed bookedBy').lean();
        if (!exists)
          throw new AppError('الغرض غير موجود', 404, 'ITEM_NOT_FOUND');
        if (exists.donor?.toString() !== userIdStr)
          throw new AppError('ليس لديك صلاحية تأكيد التسليم', 403, 'FORBIDDEN');
        if (!exists.recipientConfirmed)
          throw new AppError('بانتظار تأكيد المستلم أولاً ⏳', 400, 'RECIPIENT_NOT_CONFIRMED');
        if (exists.donorConfirmed)
          throw new AppError('لقد قمت بالتأكيد مسبقاً ✅', 400, 'ALREADY_CONFIRMED');
        throw new AppError('تعذر تأكيد التسليم', 400, 'CONFIRM_FAILED');
      }

      await Promise.all([
        User.findByIdAndUpdate(
          deliveredItem.donor._id,
          { $inc: { trustScore: 10, 'gamification.donationsCompleted': 1 } },
          { session }
        ),
        User.findByIdAndUpdate(
          deliveredItem.bookedBy._id,
          { $inc: { 'gamification.receiptsCompleted': 1 } },
          { session }
        ),
      ]);

      await session.commitTransaction();

    } catch (err) {
      if (session.inTransaction()) await session.abortTransaction();
      throw err;
    } finally {
      // ✅ FIX [SESSION-01]: endSession مرة واحدة في finally
      try { session.endSession(); } catch (_) {}
    }

    setImmediate(async () => {
      try {
        getIO()
          .to(getUserRoom(deliveredItem.bookedBy._id.toString()))
          .emit('item:delivered', {
            itemId:    deliveredItem._id,
            itemTitle: deliveredItem.title,
            message:   '🎉 تم تأكيد التسليم من المتبرع — العملية مكتملة!',
          });
        await notifyUser(deliveredItem.bookedBy._id.toString(), {
          type:    'item_delivered',
          message: `🎉 "${deliveredItem.title}" — تم تأكيد التسليم بنجاح!`,
          itemId:  deliveredItem._id,
        });
      } catch (_) {}
    });

    return {
      status: 'delivered',
      msg:    'تم تأكيد التسليم بنجاح 🎉',
      itemId: deliveredItem._id,
    };
  }

  throw new AppError('نوع التأكيد غير معروف', 400, 'INVALID_CONFIRMATION_TYPE');
};

// ─────────────────────────────────────────────────────────────────────────────
// 8. تعديل غرض
// ─────────────────────────────────────────────────────────────────────────────
exports.updateItemLogic = async (itemId, userId, body = {}, file = null) => {
  const snapshot = await Item.findById(itemId)
    .select('donor status cloudinaryId')
    .lean();

  if (!snapshot)
    throw new AppError('الغرض غير موجود', 404, 'ITEM_NOT_FOUND');

  if (snapshot.donor?.toString() !== userId?.toString())
    throw new AppError('ليس لديك صلاحية تعديل هذا الغرض', 403, 'FORBIDDEN');

  if (!['متاح', 'مخفي'].includes(snapshot.status))
    throw new AppError(
      'لا يمكن تعديل الغرض بعد حجزه أو تسليمه',
      409,
      'ITEM_NOT_EDITABLE'
    );

  if (body.category) {
    const settings = await SystemSettings.getCached();
    if (!settings.categories?.includes(body.category))
      throw new AppError(
        `التصنيف "${body.category}" غير مدعوم`,
        400,
        'INVALID_CATEGORY'
      );
  }

  if (body.safeHub) {
    // المراكز القديمة التي لا تحتوي isActive تُعامل كمفعّلة للتوافق مع البيانات الحالية.
    const safeHub = await SafeHub.findOne({
      _id: body.safeHub,
      isActive: { $ne: false },
    }).select('_id').lean();

    if (!safeHub)
      throw new AppError(
        'نقطة الاستلام غير موجودة أو غير مفعّلة',
        400,
        'INVALID_SAFE_HUB'
      );
  }

  const allowedFields = [
    'title',
    'description',
    'category',
    'location',
    'condition',
    'safeHub',
  ];
  const updates = {};

  for (const field of allowedFields) {
    if (!Object.hasOwn(body, field)) continue;
    const value = body[field];
    updates[field] = typeof value === 'string' ? value.trim() : value;
  }

  let uploadedImage = null;

  if (file) {
    await validateImageFile(file);
    uploadedImage = await uploadToCloudinary(file.buffer);
    updates.imageUrl = uploadedImage.secure_url;
    updates.cloudinaryId = uploadedImage.public_id;
  }

  if (Object.keys(updates).length === 0)
    throw new AppError('لا توجد تعديلات للحفظ', 400, 'NO_CHANGES');

  let updatedItem;

  try {
    updatedItem = await Item.findOneAndUpdate(
      {
        _id: itemId,
        donor: userId,
        status: { $in: ['متاح', 'مخفي'] },
      },
      { $set: updates },
      { returnDocument: 'after', runValidators: true }
    ).populate([
      {
        path: 'donor',
        select: 'name avatar trustScore isVerifiedStudent trustLevel',
      },
      {
        path: 'safeHub',
        select: 'name address city workingHours',
      },
    ]);
  } catch (err) {
    if (uploadedImage?.public_id) {
      try {
        await deleteFromCloudinary(uploadedImage.public_id);
      } catch (cleanupErr) {
        console.warn('[Cloudinary] تعذر حذف الصورة الجديدة بعد فشل التعديل:', cleanupErr.message);
      }
    }
    throw err;
  }

  if (!updatedItem) {
    if (uploadedImage?.public_id) {
      try {
        await deleteFromCloudinary(uploadedImage.public_id);
      } catch (cleanupErr) {
        console.warn('[Cloudinary] تعذر حذف الصورة الجديدة بعد تعارض التعديل:', cleanupErr.message);
      }
    }

    throw new AppError(
      'تغيّرت حالة الغرض أثناء التعديل؛ حدّث الصفحة وحاول مجدداً',
      409,
      'ITEM_UPDATE_CONFLICT'
    );
  }

  if (
    uploadedImage?.public_id &&
    snapshot.cloudinaryId &&
    snapshot.cloudinaryId !== uploadedImage.public_id
  ) {
    try {
      await deleteFromCloudinary(snapshot.cloudinaryId);
    } catch (cleanupErr) {
      console.warn('[Cloudinary] تعذر حذف الصورة القديمة بعد التعديل:', cleanupErr.message);
    }
  }

  const itemObject = updatedItem.toObject
    ? updatedItem.toObject()
    : { ...updatedItem };

  return {
    msg: 'تم تحديث الغرض بنجاح ✅',
    item: toDonorItem(itemObject, userId),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// 9. حذف غرض
// ─────────────────────────────────────────────────────────────────────────────
exports.deleteItemLogic = async (itemId, userId, isAdmin = false) => {
  const snapshot = await Item.findById(itemId)
    .select('donor bookedBy waitlist status cloudinaryId title')
    .lean();

  if (!snapshot)
    throw new AppError('الغرض غير موجود', 404, 'ITEM_NOT_FOUND');

  const isOwner = snapshot.donor?.toString() === userId?.toString();
  if (!isOwner && !isAdmin)
    throw new AppError('ليس لديك صلاحية حذف هذا الغرض', 403, 'FORBIDDEN');

  if (snapshot.status === 'تم التسليم' && !isAdmin)
    throw new AppError(
      'لا يمكن حذف غرض تم تسليمه',
      409,
      'DELIVERED_ITEM_DELETE_FORBIDDEN'
    );

  const deleteFilter = { _id: itemId };
  if (!isAdmin) {
    deleteFilter.donor = userId;
    deleteFilter.status = { $ne: 'تم التسليم' };
  }

  const deletedItem = await Item.findOneAndDelete(deleteFilter);
  if (!deletedItem)
    throw new AppError(
      'تغيّرت حالة الغرض أثناء الحذف؛ حدّث الصفحة وحاول مجدداً',
      409,
      'ITEM_DELETE_CONFLICT'
    );

  if (snapshot.cloudinaryId) {
    try {
      await deleteFromCloudinary(snapshot.cloudinaryId);
    } catch (cleanupErr) {
      console.warn('[Cloudinary] تعذر حذف صورة الغرض المحذوف:', cleanupErr.message);
    }
  }

  // إغلاق شاشة الغرض فوراً لدى الحاجز وقائمة الانتظار إن كانوا متصلين.
  const affectedUserIds = [
    snapshot.bookedBy,
    ...(snapshot.waitlist ?? []).map((entry) => entry.user),
  ].filter(Boolean);

  try {
    const io = getIO();
    for (const affectedUserId of affectedUserIds) {
      io.to(getUserRoom(affectedUserId.toString())).emit('item:deleted', {
        itemId: snapshot._id,
      });
    }
  } catch (_) {}

  return { msg: 'تم حذف الغرض بنجاح ✅' };
};
