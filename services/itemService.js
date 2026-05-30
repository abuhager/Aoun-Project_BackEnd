const mongoose = require('mongoose');
const cloudinary = require('../config/cloudinary');
const Item = require('../models/Item');
const User = require('../models/User');
const Report = require('../models/Report');
const SystemSettings = require('../models/SystemSettings');

const SystemSettings = require('../models/SystemSettings');
const itemRepository = require('../repositories/itemRepository');
const AppError = require('../utils/AppError');
const SafeHub = require('../models/SafeHub');


const { generateOtp } = require('../utils/otp');
const { fireSendEmail } = require('../utils/sendEmail');
const { uploadToCloudinary } = require('../utils/uploadToCloudinary');
const { notifyUser } = require('../utils/notifyUser');
const { toPublicItem } = require('../dtos/itemDto');

const escapeRegex = (str = '') =>
  String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 100);

const restoreQuota = async (userId, amount = 1, session = null) => {
  if (!userId || amount <= 0) return;
  await User.findByIdAndUpdate(userId, { $inc: { quota: amount } }, session ? { session } : {});
};

const getUserRoom = (userId) => `user_${userId}`;

exports.getItemsLogic = async (query) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(20, Math.max(1, parseInt(query.limit, 10) || 10));
  const skip = (page - 1) * limit;

  const filter = { status: 'متاح' };

  if (query.location) filter.location = new RegExp(escapeRegex(query.location), 'i');
  if (query.search) filter.title = new RegExp(escapeRegex(query.search), 'i');
  if (query.category && query.category !== 'all') filter.category = query.category;

  const [items, total] = await Promise.all([
    Item.find(filter)
      .populate('donor', 'name avatar trustScore isVerifiedStudent trustLevel')
      .populate('safeHub', 'name address city workingHours')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('-deliveryOtp -waitlist -__v')
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

exports.getMyItemsLogic = async (userId) => {
  const [user, myDonations, myRequests] = await Promise.all([
    User.findById(userId).select('name email trustScore quota isVerifiedStudent gamification').lean(),
    Item.find({ donor: userId }).populate('bookedBy', 'name avatar').sort({ createdAt: -1 }).lean(),
    Item.find({ bookedBy: userId }).populate('donor', 'name avatar').sort({ createdAt: -1 }).lean(),
  ]);

  const donationIds = myDonations.map((i) => i._id);
  const requestIds = myRequests.map((i) => i._id);
  const allItemIds = [...donationIds, ...requestIds];

  const reports = await Report.find({
    relatedItem: { $in: allItemIds },
    reportedUser: userId,
    status: { $in: ['pending', 'actioned'] },
  }).select('relatedItem').lean();

  const reportMap = new Map(reports.map((r) => [r.relatedItem.toString(), r._id.toString()]));

  return {
    user,
    myDonations: myDonations.map((item) => ({ ...item, reportId: reportMap.get(item._id.toString()) ?? null })),
    myRequests: myRequests.map((item) => ({ ...item, reportId: reportMap.get(item._id.toString()) ?? null })),
  };
};

exports.getItemByIdLogic = async (itemId, requesterId) => {
  const item = await itemRepository.findItemDetails(itemId);
  if (!item) throw Object.assign(new Error('الغرض غير موجود'), { status: 404 });

  const obj = item.toObject ? item.toObject() : { ...item };
  const isDonor = requesterId && obj.donor?._id?.toString() === requesterId;
  if (!isDonor) delete obj.deliveryOtp;

  return obj;
};

exports.createItemLogic = async (body, userId, file) => {
  if (!file) {
    throw new AppError('الصورة مطلوبة', 400, 'IMAGE_REQUIRED');
  }

  const [user, settings, activeCount, safeHub] = await Promise.all([
    User.findById(userId).select('isVerified trustLevel quota').lean(),
    SystemSettings.getCached(),
    Item.countDocuments({
      donor: userId,
      status: { $in: ['متاح', 'محجوز'] },
    }),
    SafeHub.findOne({ _id: body.safeHub, isActive: true }).lean(),
  ]);

  if (!user) {
    throw new AppError('المستخدم غير موجود', 404, 'USER_NOT_FOUND');
  }

  if (!user.isVerified) {
    throw new AppError('يجب تفعيل الحساب أولاً ✅', 403, 'ACCOUNT_NOT_VERIFIED');
  }

  if (!safeHub) {
    throw new AppError('نقطة الاستلام غير موجودة أو غير مفعّلة', 400, 'INVALID_SAFE_HUB');
  }

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
    title: body.title?.trim(),
    description: body.description?.trim(),
    category: body.category,
    location: body.location?.trim(),
    condition: body.condition,
    safeHub: body.safeHub,
    donor: userId,
    imageUrl: uploadResult.secure_url,
    cloudinaryId: uploadResult.public_id,
  });

  return {
    msg: 'تم إضافة الغرض بنجاح 🎉',
    item,
  };
};

