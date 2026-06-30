const repo    = require('../repositories/conversationRepository');
const User    = require('../models/User');
const Message = require('../models/Message');

// ─────────────────────────────────────────────────────────────────────────────
// listConversationsLogic(userId)
// ─────────────────────────────────────────────────────────────────────────────
exports.listConversationsLogic = async (userId) => {
  const conversations = await repo.findConversationsByUser(userId);

  const withUnread = await Promise.all(
    conversations.map(async (conv) => ({
      ...conv,
      unreadCount: await repo.countUnreadForConversation(conv._id.toString(), userId),
    }))
  );

  return { conversations: withUnread };
};

// ─────────────────────────────────────────────────────────────────────────────
// openConversationLogic({ itemId, userId, io })
// ─────────────────────────────────────────────────────────────────────────────
exports.openConversationLogic = async ({ itemId, userId, io }) => {
  let targetUserId;
  let itemRef = null;

  if (itemId) {
    const Item = require('../models/Item');
    const item = await Item.findById(itemId).lean();
    if (!item) throw Object.assign(new Error('الإعلان غير موجود'), { status: 404 });
    itemRef = itemId;

    const donorId = item.donor?.toString();

    if (userId.toString() === donorId) {
      targetUserId = item.bookedBy?.toString();
      if (!targetUserId) {
        throw Object.assign(
          new Error('لا يوجد حاجز لهذا الإعلان بعد، لا يمكن فتح محادثة'),
          { status: 400, code: 'NO_BOOKING' }
        );
      }
    } else {
      targetUserId = donorId;
    }
  }

  if (!targetUserId) {
    throw Object.assign(new Error('targetUserId مطلوب'), { status: 400 });
  }

  if (targetUserId === userId.toString()) {
    throw Object.assign(
      new Error('لا يمكنك فتح محادثة مع نفسك'),
      { status: 400, code: 'SELF_CONVERSATION' }
    );
  }

  const targetUser = await User.findById(targetUserId).lean();
  if (!targetUser) throw Object.assign(new Error('المستخدم المستهدف غير موجود'), { status: 404 });

  const participants = [userId.toString(), targetUserId.toString()].sort();

  let isNew = false;
  let conversation;

  if (itemRef) {
    const before = await repo.findExistingConversation(participants);
    conversation = await repo.findOrCreateByItem(itemRef, participants);
    isNew = !before;
  } else {
    conversation = await repo.findExistingConversation(participants);
    if (!conversation) {
      conversation = await repo.createConversation({ participants });
      isNew = true;
    }
  }

  if (isNew && io) {
    participants.forEach((pid) => {
      // [FIX] غرفة المستخدم الشخصية → user_${id}
      io.to(`user_${pid}`).emit('newConversation', { conversation });
    });
  }

  return { conversation, isNew };
};

// ─────────────────────────────────────────────────────────────────────────────
// getMessagesLogic({ conversationId, userId, io, page })
// ─────────────────────────────────────────────────────────────────────────────
exports.getMessagesLogic = async ({ conversationId, userId, io, page = 1 }) => {
  const conv = await repo.findConversationById(conversationId);
  if (!conv) throw Object.assign(new Error('المحادثة غير موجودة'), { status: 404 });

  const isParticipant = conv.participants.some(
    (p) => p._id.toString() === userId.toString()
  );
  if (!isParticipant) throw Object.assign(new Error('غير مصرح'), { status: 403 });

  const messages = await repo.findMessagesByConversation(conversationId, {
    page: Number(page) || 1,
    limit: 30,
  });

  await exports.markConversationReadLogic({ conversationId, userId, io });

  return { conversation: conv, messages };
};

// ─────────────────────────────────────────────────────────────────────────────
// sendMessageLogic({ conversationId, text, correlationId, user, io })
// user = { id, name }
// ─────────────────────────────────────────────────────────────────────────────
exports.sendMessageLogic = async ({ conversationId, text, correlationId, user, io }) => {
  if (!text || !text.trim()) {
    throw Object.assign(new Error('نص الرسالة مطلوب'), { status: 400 });
  }
  const trimmed = text.trim();
  const userId  = user.id;

  const conv = await repo.findConversationById(conversationId);
  if (!conv) throw Object.assign(new Error('المحادثة غير موجودة'), { status: 404 });

  const isParticipant = conv.participants.some(
    (p) => p._id.toString() === userId.toString()
  );
  if (!isParticipant) throw Object.assign(new Error('غير مصرح'), { status: 403 });

  await repo.appendMessage(conversationId, { sender: userId, text: trimmed });

  const savedMsg = await Message.findOne({ conversation: conversationId, sender: userId })
    .sort({ createdAt: -1 })
    .populate('sender', 'name avatar _id')
    .lean();

  const responseMsg = correlationId ? { ...savedMsg, correlationId } : savedMsg;

  if (io) {
    conv.participants.forEach((participant) => {
      // [FIX] user_${id} يطابق socket.join(`user_${socket.userId}`) في socketHandler
      io.to(`user_${participant._id.toString()}`).emit('message:new', {
        conversationId,
        message: responseMsg,
      });
    });

    const otherParticipants = conv.participants.filter(
      (p) => p._id.toString() !== userId.toString()
    );
    otherParticipants.forEach((p) => {
      // [FIX] نفس التصحيح للإشعارات
      io.to(`user_${p._id.toString()}`).emit('notification:new', {
        type: 'message',
        from: { _id: userId, name: user.name },
        conversationId,
        preview: trimmed.substring(0, 60),
      });
    });
  }

  return { message: responseMsg };
};

// ─────────────────────────────────────────────────────────────────────────────
// markConversationReadLogic({ conversationId, userId, io })
// ─────────────────────────────────────────────────────────────────────────────
exports.markConversationReadLogic = async ({ conversationId, userId, io }) => {
  await repo.markMessagesAsRead(conversationId, userId);

  if (io) {
    const conv = await repo.findConversationById(conversationId);
    if (conv) {
      const others = conv.participants.filter(
        (p) => p._id.toString() !== userId.toString()
      );
      others.forEach((p) => {
        // [FIX] user_${id} للتوافق مع غرف socketHandler
        io.to(`user_${p._id.toString()}`).emit('messagesRead', {
          conversationId,
          readBy: userId,
        });
      });
    }
  }

  return { success: true };
};