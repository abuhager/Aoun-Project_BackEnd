import { toId, toPlainRecord } from './dtoTypes.js';

const asId = toId;

const toNotificationDto = (notification: unknown) => {
  const source = toPlainRecord(notification);
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

export { toNotificationDto };
export default { toNotificationDto };
