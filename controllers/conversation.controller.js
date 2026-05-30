// controllers/conversation.controller.js
const conversationService = require('../services/conversationService');

exports.listConversations = async (req, res) => {
  try {
    const data = await conversationService.listConversationsLogic(req.user.id);
    res.json(data);
  } catch (err) {
    console.error('listConversations error:', err);
    res.status(err.status || 500).json({ message: err.message || 'فشل في جلب المحادثات' });
  }
};

exports.openConversation = async (req, res) => {
  try {
    const data = await conversationService.openConversationLogic({
      itemId: req.params.itemId,
      userId: req.user.id.toString(),
    });
    res.json(data);
  } catch (err) {
    console.error('openConversation error:', err);
    res.status(err.status || 500).json({ message: err.message || 'فشل في فتح المحادثة' });
  }
};

exports.getMessages = async (req, res) => {
  try {
    const data = await conversationService.getMessagesLogic({
      conversationId: req.params.conversationId,
      userId: req.user.id,
      io: req.app.get('io'),
    });
    res.json(data);
  } catch (err) {
    console.error('getMessages error:', err);
    res.status(err.status || 500).json({ message: err.message || 'فشل في جلب الرسائل' });
  }
};

exports.sendMessage = async (req, res) => {
  try {
    const data = await conversationService.sendMessageLogic({
      conversationId: req.params.conversationId,
      text: req.body.text,
      user: req.user,
      io: req.app.get('io'),
    });
    res.status(201).json(data);
  } catch (err) {
    console.error('sendMessage error:', err);
    res.status(err.status || 500).json({ message: err.message || 'فشل في إرسال الرسالة' });
  }
};

exports.markConversationRead = async (req, res) => {
  try {
    const data = await conversationService.markConversationReadLogic({
      conversationId: req.params.conversationId,
      userId: req.user.id,
      io: req.app.get('io'),
    });
    res.json(data);
  } catch (err) {
    console.error('markConversationRead error:', err);
    res.status(err.status || 500).json({ message: err.message || 'فشل في تحديث حالة القراءة' });
  }
};