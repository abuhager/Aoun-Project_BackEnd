// routes/conversations.js — ✅ FIXED BASED ON SERVICE LOGIC
const express          = require('express');
const router           = express.Router();
const { requireAuth }  = require('../middlewares/auth');
const validateObjectId = require('../middlewares/validateObjectId');
const conversationService = require('../services/conversationService');
const AppError         = require('../utils/AppError');

// ── GET /api/conversations (جلب قائمة المحادثات للمستخدم) ──────────────────
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const data = await conversationService.listConversationsLogic(req.user.id);
    res.status(200).json({ ok: true, data });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/conversations (✅ تهيئة أو فتح محادثة بناءً على itemId المرسل بالـ Body) ──
// هذا يعالج طلب الـ Frontend: POST /api/conversations
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { itemId } = req.body;
    
    if (!itemId) {
      return next(new AppError('itemId مطلوب لفتح المحادثة', 400, 'BAD_REQUEST'));
    }

    const data = await conversationService.openConversationLogic({
      itemId,
      userId: req.user.id
    });

    // الـ Service يرجع البيانات عبر الـ DTO، نرسلها مباشرة للفرونت
    res.status(200).json(data);
  } catch (err) {
    // تحويل الأخطاء العادية المرمية من الـ service إلى الـ Global Error Handler
    if (err.status) {
      return next(new AppError(err.message, err.status));
    }
    next(err);
  }
});

// ── POST /api/conversations/:itemId (✅ معالجة الـ Fallback إذا أرسل الفرونت الـ ID بالمسار) ──
// السجلات بينت أن الفرونت يطلب أحياناً: POST /api/conversations/6a2af3c005217c9ccb72c067
router.post('/:itemId', requireAuth, validateObjectId('itemId'), async (req, res, next) => {
  try {
    const data = await conversationService.openConversationLogic({
      itemId: req.params.itemId,
      userId: req.user.id
    });
    res.status(200).json(data);
  } catch (err) {
    if (err.status) {
      return next(new AppError(err.message, err.status));
    }
    next(err);
  }
});

// ── GET /api/conversations/:id/messages (جلب رسائل محادثة معينة) ─────────────
router.get('/:id/messages', requireAuth, validateObjectId('id'), async (req, res, next) => {
  try {
    // جلب الـ io من الـ app لتمريره للـ service لعمل الـ Broadcast
    const io = req.app.get('io'); 
    
    const data = await conversationService.getMessagesLogic({
      conversationId: req.params.id,
      userId: req.user.id,
      io
    });
    
    res.status(200).json({ ok: true, data });
  } catch (err) {
    if (err.status) {
      return next(new AppError(err.message, err.status));
    }
    next(err);
  }
});

// ── POST /api/conversations/:id/messages (إرسال رسالة جديدة داخل محادثة) ──────
router.post('/:id/messages', requireAuth, validateObjectId('id'), async (req, res, next) => {
  try {
    const { text } = req.body;
    const io = req.app.get('io');

    const data = await conversationService.sendMessageLogic({
      conversationId: req.params.id,
      text,
      user: { id: req.user.id, name: req.user.name },
      io
    });

    res.status(201).json({ ok: true, data });
  } catch (err) {
    if (err.status) {
      return next(new AppError(err.message, err.status));
    }
    next(err);
  }
});

// ── PUT /api/conversations/:id/read (تحديد المحادثة كمقروءة) ──────────────────
router.put('/:id/read', requireAuth, validateObjectId('id'), async (req, res, next) => {
  try {
    const io = req.app.get('io');
    
    const data = await conversationService.markConversationReadLogic({
      conversationId: req.params.id,
      userId: req.user.id,
      io
    });

    res.status(200).json(data);
  } catch (err) {
    if (err.status) {
      return next(new AppError(err.message, err.status));
    }
    next(err);
  }
});

module.exports = router;