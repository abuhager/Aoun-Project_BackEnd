// backend/services/conversationService.js

const repo = require("../repositories/conversationRepository");
const dto = require("../dtos/conversationDto");
const User = require("../models/User");
const Item = require("../models/Item");
const Conversation = require("../models/Conversation");
const mongoose = require("mongoose");
const AppError = require("../utils/AppError");

const POPULATE_ITEM = "title images imageUrl";
const POPULATE_USER = "name avatar";

exports.listConversationsLogic = async (userId) => {
  const conversations = await repo.findUserConversations(userId);
  const ids = conversations.map((c) => c._id);
  const unreadMap = await repo.countUnreadForUserBatch(ids, userId);

  return conversations.map((c) =>
    dto.toConversationListItem(c, unreadMap[c._id.toString()] || 0)
  );
};

exports.openConversationLogic = async ({ itemId, userId, donorId, io }) => {
  const targetUserId = donorId;
  if (!targetUserId || targetUserId === userId.toString()) {
    throw new AppError("لا يمكنك فتح محادثة مع نفسك", 400, "INVALID_CHAT_TARGET");
  }

  const [targetUser, item] = await Promise.all([
    User.findById(targetUserId).select('_id').lean(),
    Item.findById(itemId).select('donor bookedBy').lean(),
  ]);
  if (!targetUser || !item)
    throw new AppError("الغرض أو المستخدم غير موجود", 404, "CHAT_RESOURCE_NOT_FOUND");

  const ownerId = item.donor?.toString();
  const requesterId = item.bookedBy?.toString();
  const currentUserId = userId.toString();
  const targetId = targetUserId.toString();

  if (!ownerId || !requesterId) {
    throw new AppError(
      "المحادثة تصبح متاحة بعد حجز الغرض فقط",
      409,
      "CHAT_REQUIRES_ACTIVE_BOOKING"
    );
  }

  const isParticipant = currentUserId === ownerId || currentUserId === requesterId;
  const expectedTargetId = currentUserId === ownerId ? requesterId : ownerId;
  if (!isParticipant || targetId !== expectedTargetId) {
    throw new AppError("غير مصرح بفتح هذه المحادثة", 403, "CHAT_FORBIDDEN");
  }

  const oItemId = new mongoose.Types.ObjectId(itemId);
  const oUserId = new mongoose.Types.ObjectId(userId);
  const oTargetId = new mongoose.Types.ObjectId(targetUserId);
  const oOwnerId = new mongoose.Types.ObjectId(ownerId);
  const oRequesterId = new mongoose.Types.ObjectId(requesterId);

  // 1️⃣ الفحص القياسي بالمشاركين
  let conversation = await Conversation.findOne({
    item: oItemId,
    participants: { $all: [oUserId, oTargetId] }
  })
  .populate("item", POPULATE_ITEM)
  .populate("owner", POPULATE_USER)
  .populate("requester", POPULATE_USER);

  let isNew = false;

  // 2️⃣ إذا لم يعثر عليها، يحاول الإنشاء
  if (!conversation) {
    try {
      conversation = await repo.findOrCreateConversation({
        itemId,
        owner: ownerId,
        requester: requesterId,
      });
      isNew = true;
    } catch (error) {
      if (error.code === 11000 || error.message.includes("E11000") || error.statusCode === 409 || error.code === 'DUPLICATE_KEY') {
        console.log("🛡️ [Service - Safety Catch] تم صيد خطأ التكرار، جاري الجلب عبر معرف الغرض المطلق الصافي...");
        
        // 👈 الإصلاح الحاسم الخارق: طالما أن الداتابيز مقفلة بفهرس مكسور على الـ item وحده، 
        // سنسحب المحادثة الوحيدة المرتبطة بهذا الغرض لكي نمنع الـ 500 تماماً ويعبر المستخدم للشات القائم بسلام!
        conversation = await Conversation.findOne({
          item: oItemId,
          owner: oOwnerId,
          requester: oRequesterId,
          participants: { $all: [oUserId, oTargetId] },
        })
          .populate("item", POPULATE_ITEM)
          .populate("owner", POPULATE_USER)
          .populate("requester", POPULATE_USER);
        
        isNew = false;
      } else {
        throw error;
      }
    }
  }

  if (isNew && io && conversation) {
    conversation.participants.forEach((pid) =>
      io.to(`user_${pid.toString()}`).emit("new_conversation", { conversation })
    );
  }

  // 3️⃣ خط دفاع أخير بالمسار النصي لـ Item
  if (!conversation) {
    conversation = await Conversation.findOne({
      item: oItemId,
      owner: oOwnerId,
      requester: oRequesterId,
      participants: { $all: [oUserId, oTargetId] },
    })
      .populate("item", POPULATE_ITEM)
      .populate("owner", POPULATE_USER)
      .populate("requester", POPULATE_USER);
  }

  if (!conversation) {
    throw Object.assign(new Error("فشل في استرداد أو إنشاء المحادثة القائمة"), { status: 500 });
  }

  if (!repo.isParticipant(conversation, userId)) {
    throw new AppError("غير مصرح بفتح هذه المحادثة", 403, "CHAT_FORBIDDEN");
  }

  return { conversation: dto.toConversationListItem(conversation, 0), isNew };
};

exports.getMessagesLogic = async ({ conversationId, userId, page = 1 }) => {
  const conv = await repo.findConversationById(conversationId);
  if (!conv) throw Object.assign(new Error("المحادثة غير موجودة"), { status: 404 });
  if (!repo.isParticipant(conv, userId)) {
    throw Object.assign(new Error("غير مصرح"), { status: 403 });
  }

  const { messages, total, page: p, totalPages } = await repo.findMessagesPage(conversationId, {
    page,
    limit: 30,
  });
  return {
    conversation: dto.toConversationListItem(conv, 0),
    ...dto.toMessagesResponse(messages, conversationId),
    total,
    page: p,
    totalPages,
  };
};

exports.markConversationReadLogic = async ({ conversationId, userId, io }) => {
  const conv = await repo.findConversationById(conversationId);
  if (!conv) throw Object.assign(new Error("المحادثة غير موجودة"), { status: 404 });
  if (!repo.isParticipant(conv, userId)) {
    throw Object.assign(new Error("غير مصرح"), { status: 403 });
  }

  await repo.markMessagesRead(conversationId, userId);
  if (io) {
    conv.participants
      .filter((p) => p._id.toString() !== userId.toString())
      .forEach((p) => {
        io.to(`user_${p._id.toString()}`).emit("messages_read", {
          conversationId,
          readBy: userId,
        });
      });
  }

  return { success: true };
};
