// dtos/conversationDto.js
exports.toConversationListItem = (conversation, unread = 0) => ({
  ...conversation,
  unread,
});

exports.toConversationOpenResponse = (conversation) => ({
  _id: conversation._id,
  item: conversation.item,
  participants: conversation.participants,
});

exports.toMessageDto = (message, conversationId = null) => ({
  _id: message._id,
  sender:
    typeof message.sender === 'object' && message.sender?._id
      ? message.sender._id.toString()
      : message.sender.toString(),
  senderName: typeof message.sender === 'object' ? message.sender?.name : undefined,
  text: message.text,
  read: message.read,
  createdAt: message.createdAt,
  ...(conversationId ? { conversationId: conversationId.toString() } : {}),
});

exports.toMessagesResponse = (messages, conversationId = null) => ({
  messages: messages.map((message) => exports.toMessageDto(message, conversationId)),
});

exports.toNotificationDto = (notification, conversationId = null) => ({
  _id: notification._id,
  type: notification.type,
  title: notification.title,
  body: notification.body,
  itemId: notification.itemId,
  isRead: false,
  createdAt: notification.createdAt,
  ...(conversationId ? { conversationId } : {}),
});