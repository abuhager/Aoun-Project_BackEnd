const asId = (value) => {
  if (!value) return null;
  return (value._id ?? value).toString();
};

const toNotificationDto = (notification) => {
  const source = notification?.toObject
    ? notification.toObject()
    : notification;

  if (!source) return null;

  return {
    _id:            asId(source._id),
    type:           source.type,
    title:          source.title,
    body:           source.body,
    itemId:         asId(source.itemId),
    conversationId: asId(source.conversationId),
    actionUrl:      source.actionUrl ?? null,
    metadata:       source.metadata ?? null,
    isRead:         Boolean(source.isRead),
    createdAt:      source.createdAt,
  };
};

module.exports = { toNotificationDto };
