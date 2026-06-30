const catchAsync = require("../utils/asyncHandler");
const conversationService = require("../services/conversationService");

const uid = (req) => req.user?.id || req.user?._id?.toString();

exports.listConversations = catchAsync(async (req, res) => {
  const data = await conversationService.listConversationsLogic(uid(req));
  res.status(200).json({
    status: "success",
    results: data.length,
    data,
  });
});

exports.openConversation = catchAsync(async (req, res) => {
  const data = await conversationService.openConversationLogic({
    itemId: req.body.itemId,
    userId: uid(req),
    io: req.io,
  });

  res.status(200).json({
    status: "success",
    data,
  });
});

exports.getMessages = catchAsync(async (req, res) => {
  const data = await conversationService.getMessagesLogic({
    conversationId: req.params.conversationId,
    userId: uid(req),
    io: req.io,
    page: req.query.page || 1,
  });

  res.status(200).json({
    status: "success",
    ...data,
  });
});

exports.sendMessage = catchAsync(async (req, res) => {
  const data = await conversationService.sendMessageLogic({
    conversationId: req.params.conversationId,
    text: req.body.text,
    correlationId: req.body.correlationId,
    user: {
      id: uid(req),
      name: req.user?.name,
    },
    io: req.io,
  });

  res.status(201).json({
    status: "success",
    ...data,
  });
});

exports.markConversationRead = catchAsync(async (req, res) => {
  const data = await conversationService.markConversationReadLogic({
    conversationId: req.params.conversationId,
    userId: uid(req),
    io: req.io,
  });

  res.status(200).json({
    status: "success",
    ...data,
  });
});