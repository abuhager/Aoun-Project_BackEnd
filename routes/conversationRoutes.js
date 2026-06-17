// routes/conversationRoutes.js
const express    = require('express');
const router     = express.Router();
const c          = require('../controllers/conversationController');
const { requireAuth } = require('../middlewares/auth');

router.get ('/',                         requireAuth, c.listConversations);
router.post('/',                         requireAuth, c.openConversation);
router.get ('/:conversationId/messages', requireAuth, c.getMessages);
router.post('/:conversationId/messages', requireAuth, c.sendMessage);
router.put ('/:conversationId/read',     requireAuth, c.markConversationRead);

module.exports = router;
