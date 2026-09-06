import mongoose from 'mongoose';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import Notification from '../models/Notification.js';
import type { EntityId, RepositoryRecord } from './repositoryTypes.js';

const POPULATE_ITEM = 'title imageUrl status donor bookedBy';
const POPULATE_USER = 'name avatar';
const DEFAULT_MESSAGE_PAGE_SIZE = 50;

type ConversationPair = {
  itemId: EntityId;
  owner: EntityId;
  requester: EntityId;
};

type MessageCreatePayload = {
  conversationId: EntityId;
  senderId: EntityId;
  text: string;
  clientMessageId?: string | null;
};

type MessagePageOptions = { page?: number; limit?: number };

type PopulatableQuery = {
  populate: (path: string, fields: string) => PopulatableQuery;
};

const toObjectId = (value: EntityId) => (
  mongoose.isObjectIdOrHexString(value)
    ? new mongoose.Types.ObjectId(String(value))
    : value
);

const populateConversation = <T extends PopulatableQuery>(query: T): T => {
  query
    .populate('item', POPULATE_ITEM)
    .populate('owner', POPULATE_USER)
    .populate('requester', POPULATE_USER)
    .populate('participants', POPULATE_USER);
  return query;
};

const isDuplicateKeyError = (error: unknown): boolean => (
  typeof error === 'object'
  && error !== null
  && 'code' in error
  && error.code === 11000
);

export { DEFAULT_MESSAGE_PAGE_SIZE };

export const findConversationByPair = async ({ itemId, owner, requester }: ConversationPair) => (
  populateConversation(Conversation.findOne({ item: itemId, owner, requester })).lean()
);

export const findOrCreateConversation = async ({ itemId, owner, requester }: ConversationPair) => {
  const participants = [owner.toString(), requester.toString()].sort();

  return populateConversation(Conversation.findOneAndUpdate(
    { item: itemId, owner, requester },
    {
      $setOnInsert: {
        item: itemId,
        owner,
        requester,
        participants,
        lastMessage: '',
        lastMessageAt: null,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  )).lean();
};

export const findConversationById = async (conversationId: EntityId) => (
  populateConversation(Conversation.findById(conversationId)).lean()
);

export const findUserConversations = async (userId: EntityId) => (
  populateConversation(Conversation.find({ participants: toObjectId(userId) }))
    .sort({ lastMessageAt: -1, updatedAt: -1 })
    .lean()
);

export const countUnreadForUser = async (userId: EntityId) => {
  const actualUserId = toObjectId(userId);
  const conversationIds = (await Conversation.distinct(
    '_id',
    { participants: actualUserId }
  )) as Array<string | mongoose.Types.ObjectId>;

  if (!conversationIds.length) return 0;

  return Message.countDocuments({
    conversation: { $in: conversationIds },
    sender: { $ne: actualUserId },
    read: false,
  });
};

export const isParticipant = (conversation: RepositoryRecord | null, userId: EntityId) => (
  (Array.isArray(conversation?.participants) ? conversation.participants : []).some(
    (participant: unknown) => {
    const record = typeof participant === 'object' && participant !== null
      ? participant as RepositoryRecord
      : null;
    const participantId = record?._id ?? participant;
    return String(participantId) === String(userId);
  })
);

export const createMessage = async ({
  conversationId,
  senderId,
  text,
  clientMessageId,
}: MessageCreatePayload) => {
  const filter = clientMessageId
    ? { conversation: conversationId, sender: senderId, clientMessageId }
    : null;

  if (filter) {
    const existing = await Message.findOne(filter)
      .populate('sender', `${POPULATE_USER} _id`)
      .lean();
    if (existing) return { message: existing, created: false };
  }

  let message;
  try {
    message = (await Message.create({
      conversation: conversationId,
      sender: senderId,
      text,
      clientMessageId: clientMessageId || null,
      read: false,
    })).toObject();
  } catch (error: unknown) {
    if (!isDuplicateKeyError(error) || !filter) throw error;
    const existing = await Message.findOne(filter)
      .populate('sender', `${POPULATE_USER} _id`)
      .lean();
    return { message: existing, created: false };
  }

  await Conversation.findByIdAndUpdate(conversationId, {
    $set: {
      lastMessage: message.text.slice(0, 100),
      lastMessageAt: message.createdAt,
    },
  });

  const populatedMessage = await Message.findById(message._id)
    .populate('sender', `${POPULATE_USER} _id`)
    .lean();
  return { message: populatedMessage, created: true };
};

export const findMessagesPage = async (
  conversationId: EntityId,
  { page = 1, limit = DEFAULT_MESSAGE_PAGE_SIZE }: MessagePageOptions = {}
) => {
  const safeLimit = Math.min(Math.max(Number(limit) || DEFAULT_MESSAGE_PAGE_SIZE, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const skip = (safePage - 1) * safeLimit;

  const [messages, total] = await Promise.all([
    Message.find({ conversation: conversationId })
      .populate('sender', `${POPULATE_USER} _id`)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    Message.countDocuments({ conversation: conversationId }),
  ]);

  return {
    messages: messages.reverse(),
    total,
    page: safePage,
    totalPages: Math.ceil(total / safeLimit),
  };
};

export const markMessagesRead = async (conversationId: EntityId, userId: EntityId) => {
  const result = await Message.updateMany(
    { conversation: conversationId, sender: { $ne: toObjectId(userId) }, read: false },
    { $set: { read: true } }
  );
  return result.modifiedCount || 0;
};

export const markMessageNotificationsRead = async (
  conversationId: EntityId,
  userId: EntityId
) => {
  const result = await Notification.updateMany(
    {
      user: toObjectId(userId),
      conversationId: toObjectId(conversationId),
      type: 'new_message',
      isRead: false,
    },
    { $set: { isRead: true } }
  );
  return result.modifiedCount || 0;
};

export const countUnreadForUserBatch = async (
  conversationIds: EntityId[],
  userId: EntityId
) => {
  if (!conversationIds.length) return {};

  const rows = await Message.aggregate([
    {
      $match: {
        conversation: { $in: conversationIds.map(toObjectId) },
        sender: { $ne: toObjectId(userId) },
        read: false,
      },
    },
    { $group: { _id: '$conversation', count: { $sum: 1 } } },
  ]);

  return rows.reduce((map: Record<string, number>, row: RepositoryRecord) => {
    map[String(row._id)] = Number(row.count) || 0;
    return map;
  }, {} as Record<string, number>);
};

export default { DEFAULT_MESSAGE_PAGE_SIZE, findConversationByPair, findOrCreateConversation, findConversationById, findUserConversations, countUnreadForUser, isParticipant, createMessage, findMessagesPage, markMessagesRead, markMessageNotificationsRead, countUnreadForUserBatch };
