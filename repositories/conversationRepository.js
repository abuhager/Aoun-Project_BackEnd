const Conversation = require("../models/Conversation");
const Message = require("../models/Message");

const POPULATE_ITEM = "title images imageUrl";
const POPULATE_USER = "name avatar";

exports.findOrCreateConversation = async ({ itemId, owner, requester }) => {
  const participants = [owner, requester].sort();
  const conversation = await Conversation.findOneAndUpdate(
    { item: itemId, owner, requester },
    {
      $setOnInsert: {
        item: itemId,
        owner,
        requester,
        participants,
        lastMessage: "",
        lastMessageAt: null,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  )
  .populate("item", POPULATE_ITEM)
  .populate("owner", POPULATE_USER)
  .populate("requester", POPULATE_USER);

  return conversation;
};

exports.findConversationById = async (conversationId) => {
  const conversation = await Conversation.findById(conversationId)
    .populate("item", POPULATE_ITEM)
    .populate("owner", POPULATE_USER)
    .populate("requester", POPULATE_USER)
    .populate("participants", POPULATE_USER); // 👈 حقن الـ populate للمشاركين
    
  return conversation;
};

exports.findUserConversations = async (userId) => {
  const mongoose = require("mongoose");
  let oUserId;
  try { oUserId = new mongoose.Types.ObjectId(userId); } catch(e) { oUserId = userId; }

  return Conversation.find({
    $or: [
      { participants: oUserId },
      { owner: oUserId },
      { requester: oUserId }
    ]
  })
  .populate("item", POPULATE_ITEM)
  .populate("owner", POPULATE_USER)
  .populate("requester", POPULATE_USER)
  .populate("participants", POPULATE_USER) // 👈 حل العقدة: جلب بيانات أسماء المشاركين بالكامل
  .sort({ updatedAt: -1 })
  .lean();
};

exports.isParticipant = (conversation, userId) =>
  (conversation.participants || []).some(
    (p) => (p._id ? p._id : p).toString() === userId.toString()
  );

// الإصلاح الوقائي: دعم كلا المسميين لقطع الطريق تماماً على الـ undefined
exports.createMessage = async ({ conversationId, senderId, sender, text }) => {
  const finalSenderId = senderId || sender; 

  const message = await Message.create({
    conversation: conversationId,
    sender: finalSenderId,
    text,
    read: false,
  });

  await Conversation.findByIdAndUpdate(conversationId, {
    $set: {
      lastMessage: text.slice(0, 100),
      lastMessageAt: new Date(),
    },
  });

  return Message.findById(message._id).populate("sender", `${POPULATE_USER} _id`).lean();
};

exports.findMessagesPage = async (conversationId, { page = 1, limit = 30 } = {}) => {
  const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const skip = (safePage - 1) * safeLimit;

  const [messages, total] = await Promise.all([
    Message.find({ conversation: conversationId })
      .populate("sender", `${POPULATE_USER} _id`)
      .sort({ createdAt: -1 })
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

exports.findRecentMessages = async (conversationId, limit = 50) => {
  const messages = await Message.find({ conversation: conversationId })
    .populate("sender", `${POPULATE_USER} _id`)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  return messages.reverse();
};

exports.markMessagesRead = async (conversationId, userId) => {
  await Message.updateMany(
    { conversation: conversationId, sender: { $ne: userId }, read: false },
    { $set: { read: true } }
  );
};

exports.countUnreadForUser = async (conversationId, userId) => {
  const mongoose = require("mongoose");
  let oUserId;
  try { oUserId = new mongoose.Types.ObjectId(userId); } catch(e) { oUserId = userId; }

  return Message.countDocuments({
    conversation: conversationId,
    sender: { $ne: oUserId }, // 👈 التعديل الحاسم: إجبار المقارنة بـ ObjectId حقيقي
    read: false,
  });
};

/** حساب العداد لمجموعة محادثات (Batch) المعتمد عليه في القائمة الجانبية والـ Navbar */
exports.countUnreadForUserBatch = async (conversationIds, userId) => {
  const mongoose = require("mongoose");
  let oUserId;
  try { oUserId = new mongoose.Types.ObjectId(userId); } catch(e) { oUserId = userId; }

  // تحويل مصفوفة المعرفات أيضاً لضمان دقة الـ Aggregation
  const oConversationIds = (conversationIds || []).map(id => {
    try { return new mongoose.Types.ObjectId(id); } catch(e) { return id; }
  });

  const rows = await Message.aggregate([
    {
      $match: {
        conversation: { $in: oConversationIds },
        sender: { $ne: oUserId }, // 👈 نضمن استبعاد رسائلك الشخصية غصباً عن أي اختلاف أنواع
        read: false,
      },
    },
    { $group: { _id: "$conversation", count: { $sum: 1 } } },
  ]);

  return rows.reduce((map, r) => {
    map[r._id.toString()] = r.count;
    return map;
  }, {});
};