exports.bookItemLogic = async (itemId, userId) => {
  const restoreQuota = async () => {
    await User.findByIdAndUpdate(userId, { $inc: { quota: 1 } });
  };

  // 1) خصم الكوتا مبدئياً بشكل ذري
  const user = await User.findOneAndUpdate(
    { _id: userId, quota: { $gt: 0 } },
    { $inc: { quota: -1 } },
    { new: true }
  );

  if (!user) {
    throw new AppError(
      'لا تملك حصصاً متاحة لحجز أغراض جديدة 🚫',
      403,
      'NO_AVAILABLE_QUOTA'
    );
  }

  // 2) جلب الغرض والتحقق من القيود
  const item = await itemRepository.findItemForAction(itemId);

  if (!item) {
    await restoreQuota();
    throw new AppError('الغرض غير موجود', 404, 'ITEM_NOT_FOUND');
  }

  if (item.donor.toString() === userId) {
    await restoreQuota();
    throw new AppError('لا يمكنك حجز غرضك الخاص', 400, 'CANNOT_BOOK_OWN_ITEM');
  }

  if (item.cancelledBy?.some((id) => id.toString() === userId)) {
    await restoreQuota();
    throw new AppError(
      'لا يمكنك الحجز مجدداً لأنك ألغيت الحجز مسبقاً',
      400,
      'BOOKING_RETRY_NOT_ALLOWED'
    );
  }

  // 3) إذا الغرض متاح، حاول حجزه فوراً بشكل ذري
  if (item.status === 'متاح') {
    const newOtp = generateOtp();

    const booked = await Item.findOneAndUpdate(
      { _id: itemId, status: 'متاح' },
      {
        $set: {
          status: 'محجوز',
          bookedBy: userId,
          deliveryOtp: newOtp,
          bookedAt: new Date(),
        },
      },
      { new: true }
    ).populate('safeHub', 'name address city workingHours');

    // لو فشل الحجز لأن أحداً سبقك
    if (!booked) {
      const alreadyInWaitlist = item.waitlist?.some(
        (w) => w.user.toString() === userId
      );

      if (alreadyInWaitlist) {
        await restoreQuota();
        throw new AppError('أنت بالفعل في قائمة الانتظار', 409, 'ALREADY_IN_WAITLIST');
      }

      const waitlistUpdated = await Item.findOneAndUpdate(
        { _id: itemId, 'waitlist.user': { $ne: userId } },
        { $push: { waitlist: { user: userId, joinedAt: new Date() } } },
        { new: true }
      );

      if (!waitlistUpdated) {
        await restoreQuota();
        throw new AppError('أنت بالفعل في قائمة الانتظار', 409, 'ALREADY_IN_WAITLIST');
      }

      // ✅ الانتظار لا يجب أن يستهلك quota
      await restoreQuota();

      return {
        status: 'waitlist',
        msg: 'تمت إضافتك لقائمة الانتظار ⏳',
      };
    }

    const hubSection = booked.safeHub
      ? `<hr/>
         <p>📍 <b>نقطة التسليم:</b> ${booked.safeHub.name}</p>
         <p>🏙️ ${booked.safeHub.city} — ${booked.safeHub.address}</p>
         <p>🕐 أوقات العمل: ${booked.safeHub.workingHours || 'غير محدد'}</p>`
      : `<p>📦 سيتم التنسيق مع المتبرع مباشرة</p>`;

    await Promise.all([
      notifyUser(item.donor, {
        type: 'item_booked',
        title: 'تم حجز غرضك! 🎉',
        body: `قام شخص ما بحجز "${item.title}"`,
        itemId: item._id,
      }),
      fireSendEmail({
        email: user.email,
        subject: 'تم حجز الغرض 🎉',
        message: `
          <div dir="rtl">
            <p>تم حجز <b>${booked.title}</b> بنجاح!</p>
            <p>🔑 رمز الاستلام: <b style="font-size:1.4em">${newOtp}</b></p>
            <p>⏱️ لديك <b>72 ساعة</b> لاستلام الغرض</p>
            ${hubSection}
          </div>
        `,
      }),
    ]);

    return {
      status: 'booked',
      msg: 'تم الحجز بنجاح 🎉',
    };
  }

  // 4) إن لم يكن متاحاً، أضفه للـ waitlist فقط
  const alreadyInWaitlist = item.waitlist?.some(
    (w) => w.user.toString() === userId
  );

  if (alreadyInWaitlist) {
    await restoreQuota();
    throw new AppError('أنت بالفعل في قائمة الانتظار', 409, 'ALREADY_IN_WAITLIST');
  }

  const waitlistUpdated = await Item.findOneAndUpdate(
    { _id: itemId, 'waitlist.user': { $ne: userId } },
    { $push: { waitlist: { user: userId, joinedAt: new Date() } } },
    { new: true }
  );

  if (!waitlistUpdated) {
    await restoreQuota();
    throw new AppError('أنت بالفعل في قائمة الانتظار', 409, 'ALREADY_IN_WAITLIST');
  }

  // ✅ قائمة الانتظار لا تستهلك quota
  await restoreQuota();

  return {
    status: 'waitlist',
    msg: 'تمت إضافتك لقائمة الانتظار ⏳',
  };
};

