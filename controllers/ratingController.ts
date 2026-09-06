import ratingService from '../services/ratingService.js';
import ratingDto from '../dtos/ratingDto.js';
import asyncHandler from '../utils/asyncHandler.js';

export const submitRating = asyncHandler(async (req, res) => {
  const rating = await ratingService.submitRating({
    itemId: String(req.body.itemId),
    raterId: req.user!.id,
    score: Number(req.body.score),
    comment: typeof req.body.comment === 'string' ? req.body.comment : undefined,
  });

  return res.status(201).json({
    msg: 'تم إرسال التقييم ✅',
    rating: ratingDto.toRatingResponse(rating),
  });
});

export const getUserRatings = asyncHandler(async (req, res) => {
  const ratings = await ratingService.getUserRatings(req.params.id);

  return res.status(200).json({
    ratings: ratings.map(ratingDto.toUserRatingResponse).filter(Boolean),
  });
});

export const getPendingRating = asyncHandler(async (req, res) => {
  const userId = String(req.user!.id ?? req.user!._id);
  const { pendingRating } = await ratingService.getPendingRating(userId);

  return res.status(200).json(
    ratingDto.toPendingRatingResponse(pendingRating)
  );
});

export default { submitRating, getUserRatings, getPendingRating };
