const mongoose = require('mongoose');
const cloudinary = require('../config/cloudinary');
const Item = require('../models/Item');
const User = require('../models/User');
const Report = require('../models/Report');
const SystemSettings = require('../models/SystemSettings');
const itemRepository = require('../repositories/itemRepository');
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
  if (!file) throw Object.assign(new Error('الصورة مطلوبة'), { status: 400 });

  const [user, settings, activeCount] = await Promise.all([
    User.findById(userId).select('trustLevel isVerified quota').lean(),
    SystemSettings.getCached(),
    Item.countDocuments({ donor: userId, status: { $in: ['متاح', 'محجوز'] } }),
  ]);

  if (!user?.isVerified) {
    throw Object.assign(new Error('يجب تفعيل حسابك أولاً ✅'), { status: 403 });
  }

  const maxItems = user.trustLevel >= 2
    ? (settings.level2Quota ?? 4)
    : (settings.defaultQuota ?? 2);

  if (activeCount >= maxItems) {
    throw Object.assign(
      new Error(`لا يمكنك نشر أكثر من ${maxItems} غرض نشط في نفس الوقت`),
      { status: 429, code: 'ITEM_LIMIT_EXCEEDED' }
    );
  }

  if (body.category && settings.categories?.length && !settings.categories.includes(body.category)) {
    throw Object.assign(new Error(`التصنيف "${body.category}" غير مدعوم`), { status: 400 });
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

  return { msg: 'تم إضافة الغرض بنجاح 🎉', item };
};

exports.bookItemLogic = async (itemId, userId) => {
  const session = await mongoose.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      const item = await Item.findById(itemId)
        .select('title status donor bookedBy waitlist cancelledBy safeHub')
        .populate('safeHub', 'name address city workingHours')
        .session(session);

      if (!item) throw Object.assign(new Error('الغرض غير موجود'), { status: 404 });
      if (item.donor.toString() === userId) {
        throw Object.assign(new Error('لا يمكنك حجز غرضك الخاص'), { status: 400 });
      }
      if (item.cancelledBy?.some((id) => id.toString() === userId)) {
        throw Object.assign(new Error('لا يمكنك الحجز مجدداً لأنك ألغيت الحجز مسبقاً'), { status: 400 });
      }

      if (item.status !== 'متاح') {
        const alreadyInWaitlist = item.waitlist?.some((w) => w.user.toString() === userId);
        if (alreadyInWaitlist) {
          throw Object.assign(new Error('أنت بالفعل في قائمة الانتظار'), { status: 409 });
        }

        await Item.findOneAndUpdate(
          { _id: itemId, 'waitlist.user': { $ne: userId } },
          { $push: { waitlist: { user: userId, joinedAt: new Date() } } },
          { session }
        );

        result = { status: 'waitlist', msg: 'تمت إضافتك لقائمة الانتظار ⏳' };
        return;
      }

      const bookedUser = await User.findOneAndUpdate(
        { _id: userId, quota: { $gt: 0 } },
        { $inc: { quota: -1 } },
        { new: true, session }
      );

      if (!bookedUser) {
        throw Object.assign(new Error('لا تملك حصصاً متاحة لحجز أغراض جديدة 🚫'), { status: 403 });
      }

      const otp = generateOtp();
      const booked = await Item.findOneAndUpdate(
        { _id: itemId, status: 'متاح' },
        {
          $set: {
            status: 'محجوز',
            bookedBy: userId,
            deliveryOtp: otp,
            bookedAt: new Date(),
            recipientConfirmed: false,
            recipientConfirmedAt: null,
            donorConfirmedAt: null,
            deliveredAt: null,
          },
        },
        { new: true, session }
      ).populate('safeHub', 'name address city workingHours');

      if (!booked) {
        await restoreQuota(userId, 1, session);
        throw Object.assign(new Error('الغرض لم يعد متاحاً — جرّب غرضاً آخر'), { status: 409 });
      }

      const hubSection = booked.safeHub
        ? `<hr/><p>📍 <b>مركز التسليم:</b> ${booked.safeHub.name}</p><p>🏙️ ${booked.safeHub.city} — ${booked.safeHub.address}</p><p>🕐 أوقات العمل: ${booked.safeHub.workingHours}</p>`
        : `<p>📦 سيتم التنسيق مع المتبرع مباشرة</p>`;

      result = {
        status: 'booked',
        msg: 'تم الحجز بنجاح 🎉',
        donorId: item.donor.toString(),
        itemTitle: booked.title,
        itemId: booked._id.toString(),
        userEmail: bookedUser.email,
        otp,
        hubSection,
      };
    });

    if (result?.status === 'booked') {
      await notifyUser(result.donorId, {
        type: 'item_booked',
        title: 'تم حجز غرضك! 🎉',
        body: `قام شخص ما بحجز "${result.itemTitle}"`,
        itemId: result.itemId,
      });

      if (result.userEmail) {
        fireSendEmail({
          email: result.userEmail,
          subject: 'تم حجز الغرض 🎉',
          message: `<div dir="rtl"><p>تم حجز <b>${result.itemTitle}</b> بنجاح!</p><p>🔑 رمز الاستلام: <b style="font-size:1.4em">${result.otp}</b></p><p>⏱️ لديك <b>72 ساعة</b> لاستلام الغرض</p>${result.hubSection}</div>`,
        });
      }
    }

    return result;
  } finally {
    await session.endSession();
  }
};

