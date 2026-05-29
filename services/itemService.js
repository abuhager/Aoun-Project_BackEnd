// services/itemService.js
const cloudinary     = require('../config/cloudinary');
const Item           = require('../models/Item');
const User           = require('../models/User');
const itemRepository = require('../repositories/itemRepository');
const { generateOtp }        = require('../utils/otp');
const { fireSendEmail }      = require('../utils/sendEmail');
const { uploadToCloudinary } = require('../utils/uploadToCloudinary');
const { notifyUser } = require('../utils/notifyUser');
const { toPublicItem } = require('../dtos/itemDto');


// ─── 1. جلب الأغراض (مع pagination) ─────────────────────────
exports.getItemsLogic = async (query) => {
  const escapeRegex = require('../utils/escapeRegex');

  const page  = Math.max(1, parseInt(query.page)  || 1);
  const limit = Math.min(20, parseInt(query.limit) || 10);
  const skip  = (page - 1) * limit;

  const filter = { status: 'متاح' };

  // ✅ آمن من ReDoS
  if (query.location) filter.location = new RegExp(escapeRegex(query.location), 'i');
  if (query.search)   filter.title    = new RegExp(escapeRegex(query.search),   'i');
  if (query.category) filter.category = query.category;

  const [items, total] = await Promise.all([
    Item.find(filter)
      .populate('donor',   'name avatar trustScore isVerifiedStudent')
      .populate('safeHub', 'name address city')
      .sort({ createdAt: -1 })
      .skip(skip).limit(limit)
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

// ─── 2. أغراضي ───────────────────────────────────────────────
const Report = require('../models/Report');

exports.getMyItemsLogic = async (userId) => {
  const [user, myDonations, myRequests] = await Promise.all([
    User.findById(userId)
      .select('name email trustScore quota isVerifiedStudent gamification')
      .lean(),

    Item.find({ donor: userId })
      .populate('bookedBy', 'name avatar')
      .sort({ createdAt: -1 })
      .lean(),

    Item.find({ bookedBy: userId })
      .populate('donor', 'name avatar')
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  // ✅ جلب ALL item IDs (donations + requests)
  const donationIds = myDonations.map((i) => i._id);
  const requestIds  = myRequests.map((i) => i._id);
  const allItemIds  = [...donationIds, ...requestIds];

  // ✅ جلب reports حيث المستخدم هو المُبلَّغ عنه — سواء كمتبرع أو مستلم
  const reports = await Report.find({
    relatedItem:  { $in: allItemIds },
    reportedUser: userId,                          // ← المهم: هو المُبلَّغ عنه
    status:       { $in: ['pending', 'actioned'] },
  })
    .select('relatedItem')
    .lean();

  // ✅ Map سريع O(n)
  const reportMap = new Map(
    reports.map((r) => [r.relatedItem.toString(), r._id.toString()])
  );

  // ✅ donations — المتبرع قد يُبلَّغ عنه من المستلم
  const donationsWithReport = myDonations.map((item) => ({
    ...item,
    reportId: reportMap.get(item._id.toString()) ?? null,
  }));

  // ✅ requests — المستلم قد يُبلَّغ عنه من المتبرع
  const requestsWithReport = myRequests.map((item) => ({
    ...item,
    reportId: reportMap.get(item._id.toString()) ?? null,
  }));

  return {
    user,
    myDonations: donationsWithReport,
    myRequests:  requestsWithReport,   // ✅ الآن يحتوي على reportId
  };
};

// ─── 3. تفاصيل غرض واحد ──────────────────────────────────────
exports.getItemByIdLogic = async (itemId, requesterId) => {
  const item = await itemRepository.findItemDetails(itemId);
  if (!item) throw new Error('الغرض غير موجود');

  const obj     = item.toObject ? item.toObject() : { ...item };
  const isDonor = requesterId && obj.donor?._id?.toString() === requesterId;
  if (!isDonor) delete obj.deliveryOtp;

  return obj;
};

// ─── 4. إنشاء غرض ────────────────────────────────────────────
exports.createItemLogic = async (body, userId, file) => {
  if (!file) throw new Error('الصورة مطلوبة');

  const uploadResult = await uploadToCloudinary(file.buffer);

  const item = await Item.create({
    ...body,
    donor:        userId,
    imageUrl:     uploadResult.secure_url,
    cloudinaryId: uploadResult.public_id,
  });

  return { msg: 'تم إضافة الغرض بنجاح 🎉', item };
};

// ─── 5. حجز غرض (مع atomic $inc) ────────────────────────────
exports.bookItemLogic = async (itemId, userId) => {

  // Step 1: atomic quota check
  const user = await User.findOneAndUpdate(
    { _id: userId, quota: { $gt: 0 } },
    { $inc: { quota: -1 } },
{ returnDocument: 'after' }
  );
  if (!user) throw new Error('لا تملك حصصاً متاحة لحجز أغراض جديدة 🚫');

  // Step 2: pre-checks
  const item = await itemRepository.findItemForAction(itemId);
  if (!item) {
    await User.findByIdAndUpdate(userId, { $inc: { quota: 1 } });
    throw new Error('الغرض غير موجود');
  }
  if (item.donor.toString() === userId) {
    await User.findByIdAndUpdate(userId, { $inc: { quota: 1 } });
    throw new Error('لا يمكنك حجز غرضك الخاص');
  }
  if (item.cancelledBy?.some(id => id.toString() === userId)) {
    await User.findByIdAndUpdate(userId, { $inc: { quota: 1 } });
    throw new Error('لا يمكنك الحجز مجدداً لأنك ألغيت الحجز مسبقاً');
  }

  // Step 3: ATOMIC booking
  if (item.status === 'متاح') {
    const newOtp = generateOtp();

    const booked = await Item.findOneAndUpdate(
      { _id: itemId, status: 'متاح' },
      {
        $set: {
          status:      'محجوز',
          bookedBy:    userId,
          deliveryOtp: newOtp,
          bookedAt:    new Date(),
        },
      },
      { new: true }
    ).populate('safeHub', 'name address city workingHours');

    if (!booked) {
      const alreadyInWaitlist = item.waitlist?.some(w => w.user.toString() === userId);
      if (!alreadyInWaitlist) {
        await Item.findByIdAndUpdate(itemId, {
          $push: { waitlist: { user: userId, joinedAt: new Date() } },
        });
        return { status: 'waitlist', msg: 'تمت إضافتك لقائمة الانتظار ⏳' };
      }
      await User.findByIdAndUpdate(userId, { $inc: { quota: 1 } });
      throw new Error('أنت بالفعل في قائمة الانتظار');
    }

    const hubSection = booked.safeHub
      ? `<hr/>
         <p>📍 <b>مركز التسليم:</b> ${booked.safeHub.name}</p>
         <p>🏙️ ${booked.safeHub.city} — ${booked.safeHub.address}</p>
         <p>🕐 أوقات العمل: ${booked.safeHub.workingHours}</p>`
      : `<p>📦 سيتم التنسيق مع المتبرع مباشرة</p>`;

      await notifyUser(item.donor, {
  type:   'item_booked',
  title:  'تم حجز غرضك! 🎉',
  body:   `قام شخص ما بحجز "${item.title}"`,
  itemId: item._id,
});

    fireSendEmail({
      email:   user.email,
      subject: 'تم حجز الغرض 🎉',
      message: `
        <div dir="rtl">
          <p>تم حجز <b>${booked.title}</b> بنجاح!</p>
          <p>🔑 رمز الاستلام: <b style="font-size:1.4em">${newOtp}</b></p>
          <p>⏱️ لديك <b>72 ساعة</b> لاستلام الغرض</p>
          ${hubSection}
        </div>
      `,
    });

    return { status: 'booked', msg: 'تم الحجز بنجاح 🎉' };
  }

  // Step 4: Waitlist
  const alreadyInWaitlist = item.waitlist?.some(w => w.user.toString() === userId);
  if (alreadyInWaitlist) {
    await User.findByIdAndUpdate(userId, { $inc: { quota: 1 } });
    throw new Error('أنت بالفعل في قائمة الانتظار');
  }

  await Item.findByIdAndUpdate(itemId, {
    $push: { waitlist: { user: userId, joinedAt: new Date() } },
  });

  return { status: 'waitlist', msg: 'تمت إضافتك لقائمة الانتظار ⏳' };
};

// ─── 6. إلغاء الحجز ──────────────────────────────────────────
exports.cancelBookingLogic = async (itemId, userId) => {
  const item = await itemRepository.findItemForAction(itemId);
  if (!item) throw new Error('الغرض غير موجود');

  const isBooker = item.bookedBy && item.bookedBy.toString() === userId;
  const isDonor  = item.donor.toString() === userId;
  const inWait   = item.waitlist?.some(w => w.user.toString() === userId);

  if (!isBooker && !isDonor && !inWait) throw new Error('غير مصرح لك');

  // انسحاب من الطابور فقط
  if (inWait && !isBooker && !isDonor) {
    await Item.findByIdAndUpdate(item._id, {
      $pull: { waitlist: { user: userId } },
    });
    await User.findByIdAndUpdate(userId, { $inc: { quota: 1 } });
    return { msg: 'تم انسحابك من قائمة الانتظار 🚶‍♂️' };
  }

  const previousBooker = item.bookedBy;

  // يوجد Waitlist — حاول تمرير الدور
  if (item.waitlist?.length > 0) {
    const topWaiting = item.waitlist.slice(0, 3);

    for (const waiting of topWaiting) {
      // ✅ Step 1: خصم كوتا المستخدم التالي atomically
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

      // ✅ Step 2: احجز الغرض بشرط أن nextValidUser لا يزال في الـ waitlist
      // هذا يمنع Race Condition
      const newOtp  = generateOtp();
      const updated = await Item.findOneAndUpdate(
        {
          _id:             item._id,
          'waitlist.user': nextValidUser._id, // ✅ تأكد أنه لا يزال في القائمة
        },
        {
          $set: {
            status:      'محجوز',
            bookedBy:    nextValidUser._id,
            deliveryOtp: newOtp,
            bookedAt:    new Date(),
          },
          $addToSet: { cancelledBy: previousBooker },
          $pull:     { waitlist: { user: nextValidUser._id } },
        },
        { new: true }
      );

      // ✅ Step 3: لو فشل الحجز (غادر الـ waitlist بين الخطوتين)
      if (!updated) {
        await User.findByIdAndUpdate(nextValidUser._id, { $inc: { quota: 1 } });
        continue;
      }

      // ✅ Step 4: نجح الحجز — أعد كوتا الحاجز السابق وأبلغ المستخدم الجديد
      if (previousBooker) {
        await User.findByIdAndUpdate(previousBooker, { $inc: { quota: 1 } });
      }

await notifyUser(nextValidUser._id, {
  type:   'waitlist_promoted',
  title:  'وصل دورك! 🔔',
  body:   `أصبح "${item.title}" محجوزاً لك`,
  itemId: item._id,
});

      fireSendEmail({
        email:   nextValidUser.email,
        subject: `الدور وصلك في "عون" 🎉`,
        message: `<div dir="rtl">
          أصبح الغرض محجوزاً لك!
          رمز الاستلام: <b style="font-size:1.4em">${newOtp}</b>
          <p>لديك 72 ساعة لإتمام الاستلام ⏱️</p>
        </div>`,
      });

      return { msg: 'تم إلغاء الحجز وتمرير الدور للشخص التالي 🔄' };
    }
  }

  // لا يوجد Waitlist صالح — أعد الغرض متاحاً
  await Item.findByIdAndUpdate(item._id, {
    $set:      { status: 'متاح', bookedBy: null, bookedAt: null },
    $unset:    { deliveryOtp: '' },
    $addToSet: { cancelledBy: previousBooker },
  });

  if (previousBooker) {
    await User.findByIdAndUpdate(previousBooker, { $inc: { quota: 1 } });
  }
await notifyUser(item.donor, {
  type:   'booking_cancelled',
  title:  'تم إلغاء الحجز',
  body:   `غرضك "${item.title}" متاح مجدداً`,
  itemId: item._id,
});

  return { msg: 'تم إلغاء الحجز والقطعة متاحة الآن ✅' };
};

// ─── 7. إتمام التسليم ─────────────────────────────────────────
exports.completeDeliveryLogic = async (itemId, userId, confirmationType) => {
  // ── حراسة المدخلات ───────────────────────────────────────────
  if (!['recipient_confirm', 'donor_confirm'].includes(confirmationType)) {
    throw Object.assign(new Error('نوع التأكيد غير صحيح'), { status: 400 });
  }

  const item = await itemRepository.findItemForAction(itemId);
  if (!item)
    throw Object.assign(new Error('الغرض غير موجود'), { status: 404 });

  if (item.status === 'تم التسليم')
    throw Object.assign(new Error('تم تسليم هذا الغرض مسبقاً ✅'), { status: 400 });

  if (item.status !== 'محجوز')
    throw Object.assign(new Error('الغرض غير محجوز حالياً'), { status: 400 });

  // ══════════════════════════════════════════════════════════════
  // الخطوة 1: المستلم يضغط "تأكيد الاستلام"
  // ══════════════════════════════════════════════════════════════
  if (confirmationType === 'recipient_confirm') {
    if (item.bookedBy?.toString() !== userId.toString())
      throw Object.assign(new Error('أنت لستَ الحاجز لهذا الغرض'), { status: 403 });

    if (item.recipientConfirmed)
      throw Object.assign(new Error('لقد أكّدت الاستلام مسبقاً ⏳'), { status: 400 });

    await Item.findByIdAndUpdate(itemId, {
      $set: { recipientConfirmed: true, recipientConfirmedAt: new Date() },
    });

    // ✅ أرسل Socket.io للمتبرع ليؤكد التسليم
    try {
      const { getIo } = require('../socket');
      getIo()
        .to(`user_${item.donor.toString()}`)
        .emit('delivery:recipient_confirmed', {
          itemId:    item._id.toString(),
          itemTitle: item.title,
          message:   `أكّد ${await _getReceiverName(userId)} استلام الغرض — اضغط "تأكيد التسليم" ✅`,
        });
    } catch (socketErr) {
      console.warn('[Socket] تعذّر إرسال حدث التأكيد:', socketErr.message);
    }

    return {
      msg:    'تم تأكيد الاستلام ✅ — في انتظار تأكيد المتبرع لإتمام العملية',
      status: 'waiting_donor',
    };
  }

  // ══════════════════════════════════════════════════════════════
  // الخطوة 2: المتبرع يضغط "تأكيد التسليم"
  // ══════════════════════════════════════════════════════════════
  if (confirmationType === 'donor_confirm') {
    if (item.donor?.toString() !== userId.toString())
      throw Object.assign(new Error('أنت لستَ المتبرع بهذا الغرض'), { status: 403 });

    if (!item.recipientConfirmed)
      throw Object.assign(
        new Error('يجب أن يؤكد المستلم الاستلام أولاً ⏳'),
        { status: 400, code: 'RECIPIENT_NOT_CONFIRMED' }
      );

    // ✅ Atomic Update — التسليم النهائي
    const updatedItem = await Item.findOneAndUpdate(
      {
        _id:                itemId,
        status:             'محجوز',
        recipientConfirmed: true,
      },
      {
        $set:   { status: 'تم التسليم', donorConfirmedAt: new Date() },
        $unset: { deliveryOtp: '', bookedAt: '', recipientConfirmed: '' },
      },
      { new: true }
    ).lean();

    if (!updatedItem)
      throw Object.assign(new Error('تعذّر إتمام التسليم — حاول مرة أخرى'), { status: 409 });

    // ✅ تحديث إحصائيات المتبرع
    await User.findByIdAndUpdate(item.donor, { $inc: { totalDonations: 1 } });

    // ✅ أرسل Socket.io للمستلم (تأكيد نهائي)
    try {
      const { getIo } = require('../socket');
      getIo()
        .to(`user_${item.bookedBy.toString()}`)
        .emit('delivery:completed', {
          itemId:    item._id.toString(),
          itemTitle: item.title,
          message:   'تم تأكيد التسليم من المتبرع 🎉 — يرجى تقييم تجربتك',
        });
    } catch (socketErr) {
      console.warn('[Socket] تعذّر إرسال حدث الإتمام:', socketErr.message);
    }

    // ✅ إيميل للمستلم
    const receiver = await User.findById(item.bookedBy).select('email name').lean();
    if (receiver?.email) {
      fireSendEmail({
        email:   receiver.email,
        subject: 'تم استلام الغرض بنجاح 🎁',
        message: `<div dir="rtl">
          <h2>مرحباً ${receiver.name}!</h2>
          <p>تم تأكيد استلامك لـ <strong>${item.title}</strong> بنجاح.</p>
          <p>لا تنسَ تقييم المتبرع — تقييمك يساعد الجميع 💚</p>
        </div>`,
      });
    }

    return {
      msg:    'تم التسليم بنجاح! 🎉',
      status: 'delivered',
      item:   updatedItem,
    };
  }
};

// ─── 8. تعديل غرض ────────────────────────────────────────────
exports.updateItemLogic = async (itemId, userId, updateData, file) => {
  const item = await itemRepository.findItemForUpdate(itemId, userId);
  if (!item) throw new Error('الغرض غير موجود أو لا تملك صلاحية تعديله');

  if (file) {
    if (item.cloudinaryId) {
      await cloudinary.uploader.destroy(item.cloudinaryId).catch(console.error);
    }
    const uploadResult = await uploadToCloudinary(file.buffer);
    item.imageUrl     = uploadResult.secure_url;
    item.cloudinaryId = uploadResult.public_id;
  }

  Object.assign(item, updateData);
  await item.save();
  return { msg: 'تم التعديل بنجاح ✨', item };
};

// ─── 9. حذف غرض ──────────────────────────────────────────────
exports.deleteItemLogic = async (itemId, userId, userRole) => {
  const item = await Item.findById(itemId);

  if (!item || (item.donor.toString() !== userId.toString() && userRole !== 'admin'))
    throw new Error('غير مصرح لك بحذف هذا الغرض');

  // ✅ Fix Bug #5 — منع حذف غرض تم تسليمه
  if (item.status === 'تم التسليم') {
    throw new Error('لا يمكن حذف غرض تم تسليمه — يُحفظ كسجل دائم في النظام 🔒');
  }

  if (item.cloudinaryId) {
    await cloudinary.uploader.destroy(item.cloudinaryId).catch(console.error);
  }

  if (item.status === 'محجوز' && item.bookedBy) {
    await Promise.all([
      User.findByIdAndUpdate(item.bookedBy, { $inc: { quota: 1 } }),
      User.findByIdAndUpdate(item.donor,    { $inc: { trustScore: -3 } }),
    ]);

    const receiver = await User.findById(item.bookedBy).select('email').lean();
    if (receiver) {
      fireSendEmail({
        email:   receiver.email,
        subject: `تحديث بخصوص حجزك ⚠️`,
        message: `<div dir="rtl">نأسف لإبلاغك بأن المتبرع حذف الغرض (<b>${item.title}</b>). تم استرداد حصتك تلقائياً 💚</div>`,
      });
    }
  }

  await itemRepository.deleteItemById(item);
  return { msg: 'تم حذف الغرض نهائياً ⚖️' };
};