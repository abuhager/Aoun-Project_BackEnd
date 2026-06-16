// services/itemService.js — ✅ PATCHED [RACE-01 | RACE-02 | LOGIC-01 | SEC-01 | SEC-02 | ARCH-01]
const mongoose         = require('mongoose');
const Item             = require('../models/Item');
const User             = require('../models/User');
const Report           = require('../models/Report');
const SystemSettings   = require('../models/SystemSettings');
const DonationRequest  = require('../models/DonationRequest');
const SafeHub          = require('../models/SafeHub');

const itemRepository   = require('../repositories/itemRepository');
const AppError         = require('../utils/AppError');

const { fireSendEmail }        = require('../utils/sendEmail');
const { uploadToCloudinary }   = require('../utils/uploadToCloudinary');
const notifyUser               = require('../utils/notifyUser');
const { toPublicItem }         = require('../dtos/itemDto');
const { getIO }                = require('../socket/socketHandler');

// ── ✅ ARCH-01: مصدر واحد للحقيقة — مشتركة مع middleware/upload.js ──────────
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_SIZE      = 5 * 1024 * 1024; // 5MB

const validateImageFile = (file) => {
  if (!file)
    throw new AppError('الصورة مطلوبة', 400, 'IMAGE_REQUIRED');
  if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype))
    throw new AppError('نوع الصورة غير مدعوم (JPEG/PNG/WebP فقط)', 400, 'INVALID_IMAGE_TYPE');
  if (file.size > MAX_IMAGE_SIZE)
    throw new AppError('حجم الصورة يتجاوز 5MB', 400, 'IMAGE_TOO_LARGE');
};

const getUserRoom = (userId) => `user_${userId}`;

// ✅ SEC-01: escapeRegex + حد 100 حرف يمنع ReDoS
const escapeRegex = (str = '') =>
  String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 100);

