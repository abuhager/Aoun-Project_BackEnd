// routes/conversations.js — FIXED

const express          = require('express');
const router           = express.Router();
const { requireAuth }  = require('../middlewares/auth');
const validateObjectId = require('../middlewares/validateObjectId');
const Conversation     = require('../models/Conversation');
const AppError         = require('../utils/AppError');

// GET /api/conversations
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const conversations = await Conversation.find({
      participants: req.user.id,
    })
      .populate('participants', 'name avatar trustLevel')
      .populate('item', 'title images status')
      .sort({ lastActivity: -1 })
      .lean();

    const result = conversations.map((conv) => {
      const unreadCount = conv.messages.filter(
        (m) => m.sender.toString() !== req.user.id.toString() && !m.read
      ).length;

      const lastMessage = conv.messages.length > 0
        ? conv.messages[conv.messages.length - 1]
        : null;

      return {
        _id:          conv._id,
        item:         conv.item,
        participants: conv.participants,
        lastMessage,
        unreadCount,
        lastActivity: conv.lastActivity,
        createdAt:    conv.createdAt,
      };
    });

    res.json({ ok: true, data: result });
  } catch (err) {
    next(err);
  }
});

// GET /api/conversations/:id
router.get('/:id', requireAuth, validateObjectId('id'), async (req, res, next) => {
  try {
    const conv = await Conversation.findById(req.params.id)
      .populate('participants', 'name avatar trustLevel')
      .populate('item', 'title images status')
      .lean();

    if (!conv) {
      return next(new AppError('المحادثة غير موجودة', 404, 'CONV_NOT_FOUND'));
    }

    const isParticipant = conv.participants.some(
      (p) => p._id.toString() === req.user.id.toString()
    );

    if (!isParticipant) {
      return next(new AppError('غير مصرح', 403, 'FORBIDDEN'));
    }

    res.json({ ok: true, data: conv });
  } catch (err) {
    next(err);
  }
});

// PUT /api/conversations/:id/read
router.put('/:id/read', requireAuth, validateObjectId('id'), async (req, res, next) => {
  try {
    const conv = await Conversation.findById(req.params.id);

    if (!conv) {
      return next(new AppError('المحادثة غير موجودة', 404, 'CONV_NOT_FOUND'));
    }

    const isParticipant = conv.participants
      .map((p) => p.toString())
      .includes(req.user.id.toString());

    if (!isParticipant) {
      return next(new AppError('غير مصرح', 403, 'FORBIDDEN'));
    }

    let updated = false;

    conv.messages.forEach((m) => {
      if (m.sender.toString() !== req.user.id.toString() && !m.read) {
        m.read  = true;
        updated = true;
      }
    });

    if (updated) {
      await conv.save();
    }

    res.json({ ok: true, updated });
  } catch (err) {
    next(err);
  }
});

module.exports = router;