// ─── 6. إلغاء الحجز ──────────────────────────────────────────
exports.cancelBookingLogic = async (itemId, userId) => {
  const item = await itemRepository.findItemForAction(itemId);

  if (!item) {
    throw new AppError('الغرض غير موجود', 404, 'ITEM_NOT_FOUND');
  }

  const isBooker = item.bookedBy && item.bookedBy.toString() === userId;
  const isDonor  = item.donor.toString() === userId;
  const inWait   = item.waitlist?.some((w) => w.user.toString() === userId);

  if (!isBooker && !isDonor && !inWait) {
    throw new AppError('غير مصرح لك', 403, 'FORBIDDEN');
  }

  // ✅ الانسحاب من قائمة الانتظار فقط — بدون إعادة quota
  // لأن دخول waitlist لا يستهلك quota في المنطق الجديد
  if (inWait && !isBooker && !isDonor) {
    await Item.findByIdAndUpdate(item._id, {
      $pull: { waitlist: { user: userId } },
    });

    return { msg: 'تم انسحابك من قائمة الانتظار 🚶‍♂️' };
  }

  const previousBooker = item.bookedBy;

  // ✅ يوجد waitlist — مرّر الدور لأول مستخدم صالح
  if (item.waitlist?.length > 0) {
    const topWaiting = item.waitlist.slice(0, 3);

    for (const waiting of topWaiting) {
      const nextValidUser = await User.findOneAndUpdate(
        { _id: waiting.user, quota: { $gt: 0 } },
        { $inc: { quota: -1 } },
        { new: true }
      );

      if (!nextValidUser) {
        await Item.findByIdAndUpdate(item._id, {
          $pull: { waitlist: { user: waiting.user } },
        });
        continue;
      }

      const newOtp = generateOtp();

      const updated = await Item.findOneAndUpdate(
        {
          _id: item._id,
          'waitlist.user': nextValidUser._id,
        },
        {
          $set: {
            status: 'محجوز',
            bookedBy: nextValidUser._id,
            deliveryOtp: newOtp,
            bookedAt: new Date(),
            recipientConfirmed: false,
            recipientConfirmedAt: null,
            donorConfirmed: false,
            donorConfirmedAt: null,
          },
          $addToSet: { cancelledBy: previousBooker },
          $pull: { waitlist: { user: nextValidUser._id } },
        },
        { new: true }
      );

      if (!updated) {
        await User.findByIdAndUpdate(nextValidUser._id, { $inc: { quota: 1 } });
        continue;
      }

      if (previousBooker) {
        await User.findByIdAndUpdate(previousBooker, { $inc: { quota: 1 } });
      }

      await Promise.all([
        notifyUser(nextValidUser._id, {
          type: 'waitlist_promoted',
          title: 'وصل دورك! 🔔',
          body: `أصبح "${item.title}" محجوزاً لك`,
          itemId: item._id,
        }),
        fireSendEmail({
          email: nextValidUser.email,
          subject: 'الدور وصلك في عون 🎉',
          message: `
            <div dir="rtl">
              <p>أصبح الغرض <b>${item.title}</b> محجوزاً لك الآن!</p>
              <p>🔑 رمز الاستلام: <b style="font-size:1.4em">${newOtp}</b></p>
              <p>⏱️ لديك <b>72 ساعة</b> لإتمام الاستلام</p>
            </div>
          `,
        }),
      ]);

      return { msg: 'تم إلغاء الحجز وتمرير الدور للشخص التالي 🔄' };
    }
  }

  // ✅ لا يوجد waitlist صالح — أعد الغرض متاحاً
  await Item.findByIdAndUpdate(item._id, {
    $set: {
      status: 'متاح',
      bookedBy: null,
      bookedAt: null,
      recipientConfirmed: false,
      recipientConfirmedAt: null,
      donorConfirmed: false,
      donorConfirmedAt: null,
    },
    $unset: { deliveryOtp: '' },
    $addToSet: { cancelledBy: previousBooker },
  });

  if (previousBooker) {
    await User.findByIdAndUpdate(previousBooker, { $inc: { quota: 1 } });
  }

  await notifyUser(item.donor, {
    type: 'booking_cancelled',
    title: 'تم إلغاء الحجز',
    body: `غرضك "${item.title}" متاح مجدداً`,
    itemId: item._id,
  });

  return { msg: 'تم إلغاء الحجز والقطعة متاحة الآن ✅' };
};