// ─────────────────────────────────────────────────────────────────────────────
// 1. جلب الأغراض المتاحة
// ─────────────────────────────────────────────────────────────────────────────
exports.getItemsLogic = async (query) => {
  const page     = Math.max(1, parseInt(query.page,  10) || 1);
  const settings = await SystemSettings.getCached();
  const maxPageSize = settings.maxPageSize ?? 20;
  const limit    = Math.min(maxPageSize, Math.max(1, parseInt(query.limit, 10) || 10));
  const skip     = (page - 1) * limit;

  const filter = { status: 'متاح' };

  // ✅ SEC-01: كل regex مقيّد بـ escapeRegex
  if (query.location) filter.location = new RegExp(escapeRegex(query.location), 'i');
  if (query.search)   filter.title    = new RegExp(escapeRegex(query.search),   'i');
  if (query.category && query.category !== 'all') filter.category = query.category;

  const [items, total] = await Promise.all([
    Item.find(filter)
      .populate('donor',   'name avatar trustScore isVerifiedStudent trustLevel')
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

// ─────────────────────────────────────────────────────────────────────────────
// 2. جلب أغراضي
// ─────────────────────────────────────────────────────────────────────────────
exports.getMyItemsLogic = async (userId) => {
  const [user, myDonations, myRequests] = await Promise.all([
    User.findById(userId)
      .select('name email trustScore quota isVerifiedStudent gamification').lean(),
    Item.find({ donor: userId })
      .populate('bookedBy', 'name avatar').sort({ createdAt: -1 }).lean(),
    Item.find({ bookedBy: userId })
      .populate('donor', 'name avatar').sort({ createdAt: -1 }).lean(),
  ]);

  const allItemIds = [
    ...myDonations.map((i) => i._id),
    ...myRequests.map((i)  => i._id),
  ];

  const reports = await Report.find({
    relatedItem:  { $in: allItemIds },
    reportedUser: userId,
    status:       { $in: ['pending', 'actioned'] },
  }).select('relatedItem').lean();

  const reportMap = new Map(
    reports.map((r) => [r.relatedItem.toString(), r._id.toString()])
  );

  return {
    user,
    myDonations: myDonations.map((item) => ({
      ...item,
      reportId: reportMap.get(item._id.toString()) ?? null,
    })),
    myRequests: myRequests.map((item) => ({
      ...item,
      reportId: reportMap.get(item._id.toString()) ?? null,
    })),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. جلب غرض بالـ ID
// ─────────────────────────────────────────────────────────────────────────────
exports.getItemByIdLogic = async (itemId, requesterId) => {
  const item = await itemRepository.findItemDetails(itemId);
  if (!item) throw new AppError('الغرض غير موجود', 404, 'ITEM_NOT_FOUND');

  const settings = await SystemSettings.getCached();
  const obj      = item.toObject ? item.toObject() : { ...item };

  obj.expiryHours    = settings.bookingExpiryHours ?? 72;
  obj.waitlistCount  = obj.waitlist?.length ?? 0;

  // ✅ LOGIC: waitlist يُكشف للمتبرع فقط
  const isOwner =
    requesterId && obj.donor?._id?.toString() === requesterId.toString();
  if (!isOwner) delete obj.waitlist;

  return obj;
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. إضافة غرض جديد
// ─────────────────────────────────────────────────────────────────────────────
exports.createItemLogic = async (body, userId, file) => {
  validateImageFile(file);

  const [user, settings, activeCount, safeHub] = await Promise.all([
    User.findById(userId).select('isVerified trustLevel quota').lean(),
    SystemSettings.getCached(),
    Item.countDocuments({ donor: userId, status: { $in: ['متاح', 'محجوز'] } }),
    // ✅ SEC-02: التحقق أن الـ Hub موجود ونشط — كان يقبل أي ObjectId
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

  // إشعار أصحاب طلبات التبرع النشطة بنفس الفئة (non-blocking)
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
// 5. حجز غرض — ✅ RACE-01: Atomic findOneAndUpdate
// ─────────────────────────────────────────────────────────────────────────────
exports.bookItemLogic = async (itemId, userId) => {
  const [user, settings] = await Promise.all([
    User.findById(userId).select('trustLevel quota bookingCount').lean(),
    SystemSettings.getCached(),
  ]);

  if (!user)
    throw new AppError('المستخدم غير موجود', 404, 'USER_NOT_FOUND');

  const maxBookings =
    user.trustLevel >= 3
      ? (settings.maxActiveBookingsLevel3 ?? 5)
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

  // ✅ RACE-01: Atomic — الشرط والتحديث في عملية واحدة
  // filter: status === 'متاح' يمنع حجز غرض محجوز مسبقاً
  // إذا سبق مستخدم آخر → findOneAndUpdate تُعيد null → نُعيد 409
  const item = await Item.findOneAndUpdate(
    {
      _id:     itemId,
      status:  'متاح',           // ← الشرط الذري
      donor:   { $ne: userId },  // لا يحجز المتبرع غرضه
      bookedBy: null,
    },
    {
      $set: {
        status:    'محجوز',
        bookedBy:  userId,
        bookedAt:  new Date(),
      },
    },
    { new: true, runValidators: true }
  ).populate('donor', 'name email');

  if (!item) {
    // تحقق: هل الغرض موجود أصلاً؟
    const exists = await Item.findById(itemId).select('status donor bookedBy').lean();
    if (!exists)
      throw new AppError('الغرض غير موجود', 404, 'ITEM_NOT_FOUND');
    if (exists.donor.toString() === userId.toString())
      throw new AppError('لا يمكنك حجز غرضك الخاص', 400, 'CANNOT_BOOK_OWN_ITEM');
    if (exists.status === 'محجوز')
      throw new AppError('تم حجز هذا الغرض للتو من شخص آخر', 409, 'ITEM_ALREADY_BOOKED');

    throw new AppError('الغرض غير متاح للحجز', 409, 'ITEM_NOT_AVAILABLE');
  }

  // إشعار المتبرع (non-blocking)
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
    msg:    'تم حجز الغرض بنجاح ✅',
    itemId: item._id,
    status: item.status,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// 6. إلغاء الحجز — ✅ LOGIC-02: إشعار Socket للمتبرع عند ترقية من Waitlist
// ─────────────────────────────────────────────────────────────────────────────
exports.cancelBookingLogic = async (itemId, userId) => {
  const item = await Item.findById(itemId)
    .populate('donor',    'name email')
    .populate('bookedBy', 'name email');

  if (!item) throw new AppError('الغرض غير موجود', 404, 'ITEM_NOT_FOUND');

  const isBooker = item.bookedBy?._id?.toString() === userId;
  const isDonor  = item.donor?._id?.toString()    === userId;
  const inWait   = item.waitlist?.some((w) => w.user.toString() === userId);

  if (!isBooker && !isDonor && !inWait)
    throw new AppError('ليس لديك صلاحية إلغاء هذا الحجز', 403, 'FORBIDDEN');

  // حالة: المستخدم في قائمة الانتظار فقط
  if (inWait && !isBooker && !isDonor) {
    item.waitlist = item.waitlist.filter((w) => w.user.toString() !== userId);
    await item.save();
    return { msg: 'تم إلغاء تسجيلك من قائمة الانتظار ✅' };
  }

  const canceledById = item.bookedBy?._id?.toString();

  // ترقية أول شخص من الـ Waitlist
  const nextUser = item.waitlist?.[0] ?? null;

  if (nextUser) {
    item.waitlist  = item.waitlist.slice(1);
    item.bookedBy  = nextUser.user;
    item.bookedAt  = new Date();
    item.status    = 'محجوز';

    // إضافة المُلغي لـ cancelledBy لمنع إعادة الحجز
    if (canceledById) item.cancelledBy.push(canceledById);
    await item.save();

    // ✅ LOGIC-02: إشعار المُرقَّى من Waitlist
    setImmediate(async () => {
      try {
        await notifyUser(nextUser.user.toString(), {
          type:    'waitlist_promoted',
          message: `🎉 أصبح غرض "${item.title}" متاحاً لك! تفقّد حجوزاتك.`,
          itemId:  item._id,
        });
        getIO()
          .to(getUserRoom(nextUser.user.toString()))
          .emit('item:waitlist_promoted', { itemId: item._id });

        // ✅ LOGIC-02: إشعار المتبرع أيضاً بتغيّر الحاجز (كان مفقوداً)
        await notifyUser(item.donor._id.toString(), {
          type:    'booking_transferred',
          message: `🔄 تم نقل حجز "${item.title}" لمستخدم آخر من قائمة الانتظار`,
          itemId:  item._id,
        });
        getIO()
          .to(getUserRoom(item.donor._id.toString()))
          .emit('item:booking_transferred', { itemId: item._id });
      } catch (_) {}
    });

    return { msg: 'تم إلغاء الحجز وتم ترقية أول شخص في قائمة الانتظار ✅' };
  }

  // لا يوجد أحد في Waitlist → إعادة الغرض لـ "متاح"
  if (canceledById) item.cancelledBy.push(canceledById);
  item.bookedBy = null;
  item.bookedAt = null;
  item.status   = 'متاح';
  await item.save();

  setImmediate(async () => {
    try {
      await notifyUser(item.donor._id.toString(), {
        type:    'booking_cancelled',
        message: `❌ تم إلغاء حجز غرضك "${item.title}"`,
        itemId:  item._id,
      });
      getIO()
        .to(getUserRoom(item.donor._id.toString()))
        .emit('item:booking_cancelled', { itemId: item._id });
    } catch (_) {}
  });

  return { msg: 'تم إلغاء الحجز بنجاح ✅' };
};

// ─────────────────────────────────────────────────────────────────────────────
// 7. تأكيد التسليم المزدوج — ✅ RACE-02 + LOGIC-01: Atomic بالكامل
// ─────────────────────────────────────────────────────────────────────────────
exports.completeDeliveryLogic = async (itemId, userId, confirmationType) => {
  const userIdStr = userId.toString();

  // ── تأكيد المستلم ─────────────────────────────────────────────────────────
  if (confirmationType === 'recipient_confirm') {
    // ✅ RACE-02: Atomic — شرط + تحديث في عملية واحدة
    const item = await Item.findOneAndUpdate(
      {
        _id:                itemId,
        status:             'محجوز',
        bookedBy:           userId,
        recipientConfirmed: false,   // ← يمنع التأكيد المزدوج
      },
      {
        $set: {
          recipientConfirmed:   true,
          recipientConfirmedAt: new Date(),
        },
      },
      { new: true }
    ).populate('donor bookedBy', 'name email');

    if (!item) {
      const exists = await Item.findById(itemId)
        .select('status bookedBy recipientConfirmed').lean();
      if (!exists)
        throw new AppError('الغرض غير موجود', 404, 'ITEM_NOT_FOUND');
      if (exists.bookedBy?.toString() !== userIdStr)
        throw new AppError('ليس لديك صلاحية تأكيد الاستلام', 403, 'FORBIDDEN');
      if (exists.status !== 'محجوز')
        throw new AppError('الغرض ليس في حالة الحجز', 400, 'INVALID_STATUS');
      if (exists.recipientConfirmed)
        throw new AppError('لقد قمت بالتأكيد مسبقاً ✅', 400, 'ALREADY_CONFIRMED');
      throw new AppError('تعذر تأكيد الاستلام', 400, 'CONFIRM_FAILED');
    }

    // إشعار المتبرع عبر Socket ليضغط "تأكيد التسليم"
    setImmediate(() => {
      try {
        getIO()
          .to(getUserRoom(item.donor._id.toString()))
          .emit('item:recipient_confirmed', {
            itemId:    item._id,
            itemTitle: item.title,
            message:   `✅ المستلم أكّد الاستلام — بانتظار تأكيدك أنت`,
          });

        notifyUser(item.donor._id.toString(), {
          type:    'recipient_confirmed',
          message: `📦 "${item.title}" — المستلم أكّد الوصول. أكّد أنت التسليم لإتمام العملية.`,
          itemId:  item._id,
        }).catch(() => {});
      } catch (_) {}
    });

    return {
      status:  'pending_donor',
      msg:     'تم تأكيد الاستلام ✅ — بانتظار تأكيد المتبرع',
      itemId:  item._id,
    };
  }

  // ── تأكيد المتبرع ─────────────────────────────────────────────────────────
  if (confirmationType === 'donor_confirm') {
    // ✅ RACE-02 + LOGIC-01: Atomic — شرط recipientConfirmed: true يضمن الترتيب الصحيح
    // ✅ LOGIC-01: التحوّل لـ "تم التسليم" يحدث في نفس العملية الذرية
    const item = await Item.findOneAndUpdate(
      {
        _id:                itemId,
        status:             'محجوز',
        donor:              userId,
        recipientConfirmed: true,    // ← المستلم أكّد أولاً
        donorConfirmed:     false,   // ← يمنع التأكيد المزدوج
      },
      {
        $set: {
          donorConfirmed:   true,
          donorConfirmedAt: new Date(),
          status:           'تم التسليم',  // ✅ LOGIC-01: atomic في نفس اللحظة
          deliveredAt:      new Date(),
        },
      },
      { new: true }
    ).populate('donor bookedBy', 'name email trustScore gamification');

    if (!item) {
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

    // تحديث نقاط المتبرع والمستلم (non-blocking)
    setImmediate(async () => {
      try {
        await Promise.allSettled([
          User.findByIdAndUpdate(item.donor._id, {
            $inc: { trustScore: 10, 'gamification.donationsCompleted': 1 },
          }),
          User.findByIdAndUpdate(item.bookedBy._id, {
            $inc: { 'gamification.receiptsCompleted': 1 },
          }),
        ]);

        // إشعار المستلم بالإتمام
        await notifyUser(item.bookedBy._id.toString(), {
          type:    'delivery_completed',
          message: `🎉 اكتملت عملية التسليم للغرض "${item.title}"`,
          itemId:  item._id,
        });

        // Socket broadcast للمستلم
        getIO()
          .to(getUserRoom(item.bookedBy._id.toString()))
          .emit('item:delivered', {
            itemId:    item._id,
            itemTitle: item.title,
            message:   '🎉 تمت عملية التسليم بنجاح!',
          });

        // Leaderboard update
        getIO().to('leaderboard_subscribers').emit('leaderboard:update');
      } catch (_) {}
    });

    return {
      status:  'delivered',
      msg:     'تم إتمام التسليم بنجاح 🎉',
      itemId:  item._id,
    };
  }

  throw new AppError('نوع التأكيد غير صحيح', 400, 'INVALID_CONFIRMATION_TYPE');
};

// ─────────────────────────────────────────────────────────────────────────────
// 8. تعديل غرض
// ─────────────────────────────────────────────────────────────────────────────
exports.updateItemLogic = async (itemId, userId, body, file) => {
  const item = await Item.findById(itemId);
  if (!item) throw new AppError('الغرض غير موجود', 404, 'ITEM_NOT_FOUND');

  const isOwner = item.donor.toString() === userId.toString();
  if (!isOwner)
    throw new AppError('ليس لديك صلاحية تعديل هذا الغرض', 403, 'FORBIDDEN');
  if (item.status !== 'متاح')
    throw new AppError('لا يمكن تعديل غرض محجوز أو مُسلَّم', 400, 'ITEM_NOT_EDITABLE');

  const ALLOWED = ['title', 'description', 'category', 'location', 'condition'];
  for (const key of ALLOWED) {
    if (body[key] !== undefined) item[key] = body[key];
  }

  if (file) {
    validateImageFile(file);
    const upload = await uploadToCloudinary(file.buffer);
    item.imageUrl     = upload.secure_url;
    item.cloudinaryId = upload.public_id;
  }

  await item.save();
  return { msg: 'تم تحديث الغرض ✅', item: toPublicItem(item.toObject()) };
};

// ─────────────────────────────────────────────────────────────────────────────
// 9. حذف غرض
// ─────────────────────────────────────────────────────────────────────────────
exports.deleteItemLogic = async (itemId, userId, isAdmin) => {
  const item = await Item.findById(itemId).select('donor status title').lean();
  if (!item) throw new AppError('الغرض غير موجود', 404, 'ITEM_NOT_FOUND');

  const isOwner = item.donor.toString() === userId.toString();
  if (!isOwner && !isAdmin)
    throw new AppError('ليس لديك صلاحية حذف هذا الغرض', 403, 'FORBIDDEN');
  if (item.status === 'محجوز' && !isAdmin)
    throw new AppError('لا يمكن حذف غرض محجوز — ألغِ الحجز أولاً', 400, 'ITEM_IS_BOOKED');

  await Item.deleteOne({ _id: itemId });
  return { msg: 'تم حذف الغرض ✅' };
};