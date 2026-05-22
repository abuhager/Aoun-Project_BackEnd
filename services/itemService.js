// backend/services/itemService.js

const itemRepository = require("../repositories/itemRepository");
const User = require("../models/User");
const Item = require("../models/Item");
const sendEmail = require("../utils/sendEmail");
const { generateOtp } = require("../utils/otp");
const cloudinary = require("cloudinary").v2;
const VALID_REPORT_REASONS = [
  'لم يُسلّم الغرض',
  'معلومات مضللة',
  'سلوك غير لائق',
  'غرض مختلف عن الوصف',
  'أخرى',
];

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

function fireSendEmail(options) {
  sendEmail(options).catch(err =>
    console.error(`[Email Error] to: ${options.email} | subject: "${options.subject}" |`, err.message)
  );
}

function uploadToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: "aoun_items" },
      (error, result) => (result ? resolve(result) : reject(error))
    );
    stream.end(buffer);
  });
}

// ─────────────────────────────────────────
// 1. منطق حجز الغرض
// ─────────────────────────────────────────
exports.bookItemLogic = async (itemId, userId) => {
  // 1️⃣ فحص غرض غير مقيّم
  const unrated = await Item.findOne({
    bookedBy: userId,
    status: "تم التسليم",
    isRated: false,
  });
  if (unrated)
    throw new Error(`قيّم غرض (${unrated.title}) أولاً لتعزيز مجتمع الثقة 💚`);

  // 2️⃣ فحص وجود الغرض
  const item = await itemRepository.findItemById(itemId);
  if (!item) throw new Error("الغرض غير موجود أو تم حذفه.");

  if (item.donor.toString() === userId.toString())
    throw new Error("لا يمكنك حجز الغرض الذي قمت بالتبرع به.");

  if ((item.cancelledBy || []).some((id) => id.toString() === userId))
    throw new Error("لا يمكنك حجز هذا الغرض مجدداً بعد إلغائه 🚫");

  // 3️⃣ حجز الغرض بشكل atomic
  const otp        = generateOtp();
  const bookedItem = await itemRepository.bookItemSafely(itemId, userId, {
    status:      "محجوز",
    bookedBy:    userId,
    deliveryOtp: otp,
    bookedAt:    new Date(),
  });

  // 4️⃣ إذا سبقك أحد → waitlist
  if (!bookedItem) {
    await itemRepository.addToWaitlist(itemId, userId);
    return {
      status:  "waitlist",
      message: "سبقك أحدهم! تمت إضافتك لطابور الانتظار بنجاح.",
    };
  }

  // 5️⃣ خصم الكوتا بشكل atomic
  const user = await User.findOneAndUpdate(
    { _id: userId, quota: { $gt: 0 } },
    { $inc: { quota: -1 } },
    { new: true }
  );

  if (!user) {
    await Item.findByIdAndUpdate(itemId, {
      $set: { status: "متاح", bookedBy: null, deliveryOtp: null, bookedAt: null },
    });
    throw new Error("عذراً، لقد استنفدت حصتك (الكوتا) لهذا الشهر.");
  }

  // 6️⃣ إيميل — OTP يُرسل بالإيميل فقط، لا يُرجع في الـ response
  fireSendEmail({
    email:   user.email,
    subject: `تأكيد حجز: ${bookedItem.title} 🎁`,
    message: `<div dir="rtl">تهانينا! أصبح الغرض محجوزاً لك.<br>
              رمز الاستلام: <b>${otp}</b>
              <p>لديك 72 ساعة لإتمام الاستلام ⏱️</p></div>`,
  });

  // ✅ لا نُرجع OTP في الـ response
  const safeItem = bookedItem.toObject ? bookedItem.toObject() : { ...bookedItem };
  delete safeItem.deliveryOtp;

  return {
    status:  "booked",
    message: "تم الحجز بنجاح. تحقق من بريدك الإلكتروني للحصول على رمز الاستلام 📧",
    item:    safeItem,
  };
};

