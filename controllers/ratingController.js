// controllers/ratingController.js
const ratingService          = require('../services/ratingService');
const { validateRating }     = require('../dtos/ratingDto');

exports.submitRating = async (req, res) => {
  const { error } = validateRating(req.body);
  if (error)
    return res.status(400).json({ msg: error.details[0].message, code: 'VALIDATION_ERROR' });

  try {
    const rating = await ratingService.submitRating({
      itemId:  req.body.itemId,
      raterId: req.user.id,
      score:   req.body.score,
      comment: req.body.comment,
    });
    return res.status(201).json({ msg: 'تم إرسال التقييم ✅', rating });
  } catch (err) {
    return res.status(err.status ?? 500).json({ msg: err.message, code: err.code ?? 'SERVER_ERROR' });
  }
};

exports.getUserRatings = async (req, res) => {
  try {
    const ratings = await ratingService.getUserRatings(req.params.id);
    return res.status(200).json({ ratings });
  } catch (err) {
    return res.status(500).json({ msg: err.message });
  }
};