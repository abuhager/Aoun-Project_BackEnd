import conversationService from '../services/conversationService.js';
import catchAsync, { type AounRequest } from '../utils/asyncHandler.js';

const currentUserId = (req: AounRequest): string => String(req.user?.id ?? req.user?._id);

export const listConversations = catchAsync(async (req, res) => {
  const conversations = await conversationService.listConversationsLogic(currentUserId(req));

  res.status(200).json({
    status: 'success',
    results: conversations.length,
    data: conversations,
  });
});

export const getUnreadCount = catchAsync(async (req, res) => {
  const data = await conversationService.getUnreadCountLogic(currentUserId(req));
  res.status(200).json({ status: 'success', data });
});

export const openConversation = catchAsync(async (req, res) => {
  const data = await conversationService.openConversationLogic({
    itemId: String(req.body.itemId),
    userId: currentUserId(req),
    // donorId is accepted temporarily for clients that have not yet moved to targetUserId.
    targetUserId: req.body.targetUserId || req.body.donorId
      ? String(req.body.targetUserId ?? req.body.donorId)
      : null,
    io: req.app.get('io'),
  });

  res.status(data.isNew ? 201 : 200).json({ status: 'success', data });
});

export const getMessages = catchAsync(async (req, res) => {
  const data = await conversationService.getMessagesLogic({
    conversationId: req.params.conversationId,
    userId: currentUserId(req),
    page: req.query.page,
  });

  res.status(200).json({ status: 'success', ...data });
});

export const markConversationRead = catchAsync(async (req, res) => {
  const data = await conversationService.markConversationReadLogic({
    conversationId: req.params.conversationId,
    userId: currentUserId(req),
    io: req.app.get('io'),
  });

  res.status(200).json({ status: 'success', ...data });
});

export default { listConversations, getUnreadCount, openConversation, getMessages, markConversationRead };
