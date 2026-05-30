const express = require('express');
const router = express.Router();
const { requireAuth }  = require('../middlewares/auth');
const conversationController = require('../controllers/conversation.controller');

router.get('/', requireAuth, conversationController.listConversations);
router.post('/:itemId', requireAuth, conversationController.openConversation);
router.get('/:conversationId/messages', requireAuth, conversationController.getMessages);
router.post('/:conversationId/messages', requireAuth, conversationController.sendMessage);
router.put('/:conversationId/read', requireAuth, conversationController.markConversationRead);

module.exports = router;