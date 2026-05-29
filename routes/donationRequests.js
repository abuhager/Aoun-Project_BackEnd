// routes/donationRequests.js
const express    = require('express');
const router     = express.Router();
const { requireAuth } = require('../middlewares/auth');
const validateObjectId = require('../middlewares/validateObjectId');
const drController = require('../controllers/donationRequestController');
const { validateDonationRequest } = require('../dtos/donationRequestDto');

// middleware تحقق من الـ DTO
const validate = (fn) => (req, res, next) => {
  const { error } = fn(req.body);
  if (error) return res.status(400).json({ msg: error.details[0].message });
  next();
};

// ── قراءة عامة ────────────────────────────────────────────────
router.get('/',    drController.getRequests);
router.get('/me',  requireAuth, drController.getMyRequests);

// ── كتابة ─────────────────────────────────────────────────────
router.post('/',
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
