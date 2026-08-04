// services/ratingService.js
const ratingRepository = require('../repositories/ratingRepository');
const SystemSettings   = require('../models/SystemSettings');
const AppError         = require('../utils/AppError');

// ── helper: حساب trustDelta ديناميكياً
const calcTrustDelta = (score, settings) => {
  const max       = settings?.maxRatingScore   ?? 10;
  const maxDelta  = settings?.maxTrustDelta    ?? 5;
  const penaltyAt = settings?.ratingPenaltyAt  ?? 3;
  const penalty   = settings?.ratingPenalty    ?? -2;

  if (score <= penaltyAt) return penalty;
  return Math.round((score / max) * maxDelta);
};

// ─── تقديم تقييم ──────────────────────────────────────────────
exports.submitRating = async (raterId, { itemId, score, comment }) => {
  const [item, settings] = await Promise.all([
    ratingRepository.findItemById(itemId),
    SystemSettings.getCached(),
  ]);

  if (!item)
    throw new AppError('الغرض غير موجود', 404, 'ITEM_NOT_FOUND');

  if (item.status !== 'تم التسليم')
    throw new AppError('لا يمكن التقييم قبل تأكيد التسليم', 400, 'ITEM_NOT_DELIVERED');

  const isDonor    = item.donor.toString()     === raterId.toString();
  const isReceiver = item.bookedBy?.toString() === raterId.toString();

  if (!isDonor && !isReceiver)
    throw new AppError('غير مصرح لك بتقييم هذا الغرض', 403, 'FORBIDDEN');

  const ratee = isDonor ? item.bookedBy : item.donor;

  // ✅ FIX [RATING-01]: guard ضد تقييم النفس (في حال تطابق donor وbookedBy)
  if (ratee.toString() === raterId.toString())
    throw new AppError('لا يمكنك تقييم نفسك', 400, 'SELF_RATING');

  const existing = await ratingRepository.findExistingRating({ itemId, raterId });
  if (existing)
    throw new AppError('لقد قيّمت هذا الغرض مسبقاً', 409, 'ALREADY_RATED');

  const trustDelta = calcTrustDelta(score, settings);

  const rating = await ratingRepository.createRating({
    item:               itemId,
    rater:              raterId,
    ratee,
    score,
    comment:            comment ?? '',
    isHandoverConfirmed: true,
    trustDelta,
  });

  await Promise.all([
    ratingRepository.markItemRated(itemId),
    ratingRepository.incrementUserTrustScore(ratee.toString(), trustDelta),
  ]);

  return rating;
};

// ─── جلب تقييمات مستخدم ───────────────────────────────────────
exports.getUserRatings = (userId) =>
  ratingRepository.findRatingsForUser(userId);

// ─── جلب الغرض المنتظر تقييم ─────────────────────────────────
exports.getPendingRating = async (userId) => {
  const delivered = await ratingRepository.findDeliveredItemsAsReceiver(userId);
  if (!delivered.length) return { pendingRating: null };

  const ratedIds = await ratingRepository.findRatedItemIdsByRater(userId);
  const ratedSet = new Set(ratedIds.map(String));

  const pending = delivered.find(
    (item) => !item.isRated && !ratedSet.has(String(item._id))
  );

  return { pendingRating: pending ?? null };
};