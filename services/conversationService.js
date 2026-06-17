// services/conversationService.js
const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const Item = require('../models/Item');
const conversationRepository = require('../repositories/conversationRepository');
const {
  toConversationListItem,
  toConversationOpenResponse,
  toMessageDto,
  toMessagesResponse,
  toNotificationDto,
} = require('../dtos/conversationDto');

const userRoom = (id) => `user_${id}`;
const convRoom = (id) => `conv_${id}`;

const emitToRoom = (io, room, event, payload) => {
  if (!io) return;
  io.to(room).emit(event, payload);
};

const ensureValidObjectId = (value, fieldName) => {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw Object.assign(new Error(`${fieldName} غير صالح`), { status: 400 });
  }
};

const ensureParticipant = (conversation, userId) => {
  const allowed = conversation.participants.some(
    (participant) => participant.toString() === userId.toString()
  );

  if (!allowed) {
    throw Object.assign(new Error('غير مصرح لك'), { status: 403 });
  }
};

exports.listConversationsLogic = async (userId) => {
  const conversations = await conversationRepository.findConversationListByParticipant(userId);

  const enriched = await Promise.all(
    conversations.map(async (conversation) => {
      const unread = await conversationRepository.countUnreadForConversation(conversation._id, userId);
      return toConversationListItem(conversation, unread);
    })
  );

  return enriched;
};

exports.openConversationLogic = async ({ itemId, userId }) => {
  ensureValidObjectId(itemId, 'itemId');

  const item = await Item.findById(itemId).populate('donor', '_id name');
  if (!item) {
    throw Object.assign(new Error('الغرض غير موجود'), { status: 404 });
  }

  const donorId = item.donor?._id?.toString?.() || item.donor?.toString?.();
  const bookedById = typeof item.bookedBy === 'object'
    ? item.bookedBy?._id?.toString?.()
    : item.bookedBy?.toString?.();

  // 🔒 الشرط المطلوب: ممنوع نهائياً فتح أي محادثة إذا لم يكن الغرض محجوزاً مسبقاً
  if (!bookedById) {
    throw Object.assign(new Error('لا توجد محادثة قبل حجز الغرض فعلياً'), { status: 400 });
  }

  // 🔒 حماية الصلاحيات: المحادثة مقيدة وحصرية فقط بين المتبرع والشخص الذي حجز الغرض
  const allowed = userId === donorId || userId === bookedById;
  if (!allowed) {
    throw Object.assign(new Error('عذراً، هذه المحادثة مقيدة ومتاحة لأطراف الحجز فقط'), { status: 403 });
  }

  // البحث عن محادثة سابقة أو إنشاء واحدة جديدة
  let conversation = await conversationRepository.findConversationByItemAndParticipants(
    itemId,
    donorId,
    bookedById
  );

  if (!conversation) {
    conversation = await conversationRepository.createConversation({
      item: itemId,
      participants: [donorId, bookedById],
    });
  }

  return toConversationOpenResponse(conversation);
};

exports.getMessagesLogic = async ({ conversationId, userId, io }) => {
  ensureValidObjectId(conversationId, 'conversationId');

  const conversation = await conversationRepository.findConversationByIdWithMessages(conversationId);
  if (!conversation) {
    throw Object.assign(new Error('المحادثة غير موجودة'), { status: 404 });
  }

  ensureParticipant(conversation, userId);

  const changed = await conversationRepository.markIncomingMessagesRead(conversation, userId);
  if (changed) {
    emitToRoom(io, convRoom(conversationId), 'messagesRead', { by: userId });
  }

  return toMessagesResponse(conversation.messages, conversationId);
};

exports.sendMessageLogic = async ({ conversationId, text, user, io }) => {
  ensureValidObjectId(conversationId, 'conversationId');

  const normalizedText = text?.trim();
  if (!normalizedText || normalizedText.length > 1000) {
    throw Object.assign(new Error('نص الرسالة غير صالح'), { status: 400 });
  }

  const conversation = await conversationRepository.findConversationById(conversationId);
  if (!conversation) {
    throw Object.assign(new Error('المحادثة غير موجودة'), { status: 404 });
  }

  ensureParticipant(conversation, user.id);

  const populatedConversation = await conversation.populate('item', 'title _id');

  const newMessage = {
    _id: new mongoose.Types.ObjectId(),
    sender: user.id,
    text: normalizedText,
    createdAt: new Date(),
    read: false,
  };

  await conversationRepository.appendMessage(populatedConversation, newMessage);

  const receiverId = populatedConversation.participants
    .find((participant) => participant.toString() !== user.id.toString())
    ?.toString();

  const messageDto = toMessageDto(
    {
      ...newMessage,
      sender: { _id: user.id, name: user.name },
    },
    populatedConversation._id
  );

  emitToRoom(io, convRoom(populatedConversation._id), 'newMessage', messageDto);

  let notificationDto = null;
  if (receiverId) {
    const notification = await Notification.create({
      user: receiverId,
      type: 'new_message',
      title: 'رسالة جديدة',
      body: `لديك رسالة جديدة بخصوص: ${populatedConversation.item?.title || 'أحد الأغراض'}`,
      itemId: populatedConversation.item?._id || null,
    });

    notificationDto = toNotificationDto(notification, populatedConversation._id.toString());

    emitToRoom(io, userRoom(receiverId), 'notification:new', notificationDto);
    emitToRoom(io, userRoom(receiverId), 'conversation:updated', {
      conversationId: populatedConversation._id.toString(),
      lastMessage: messageDto,
    });
  }

  return {
    message: messageDto,
    notification: notificationDto,
  };
};

exports.markConversationReadLogic = async ({ conversationId, userId, io }) => {
  ensureValidObjectId(conversationId, 'conversationId');

  const conversation = await conversationRepository.findConversationById(conversationId);
  if (!conversation) {
    throw Object.assign(new Error('المحادثة غير موجودة'), { status: 404 });
  }

  ensureParticipant(conversation, userId);

  const changed = await conversationRepository.markIncomingMessagesRead(conversation, userId);

  if (changed) {
    emitToRoom(io, convRoom(conversationId), 'messagesRead', { by: userId });
    emitToRoom(io, userRoom(userId), 'conversation:read', { conversationId });
  }

  return { success: true };
};