// controllers/conversationController.js
const svc  = require('../services/conversationService');
const repo = require('../repositories/conversationRepository');
const uid  = (req) => (req.user._id || req.user.id).toString();


// GET /api/conversations
exports.listConversations = async (req, res, next) => {
  try {
    const result = await svc.listConversationsLogic(uid(req));
    // [FIX] الفرونت يتوقع مصفوفة مباشرة، وليس { conversations: [...] }
    res.json(result.conversations);
  } catch (e) { next(e); }
};


// POST /api/conversations
exports.openConversation = async (req, res, next) => {
  try {
    const result = await svc.openConversationLogic({
      itemId: req.body.itemId,
      userId: uid(req),
      io: req.io,
    });

    const messages = await repo.findMessagesByConversation(
      result.conversation._id.toString(),
      { page: 1, limit: 30 }
    );

    res.json({ ...result.conversation, messages });
  } catch (e) { next(e); }
};


// GET /api/conversations/:conversationId/messages
exports.getMessages = async (req, res, next) => {
  try {
    res.json(await svc.getMessagesLogic({
      conversationId: req.params.conversationId,
      userId: uid(req),
      io: req.io,
      page: req.query.page,
    }));
  } catch (e) { next(e); }
};


// POST /api/conversations/:conversationId/messages
exports.sendMessage = async (req, res, next) => {
  try {
    res.status(201).json(await svc.sendMessageLogic({
      conversationId: req.params.conversationId,
      text: req.body.text,
      correlationId: req.body.correlationId,
      user: { id: uid(req), name: req.user.name },
      io: req.io,
    }));
  } catch (e) { next(e); }
};


// PUT /api/conversations/:conversationId/read
exports.markConversationRead = async (req, res, next) => {
  try {
    res.json(await svc.markConversationReadLogic({
      conversationId: req.params.conversationId,
      userId: uid(req),
      io: req.io,
    }));
  } catch (e) { next(e); }
};