// services/itemService.js
// ✅ PATCHED v2 — جميع إصلاحات Flow 5 مُطبَّقة

const mongoose        = require('mongoose'); // ✅ FIX [DUP-01]: نقل require للأعلى بدل داخل الدالة
const Item            = require('../models/Item');
const User            = require('../models/User');
const Report          = require('../models/Report');
const SystemSettings  = require('../models/SystemSettings');
const DonationRequest = require('../models/DonationRequest');
const SafeHub         = require('../models/SafeHub');

const itemRepository  = require('../repositories/itemRepository');
const AppError        = require('../utils/AppError');

const { fireSendEmail }      = require('../utils/sendEmail');
const { uploadToCloudinary } = require('../utils/uploadToCloudinary');
const notifyUser             = require('../utils/notifyUser');
const { toPublicItem, toDonorItem, toReceiverItem } = require('../dtos/itemDto');
const { getIO }              = require('../socket');

// ── ✅ ARCH-01: ثوابت مشتركة ────────────────────────────────────────────────
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const validateImageFile = async (file) => {
  // ✅ FIX [HARD-01]: MAX_IMAGE_SIZE من SystemSettings بدل قيمة ثابتة
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

  // ✅ FIX [BROWSE-01]: أظهر المتاح + المحجوز — احذف فقط 'تم التسليم' و'ملغي'
  const filter = { status: { $in: ['متاح', 'محجوز'] } };

  if (query.location)    filter.location = new RegExp(escapeRegex(query.location), 'i');
  if (query.search)      filter.title    = new RegExp(escapeRegex(query.search),    'i');
  if (query.category && query.category !== 'all') filter.category = query.category;

  // ✅ FIX [BROWSE-02]: فلتر اختياري للشخص اللي يريد المتاح فقط
  if (query.availableOnly === 'true') filter.status = 'متاح';

  const [items, total] = await Promise.all([
    Item.find(filter)
      .populate('donor',   'name avatar trustScore isVerifiedStudent trustLevel')
      .populate('safeHub', 'name address city workingHours')
      .sort({ status: 1, createdAt: -1 }) // ✅ 'متاح' يجي قبل 'محجوز' أبجدياً
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
// ✅ FIX [PERF-01]: استخدام itemRepository بدل استعلامات مكررة + حذف N+1 Query
// ─────────────────────────────────────────────────────────────────────────────
exports.getMyItemsLogic = async (userId) => {
  const [user, myDonations, myRequests] = await Promise.all([
    User.findById(userId)
      .select('name email trustScore quota isVerifiedStudent gamification').lean(),
    itemRepository.findDonationsByUser(userId),  // ✅ يتضمن reportId تلقائياً
    itemRepository.findReceivedByUser(userId),   // ✅ يتضمن reportId تلقائياً
  ]);

  // ✅ 3 queries متوازية بدل 4 — Report query محذوف (مدمج في Repository)
  return { user, myDonations, myRequests };
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

  // ✅ FIX [UX-02]: مرّر requesterId للـ DTO ليحسب isInWaitlist
  // المتبرع يرى waitlist كاملة — باقي الجمهور يرى isInWaitlist فقط
  if (isOwner) {
    return toDonorItem(obj, requesterId);
  }

  if (isBookerReq) {
    delete obj.waitlist;
    return toReceiverItem(obj, requesterId);
  }

  // زائر عادي أو مستخدم في الطابور
  delete obj.waitlist;
  return toPublicItem(obj, requesterId);
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. إضافة غرض جديد
// ─────────────────────────────────────────────────────────────────────────────
exports.createItemLogic = async (body, userId, file) => {
  await validateImageFile(file); // ✅ async الآن لقراءة maxImageSizeMB

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
// ✅ FIX [LOGIC-WAITLIST]: إضافة المستخدم للـ Waitlist بدل رمي Error مباشرة
// ✅ FIX [LOGIC-WAITLIST-LIMIT]: حد أقصى ديناميكي للـ Waitlist من SystemSettings
// ─────────────────────────────────────────────────────────────────────────────
exports.bookItemLogic = async (itemId, userId) => {
  const [user, settings] = await Promise.all([
    User.findById(userId).select('trustLevel quota bookingCount').lean(),
    SystemSettings.getCached(),
  ]);

  if (!user)
    throw new AppError('المستخدم غير موجود', 404, 'USER_NOT_FOUND');

  // ✅ FIX: trustLevel هو مصدر الحقيقة الوحيد
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

  // ✅ RACE-01: Atomic findOneAndUpdate — الحجز الفعلي
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

  // ✅ الحجز نجح
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

  // ✅ FIX [LOGIC-WAITLIST]: الحجز فشل — تحليل السبب ثم إضافة للـ Waitlist إن أمكن
  const exists = await Item.findById(itemId)
    .select('status donor bookedBy waitlist cancelledBy')
    .lean();

  if (!exists)
    throw new AppError('الغرض غير موجود', 404, 'ITEM_NOT_FOUND');

  if (exists.donor.toString() === userId.toString())
    throw new AppError('لا يمكنك حجز غرضك الخاص', 400, 'CANNOT_BOOK_OWN_ITEM');

  // ✅ FIX: منع من ألغى حجزه مسبقاً من الانضمام للـ Waitlist أيضاً
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
    // ✅ FIX [LOGIC-WAITLIST-LIMIT]: حد أقصى ديناميكي من SystemSettings
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

    // ✅ إضافة ذرية للـ Waitlist — تمنع التكرار حتى في حالة Race Condition
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

  // ✅ مغادرة قائمة الانتظار فقط
  if (inWait && !isBooker && !isDonor) {
    item.waitlist = item.waitlist.filter((w) => w.user.toString() !== userId);
    await item.save();
    return { msg: 'تم إلغاء تسجيلك من قائمة الانتظار ✅' };
  }

  const canceledById = item.bookedBy?._id?.toString();
  const nextUser     = item.waitlist?.[0] ?? null;

  if (nextUser) {
    item.waitlist = item.waitlist.slice(1);
    item.bookedBy = nextUser.user;
    item.bookedAt = new Date();
    item.status   = 'محجوز';

    if (canceledById) item.cancelledBy.push(canceledById);
    await item.save();

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
// 7. تأكيد التسليم المزدوج
// ─────────────────────────────────────────────────────────────────────────────
exports.completeDeliveryLogic = async (itemId, userId, confirmationType) => {
  if (!userId) throw new AppError('المستخدم غير معرّف', 401, 'UNAUTHORIZED');

  // ✅ FIX [DUP-01]: mongoose مُعرَّف في أعلى الملف — لا حاجة لـ require هنا
  const userObjectId = typeof userId === 'string'
    ? new mongoose.Types.ObjectId(userId)
    : userId;
  const userIdStr = userId.toString();

  // ── تأكيد المستلم ──────────────────────────────────────────────────────────
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

  // ── تأكيد المتبرع ──────────────────────────────────────────────────────────
  if (confirmationType === 'donor_confirm') {
    const session = await mongoose.startSession();
    session.startTransaction();

    let deliveredItem;

    try {
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
      try { session.endSession(); } catch (_) {}

    } catch (err) {
      if (session.inTransaction()) await session.abortTransaction();
      try { session.endSession(); } catch (_) {}
      throw err;
    }

    setImmediate(async () => {
      try {
        const io = getIO();
        await notifyUser(deliveredItem.bookedBy._id.toString(), {
          type:    'delivery_completed',
          message: `🎉 اكتملت عملية التسليم للغرض "${deliveredItem.title}"`,
          itemId:  deliveredItem._id,
        });
        io.to(`user_${deliveredItem.bookedBy._id}`).emit('item:delivered', {
          itemId:    deliveredItem._id,
          itemTitle: deliveredItem.title,
          message:   '🎉 تمت عملية التسليم بنجاح!',
        });
        io.to('leaderboard_subscribers').emit('leaderboard:update');
      } catch (_) {}
    });

    return {
      status: 'delivered',
      msg:    'تم إتمام التسليم بنجاح 🎉',
      itemId: deliveredItem._id,
    };
  }

  throw new AppError('نوع التأكيد غير صحيح', 400, 'INVALID_CONFIRMATION_TYPE');
};

// ─────────────────────────────────────────────────────────────────────────────
// 8. تعديل غرض
// ✅ FIX [SEC-IDOR]: Atomic Query يدمج الجلب والتحقق من الملكية
// ✅ FIX [SEC-SAFEHUB]: safeHub محذوف من ALLOWED — لا يُعدَّل بعد الإنشاء
// ─────────────────────────────────────────────────────────────────────────────
exports.updateItemLogic = async (itemId, userId, body, file) => {
  // ✅ FIX [SEC-IDOR]: استعلام ذري واحد يدمج الجلب + فحص الملكية + فحص الحالة
  const item = await Item.findOne({
    _id:    itemId,
    donor:  userId,   // ← ملكية مُدمجة في الـ Query
    status: 'متاح',   // ← لا يُعدَّل محجوز أو مُسلَّم
  });

  if (!item) {
    const exists = await Item.findById(itemId).select('status donor').lean();
    if (!exists)
      throw new AppError('الغرض غير موجود', 404, 'ITEM_NOT_FOUND');
    if (exists.donor.toString() !== userId.toString())
      throw new AppError('ليس لديك صلاحية تعديل هذا الغرض', 403, 'FORBIDDEN');
    throw new AppError(
      'لا يمكن تعديل غرض محجوز أو مُسلَّم',
      400,
      'ITEM_NOT_EDITABLE'
    );
  }

  // ✅ FIX [SEC-SAFEHUB]: safeHub محذوف — يُحدَّد عند الإنشاء فقط ولا يتغير
  const ALLOWED = ['title', 'description', 'category', 'location', 'condition'];
  for (const key of ALLOWED) {
    if (body[key] !== undefined) item[key] = body[key];
  }

  if (file) {
    await validateImageFile(file);
    const upload      = await uploadToCloudinary(file.buffer);
    item.imageUrl     = upload.secure_url;
    item.cloudinaryId = upload.public_id;
  }

  await item.save();
  return { msg: 'تم تحديث الغرض ✅', item: toPublicItem(item.toObject()) };
};

// ─────────────────────────────────────────────────────────────────────────────
// 9. حذف غرض
// ✅ FIX [LOGIC-DELETE]: إشعار المستلم عند حذف غرض محجوز من قِبل الأدمن
// ─────────────────────────────────────────────────────────────────────────────
exports.deleteItemLogic = async (itemId, userId, isAdmin) => {
  const item = await Item.findById(itemId)
    .select('donor status title bookedBy').lean();
  if (!item) throw new AppError('الغرض غير موجود', 404, 'ITEM_NOT_FOUND');

  const isOwner = item.donor.toString() === userId.toString();
  if (!isOwner && !isAdmin)
    throw new AppError('ليس لديك صلاحية حذف هذا الغرض', 403, 'FORBIDDEN');
  if (item.status === 'محجوز' && !isAdmin)
    throw new AppError('لا يمكن حذف غرض محجوز — ألغِ الحجز أولاً', 400, 'ITEM_IS_BOOKED');

  // ✅ FIX [LOGIC-DELETE]: إشعار المستلم قبل الحذف إذا كان الأدمن هو من يحذف
  if (isAdmin && item.status === 'محجوز' && item.bookedBy) {
    setImmediate(async () => {
      try {
        await notifyUser(item.bookedBy.toString(), {
          type:    'booking_cancelled_by_admin',
          message: `⚠️ تم حذف الغرض "${item.title}" من قِبل الإدارة. يُرجى البحث عن بدائل.`,
          itemId:  item._id,
        });
        getIO()
          .to(getUserRoom(item.bookedBy.toString()))
          .emit('item:deleted_by_admin', {
            itemId:  item._id,
            message: `تم حذف الغرض "${item.title}" من قِبل الإدارة`,
          });
      } catch (_) {}
    });
  }

  await Item.deleteOne({ _id: itemId });
  return { msg: 'تم حذف الغرض ✅' };
};