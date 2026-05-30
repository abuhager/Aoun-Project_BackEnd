// repositories/conversationRepository.js
const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');

exports.findConversationListByParticipant = (userId) =>
  Conversation.find({ participants: userId })
    .populate('item', 'title imageUrl status')
    .populate('participants', 'name avatar')
    .sort({ lastActivity: -1 })
    .select('-messages')
    .lean();

exports.countUnreadForConversation = async (conversationId, userId) => {
  const result = await Conversation.aggregate([
    { $match: { _id: new mongoose.Types.ObjectId(conversationId) } },
    { $unwind: '$messages' },
    {
      $match: {
        'messages.sender': { $ne: new mongoose.Types.ObjectId(userId) },
        'messages.read': false,
      },
    },
    { $count: 'count' },
  ]);

  return result[0]?.count ?? 0;
};

exports.findConversationById = (conversationId) =>
  Conversation.findById(conversationId);

exports.findConversationByIdWithMessages = (conversationId) =>
  Conversation.findById(conversationId).populate('messages.sender', 'name avatar');

exports.findConversationByItemAndParticipants = (itemId, donorId, bookedById) =>
  Conversation.findOne({
    item: itemId,
    participants: { $all: [donorId, bookedById] },
  });

exports.createConversation = ({ item, participants }) =>
  Conversation.create({
    item,
    participants,
    messages: [],
    lastActivity: new Date(),
  });

exports.appendMessage = async (conversation, message) => {
  conversation.messages.push(message);
  conversation.lastActivity = new Date();
  await conversation.save();
  return conversation;
};

exports.markIncomingMessagesRead = async (conversation, userId) => {
  let changed = false;

  conversation.messages.forEach((message) => {
    if (message.sender.toString() !== userId.toString() && !message.read) {
      message.read = true;
      changed = true;
    }
  });

  if (changed) {
    conversation.lastActivity = new Date();
    await conversation.save();
  }

  return changed;
};