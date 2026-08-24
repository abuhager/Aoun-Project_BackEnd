exports.toConversationListItem = (conversation, unreadCount = 0) => {
  // التأكد من استخلاص الحساب الآخر بشكل آمن تماماً لمنع ظهور "مستخدم غير معروف"
  const ownerObj = conversation.owner;
  const requesterObj = conversation.requester;

  return {
    _id: conversation._id?.toString() || conversation.id?.toString(),
    item: conversation.item
      ? {
          _id: conversation.item._id?.toString(),
          title: conversation.item.title,
          imageUrl: conversation.item.imageUrl,
          status: conversation.item.status,
        }
      : null,
    owner: ownerObj
      ? { 
          _id: ownerObj._id?.toString() || ownerObj.toString(), 
          name: ownerObj.name || "صاحب الغرض", 
          avatar: ownerObj.avatar || "" 
        }
      : null,
    requester: requesterObj
      ? { 
          _id: requesterObj._id?.toString() || requesterObj.toString(), 
          name: requesterObj.name || "مستلم عون", 
          avatar: requesterObj.avatar || "" 
        }
      : null,
    participants: (conversation.participants || []).map((p) =>
      p._id ? { _id: p._id.toString(), name: p.name, avatar: p.avatar } : { _id: p.toString() }
    ),
    lastMessage: conversation.lastMessage || "",
    lastMessageAt: conversation.lastMessageAt,
    updatedAt: conversation.updatedAt,
    unreadCount: Number(unreadCount) || 0,
  };
};

exports.toMessageDto = (message, conversationId) => ({
  _id: message._id?.toString(),
  conversationId: conversationId?.toString(),
  sender:
    typeof message.sender === "object" && message.sender !== null
      ? { _id: message.sender._id?.toString(), name: message.sender.name, avatar: message.sender.avatar }
      : message.sender?.toString(),
  text: message.text,
  createdAt: message.createdAt,
  read: message.read ?? false,
  ...(message.clientMessageId ? { correlationId: message.clientMessageId } : {}),
});

exports.toMessagesResponse = (messages, conversationId) => ({
  messages: (messages || []).map((m) => exports.toMessageDto(m, conversationId)),
});
