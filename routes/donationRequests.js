// routes/donationRequests.js
const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middlewares/auth');
const validateObjectId = require('../middlewares/validateObjectId');
const drController = require('../controllers/donationRequestController');
const { validateDonationRequest } = require('../dtos/donationRequestDto');

// middleware تحقق من الـ DTO
const validate = (fn) => (req, res, next) => {
  const { error } = fn(req.body);
  if (error) {
    return res.status(400).json({ msg: error.details[0].message });
  }
  next();
};

// ── قراءة ────────────────────────────────────────────────────
// ✅ لازم تكون محمية لأن getRequests يعتمد على req.user.id عند mine=true
router.get('/', requireAuth, drController.getRequests);

// ✅ endpoint إضافي للداشبورد أو quota summary
router.get('/me', requireAuth, drController.getMyRequests);

// ── كتابة ────────────────────────────────────────────────────
router.post(
  '/',
  requireAuth,
  validate(validateDonationRequest),
  drController.createRequest
);

router.patch(
  '/:id/cancel',
  requireAuth,
  validateObjectId('id'),
  drController.cancelRequest
);

module.exports = router;