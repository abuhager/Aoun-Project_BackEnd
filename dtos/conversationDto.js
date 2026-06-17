// dtos/conversationDto.js
// HIGH-01 ► correlationId مُضاف

exports.toConversationListItem = (conversation, unreadCount = 0) => ({
  _id:          conversation._id?.toString(),
  item:         conversation.item
    ? { _id: conversation.item._id?.toString(), title: conversation.item.title, imageUrl: conversation.item.imageUrl, status: conversation.item.status }
    : null,
  participants: (conversation.participants || []).map((p) => ({ _id: p._id?.toString(), name: p.name, avatar: p.avatar })),
  lastActivity: conversation.lastActivity,
  unreadCount,
});

exports.toConversationOpenResponse = (conversation) => ({
  _id: conversation._id?.toString(),
  item: conversation.item?.toString?.() ?? conversation.item,
});

exports.toMessageDto = (message, conversationId) => ({
  _id:            message._id?.toString(),
  conversationId: conversationId?.toString(),
  sender:         typeof message.sender === 'object' && message.sender !== null
    ? { _id: message.sender._id?.toString(), name: message.sender.name }
    : message.sender?.toString(),
  text:          message.text,
  createdAt:     message.createdAt,
  read:          message.read ?? false,
  correlationId: message.correlationId ?? null,
});

exports.toMessagesResponse = (messages, conversationId) => ({
  messages: (messages || []).map((m) => exports.toMessageDto(m, conversationId)),
  total: messages?.length ?? 0,
});

exports.toNotificationDto = (notification, conversationId) => ({
  _id:            notification._id?.toString(),
  type:           notification.type,
  title:          notification.title,
  body:           notification.body,
  itemId:         notification.itemId?.toString?.() ?? null,
  conversationId: conversationId ?? null,
  isRead:         notification.isRead ?? false,
  createdAt:      notification.createdAt,
});
