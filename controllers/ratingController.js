// controllers/ratingController.js
const ratingService = require('../services/ratingService');
const asyncHandler = require('../utils/asyncHandler');

exports.submitRating = asyncHandler(async (req, res) => {
  const rating = await ratingService.submitRating({
    itemId: req.body.itemId,
    raterId: req.user.id,
    score: req.body.score,
    comment: req.body.comment,
  });

  return res.status(201).json({
    msg: 'تم إرسال التقييم ✅',
    rating,
  });
});

exports.getUserRatings = asyncHandler(async (req, res) => {
  const ratings = await ratingService.getUserRatings(req.params.id);

  return res.status(200).json({ ratings });
});

exports.getPendingRating = asyncHandler(async (req, res) => {
  const pending = await ratingService.getPendingRating(req.user.id);

  return res.json({ pendingRating: pending });
});