const Conversation = require('../models/Conversation');
const Message      = require('../models/Message');

// ─── الدوال الموجودة (بدون تغيير) ──────────────────────────────────────────

exports.findExistingConversation = async (participants) => {
  return Conversation.findOne({
    participants: { $all: participants, $size: participants.length },
    isActive: true,
  }).lean();
};

exports.createConversation = async (data) => {
  const conv = new Conversation(data);
  await conv.save();
  return conv.toObject();
};

exports.findConversationById = async (conversationId) => {
  return Conversation.findById(conversationId)
    .populate('participants', 'name avatar _id')
    .populate('lastMessage')
    .lean();
};

exports.findConversationsByUser = async (userId) => {
  return Conversation.find({
    participants: userId,
    isActive: true,
  })
    .populate('participants', 'name avatar _id')
    .populate('lastMessage')
    .sort({ updatedAt: -1 })
    .lean();
};

// ─── [جديد] findOrCreateByItem ─────────────────────────────────────────────
/**
 * ابحث عن محادثة مرتبطة بـ item معين، أو أنشئها إذا لم تكن موجودة.
 * يستخدم upsert لتجنب race condition ومشكلة الـ 409.
 *
 * @param {string} itemId
 * @param {string[]} participants — مُرتَّبة مسبقاً
 * @returns {Promise<object>}
 */
exports.findOrCreateByItem = async (itemId, participants) => {
  const conv = await Conversation.findOneAndUpdate(
    { item: itemId },
    { $setOnInsert: { item: itemId, participants } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  )
    .populate('participants', 'name avatar _id')
    .lean();
  return conv;
};

// ─── الدوال المُصلَحة / الجديدة ────────────────────────────────────────────

exports.appendMessage = async (conversationId, messageData) => {
  const newMessage = await Message.create({
    conversation: conversationId,
    sender: messageData.sender,
    text:   messageData.text,
  });

  await Conversation.findByIdAndUpdate(conversationId, {
    $set: { lastMessage: newMessage._id },
    $inc: { unreadCount: 1 },
  });

  return newMessage.toObject();
};

exports.findMessagesByConversation = async (conversationId, { page = 1, limit = 30 } = {}) => {
  const skip = (page - 1) * limit;
  return Message.find({ conversation: conversationId })
    .populate('sender', 'name avatar _id')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
};

exports.countUnreadForConversation = async (conversationId, userId) => {
  return Message.countDocuments({
    conversation: conversationId,
    sender: { $ne: userId },
    read: false,
  });
};

exports.markMessagesAsRead = async (conversationId, userId) => {
  await Message.updateMany(
    {
      conversation: conversationId,
      sender: { $ne: userId },
      read: false,
    },
    { $set: { read: true } }
  );

  await Conversation.findByIdAndUpdate(conversationId, {
    $set: { unreadCount: 0 },
  });
};

exports.closeConversation = async (conversationId) => {
  return Conversation.findByIdAndUpdate(
    conversationId,
    { $set: { isActive: false } },
    { new: true }
  ).lean();
};