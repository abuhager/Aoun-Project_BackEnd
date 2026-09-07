import ratingRepository from '../repositories/ratingRepository.js';
import SystemSettings from '../models/SystemSettings.js';
import notifyUser from '../utils/notifyUser.js';
import AppError from '../utils/AppError.js';
import runMongoTransaction from '../utils/mongoTransaction.js';
import type { EntityId, ServiceRecord } from './serviceTypes.js';
import { getErrorMessage } from './serviceTypes.js';

type RatingSettings = {
  ratingThresholdExcellent?: number;
  ratingThresholdGood?: number;
  ratingThresholdNeutral?: number;
  ratingThresholdBad?: number;
};

type SubmitRatingInput = {
  itemId: EntityId;
  raterId: EntityId;
  score: number;
  comment?: string;
};

// حساب trustDelta بناءً على إعدادات النظام الديناميكية
const calcTrustDelta = (score: number, s: RatingSettings | null | undefined) => {
  if (score >= (s?.ratingThresholdExcellent ?? 9)) return  2;
  if (score >= (s?.ratingThresholdGood      ?? 7)) return  1;
  if (score >= (s?.ratingThresholdNeutral   ?? 5)) return  0;
  if (score >= (s?.ratingThresholdBad       ?? 3)) return -1;
  return -2;
};

const isDuplicateKeyError = (error: unknown) => (
  typeof error === 'object'
  && error !== null
  && 'code' in error
  && (error as { code?: unknown }).code === 11000
);

const ratingMatchesRequest = (
  rating: unknown,
  { itemId, raterId, score, comment }: SubmitRatingInput
) => {
  const record = rating as ServiceRecord | null;
  return Boolean(
    record
    && String(record.item) === String(itemId)
    && String(record.rater) === String(raterId)
    && Number(record.score) === score
    && String(record.comment ?? '') === String(comment ?? '')
  );
};

export const submitRating = async ({ itemId, raterId, score, comment }: SubmitRatingInput) => {
  const settings = await SystemSettings.getCached();
  const input = { itemId, raterId, score, comment };

  let result;
  try {
    result = await runMongoTransaction(async (session) => {
      const item = await ratingRepository.findItemById(itemId, session);

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

      if (ratee.toString() === raterId.toString())
        throw new AppError('لا يمكنك تقييم نفسك', 400, 'SELF_RATING');

      const existing = await ratingRepository.findExistingRating(
        { itemId, raterId },
        session
      );
      if (existing) {
        if (ratingMatchesRequest(existing, input)) {
          return { rating: existing, created: false, ratee, item };
        }
        throw new AppError('لقد قيّمت هذا الغرض مسبقاً ✅', 409, 'ALREADY_RATED');
      }

      const trustDelta = calcTrustDelta(score, settings);
      const rating = await ratingRepository.createRating({
        item: itemId,
        rater: raterId,
        ratee,
        score,
        comment: comment ?? '',
        isHandoverConfirmed: true,
        trustDelta,
      }, session);

      await ratingRepository.markItemRated(itemId, session);
      await ratingRepository.incrementUserTrustScore(ratee, trustDelta, session);

      return { rating, created: true, ratee, item };
    });
  } catch (error: unknown) {
    if (!isDuplicateKeyError(error)) throw error;

    const existing = await ratingRepository.findExistingRating({ itemId, raterId });
    if (!existing || !ratingMatchesRequest(existing, input)) {
      throw new AppError('لقد قيّمت هذا الغرض مسبقاً ✅', 409, 'ALREADY_RATED');
    }
    return existing;
  }

  if (result.created) {
    try {
      await notifyUser(result.ratee, {
        type:   'new_rating',
        title:  'حصلت على تقييم جديد ⭐',
        body:   `تقييمك على "${result.item.title}": ${score}/10`,
        itemId: result.item._id,
      });
    } catch (error: unknown) {
      console.warn(`[Rating Notification] ${getErrorMessage(error)}`);
    }
  }

  return result.rating;
};

export const getUserRatings = async (userId: EntityId) => {
  return ratingRepository.findRatingsForUser(userId);
};

export const getPendingRating = async (userId: EntityId) => {
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

export default { submitRating, getUserRatings, getPendingRating };
