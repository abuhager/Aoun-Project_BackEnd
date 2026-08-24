const mongoose = require('mongoose');

const repo = require('../repositories/conversationRepository');
const dto = require('../dtos/conversationDto');
const notifyUser = require('../utils/notifyUser');

const MAX_MESSAGE_LENGTH = 2000;
const MESSAGE_RATE_WINDOW_MS = 10_000;
const MESSAGE_RATE_MAX = 15;
const CLIENT_MESSAGE_ID_PATTERN = /^[A-Za-z0-9._:-]{8,100}$/;

const chatError = (message, code, statusCode = 400) => Object.assign(
  new Error(message),
  { code, statusCode }
);

const asId = (value) => (value?._id || value)?.toString();

const participantIds = (conversation) => (
  [...new Set((conversation?.participants || []).map(asId).filter(Boolean))]
);

const canSendInConversation = (conversation) => (
  asId(conversation?.item?.donor) === asId(conversation?.owner)
  && asId(conversation?.item?.bookedBy) === asId(conversation?.requester)
);

async function assertParticipant(conversationId, userId) {
  if (!mongoose.isObjectIdOrHexString(conversationId)) {
    throw chatError('معرّف المحادثة غير صالح', 'INVALID_CONVERSATION_ID');
  }
  if (!mongoose.isObjectIdOrHexString(userId)) {
    throw chatError('هوية الاتصال غير صالحة', 'SOCKET_UNAUTHORIZED', 401);
  }

  const conversation = await repo.findConversationById(conversationId);
  if (!conversation) {
    throw chatError('المحادثة غير موجودة', 'CHAT_NOT_FOUND', 404);
  }
  if (!repo.isParticipant(conversation, userId)) {
    throw chatError('غير مصرح لك بدخول هذه المحادثة', 'CHAT_FORBIDDEN', 403);
  }

  return conversation;
}

const safeAck = (ack, payload) => {
  if (typeof ack !== 'function') return false;
  ack(payload);
  return true;
};

const sendSocketError = (socket, scope, error, ack) => {
  const payload = {
    ok: false,
    success: false,
    code: error.code || 'CHAT_ERROR',
    error: error.statusCode >= 500 ? 'تعذر تنفيذ عملية المحادثة' : error.message,
  };

  if (!safeAck(ack, payload)) {
    socket.emit('chat_error', { scope, code: payload.code, msg: payload.error });
  }
};

const broadcastConversationRefresh = (io, conversation, conversationId) => {
  participantIds(conversation).forEach((participantId) => {
    io.to(`user_${participantId}`).emit('conversation_updated', { conversationId });
  });
};

const markReadAndBroadcast = async (io, conversation, conversationId, userId) => {
  const [markedCount, markedNotificationCount] = await Promise.all([
    repo.markMessagesRead(conversationId, userId),
    repo.markMessageNotificationsRead(conversationId, userId),
  ]);
  if (markedCount === 0 && markedNotificationCount === 0) return 0;

  if (markedCount > 0) {
    io.to(`conv_${conversationId}`).emit('messages_read', {
      conversationId,
      readBy: userId.toString(),
    });
  }
  if (markedNotificationCount > 0) {
    io.to(`user_${userId}`).emit('notification:refresh');
  }
  broadcastConversationRefresh(io, conversation, conversationId);
  return markedCount;
};

