// services/conversationService.js
const repo    = require('../repositories/conversationRepository');
const User    = require('../models/User');

exports.listConversationsLogic = async (userId) => {
  const conversations = await repo.findConversationsByUser(userId);
  return { conversations };
};

exports.openConversationLogic = async ({ itemId, userId, io }) => {
  if (!itemId) throw Object.assign(new Error('itemId مطلوب'), { status: 400 });

  const Item = require('../models/Item');
  const item = await Item.findById(itemId).lean();
  if (!item) throw Object.assign(new Error('الإعلان غير موجود'), { status: 404 });

  const donorId = item.donor?.toString();
  let targetUserId;

  if (userId.toString() === donorId) {
    targetUserId = item.bookedBy?.toString();
    if (!targetUserId)
      throw Object.assign(new Error('لا يوجد حاجز لهذا الإعلان بعد'), { status: 400, code: 'NO_BOOKING' });
  } else {
    targetUserId = donorId;
  }

  if (targetUserId === userId.toString())
    throw Object.assign(new Error('لا يمكنك فتح محادثة مع نفسك'), { status: 400 });

  const targetUser = await User.findById(targetUserId).lean();
  if (!targetUser) throw Object.assign(new Error('المستخدم غير موجود'), { status: 404 });

  const participants = [userId.toString(), targetUserId.toString()].sort();
  const before       = await repo.findExistingConversation(participants);
  const conversation = await repo.findOrCreateByItem(itemId, participants);
  const isNew        = !before;

  if (isNew && io) {
    participants.forEach((pid) =>
      io.to(`user_${pid}`).emit('newConversation', { conversation })
    );
  }

  return { conversation, isNew };
};

exports.getMessagesLogic = async ({ conversationId, userId, io, page = 1 }) => {
  const conv = await repo.findConversationById(conversationId);
  if (!conv) throw Object.assign(new Error('المحادثة غير موجودة'), { status: 404 });

  const isParticipant = conv.participants.some(
    (p) => p._id.toString() === userId.toString()
  );
  if (!isParticipant) throw Object.assign(new Error('غير مصرح'), { status: 403 });

  const [messages] = await Promise.all([
    repo.findMessagesByConversation(conversationId, { page: Number(page) || 1, limit: 30 }),
    exports.markConversationReadLogic({ conversationId, userId, io }),
  ]);

  return { conversation: conv, messages };
};

exports.sendMessageLogic = async ({ conversationId, text, correlationId, user, io }) => {
  if (!text?.trim())
    throw Object.assign(new Error('نص الرسالة مطلوب'), { status: 400 });

  const trimmed = text.trim();
  const userId  = user.id;

  const conv = await repo.findConversationById(conversationId);
  if (!conv) throw Object.assign(new Error('المحادثة غير موجودة'), { status: 404 });

  const isParticipant = conv.participants.some(
    (p) => p._id.toString() === userId.toString()
  );
  if (!isParticipant) throw Object.assign(new Error('غير مصرح'), { status: 403 });

  const savedMsg   = await repo.appendMessage(conversationId, { sender: userId, text: trimmed });
  const responseMsg = correlationId ? { ...savedMsg, correlationId } : savedMsg;

  if (io) {
    // ✅ FIX-4: البث على غرفة المحادثة — يضمن وصول الرسالة لكلا الطرفين
    io.to(`conv_${conversationId}`).emit('message:new', {
      conversationId,
      message: responseMsg,
    });

    // إشعار للطرف الآخر عبر غرفته الشخصية
    conv.participants
      .filter((p) => p._id.toString() !== userId.toString())
      .forEach((p) => {
        io.to(`user_${p._id.toString()}`).emit('notification:new', {
          type:   'message',
          from:   { _id: userId, name: user.name },
          conversationId,
          preview: trimmed.substring(0, 60),
        });
      });
  }

  return { message: responseMsg };
};

exports.markConversationReadLogic = async ({ conversationId, userId, io }) => {
  await repo.markMessagesAsRead(conversationId, userId);

  if (io) {
    const conv = await repo.findConversationById(conversationId);
    if (conv) {
      conv.participants
        .filter((p) => p._id.toString() !== userId.toString())
        .forEach((p) => {
          io.to(`user_${p._id.toString()}`).emit('messagesRead', {
            conversationId,
            readBy: userId,
          });
        });
    }
  }

  return { success: true };
};