exports.cancelBookingLogic = async (itemId, userId) => {
  const session = await mongoose.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      const item = await Item.findById(itemId).session(session);
      if (!item) throw Object.assign(new Error('الغرض غير موجود'), { status: 404 });

      const isBooker = item.bookedBy && item.bookedBy.toString() === userId;
      const isDonor = item.donor.toString() === userId;
      const inWait = item.waitlist?.some((w) => w.user.toString() === userId);

      if (!isBooker && !isDonor && !inWait) {
        throw Object.assign(new Error('غير مصرح لك'), { status: 403 });
      }

      if (inWait && !isBooker && !isDonor) {
        await Item.findByIdAndUpdate(
          item._id,
          { $pull: { waitlist: { user: userId } } },
          { session }
        );
        await restoreQuota(userId, 1, session);
        result = { msg: 'تم انسحابك من قائمة الانتظار 🚶‍♂️' };
        return;
      }

      const previousBooker = item.bookedBy?.toString() ?? null;
      const waitlistUsers = item.waitlist?.map((w) => w.user.toString()) ?? [];

      if (waitlistUsers.length > 0) {
        for (const nextUserId of waitlistUsers.slice(0, 5)) {
          const nextUser = await User.findOneAndUpdate(
            { _id: nextUserId, quota: { $gt: 0 } },
            { $inc: { quota: -1 } },
            { new: true, session }
          );

          if (!nextUser) {
            await Item.findByIdAndUpdate(item._id, { $pull: { waitlist: { user: nextUserId } } }, { session });
            continue;
          }

          const newOtp = generateOtp();
          const updated = await Item.findOneAndUpdate(
            { _id: item._id, 'waitlist.user': nextUser._id },
            {
              $set: {
                status: 'محجوز',
                bookedBy: nextUser._id,
                deliveryOtp: newOtp,
                bookedAt: new Date(),
                recipientConfirmed: false,
                recipientConfirmedAt: null,
                donorConfirmedAt: null,
                deliveredAt: null,
              },
              $addToSet: { cancelledBy: previousBooker },
              $pull: { waitlist: { user: nextUser._id } },
            },
            { new: true, session }
          );

          if (!updated) {
            await restoreQuota(nextUser._id, 1, session);
            continue;
          }

          if (previousBooker) {
            await restoreQuota(previousBooker, 1, session);
          }

          result = {
            msg: 'تم إلغاء الحجز وتمرير الدور للمستخدم التالي ✅',
            reassignedTo: nextUser._id.toString(),
            title: item.title,
          };
          return;
        }
      }

      await Item.findByIdAndUpdate(
        item._id,
        {
          $set: {
            status: 'متاح',
            bookedBy: null,
            bookedAt: null,
            recipientConfirmed: false,
            recipientConfirmedAt: null,
            donorConfirmedAt: null,
            deliveredAt: null,
          },
          $unset: { deliveryOtp: 1 },
          ...(previousBooker ? { $addToSet: { cancelledBy: previousBooker } } : {}),
        },
        { session }
      );

      if (previousBooker) {
        await restoreQuota(previousBooker, 1, session);
      }

      result = { msg: 'تم إلغاء الحجز والقطعة متاحة الآن ✅' };
    });

    if (result?.reassignedTo) {
      await notifyUser(result.reassignedTo, {
        type: 'waitlist_promoted',
        title: 'أصبح الغرض لك الآن 🎉',
        body: `أصبحت الأول في الدور على "${result.title}" وتم تثبيت الحجز لك تلقائياً`,
      });
    }

    return result;
  } finally {
    await session.endSession();
  }
};

