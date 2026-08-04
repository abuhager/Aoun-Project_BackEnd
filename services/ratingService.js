// services/ratingService.js
const ratingRepository = require('../repositories/ratingRepository');
const SystemSettings   = require('../models/SystemSettings');
const notifyUser       = require('../utils/notifyUser');
const AppError         = require('../utils/AppError');

// حساب trustDelta بناءً على إعدادات النظام الديناميكية
const calcTrustDelta = (score, s) => {
  if (score >= (s?.ratingThresholdExcellent ?? 9)) return  2;
  if (score >= (s?.ratingThresholdGood      ?? 7)) return  1;
  if (score >= (s?.ratingThresholdNeutral   ?? 5)) return  0;
  if (score >= (s?.ratingThresholdBad       ?? 3)) return -1;
  return -2;
};

exports.submitRating = async ({ itemId, raterId, score, comment }) => {
  const [item, settings] = await Promise.all([
    ratingRepository.findItemById(itemId),
    SystemSettings.getCached(),
  ]);

  if (!item)
    throw new AppError('الغرض غير موجود', 404, 'ITEM_NOT_FOUND');

  if (item.status !== 'تم التسليم')
    throw new AppError('لا يمكن التقييم قبل تأكيد التسليم', 400, 'ITEM_NOT_DELIVERED');

  const isDonor    = item.donor?.toString()    === raterId.toString();
  const isReceiver = item.bookedBy?.toString() === raterId.toString();

  if (!isDonor && !isReceiver)
    throw new AppError('فقط المتبرع أو المستلم يمكنه تقييم هذا الغرض', 403, 'NOT_PARTICIPANT');

  const ratee = isDonor ? item.bookedBy : item.donor;

  if (!ratee)
    throw new AppError('لا يوجد طرف آخر صالح للتقييم لهذا الغرض', 400, 'RATEE_NOT_FOUND');

  // حماية ضد تقييم النفس
  if (ratee.toString() === raterId.toString())
    throw new AppError('لا يمكنك تقييم نفسك', 400, 'SELF_RATING');

  const exists = await ratingRepository.findExistingRating({ itemId, raterId });
  if (exists)
    throw new AppError('لقد قيّمت هذا الغرض مسبقاً ✅', 409, 'ALREADY_RATED');

  const trustDelta = calcTrustDelta(score, settings);

  const rating = await ratingRepository.createRating({
    item: itemId,
    rater: raterId,
    ratee,
    score,
    comment: comment ?? '',
    isHandoverConfirmed: true,
    trustDelta,
  });

  await Promise.all([
    ratingRepository.markItemRated(itemId),
    ratingRepository.incrementUserTrustScore(ratee, trustDelta),
    notifyUser(ratee, {
      type:   'new_rating',
      title:  'حصلت على تقييم جديد ⭐',
      body:   `تقييمك على "${item.title}": ${score}/10`,
      itemId: item._id,
    }),
  ]);

  return rating;
};

exports.getUserRatings = async (userId) => {
  return ratingRepository.findRatingsForUser(userId);
};

exports.getPendingRating = async (userId) => {
  // 1. جلب كافة الأغراض المسلمة التي يكون المستخدم طرفاً فيها (متبرع أو مستلم)
  const [asDonor, asReceiver] = await Promise.all([
    ratingRepository.findDeliveredItemsAsDonor(userId),
    ratingRepository.findDeliveredItemsAsReceiver(userId),
  ]);

  const allItems = [...asDonor, ...asReceiver];
  if (!allItems.length) return { pendingRating: null };

  // 2. جلب جميع معرّفات الأغراض التي قام *هذا المستخدم تحديداً* بتقييمها سابقاً
  const ratedItemIds = await ratingRepository.findRatedItemIdsByRater(userId);
  const ratedSet = new Set(ratedItemIds.map(String));

  // 3. البحث عن أول غرض مسلم لم يقم *هذا المستخدم* بتقييمه بعد (حتى لو كان الطرف الآخر قد قيم وأصبح isRated = true)
  const pending = allItems.find((item) => !ratedSet.has(String(item._id)));

  return { pendingRating: pending ?? null };
};