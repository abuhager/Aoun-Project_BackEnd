import { asRecord, toId, toPlainRecord } from './dtoTypes.js';

export const toConversationListItem = (rawConversation: unknown, unreadCount = 0) => {
  const conversation = toPlainRecord(rawConversation);
  if (!conversation) return null;

  // التأكد من استخلاص الحساب الآخر بشكل آمن تماماً لمنع ظهور "مستخدم غير معروف"
  const ownerObj = asRecord(conversation.owner);
  const requesterObj = asRecord(conversation.requester);
  const item = asRecord(conversation.item);

  return {
    _id: toId(conversation._id ?? conversation.id),
    item: item
      ? {
          _id: toId(item),
          title: item.title,
          imageUrl: item.imageUrl,
          status: item.status,
        }
      : null,
    owner: ownerObj
      ? { 
          _id: toId(ownerObj),
          name: ownerObj.name || "صاحب الغرض", 
          avatar: ownerObj.avatar || "" 
        }
      : null,
    requester: requesterObj
      ? { 
          _id: toId(requesterObj),
          name: requesterObj.name || "مستلم عون", 
          avatar: requesterObj.avatar || "" 
        }
      : null,
    participants: Array.isArray(conversation.participants)
      ? conversation.participants.map((rawParticipant: unknown) => {
          const participant = asRecord(rawParticipant);
          return participant
            ? {
                _id: toId(participant),
                ...(participant.name !== undefined ? { name: participant.name } : {}),
                ...(participant.avatar !== undefined ? { avatar: participant.avatar } : {}),
              }
            : { _id: toId(rawParticipant) };
        })
      : [],
    lastMessage: conversation.lastMessage || "",
    lastMessageAt: conversation.lastMessageAt,
    updatedAt: conversation.updatedAt,
    unreadCount: Number(unreadCount) || 0,
  };
};

export const toMessageDto = (rawMessage: unknown, conversationId: unknown) => {
  const message = toPlainRecord(rawMessage);
  if (!message) return null;
  const sender = asRecord(message.sender);

  return ({
  _id: toId(message._id),
  conversationId: toId(conversationId),
  sender:
    sender
      ? { _id: toId(sender), name: sender.name, avatar: sender.avatar }
      : toId(message.sender),
  text: message.text,
  createdAt: message.createdAt,
  read: message.read ?? false,
  ...(message.clientMessageId ? { correlationId: message.clientMessageId } : {}),
  });
};

export const toMessagesResponse = (messages: unknown, conversationId: unknown) => ({
  messages: Array.isArray(messages)
    ? messages.map((message: unknown) => toMessageDto(message, conversationId))
    : [],
});

export default { toConversationListItem, toMessageDto, toMessagesResponse };
