const toPlainObject = (value) => (
  value?.toObject ? value.toObject() : value
);

const toId = (value) => {
  if (!value) return null;
  return String(value._id ?? value);
};

const toDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const toParticipant = (value) => value ? {
  _id:    toId(value),
  name:   value.name   ?? null,
  avatar: value.avatar ?? null,
} : null;

exports.toRatingResponse = (rawRating) => {
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

exports.toUserRatingResponse = (rawRating) => {
  const rating = toPlainObject(rawRating);
  if (!rating) return null;

  return {
    _id:       toId(rating),
    score:     rating.score,
    comment:   rating.comment ?? '',
    createdAt: toDate(rating.createdAt),
    item: rating.item ? {
      _id:   toId(rating.item),
      title: rating.item.title ?? null,
    } : null,
    rater: toParticipant(rating.rater),
  };
};

/** لا نعيد سجل Item الخام؛ فقط الحقول اللازمة لنافذة التقييم. */
exports.toPendingRatingResponse = (rawItem) => {
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
