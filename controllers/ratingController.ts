// controllers/ratingController.js
const ratingService = require('../services/ratingService');
const ratingDto = require('../dtos/ratingDto');
import asyncHandler = require('../utils/asyncHandler');

exports.submitRating = asyncHandler(async (req, res) => {
  const rating = await ratingService.submitRating({
    itemId: req.body.itemId,
    raterId: req.user!.id,
    score: req.body.score,
    comment: req.body.comment,
  });

  return res.status(201).json({
    msg: 'تم إرسال التقييم ✅',
    rating: ratingDto.toRatingResponse(rating),
  });
});

exports.getUserRatings = asyncHandler(async (req, res) => {
  const ratings = await ratingService.getUserRatings(req.params.id);

  return res.status(200).json({
    ratings: ratings.map(ratingDto.toUserRatingResponse).filter(Boolean),
  });
});

exports.getPendingRating = asyncHandler(async (req, res) => {
  const userId = req.user!.id || req.user!._id;
  const { pendingRating } = await ratingService.getPendingRating(userId);

  return res.status(200).json(
    ratingDto.toPendingRatingResponse(pendingRating)
  );
});