exports.completeDeliveryLogic = async (itemId, userId, confirmationType) => {
  if (!['recipient_confirm', 'donor_confirm'].includes(confirmationType)) {
    throw Object.assign(new Error('نوع التأكيد غير صحيح'), { status: 400 });
  }

  const item = await itemRepository.findItemForAction(itemId);
  if (!item) throw Object.assign(new Error('الغرض غير موجود'), { status: 404 });
  if (item.status === 'تم التسليم') throw Object.assign(new Error('تم تسليم هذا الغرض مسبقاً ✅'), { status: 400 });
  if (item.status !== 'محجوز') throw Object.assign(new Error('الغرض غير محجوز حالياً'), { status: 400 });

  if (confirmationType === 'recipient_confirm') {
    if (item.bookedBy?.toString() !== userId.toString()) {
      throw Object.assign(new Error('أنت لستَ الحاجز لهذا الغرض'), { status: 403 });
    }

    if (item.recipientConfirmed) {
      throw Object.assign(new Error('لقد أكّدت الاستلام مسبقاً ⏳'), { status: 400 });
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
      throw Object.assign(new Error('تعذّر تسجيل تأكيد الاستلام — حاول مرة أخرى'), { status: 409 });
    }

    try {
      const { getIO } = require('../socket');
      getIO().to(getUserRoom(item.donor.toString())).emit('delivery:recipient_confirmed', {
        itemId: item._id.toString(),
        itemTitle: item.title,
        message: 'أكّد المستلم استلام الغرض — اضغط "تأكيد التسليم" ✅',
      });
    } catch (socketErr) {
      console.warn('[Socket] تعذّر إرسال حدث تأكيد الاستلام:', socketErr.message);
    }

    await notifyUser(item.donor, {
      type: 'recipient_confirmed',
      title: 'المستلم أكّد الاستلام ✅',
      body: `أكّد المستلم استلام "${item.title}" — اضغط تأكيد التسليم لإتمام العملية`,
      itemId: item._id,
    });

    return {
      msg: 'تم تأكيد الاستلام ✅ — في انتظار تأكيد المتبرع لإتمام العملية',
      status: 'waiting_donor',
      item: updatedItem,
    };
  }

  if (item.donor?.toString() !== userId.toString()) {
    throw Object.assign(new Error('أنت لستَ المتبرع بهذا الغرض'), { status: 403 });
  }

  if (!item.recipientConfirmed) {
    throw Object.assign(new Error('يجب أن يؤكد المستلم الاستلام أولاً ⏳'), {
      status: 400,
      code: 'RECIPIENT_NOT_CONFIRMED',
    });
  }

  const settings = await SystemSettings.getCached();
  const now = new Date();

  const updatedItem = await Item.findOneAndUpdate(
    {
      _id: itemId,
      status: 'محجوز',
      recipientConfirmed: true,
      donor: userId,
    },
    {
      $set: {
        status: 'تم التسليم',
        donorConfirmedAt: now,
        deliveredAt: now,
      },
      $unset: { deliveryOtp: 1 },
    },
    { new: true }
  ).lean();

  if (!updatedItem) {
    throw Object.assign(new Error('تعذّر إتمام التسليم — حاول مرة أخرى'), { status: 409 });
  }

  await User.findByIdAndUpdate(item.donor, {
    $inc: {
      totalDonations: 1,
      trustScore: settings.trustScorePerDonation ?? 5,
      quota: settings.donorQuotaReward ?? 1,
    },
  });

  try {
    const { getIO } = require('../socket');
    const io = getIO();
    const payload = { itemId: item._id.toString(), itemTitle: item.title };

    io.to(getUserRoom(item.bookedBy.toString())).emit('delivery:completed', {
      ...payload,
      message: 'تم تأكيد التسليم من المتبرع 🎉 — يرجى تقييم تجربتك',
    });
    io.to(getUserRoom(item.donor.toString())).emit('delivery:completed', {
      ...payload,
      message: 'تم إتمام التسليم بنجاح 🎉 — شكراً لتبرعك 💚',
    });
  } catch (socketErr) {
    console.warn('[Socket] تعذّر إرسال حدث الإتمام:', socketErr.message);
  }

  await Promise.all([
    notifyUser(item.bookedBy, {
      type: 'delivery_completed',
      title: 'تم استلام غرضك بنجاح 🎁',
      body: `تم تأكيد استلامك لـ "${item.title}" — لا تنسَ تقييم المتبرع 💚`,
      itemId: item._id,
    }),
    notifyUser(item.donor, {
      type: 'delivery_completed',
      title: 'تم إتمام التسليم 🎉',
      body: `تم تسليم "${item.title}" بنجاح — شكراً لمساهمتك 💚`,
      itemId: item._id,
    }),
  ]);

  const receiver = await User.findById(item.bookedBy).select('email name').lean();
  if (receiver?.email) {
    fireSendEmail({
      email: receiver.email,
      subject: 'تم استلام الغرض بنجاح 🎁',
      message: `<div dir="rtl"><h2>مرحباً ${receiver.name}!</h2><p>تم تأكيد استلامك لـ <strong>${item.title}</strong> بنجاح.</p><p>لا تنسَ تقييم المتبرع — تقييمك يساعد الجميع 💚</p></div>`,
    });
  }

  return {
    msg: 'تم التسليم بنجاح! 🎉',
    status: 'delivered',
    item: updatedItem,
  };
};