// ─────────────────────────────────────────
// 2. منطق إضافة غرض جديد
// ─────────────────────────────────────────
exports.createItemLogic = async (itemData, userId, file) => {
  if (!file) throw new Error("صورة الغرض مطلوبة.");

  const uploadResult = await uploadToCloudinary(file.buffer);

  const newItemData = {
    title:        itemData.title,
    category:     itemData.category,
    description:  itemData.description,
    location:     itemData.location,
    condition:    itemData.condition,
    imageUrl:     uploadResult.secure_url,
    cloudinaryId: uploadResult.public_id,
    donor:        userId,
    status:       "متاح",
  };

  const createdItem = await itemRepository.createItem(newItemData);
  return { message: "تم إضافة الغرض بنجاح", item: createdItem };
};

// ─────────────────────────────────────────
// 3. منطق جلب جميع الأغراض (Pagination)
// ─────────────────────────────────────────
exports.getItemsLogic = async (queryFilters) => {
  const { category, location, page = 1, limit: rawLimit } = queryFilters;
  const limit = Math.min(parseInt(rawLimit) || 12, 50);
  const query = { status: { $in: ["متاح", "محجوز"] } };

  if (category) query.category = category;
  if (location) query.location = location;

  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    itemRepository.findItemsWithPagination(query, skip, limit),
    itemRepository.countItems(query),
  ]);

  return { items, total, page: parseInt(page), pages: Math.ceil(total / limit) };
};

// ─────────────────────────────────────────
// 4. منطق جلب الأغراض الشخصية
// ✅ OTP لا يُرجع في الـ response — يُرسل بالإيميل فقط
// ─────────────────────────────────────────
exports.getMyItemsLogic = async (userId) => {
  const [user, donations, requests] = await Promise.all([
    User.findById(userId)
      .select("name email trustScore phone quota isVerifiedStudent")
      .lean(),
    itemRepository.findDonationsByUser(userId),
    itemRepository.findRequestsByUser(userId),
  ]);

  // ✅ نحذف deliveryOtp من كل item قبل الإرجاع
  const stripOtp = (i) => {
    const obj = i.toObject ? i.toObject() : { ...i };
    delete obj.deliveryOtp;
    return obj;
  };

  return {
    user,
    myDonations: donations.map(stripOtp),
    myRequests:  requests.map(stripOtp),
  };
};

// ─────────────────────────────────────────
// 5. منطق جلب تفاصيل غرض واحد
// ─────────────────────────────────────────
exports.getItemByIdLogic = async (itemId, requesterId) => {
  const item = await itemRepository.findItemDetails(itemId);
  if (!item) throw new Error("الغرض غير موجود");

  const itemObj = item.toObject();
  // ✅ لا أحد يرى الـ OTP في الـ response — يُرسل بالإيميل فقط
  delete itemObj.deliveryOtp;

  return itemObj;
};

