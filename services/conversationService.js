// services/conversationService.js
const mongoose     = require('mongoose');
const Notification = require('../models/Notification');
const Item         = require('../models/Item');
const repo         = require('../repositories/conversationRepository');
const { toConversationListItem, toConversationOpenResponse, toMessageDto, toMessagesResponse, toNotificationDto } = require('../dtos/conversationDto');

const emit = (io, room, event, payload) => { if (io) io.to(room).emit(event, payload); };
const ensureId = (v, f) => { if (!mongoose.Types.ObjectId.isValid(v)) throw Object.assign(new Error(f + ' غير صالح'), { status: 400 }); };
const ensureParticipant = (conv, uid) => { if (!conv.participants.some((p) => p.toString() === uid.toString())) throw Object.assign(new Error('غير مصرح'), { status: 403 }); };

exports.listConversationsLogic = async (userId) => {
  const convs = await repo.findConversationListByParticipant(userId);
  return Promise.all(convs.map(async (c) => toConversationListItem(c, await repo.countUnreadForConversation(c._id, userId))));
};

// ══════════════════════════════════════════════════════════════
// ✅ تعديل المنطق: السماح بالمحادثات للأغراض المتاحة والمحجوزة دون تعارض
// ══════════════════════════════════════════════════════════════
exports.openConversationLogic = async ({ itemId, userId }) => {
  ensureId(itemId, 'itemId');
  
  const item = await Item.findById(itemId).populate('donor', '_id name');
  if (!item) throw Object.assign(new Error('الغرض غير موجود'), { status: 404 });

  const donorId = item.donor?._id?.toString?.() || item.donor?.toString?.();
  const bookedById = item.bookedBy ? (typeof item.bookedBy === 'object' ? item.bookedBy?._id?.toString?.() : item.bookedBy?.toString?.()) : null;

  let participantB = null;

  if (userId === donorId) {
    // 1. إذا كان المتبرع هو من يفتح الشات، يجب أن يكون الغرض محجوزاً لشخص ما لنعرف مع من يتحدث
    if (!bookedById) {
      throw Object.assign(new Error('لا توجد حجوزات نشطة على هذا الغرض للتحدث مع المستلم'), { status: 400 });
    }
    participantB = bookedById;
  } else {
    // 2. إذا كان مستخدم عادي يفتح الشات، يتحدث مع المتبرع فوراً (سواء الغرض متاح أو محجوز له)
    // حماية: إذا كان الغرض محجوزاً لشخص آخر، نمنع الأطراف الخارجية من التطفل
    if (bookedById && bookedById !== userId) {
      throw Object.assign(new Error('هذه المحادثة مقيدة، الغرض محجوز لمستلم آخر 🛡️'), { status: 403 });
    }
    participantB = donorId;
  }

  // البحث عن محادثة قائمة بين الطرفين (المستخدم الحالي والطرف الثاني المستهدف)
  let conv = await repo.findConversationByItemAndParticipants(itemId, userId, participantB);
  
  // إذا لم توجد محادثة سابقة، قم بإنشاء واحدة جديدة
  if (!conv) {
    conv = await repo.createConversation({ 
      item: itemId, 
      participants: [userId, participantB] 
    });
  }

  return toConversationOpenResponse(conv);
};

exports.getMessagesLogic = async ({ conversationId, userId, io }) => {
  ensureId(conversationId, 'conversationId');
  const conv = await repo.findConversationByIdWithMessages(conversationId);
  if (!conv) throw Object.assign(new Error('المحادثة غير موجودة'), { status: 404 });
  ensureParticipant(conv, userId);
  const changed = await repo.markIncomingMessagesRead(conv, userId);
  if (changed) emit(io, 'conv_' + conversationId, 'messagesRead', { by: userId });
  return toMessagesResponse(conv.messages, conversationId);
};

exports.sendMessageLogic = async ({ conversationId, text, user, io, correlationId }) => {
  ensureId(conversationId, 'conversationId');
  const trimmed = text?.trim();
  if (!trimmed || trimmed.length > 1000) throw Object.assign(new Error('نص الرسالة غير صالح'), { status: 400 });
  const conv = await repo.findConversationById(conversationId);
  if (!conv) throw Object.assign(new Error('المحادثة غير موجودة'), { status: 404 });
  ensureParticipant(conv, user.id);
  const newMsg = { _id: new mongoose.Types.ObjectId(), sender: user.id, text: trimmed, createdAt: new Date(), read: false };
  const updated = await repo.appendMessage(conversationId, newMsg, user.id);
  if (!updated) throw Object.assign(new Error('فشل الحفظ'), { status: 500 });
  await updated.populate('item', 'title _id');
  const msgDto = toMessageDto({ ...newMsg, sender: { _id: user.id, name: user.name }, correlationId }, updated._id);
  emit(io, 'conv_' + updated._id, 'newMessage', { ...msgDto, correlationId });
  const receiverId = updated.participants.find((p) => p.toString() !== user.id.toString())?.toString();
  let notificationDto = null;
  if (receiverId) {
    const notif = await Notification.create({ user: receiverId, type: 'new_message', title: 'رسالة جديدة', body: 'رسالة جديدة بخصوص: ' + (updated.item?.title || 'أحد الأغراض'), itemId: updated.item?._id || null });
    notificationDto = toNotificationDto(notif, updated._id.toString());
    emit(io, 'user_' + receiverId, 'notification:new',      notificationDto);
    emit(io, 'user_' + receiverId, 'conversation:updated', { conversationId: updated._id.toString(), lastMessage: msgDto });
  }
  return { message: { ...msgDto, correlationId }, notification: notificationDto };
};

exports.markConversationReadLogic = async ({ conversationId, userId, io }) => {
  ensureId(conversationId, 'conversationId');
  const conv = await repo.findConversationById(conversationId);
  if (!conv) throw Object.assign(new Error('المحادثة غير موجودة'), { status: 404 });
  ensureParticipant(conv, userId);
  const changed = await repo.markIncomingMessagesRead(conv, userId);
  if (changed) { emit(io, 'conv_' + conversationId, 'messagesRead', { by: userId }); emit(io, 'user_' + userId, 'conversation:read', { conversationId }); }
  return { success: true };
};