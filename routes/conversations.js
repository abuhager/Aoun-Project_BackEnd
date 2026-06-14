// routes/conversations.js ✅ FIXED — إضافة route القراءة
const express = require('express');
const router  = express.Router();
const { requireAuth } = require('../middlewares/authMiddleware');
const { validateObjectId } = require('../middlewares/validateObjectId');
const Conversation = require('../models/Conversation');
const AppError = require('../utils/AppError');

// PUT /api/conversations/:id/read
router.put('/:id/read', requireAuth, validateObjectId('id'), async (req, res, next) => {
  try {
    const conv = await Conversation.findById(req.params.id);
    if (!conv) return next(new AppError('المحادثة غير موجودة', 404, 'CONV_NOT_FOUND'));

    const isParticipant = conv.participants
      .map((p) => p.toString())
      .includes(req.user.id.toString());

    if (!isParticipant) return next(new AppError('غير مصرح', 403, 'FORBIDDEN'));

    let updated = false;
    conv.messages.forEach((m) => {
      if (m.sender.toString() !== req.user.id.toString() && !m.read) {
        m.read = true;
        updated = true;
      }
    });

    if (updated) await conv.save();

    res.json({ ok: true, updated });
  } catch (err) {
    next(err);
  }
});

module.exports = router;