// ─────────────────────────────────────────
// 6. منطق إلغاء الحجز والتعامل مع الطابور
// ─────────────────────────────────────────
exports.cancelBookingLogic = async (itemId, userId) => {
  const item = await itemRepository.findItemForAction(itemId);
  if (!item) throw new Error("الغرض غير موجود");

  const isBooker = item.bookedBy && item.bookedBy.toString() === userId;
  const isDonor  = item.donor.toString() === userId;
  const inWait   = item.waitlist.some((w) => w.user.toString() === userId);

  if (!isBooker && !isDonor && !inWait) throw new Error("غير مصرح لك");

  // انسحاب من الطابور فقط
  if (inWait && !isBooker && !isDonor) {
    await Item.findByIdAndUpdate(item._id, {
      $pull: { waitlist: { user: userId } },
    });
    return { msg: "تم انسحابك من قائمة الانتظار بنجاح 🚶‍♂️" };
  }

  // ✅ حفظ previousBooker قبل أي تعديل
  const previousBooker = item.bookedBy;

  // فحص طابور الانتظار وتمرير الدور
  if (item.waitlist.length > 0) {
    let nextValidUser = null;
    const usersToRemove = [];

    for (const waiting of item.waitlist) {
      nextValidUser = await User.findOneAndUpdate(
        { _id: waiting.user, quota: { $gt: 0 } },
        { $inc: { quota: -1 } },
        { new: true }
      );
      if (nextValidUser) break;
      else usersToRemove.push(waiting.user);
    }

    if (usersToRemove.length > 0) {
      await Item.findByIdAndUpdate(item._id, {
        $pull: { waitlist: { user: { $in: usersToRemove } } },
      });
    }

    if (nextValidUser) {
      const newOtp = generateOtp();

      // ✅ 1: حدِّث الغرض أولاً
      await Item.findByIdAndUpdate(item._id, {
        $set: {
          status:      "محجوز",
          bookedBy:    nextValidUser._id,
          deliveryOtp: newOtp,
          bookedAt:    new Date(),
        },
        $addToSet: { cancelledBy: previousBooker },
        $pull:     { waitlist: { user: nextValidUser._id } },
      });

      // ✅ 2: أعِد كوتا الحاجز السابق بعد نجاح تحديث الغرض
      if (previousBooker) {
        await User.findByIdAndUpdate(previousBooker, { $inc: { quota: 1 } });
      }

      fireSendEmail({
        email:   nextValidUser.email,
        subject: `الدور وصلك في "عون" 🎉`,
        message: `<div dir="rtl">أصبح الغرض محجوزاً لك! رمز الاستلام: <b>${newOtp}</b><p>لديك 72 ساعة لإتمام الاستلام ⏱️</p></div>`,
      });

      return { msg: "تم إلغاء الحجز وتمرير الدور للشخص التالي 🔄" };
    }
  }

  // لا يوجد منتظرون — الغرض يعود متاحاً
  // ✅ 1: حدِّث الغرض أولاً
  await Item.findByIdAndUpdate(item._id, {
    $set:      { status: "متاح", bookedBy: null, deliveryOtp: null, bookedAt: null },
    $addToSet: { cancelledBy: previousBooker },
  });

  // ✅ 2: أعِد الكوتا بعد نجاح تحديث الغرض
  if (previousBooker) {
    await User.findByIdAndUpdate(previousBooker, { $inc: { quota: 1 } });
  }

  // TODO Phase 3: استبدل بـ MongoDB Transaction

  return { msg: "تم إلغاء الحجز والقطعة متاحة الآن ✅" };
};
// ─────────────────────────────────────────
// 7. منطق إتمام التسليم
// ✅ يزيد totalDonations للمتبرع عند كل تسليم ناجح
// ─────────────────────────────────────────
exports.completeDeliveryLogic = async (itemId, userId, otp) => {
  const item = await itemRepository.findItemForAction(itemId);
  if (!item || item.donor.toString() !== userId) throw new Error("غير مصرح لك");
  if (String(item.deliveryOtp).trim() !== String(otp).trim())
    throw new Error("الرمز خطأ ❌");

  item.status      = "تم التسليم";
  item.deliveryOtp = undefined;
  item.bookedAt    = undefined;
  await item.save();

  // ✅ زيادة totalDonations للمتبرع بشكل atomic
  await User.findByIdAndUpdate(item.donor, { $inc: { totalDonations: 1 } });

  const receiver = await User.findById(item.bookedBy);
  if (receiver)
    fireSendEmail({
      email:   receiver.email,
      subject: `تم استلام الغرض 🎁`,
      message: `<div dir="rtl">شكراً لك! لقد تم تأكيد استلامك للغرض. لا تنسَ تقييم المتبرع لدعمه 💚</div>`,
    });

  const safeItem = item.toObject ? item.toObject() : { ...item };
  delete safeItem.deliveryOtp;
  return { msg: "تم التسليم! 💚", item: safeItem };
};

// ─────────────────────────────────────────
// 8. منطق التقييم
// ✅ نظام نقاط واضح: 5★=+5 | 3-4★=+2 | 1-2★=-3
// ─────────────────────────────────────────
// services/itemService.js — rateItemLogic
const RATING_POINTS = {
  5: +5,  // ممتاز
  4: +3,  // جيد جداً
  3: +1,  // مقبول
  2:  0,  // ضعيف   ← لا خصم، فقط لا مكافأة
  1:  0,  // سيئ    ← نفس الشيء
};