// ─── 7. إتمام التسليم ─────────────────────────────────────────
exports.completeDeliveryLogic = async (itemId, userId, confirmationType) => {
  if (!['recipient_confirm', 'donor_confirm'].includes(confirmationType)) {
    throw new AppError('نوع التأكيد غير صحيح', 400, 'INVALID_CONFIRMATION_TYPE');
  }

  const item = await itemRepository.findItemForAction(itemId);

  if (!item) {
    throw new AppError('الغرض غير موجود', 404, 'ITEM_NOT_FOUND');
  }

  if (item.status === 'تم التسليم') {
    throw new AppError('تم تسليم هذا الغرض مسبقاً ✅', 400, 'ALREADY_DELIVERED');
  }

  if (item.status !== 'محجوز') {
    throw new AppError('الغرض غير محجوز حالياً', 400, 'ITEM_NOT_BOOKED');
  }

  // ══════════════════════════════════════════════════════════════
  // 1) المستلم يؤكد الاستلام
  // ══════════════════════════════════════════════════════════════
  if (confirmationType === 'recipient_confirm') {
    if (item.bookedBy?.toString() !== userId.toString()) {
      throw new AppError('أنت لستَ الحاجز لهذا الغرض', 403, 'NOT_BOOKER');
    }

    if (item.recipientConfirmed) {
      throw new AppError('لقد أكّدت الاستلام مسبقاً ⏳', 400, 'RECIPIENT_ALREADY_CONFIRMED');
    }

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
      throw new AppError(
        'تعذّر تسجيل تأكيد الاستلام — حاول مرة أخرى',
        409,
        'RECIPIENT_CONFIRM_CONFLICT'
      );
    }

    try {
      const { getIO } = require('../socket/socketHandler');

      getIO()
        .to(`user_${item.donor.toString()}`)
        .emit('delivery:recipient_confirmed', {
          itemId: item._id,
          title: item.title,
          bookedBy: item.bookedBy,
          msg: 'قام المستلم بتأكيد الاستلام، بانتظار تأكيدك النهائي.',
        });
    } catch (_) {}

    await notifyUser(item.donor, {
      type: 'recipient_confirmed_receipt',
      title: 'تم تأكيد الاستلام من المستلم 📦',
      body: `قام المستلم بتأكيد استلام "${item.title}"، أكّد التسليم من طرفك الآن`,
      itemId: item._id,
    });

    return {
      status: 'recipient_confirmed',
      msg: 'تم تسجيل تأكيد الاستلام ✅ وبانتظار تأكيد المتبرع',
    };
  }

  // ══════════════════════════════════════════════════════════════
  // 2) المتبرع يؤكد التسليم النهائي
  // ══════════════════════════════════════════════════════════════
  if (item.donor?.toString() !== userId.toString()) {
    throw new AppError('أنت لستَ المتبرع لهذا الغرض', 403, 'NOT_DONOR');
  }

  if (!item.recipientConfirmed) {
    throw new AppError(
      'لا يمكن تأكيد التسليم قبل أن يؤكد المستلم الاستلام أولاً',
      400,
      'RECIPIENT_CONFIRM_REQUIRED'
    );
  }

  if (item.donorConfirmed) {
    throw new AppError('لقد أكّدت التسليم مسبقاً ✅', 400, 'DONOR_ALREADY_CONFIRMED');
  }

  const deliveredItem = await Item.findOneAndUpdate(
    {
      _id: itemId,
      status: 'محجوز',
      donor: userId,
      recipientConfirmed: true,
      donorConfirmed: { $ne: true },
    },
    {
      $set: {
        donorConfirmed: true,
        donorConfirmedAt: new Date(),
        status: 'تم التسليم',
        deliveredAt: new Date(),
      },
      $unset: {
        deliveryOtp: '',
      },
    },
    { new: true }
  ).lean();

  if (!deliveredItem) {
    throw new AppError(
      'تعذّر إتمام التسليم — حاول مرة أخرى',
      409,
      'DONOR_CONFIRM_CONFLICT'
    );
  }

  const settings = await SystemSettings.getCached();
  const quotaReward = settings.donorQuotaReward ?? 1;
  const trustScorePerDonation = settings.trustScorePerDonation ?? 5;

  await Promise.all([
    User.findByIdAndUpdate(item.donor, {
      $inc: {
        totalDonations: 1,
        trustScore: trustScorePerDonation,
        quota: quotaReward,
      },
    }),
    notifyUser(item.bookedBy, {
      type: 'delivery_completed',
      title: 'تم التسليم بنجاح 🎉',
      body: `اكتمل تسليم "${item.title}" بنجاح`,
      itemId: item._id,
    }),
  ]);

  try {
    const { getIO } = require('../socket/socketHandler');
    getIO()
      .to(`user_${item.bookedBy.toString()}`)
      .emit('delivery:completed', {
        itemId: item._id,
        title: item.title,
        msg: 'تم تأكيد التسليم النهائي بنجاح',
      });
  } catch (_) {}

  return {
    status: 'delivered',
    msg: 'تم تأكيد التسليم النهائي بنجاح 🎉',
  };
};

