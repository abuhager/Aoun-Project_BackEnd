const mongoose = require('mongoose');

const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Notification = require('../models/Notification');

const POPULATE_ITEM = 'title images imageUrl status donor bookedBy';
const POPULATE_USER = 'name avatar';
const DEFAULT_MESSAGE_PAGE_SIZE = 50;

const toObjectId = (value) => (
  mongoose.isObjectIdOrHexString(value)
    ? new mongoose.Types.ObjectId(value)
    : value
);

const populateConversation = (query) => query
  .populate('item', POPULATE_ITEM)
  .populate('owner', POPULATE_USER)
  .populate('requester', POPULATE_USER)
  .populate('participants', POPULATE_USER);

exports.DEFAULT_MESSAGE_PAGE_SIZE = DEFAULT_MESSAGE_PAGE_SIZE;

exports.findConversationByPair = async ({ itemId, owner, requester }) => (
  populateConversation(Conversation.findOne({ item: itemId, owner, requester })).lean()
);

exports.findOrCreateConversation = async ({ itemId, owner, requester }) => {
  const participants = [owner.toString(), requester.toString()].sort();

  return populateConversation(Conversation.findOneAndUpdate(
    { item: itemId, owner, requester },
    {
      $setOnInsert: {
        item: itemId,
        owner,
        requester,
        participants,
        lastMessage: '',
        lastMessageAt: null,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  )).lean();
};

exports.findConversationById = async (conversationId) => (
  populateConversation(Conversation.findById(conversationId)).lean()
);

exports.findUserConversations = async (userId) => (
  populateConversation(Conversation.find({ participants: toObjectId(userId) }))
    .sort({ lastMessageAt: -1, updatedAt: -1 })
    .lean()
);

exports.isParticipant = (conversation, userId) => (
  (conversation?.participants || []).some((participant) => {
    const participantId = participant?._id || participant;
    return participantId?.toString() === userId?.toString();
  })
);

exports.createMessage = async ({ conversationId, senderId, text, clientMessageId }) => {
  const filter = clientMessageId
    ? { conversation: conversationId, sender: senderId, clientMessageId }
    : null;

  if (filter) {
    const existing = await Message.findOne(filter)
      .populate('sender', `${POPULATE_USER} _id`)
      .lean();
    if (existing) return { message: existing, created: false };
  }

  let message;
  try {
    message = (await Message.create({
      conversation: conversationId,
      sender: senderId,
      text,
      clientMessageId: clientMessageId || null,
      read: false,
    })).toObject();
  } catch (error) {
    if (error?.code !== 11000 || !filter) throw error;
    const existing = await Message.findOne(filter)
      .populate('sender', `${POPULATE_USER} _id`)
      .lean();
    return { message: existing, created: false };
  }

  await Conversation.findByIdAndUpdate(conversationId, {
    $set: {
      lastMessage: message.text.slice(0, 100),
      lastMessageAt: message.createdAt,
    },
  });

  const populatedMessage = await Message.findById(message._id)
    .populate('sender', `${POPULATE_USER} _id`)
    .lean();
  return { message: populatedMessage, created: true };
};

exports.findMessagesPage = async (
  conversationId,
  { page = 1, limit = DEFAULT_MESSAGE_PAGE_SIZE } = {}
) => {
  const safeLimit = Math.min(Math.max(Number(limit) || DEFAULT_MESSAGE_PAGE_SIZE, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const skip = (safePage - 1) * safeLimit;

  const [messages, total] = await Promise.all([
    Message.find({ conversation: conversationId })
      .populate('sender', `${POPULATE_USER} _id`)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    Message.countDocuments({ conversation: conversationId }),
  ]);

  return {
    messages: messages.reverse(),
    total,
    page: safePage,
    totalPages: Math.ceil(total / safeLimit),
  };
};

exports.markMessagesRead = async (conversationId, userId) => {
  const result = await Message.updateMany(
    { conversation: conversationId, sender: { $ne: toObjectId(userId) }, read: false },
    { $set: { read: true } }
  );
  return result.modifiedCount || 0;
};

exports.markMessageNotificationsRead = async (conversationId, userId) => {
  const result = await Notification.updateMany(
    {
      user: toObjectId(userId),
      conversationId: toObjectId(conversationId),
      type: 'new_message',
      isRead: false,
    },
    { $set: { isRead: true } }
  );
  return result.modifiedCount || 0;
};

exports.countUnreadForUserBatch = async (conversationIds, userId) => {
  if (!conversationIds.length) return {};

  const rows = await Message.aggregate([
    {
      $match: {
        conversation: { $in: conversationIds.map(toObjectId) },
        sender: { $ne: toObjectId(userId) },
        read: false,
      },
    },
    { $group: { _id: '$conversation', count: { $sum: 1 } } },
  ]);

  return rows.reduce((map, row) => {
    map[row._id.toString()] = row.count;
    return map;
  }, {});
};