function registerChatHandlers(io, socket) {
  let recentMessageTimes = [];

  socket.on('join_room', async ({ convId } = {}, ack) => {
    try {
      const conversation = await assertParticipant(convId, socket.userId);
      const conversationId = conversation._id.toString();

      for (const room of socket.rooms) {
        if (room.startsWith('conv_') && room !== `conv_${conversationId}`) {
          socket.leave(room);
        }
      }
      await socket.join(`conv_${conversationId}`);

      const page = await repo.findMessagesPage(conversationId, {
        page: 1,
        limit: repo.DEFAULT_MESSAGE_PAGE_SIZE,
      });
      await markReadAndBroadcast(io, conversation, conversationId, socket.userId);

      safeAck(ack, {
        ok: true,
        success: true,
        conversationId,
        messages: dto.toMessagesResponse(page.messages, conversationId).messages,
        page: page.page,
        totalPages: page.totalPages,
        canSend: canSendInConversation(conversation),
      });
    } catch (error) {
      console.warn(`[Socket Chat][join_room] ${error.code || 'CHAT_ERROR'}: ${error.message}`);
      sendSocketError(socket, 'join_room', error, ack);
    }
  });

  socket.on('leave_room', ({ convId } = {}) => {
    if (!mongoose.isObjectIdOrHexString(convId)) return;
    const room = `conv_${convId}`;
    if (!socket.rooms.has(room)) return;

    socket.to(room).emit('typing_status', {
      convId,
      userId: socket.userId,
      isTyping: false,
    });
    socket.leave(room);
  });

  socket.on('send_message', async ({ convId, text, correlationId } = {}, ack) => {
    try {
      if (typeof text !== 'string') {
        throw chatError('نص الرسالة مطلوب', 'INVALID_MESSAGE');
      }
      const trimmed = text.trim();
      if (!trimmed) {
        throw chatError('لا يمكن إرسال رسالة فارغة', 'INVALID_MESSAGE');
      }
      if (trimmed.length > MAX_MESSAGE_LENGTH) {
        throw chatError(
          `الرسالة تتجاوز الحد الأقصى (${MAX_MESSAGE_LENGTH} حرف)`,
          'MESSAGE_TOO_LONG'
        );
      }
      if (correlationId != null && !CLIENT_MESSAGE_ID_PATTERN.test(correlationId)) {
        throw chatError('معرّف الرسالة غير صالح', 'INVALID_CLIENT_MESSAGE_ID');
      }

      const now = Date.now();
      recentMessageTimes = recentMessageTimes.filter(
        (timestamp) => now - timestamp < MESSAGE_RATE_WINDOW_MS
      );
      if (recentMessageTimes.length >= MESSAGE_RATE_MAX) {
        throw chatError('تم إرسال رسائل كثيرة بسرعة؛ حاول بعد لحظات', 'CHAT_RATE_LIMITED', 429);
      }

      const conversation = await assertParticipant(convId, socket.userId);
      const conversationId = conversation._id.toString();
      if (!canSendInConversation(conversation)) {
        throw chatError(
          'هذه المحادثة للقراءة فقط لأن الحجز لم يعد قائماً',
          'CHAT_BOOKING_ENDED',
          409
        );
      }
      const room = `conv_${conversationId}`;
      if (!socket.rooms.has(room)) {
        throw chatError('افتح المحادثة قبل إرسال الرسالة', 'CHAT_ROOM_NOT_JOINED', 409);
      }
      recentMessageTimes.push(now);

      const result = await repo.createMessage({
        conversationId,
        senderId: socket.userId,
        text: trimmed,
        clientMessageId: correlationId || null,
      });
      const message = dto.toMessageDto(result.message, conversationId);

      safeAck(ack, {
        ok: true,
        success: true,
        message,
        correlationId: correlationId || null,
      });

      if (!result.created) return;

      io.to(room).emit('receive_message', {
        convId: conversationId,
        message,
      });
      broadcastConversationRefresh(io, conversation, conversationId);

      const sender = (conversation.participants || [])
        .find((participant) => asId(participant) === socket.userId.toString());
      const senderName = sender?.name || socket.userName || 'مستخدم عون';
      const itemId = asId(conversation.item) || null;
      const preview = trimmed.length > 100 ? `${trimmed.slice(0, 100)}…` : trimmed;
      let activeUserIds = new Set();
      try {
        const activeSockets = await io.in(room).fetchSockets();
        activeUserIds = new Set(
          activeSockets
            .map((activeSocket) => activeSocket.data?.userId || activeSocket.userId)
            .filter(Boolean)
            .map(String)
        );
      } catch (error) {
        console.warn(`[Socket Chat][presence] ${error.message}`);
      }

      participantIds(conversation)
        .filter((participantId) => participantId !== socket.userId.toString())
        .filter((participantId) => !activeUserIds.has(participantId))
        .forEach((participantId) => {
          notifyUser(participantId, {
            type: 'new_message',
            title: `رسالة جديدة من ${senderName}`,
            body: preview,
            itemId,
            conversationId,
            metadata: { senderId: socket.userId.toString() },
          }).catch((error) => {
            console.warn(`[Socket Chat][notification] ${error.message}`);
          });
        });
    } catch (error) {
      console.warn(`[Socket Chat][send_message] ${error.code || 'CHAT_ERROR'}: ${error.message}`);
      sendSocketError(socket, 'send_message', error, ack);
    }
  });

  socket.on('mark_read', async ({ convId } = {}, ack) => {
    try {
      const conversation = await assertParticipant(convId, socket.userId);
      const conversationId = conversation._id.toString();
      if (!socket.rooms.has(`conv_${conversationId}`)) {
        throw chatError('المحادثة غير مفتوحة', 'CHAT_ROOM_NOT_JOINED', 409);
      }

      const markedCount = await markReadAndBroadcast(
        io,
        conversation,
        conversationId,
        socket.userId
      );
      safeAck(ack, { ok: true, success: true, markedCount });
    } catch (error) {
      sendSocketError(socket, 'mark_read', error, ack);
    }
  });

  socket.on('typing_status', ({ convId, isTyping } = {}) => {
    if (!mongoose.isObjectIdOrHexString(convId) || typeof isTyping !== 'boolean') return;
    const room = `conv_${convId}`;
    if (!socket.rooms.has(room)) return;

    socket.to(room).emit('typing_status', {
      convId,
      userId: socket.userId,
      isTyping,
    });
  });
}

module.exports = {
  MAX_MESSAGE_LENGTH,
  assertParticipant,
  canSendInConversation,
  registerChatHandlers,
};
