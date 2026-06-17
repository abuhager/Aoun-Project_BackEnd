// repositories/conversationRepository.js
// CRIT-01 ► appendMessage ذري | CRIT-02 ► markRead ذري | HIGH-03 ► $slice -50

const mongoose     = require('mongoose');
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
    { $match: { 'messages.sender': { $ne: new mongoose.Types.ObjectId(userId) }, 'messages.read': false } },
    { $count: 'count' },
  ]);
  return result[0]?.count ?? 0;
};

exports.findConversationById = (id) => Conversation.findById(id);

exports.findConversationByIdWithMessages = (id) =>
  Conversation.findById(id, { messages: { $slice: -50 } })
    .populate('messages.sender', 'name avatar');

exports.findConversationByItemAndParticipants = (itemId, donorId, bookedById) =>
  Conversation.findOne({ item: itemId, participants: { $all: [donorId, bookedById] } });

exports.createConversation = ({ item, participants }) =>
  Conversation.create({ item, participants, messages: [], lastActivity: new Date() });

// CRIT-01 ► تحقق من المشارك + إضافة رسالة في عملية ذرية واحدة
exports.appendMessage = (conversationIdOrDoc, message, senderId) => {
  const convId = conversationIdOrDoc?._id ?? conversationIdOrDoc;
  return Conversation.findOneAndUpdate(
    { _id: convId, participants: new mongoose.Types.ObjectId(senderId || message.sender) },
    { $push: { messages: message }, $set: { lastActivity: new Date() } },
    { new: true }
  );
};

// CRIT-02 ► arrayFilters في updateOne — ذري تماماً
exports.markIncomingMessagesRead = async (conversationOrId, userId) => {
  const convId = conversationOrId?._id ?? conversationOrId;
  const result = await Conversation.updateOne(
    { _id: convId },
    { $set: { 'messages.$[elem].read': true } },
    { arrayFilters: [{ 'elem.sender': { $ne: new mongoose.Types.ObjectId(userId) }, 'elem.read': false }] }
  );
  return result.modifiedCount > 0;
};