exports.updateItemLogic = async (itemId, userId, updateData, file) => {
  const item = await itemRepository.findItemForUpdate(itemId, userId);
  if (!item) throw Object.assign(new Error('الغرض غير موجود أو لا تملك صلاحية تعديله'), { status: 404 });

  const settings = await SystemSettings.getCached();
  if (updateData.category && settings.categories?.length && !settings.categories.includes(updateData.category)) {
    throw Object.assign(new Error(`التصنيف "${updateData.category}" غير مدعوم`), { status: 400 });
  }

  if (file) {
    if (item.cloudinaryId) {
      await cloudinary.uploader.destroy(item.cloudinaryId).catch(console.error);
    }
    const uploadResult = await uploadToCloudinary(file.buffer);
    item.imageUrl = uploadResult.secure_url;
    item.cloudinaryId = uploadResult.public_id;
  }

  Object.assign(item, {
    ...updateData,
    title: updateData.title?.trim() ?? item.title,
    description: updateData.description?.trim() ?? item.description,
    location: updateData.location?.trim() ?? item.location,
  });

  await item.save();
  return { msg: 'تم التعديل بنجاح ✨', item };
};

exports.deleteItemLogic = async (itemId, userId, userRole) => {
  const item = await Item.findById(itemId);

  if (!item || (item.donor.toString() !== userId.toString() && userRole !== 'admin')) {
    throw Object.assign(new Error('غير مصرح لك بحذف هذا الغرض'), { status: 403 });
  }

  if (item.status === 'تم التسليم') {
    throw Object.assign(new Error('لا يمكن حذف غرض تم تسليمه — يُحفظ كسجل دائم في النظام 🔒'), { status: 400 });
  }

  if (item.cloudinaryId) {
    await cloudinary.uploader.destroy(item.cloudinaryId).catch(console.error);
  }

  if (item.status === 'محجوز' && item.bookedBy) {
    await Promise.all([
      User.findByIdAndUpdate(item.bookedBy, { $inc: { quota: 1 } }),
      User.findByIdAndUpdate(item.donor, { $inc: { trustScore: -3 } }),
    ]);

    const receiver = await User.findById(item.bookedBy).select('email').lean();
    if (receiver?.email) {
      fireSendEmail({
        email: receiver.email,
        subject: 'تحديث بخصوص حجزك ⚠️',
        message: `<div dir="rtl">نأسف لإبلاغك بأن المتبرع حذف الغرض (<b>${item.title}</b>). تم استرداد حصتك تلقائياً 💚</div>`,
      });
    }
  }

  await itemRepository.deleteItemById(item);
  return { msg: 'تم حذف الغرض نهائياً ⚖️' };
};