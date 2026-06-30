const Conversation = require("../models/Conversation");
const Message = require("../models/Message");

exports.createOrGetConversation = async ({ item, owner, requester }) => {
  const update = {
    $setOnInsert: {
      item,
      owner,
      requester,
      participants: [owner, requester],
      unreadCount: 0,
      lastMessage: "",
      lastMessageAt: null,
    },
  };

  const conversation = await Conversation.findOneAndUpdate(
    { item, owner, requester },
    update,
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    }
  )
    .populate("item", "title images")
    .populate("owner", "name avatar")
    .populate("requester", "name avatar");

  return conversation;
};

exports.findUserConversations = async (userId) => {
  return Conversation.find({ participants: userId })
    .populate("item", "title images")
    .populate("owner", "name avatar")
    .populate("requester", "name avatar")
    .sort({ updatedAt: -1 });
};

exports.findConversationById = async (conversationId) => {
  return Conversation.findById(conversationId)
    .populate("item", "title images")
    .populate("owner", "name avatar")
    .populate("requester", "name avatar");
};

exports.appendMessage = async ({ conversationId, sender, text }) => {
  const message = await Message.create({
    conversation: conversationId,
    sender,
    text,
  });

  await Conversation.findByIdAndUpdate(conversationId, {
    $set: {
      lastMessage: text,
      lastMessageAt: new Date(),
    },
    $inc: { unreadCount: 1 },
  });

  return Message.findById(message._id).populate("sender", "name avatar");
};

exports.findMessagesByConversation = async (conversationId, { page = 1, limit = 20 } = {}) => {
  const skip = (page - 1) * limit;

  const [messages, total] = await Promise.all([
    Message.find({ conversation: conversationId })
      .populate("sender", "name avatar")
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(limit),
    Message.countDocuments({ conversation: conversationId }),
  ]);

  return {
    messages,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  };
};

exports.markMessagesAsRead = async ({ conversationId, userId }) => {
  await Message.updateMany(
    { conversation: conversationId, sender: { $ne: userId }, read: false },
    { $set: { read: true } }
  );

  await Conversation.findByIdAndUpdate(conversationId, {
    $set: { unreadCount: 0 },
  });
};

exports.countUnreadForConversation = async ({ conversationId, userId }) => {
  return Message.countDocuments({
    conversation: conversationId,
    sender: { $ne: userId },
    read: false,
  });
};