// services/ratingService.js
const Rating         = require('../models/Rating');
const Item           = require('../models/Item');
const User           = require('../models/User');

const { notifyUser } = require('../utils/notifyUser');

const calcTrustDelta = (score) => {
  if (score >= 9) return  2;
  if (score >= 7) return  1;
  if (score >= 5) return  0;
  if (score >= 3) return -1;
  return -2;
};

exports.submitRating = async ({ itemId, raterId, score, comment }) => {

  const item = await Item.findById(itemId);

  if (!item)
    throw Object.assign(new Error('الغرض غير موجود'), { status: 404, code: 'ITEM_NOT_FOUND' });

  if (item.status !== 'تم التسليم')
    throw Object.assign(
      new Error('لا يمكن التقييم قبل اكتمال التسليم'),
      { status: 403, code: 'HANDOVER_NOT_COMPLETE' }
    );

  // ✅ Fix 11.3 — تقييم ثنائي: المتبرع يقيّم المستلم والمستلم يقيّم المتبرع
  const isDonor    = item.donor.toString()     === raterId.toString();
  const isReceiver = item.bookedBy?.toString() === raterId.toString();

  if (!isDonor && !isReceiver)
    throw Object.assign(
      new Error('فقط المتبرع أو المستلم يمكنه تقييم هذا الغرض'),
      { status: 403, code: 'NOT_PARTICIPANT' }
    );

  // ✅ Fix 11.3 — ratee دائماً الطرف الآخر
  const ratee = isDonor ? item.bookedBy : item.donor;

  const exists = await Rating.findOne({ item: itemId, rater: raterId });
  if (exists)
    throw Object.assign(
      new Error('لقد قيّمت هذا الغرض مسبقاً ✅'),
      { status: 409, code: 'ALREADY_RATED' }
    );

  const trustDelta = calcTrustDelta(score);

  const rating = await Rating.create({
    item:                itemId,
    rater:               raterId,
    ratee,                          // ✅ Fix 11.3 — الطرف الآخر ديناميكياً
    score,
    comment,
    isHandoverConfirmed: true,
    trustDelta,
  });

  await Item.findByIdAndUpdate(itemId, { isRated: true });

  // ✅ Fix 11.3 — تحديث trustScore للطرف المُقيَّم (مش دائماً المتبرع)
  await User.findByIdAndUpdate(ratee, { $inc: { trustScore: trustDelta } });

  // ✅ Fix 11.3 — إشعار الطرف المُقيَّم
  await notifyUser(ratee, {
    type:   'new_rating',
    title:  'حصلت على تقييم جديد ⭐',
    body:   `تقييمك على "${item.title}": ${score}/10`,
    itemId: item._id,
  });

  return rating;
};

exports.getUserRatings = async (userId) => {
  return Rating.find({ ratee: userId })
    .select('score comment createdAt item rater')
    .populate('item',  'title')
    .populate('rater', 'name avatar')
    .sort({ createdAt: -1 })
    .limit(20);
};

// ✅ Fix 11.3 — getPendingRating يشمل المتبرع والمستلم معاً
exports.getPendingRating = async (userId) => {
  const [asDonor, asReceiver] = await Promise.all([
    Item.find({ donor: userId,    status: 'تم التسليم' })
      .populate('bookedBy', 'name avatar')
      .lean(),
    Item.find({ bookedBy: userId, status: 'تم التسليم' })
      .populate('donor', 'name avatar')
      .lean(),
  ]);

  const allItems = [...asDonor, ...asReceiver];
  if (!allItems.length) return null;

  const ratedItemIds = await Rating.find({ rater: userId }).distinct('item');
  const ratedSet     = new Set(ratedItemIds.map(String));

  return allItems.find((item) => !ratedSet.has(String(item._id))) || null;
};