// services/itemService.js
// ─── 8. تعديل غرض ────────────────────────────────────────────
exports.updateItemLogic = async (itemId, userId, updateData, file) => {
  const item = await itemRepository.findItemForUpdate(itemId, userId);

  if (!item) {
    throw new AppError(
      'الغرض غير موجود أو لا تملك صلاحية تعديله',
      404,
      'ITEM_NOT_FOUND_OR_FORBIDDEN'
    );
  }

  if (item.status === 'تم التسليم') {
    throw new AppError(
      'لا يمكن تعديل غرض تم تسليمه',
      400,
      'DELIVERED_ITEM_CANNOT_BE_UPDATED'
    );
  }

  // ✅ الأفضل منع تعديل الغرض بعد حجزه لتفادي تغيير نقطة التسليم/الوصف أثناء العملية
  if (item.status === 'محجوز') {
    throw new AppError(
      'لا يمكن تعديل غرض محجوز حالياً',
      400,
      'BOOKED_ITEM_CANNOT_BE_UPDATED'
    );
  }

  const settings = await SystemSettings.getCached();

  if (updateData.category && !settings.categories?.includes(updateData.category)) {
    throw new AppError(
      `التصنيف "${updateData.category}" غير مدعوم`,
      400,
      'INVALID_CATEGORY'
    );
  }

  if (updateData.safeHub) {
    const safeHub = await SafeHub.findOne({
      _id: updateData.safeHub,
      isActive: true,
    }).lean();

    if (!safeHub) {
      throw new AppError(
        'نقطة الاستلام غير موجودة أو غير مفعّلة',
        400,
        'INVALID_SAFE_HUB'
      );
    }
  }

  if (file) {
    if (item.cloudinaryId) {
      await cloudinary.uploader.destroy(item.cloudinaryId).catch(() => null);
    }

    const uploadResult = await uploadToCloudinary(file.buffer);
    item.imageUrl = uploadResult.secure_url;
    item.cloudinaryId = uploadResult.public_id;
  }

  if (typeof updateData.title === 'string') {
    item.title = updateData.title.trim();
  }

  if (typeof updateData.description === 'string') {
    item.description = updateData.description.trim();
  }

  if (typeof updateData.category === 'string') {
    item.category = updateData.category;
  }

  if (typeof updateData.location === 'string') {
    item.location = updateData.location.trim();
  }

  if (typeof updateData.condition === 'string') {
    item.condition = updateData.condition;
  }

  if (updateData.safeHub) {
    item.safeHub = updateData.safeHub;
  }

  await item.save();

  return {
    msg: 'تم التعديل بنجاح ✨',
    item,
  };
};