exports.rateItemLogic = async (itemId, userId, rating) => {
  const item = await Item.findById(itemId);

  if (!item || item.bookedBy?.toString() !== userId)
    throw new Error('غير مصرح لك');
  if (item.status !== 'تم التسليم' || item.isRated)
    throw new Error('لا يمكن التقييم الآن');

  const points = RATING_POINTS[rating];
  if (points === undefined) throw new Error('التقييم يجب أن يكون بين 1 و5');

  // ✅ زيادة فقط — لا خصم أبداً
  const donor = await User.findByIdAndUpdate(
    item.donor,
    { $inc: { trustScore: points } },
    { new: true }
  );

  // clamp 0–100 (فقط للحد الأعلى — الأدنى لن يُكسَر أصلاً)
  if (donor.trustScore > 100)
    await User.findByIdAndUpdate(item.donor, { $set: { trustScore: 100 } });

  await Item.findByIdAndUpdate(itemId, { $set: { isRated: true, rating } });

  return {
    msg: 'تم التقييم 🌟',
    trustScore: Math.min(100, donor.trustScore),
  };
};

// ─────────────────────────────────────────
// 9. منطق التبليغ
// ─────────────────────────────────────────
exports.reportUserLogic = async (reportedUserId, reporterId, reason) => {
  // 1️⃣ التحقق من reason
  if (!reason || !VALID_REPORT_REASONS.includes(reason))
    throw new Error(`سبب البلاغ مطلوب. الأسباب المتاحة: ${VALID_REPORT_REASONS.join(' | ')}`);

  // 2️⃣ لا تبليغ عن نفسك
  if (reporterId === reportedUserId)
    throw new Error('لا يمكنك التبليغ عن نفسك');

  const user = await User.findById(reportedUserId);
  if (!user) throw new Error('المستخدم غير موجود');

  // 3️⃣ تبليغ مسبق
  if ((user.reportedBy || []).some((id) => id.toString() === reporterId))
    throw new Error('لقد قمت بالتبليغ عن هذا المستخدم مسبقاً 🚫');

  // 4️⃣ تسجيل البلاغ فقط — بدون خصم تلقائي
  // ⚠️ Phase 4: سيُستبدل هذا بنموذج Report كامل مع dispute window
  user.reportedBy.push(reporterId);

  // 5️⃣ الحظر التلقائي عند 6 بلاغات فقط (أدنى حد)
  // ✅ لا خصم trustScore تلقائي — ينتظر Admin review
  if (user.reportedBy.length >= 6) {
    user.isBanned = true;
  }

  await user.save();
  return { msg: 'تم إرسال البلاغ بنجاح. سيتم مراجعته من قبل الإدارة 🛡️' };
};

// ─────────────────────────────────────────
// 10. منطق تعديل الغرض
// ─────────────────────────────────────────
exports.updateItemLogic = async (itemId, userId, updateData, file) => {
  const item = await itemRepository.findItemForUpdate(itemId, userId);
  if (!item) throw new Error("الغرض غير موجود أو لا تملك صلاحية تعديله");

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
  return { msg: "تم التعديل بنجاح ✨", item };
};

// ─────────────────────────────────────────
// 11. منطق حذف الغرض
// ─────────────────────────────────────────
exports.deleteItemLogic = async (itemId, userId, userRole) => {
  const item = await Item.findById(itemId);
  if (!item || (item.donor.toString() !== userId && userRole !== "admin"))
    throw new Error("غير مصرح لك بحذف هذا الغرض");

  if (item.cloudinaryId) {
    await cloudinary.uploader.destroy(item.cloudinaryId).catch(console.error);
  }

  if (item.status === "محجوز" && item.bookedBy) {
    const [receiver] = await Promise.all([
      User.findByIdAndUpdate(item.bookedBy, { $inc: { quota: 1 } }, { new: true }),
      User.findByIdAndUpdate(item.donor,    { $inc: { trustScore: -3 } }),
    ]);

    if (receiver)
      fireSendEmail({
        email:   receiver.email,
        subject: `تحديث بخصوص حجزك ⚠️`,
        message: `<div dir="rtl">نأسف لإبلاغك بأن المتبرع قام بحذف الغرض (<b>${item.title}</b>). لقد تم استرداد حصتك (الكوتا) تلقائياً 💚</div>`,
      });
  }

  await itemRepository.deleteItemById(item);
  return { msg: "تم حذف الغرض نهائياً ⚖️" };
};

exports.getPendingRatingLogic = async (userId) => {
  const item = await itemRepository.findPendingRating(userId);
  return { hasPending: !!item, item: item || null };
};
