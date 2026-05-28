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

  if (item.bookedBy?.toString() !== raterId.toString())
    throw Object.assign(
      new Error('فقط المستلم يمكنه تقييم هذا الغرض'),
      { status: 403, code: 'NOT_RECEIVER' }
    );

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
    ratee:               item.donor,
    score,
    comment,
    isHandoverConfirmed: true,
    trustDelta,
  });

    await Item.findByIdAndUpdate(itemId, { isRated: true });

  await User.findByIdAndUpdate(
    item.donor,
    { $inc: { trustScore: trustDelta } }
  );

  // ✅ أبلغ المتبرع بالتقييم
  await notifyUser(item.donor, {
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

exports.getPendingRating = async (userId) => {
  const bookedItems = await Item.find({
    bookedBy: userId,
    status:   'تم التسليم',
  })
    .populate('donor', 'name avatar')
    .lean();

  if (!bookedItems.length) return null;

  const ratedItemIds = await Rating.find({ rater: userId }).distinct('item');
  const ratedSet     = new Set(ratedItemIds.map(String));

  return bookedItems.find((item) => !ratedSet.has(String(item._id))) || null;
};