// ─── 9. حذف غرض ──────────────────────────────────────────────
exports.deleteItemLogic = async (itemId, userId, userRole) => {
  const item = await Item.findById(itemId);

  if (!item) {
    throw new AppError('الغرض غير موجود', 404, 'ITEM_NOT_FOUND');
  }

  const isOwner = item.donor.toString() === userId.toString();
  const isAdmin = userRole === 'admin';

  if (!isOwner && !isAdmin) {
    throw new AppError('غير مصرح لك بحذف هذا الغرض', 403, 'FORBIDDEN_DELETE_ITEM');
  }

  // ✅ لا نحذف السجل التاريخي بعد التسليم
  if (item.status === 'تم التسليم') {
    throw new AppError(
      'لا يمكن حذف غرض تم تسليمه — يُحفظ كسجل دائم في النظام 🔒',
      400,
      'DELIVERED_ITEM_CANNOT_BE_DELETED'
    );
  }

  if (item.cloudinaryId) {
    await cloudinary.uploader.destroy(item.cloudinaryId).catch(() => null);
  }

  // ✅ إذا كان الغرض محجوزاً نرجّع quota للمستلم ونبلّغه
  if (item.status === 'محجوز' && item.bookedBy) {
    await Promise.all([
      User.findByIdAndUpdate(item.bookedBy, { $inc: { quota: 1 } }),
      // ✅ عقوبة فقط على المالك إذا حذف غرضاً بعد حجزه
      isOwner
        ? User.findByIdAndUpdate(item.donor, { $inc: { trustScore: -3 } })
        : Promise.resolve(),
    ]);

    const receiver = await User.findById(item.bookedBy).select('email name').lean();

    await notifyUser(item.bookedBy, {
      type: 'item_deleted_after_booking',
      title: 'تم إلغاء الغرض المحجوز ⚠️',
      body: `تم حذف الغرض "${item.title}" وتم استرجاع حصتك تلقائياً`,
      itemId: item._id,
    });

    if (receiver?.email) {
      fireSendEmail({
        email: receiver.email,
        subject: 'تحديث بخصوص حجزك ⚠️',
        message: `
          <div dir="rtl">
            <p>مرحباً ${receiver.name || ''}</p>
            <p>نأسف لإبلاغك بأنه تم حذف الغرض <b>${item.title}</b>.</p>
            <p>تم استرجاع حصتك تلقائياً 💚</p>
          </div>
        `,
      });
    }
  }

  await itemRepository.deleteItemById(item);

  return {
    msg: 'تم حذف الغرض نهائياً ⚖️',
  };
};