import { asRecord, toId, toIsoDate, toPlainRecord } from './dtoTypes';

const toPlainObject = toPlainRecord;
const toDate = toIsoDate;

const toParticipant = (value: unknown) => {
  const participant = asRecord(value);
  return participant ? {
    _id:    toId(participant),
    name:   participant.name   ?? null,
    avatar: participant.avatar ?? null,
  } : null;
};

exports.toRatingResponse = (rawRating: unknown) => {
  const rating = toPlainObject(rawRating);
  if (!rating) return null;

  return {
    _id:        toId(rating),
    score:      rating.score,
    comment:    rating.comment ?? '',
    trustDelta: rating.trustDelta ?? 0,
    createdAt:  toDate(rating.createdAt),
  };
};

exports.toUserRatingResponse = (rawRating: unknown) => {
  const rating = toPlainObject(rawRating);
  if (!rating) return null;

  const item = asRecord(rating.item);

  return {
    _id:       toId(rating),
    score:     rating.score,
    comment:   rating.comment ?? '',
    createdAt: toDate(rating.createdAt),
    item: item ? {
      _id:   toId(item),
      title: item.title ?? null,
    } : null,
    rater: toParticipant(rating.rater),
  };
};

/** لا نعيد سجل Item الخام؛ فقط الحقول اللازمة لنافذة التقييم. */
exports.toPendingRatingResponse = (rawItem: unknown) => {
  const item = toPlainObject(rawItem);
  if (!item) return { pendingRating: null };

  return {
    pendingRating: {
      _id:      toId(item),
      title:    item.title,
      status:   item.status,
      isRated:  Boolean(item.isRated),
      donor:    toParticipant(item.donor),
      bookedBy: toParticipant(item.bookedBy),
    },
  };
};

exports._private = { toDate, toId, toParticipant };
