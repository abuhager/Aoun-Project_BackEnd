const mongoose = require('mongoose');

const Item = require('../models/Item');
const repo = require('../repositories/conversationRepository');
const dto = require('../dtos/conversationDto');
const AppError = require('../utils/AppError');
const {
  SOCKET_EVENTS,
  conversationRoom,
  userRoom,
} = require('../socket/contracts');

const asId = (value) => (value?._id || value)?.toString();

const assertObjectId = (value, fieldName) => {
  if (!mongoose.isObjectIdOrHexString(value)) {
    throw new AppError(`معرّف ${fieldName} غير صالح`, 400, 'INVALID_ID');
  }
};

const participantIds = (conversation) => (
  (conversation?.participants || [])
    .map(asId)
    .filter(Boolean)
);

const assertParticipant = (conversation, userId) => {
  if (!repo.isParticipant(conversation, userId)) {
    throw new AppError('غير مصرح لك بالوصول إلى هذه المحادثة', 403, 'CHAT_FORBIDDEN');
  }
};

exports.listConversationsLogic = async (userId) => {
  assertObjectId(userId, 'المستخدم');

  const conversations = await repo.findUserConversations(userId);
  const ids = conversations.map((conversation) => conversation._id);
  const unreadMap = await repo.countUnreadForUserBatch(ids, userId);

  return conversations.map((conversation) => (
    dto.toConversationListItem(
      conversation,
      unreadMap[conversation._id.toString()] || 0
    )
  ));
};

exports.getUnreadCountLogic = async (userId) => {
  assertObjectId(userId, 'المستخدم');
  const unreadCount = await repo.countUnreadForUser(userId);
  return { unreadCount };
};

exports.openConversationLogic = async ({ itemId, userId, targetUserId = null, donorId, io }) => {
  assertObjectId(itemId, 'الغرض');
  assertObjectId(userId, 'المستخدم');

  const legacyTargetId = targetUserId || donorId || null;
  if (legacyTargetId) assertObjectId(legacyTargetId, 'المستخدم الآخر');

  const item = await Item.findById(itemId).select('donor bookedBy').lean();
  if (!item) {
    throw new AppError('الغرض غير موجود', 404, 'ITEM_NOT_FOUND');
  }

  const ownerId = asId(item.donor);
  const requesterId = asId(item.bookedBy);
  const currentUserId = userId.toString();

  if (!ownerId || !requesterId) {
    throw new AppError(
      'المحادثة تصبح متاحة بعد حجز الغرض',
      409,
      'CHAT_REQUIRES_BOOKING'
    );
  }

  if (ownerId === requesterId) {
    throw new AppError('لا يمكن إنشاء محادثة مع الحساب نفسه', 409, 'CHAT_SELF_CONVERSATION');
  }

  if (currentUserId !== ownerId && currentUserId !== requesterId) {
    throw new AppError('غير مصرح لك بفتح هذه المحادثة', 403, 'CHAT_FORBIDDEN');
  }

  const expectedTargetId = currentUserId === ownerId ? requesterId : ownerId;
  if (legacyTargetId && legacyTargetId.toString() !== expectedTargetId) {
    throw new AppError('المستخدم الآخر ليس طرفاً في حجز هذا الغرض', 403, 'CHAT_TARGET_MISMATCH');
  }

  let conversation = await repo.findConversationByPair({
    itemId,
    owner: ownerId,
    requester: requesterId,
  });
  let isNew = false;

  if (!conversation) {
    try {
      conversation = await repo.findOrCreateConversation({
        itemId,
        owner: ownerId,
        requester: requesterId,
      });
      isNew = true;
    } catch (error) {
      if (error?.code !== 11000) throw error;
      conversation = await repo.findConversationByPair({
        itemId,
        owner: ownerId,
        requester: requesterId,
      });
    }
  }

  if (!conversation) {
    throw new AppError('تعذر فتح المحادثة', 500, 'CHAT_OPEN_FAILED');
  }
  assertParticipant(conversation, currentUserId);

  const response = {
    conversation: dto.toConversationListItem(conversation, 0),
    isNew,
  };

  if (io && isNew) {
    participantIds(conversation).forEach((participantId) => {
      io.to(userRoom(participantId)).emit(
        SOCKET_EVENTS.NEW_CONVERSATION,
        response.conversation
      );
    });
  }

  return response;
};

exports.getMessagesLogic = async ({ conversationId, userId, page = 1 }) => {
  assertObjectId(conversationId, 'المحادثة');
  assertObjectId(userId, 'المستخدم');

  const parsedPage = page == null ? 1 : Number(page);
  if (!Number.isInteger(parsedPage) || parsedPage < 1) {
    throw new AppError('رقم الصفحة غير صالح', 400, 'INVALID_PAGE');
  }

  const conversation = await repo.findConversationById(conversationId);
  if (!conversation) {
    throw new AppError('المحادثة غير موجودة', 404, 'CHAT_NOT_FOUND');
  }
  assertParticipant(conversation, userId);

  const result = await repo.findMessagesPage(conversationId, {
    page: parsedPage,
    limit: repo.DEFAULT_MESSAGE_PAGE_SIZE,
  });

  return {
    conversation: dto.toConversationListItem(conversation, 0),
    ...dto.toMessagesResponse(result.messages, conversationId),
    total: result.total,
    page: result.page,
    totalPages: result.totalPages,
  };
};

exports.markConversationReadLogic = async ({ conversationId, userId, io }) => {
  assertObjectId(conversationId, 'المحادثة');
  assertObjectId(userId, 'المستخدم');

  const conversation = await repo.findConversationById(conversationId);
  if (!conversation) {
    throw new AppError('المحادثة غير موجودة', 404, 'CHAT_NOT_FOUND');
  }
  assertParticipant(conversation, userId);

  const [markedCount, markedNotificationCount] = await Promise.all([
    repo.markMessagesRead(conversationId, userId),
    repo.markMessageNotificationsRead(conversationId, userId),
  ]);

  if (io && (markedCount > 0 || markedNotificationCount > 0)) {
    if (markedCount > 0) {
      io.to(conversationRoom(conversationId)).emit(SOCKET_EVENTS.MESSAGES_READ, {
        conversationId,
        readBy: userId.toString(),
      });
    }
    if (markedNotificationCount > 0) {
      io.to(userRoom(userId)).emit(SOCKET_EVENTS.NOTIFICATION_REFRESH);
    }
    participantIds(conversation).forEach((participantId) => {
      io.to(userRoom(participantId)).emit(
        SOCKET_EVENTS.CONVERSATION_UPDATED,
        { conversationId }
      );
    });
  }

  return { success: true, markedCount, markedNotificationCount };
};
