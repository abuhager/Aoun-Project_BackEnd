// services/ratingService.js
// ✅ Phase 4: التقييم فقط بعد handover + حساب trustScore ديناميكي
const Rating = require('../models/Rating');
const Item   = require('../models/Item');
const User   = require('../models/User');

// ─── قاعدة حساب trustDelta ────────────────────────────────
// score 9-10 → +2  |  score 7-8 → +1  |  score 5-6 → 0
// score 3-4  → -1  |  score 1-2 → -2
const calcTrustDelta = (score) => {
  if (score >= 9) return  2;
  if (score >= 7) return  1;
  if (score >= 5) return  0;
  if (score >= 3) return -1;
  return -2;
};

exports.submitRating = async ({ itemId, raterId, score, comment }) => {

  // ─── 1. جلب الغرض والتحقق من الحالة ───────────────────
  const item = await Item.findById(itemId);

  if (!item)
    throw Object.assign(new Error('الغرض غير موجود'), { status: 404, code: 'ITEM_NOT_FOUND' });

  // ✅ الحماية الأساسية: لا تقييم إلا بعد handover ناجح
  if (item.status !== 'delivered')
    throw Object.assign(
      new Error('لا يمكن التقييم قبل اكتمال التسليم'),
      { status: 403, code: 'HANDOVER_NOT_COMPLETE' }
    );

  // ✅ التحقق: المُقيِّم هو المستلم الفعلي
  if (item.bookedBy?.toString() !== raterId.toString())
    throw Object.assign(
      new Error('فقط المستلم يمكنه تقييم هذا الغرض'),
      { status: 403, code: 'NOT_RECEIVER' }
    );

  // ─── 2. التحقق من التقييم المسبق (atomic) ────────────
  const exists = await Rating.findOne({ item: itemId, rater: raterId });
  if (exists)
    throw Object.assign(
      new Error('لقد قيّمت هذا الغرض مسبقاً ✅'),
      { status: 409, code: 'ALREADY_RATED' }
    );

  // ─── 3. حساب trustDelta وإنشاء التقييم ───────────────
  const trustDelta = calcTrustDelta(score);

  const rating = await Rating.create({
    item:                itemId,
    rater:               raterId,
    ratee:               item.donor,
    score,
    comment,
    isHandoverConfirmed: true,   // ✅ وصلنا هنا = handover مكتمل
    trustDelta,
  });

  // ─── 4. تحديث trustScore للمتبرع (atomic) ────────────
  await User.findByIdAndUpdate(
    item.donor,
    { $inc: { trustScore: trustDelta } }
  );

  return rating;
};

// ─── جلب تقييمات مستخدم معين ────────────────────────────
exports.getUserRatings = async (userId) => {
  return Rating.find({ ratee: userId })
    .select('score comment createdAt item rater')
    .populate('item',  'title')
    .populate('rater', 'name avatar')
    .sort({ createdAt: -1 })
    .limit(20);
};