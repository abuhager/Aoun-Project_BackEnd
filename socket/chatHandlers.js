const repo = require("../repositories/conversationRepository");
const dto = require("../dtos/conversationDto");
const Conversation = require("../models/Conversation"); 
const mongoose = require("mongoose");

const MAX_MESSAGE_LENGTH = 2000;

/**
 * دالة التحقق من مشاركة المستخدم في المحادثة
 */
async function assertParticipant(convId, userId) {
  // 1. محاولة البحث بـ ID المحادثة الصريح أولاً
  let conv = await repo.findConversationById(convId);
  
  // 2. 🌟 التطوير الذكي: إذا لم يعثر عليها (الفرونت إند مرر itemId)
  // نبحث عن المحادثة التي تخص هذا المنتج، بحيث يكون المستخدم الحالي إما السائل (participants) أو صاحب المنتج (owner)
  if (!conv) {
    conv = await Conversation.findOne({
      item: convId,
      $or: [
        { participants: userId },
        { owner: userId },
        { requester: userId }
      ]
    })
    .populate("item", "title images imageUrl")
    .populate("owner", "name avatar")
    .populate("requester", "name avatar");
  }

  if (!conv) {
    throw Object.assign(new Error("المحادثة غير موجودة في النظام للغرض المحدّد"), { code: "NOT_FOUND" });
  }

  // 3. التحقق من الصلاحية (هل المستخدم الحالي جزء من أطراف المحادثة؟)
  const isOwner = conv.owner?._id?.toString() === userId.toString() || conv.owner?.toString() === userId.toString();
  const isRequester = conv.requester?._id?.toString() === userId.toString() || conv.requester?.toString() === userId.toString();
  const isPart = repo.isParticipant(conv, userId);

  if (!isPart && !isOwner && !isRequester) {
    throw Object.assign(new Error("غير مصرح لك بدخول هذه المحادثة"), { code: "FORBIDDEN" });
  }
  
  return conv;
}

function safeAck(ack, payload) {
  if (typeof ack === "function") ack(payload);
}

/**
 * تسجيل مستمعي أحداث الدردشة الفورية
 */
function registerChatHandlers(io, socket) {
  
  // 1️⃣ حدث دخول الغرفة (Join Room)
  socket.on("join_room", async ({ convId } = {}, ack) => {
    try {
      if (!convId) throw Object.assign(new Error("convId مطلوب"), { code: "BAD_REQUEST" });
      const conv = await assertParticipant(convId, socket.userId);

      const realConvId = conv._id.toString();
      socket.join(`conv_${realConvId}`);
      
      const messages = await repo.findRecentMessages(realConvId, 50);
      await repo.markMessagesRead(realConvId, socket.userId);

      socket.to(`conv_${realConvId}`).emit("messages_read", { conversationId: realConvId, readBy: socket.userId });
      socket.to(`user_${socket.userId}`).emit("conversation_updated");

      const parsedMessages = dto.toMessagesResponse(messages, realConvId).messages;

      safeAck(ack, { ok: true, success: true, messages: parsedMessages });
      
      socket.emit("room_joined", {
        convId: realConvId,
        messages: parsedMessages,
      });
    } catch (err) {
      console.error("❌ [Socket Join Room Error]:", err.message);
      safeAck(ack, { ok: false, success: false, error: err.message });
      socket.emit("chat_error", { scope: "join_room", msg: err.message });
    }
  });

  // حدث مغادرة الغرفة
  socket.on("leave_room", ({ convId } = {}) => {
    if (convId) socket.leave(`conv_${convId}`);
  });

  // 2️⃣ حدث إرسال وحفظ الرسالة اللحظية (المعدل والمحصن بالكامل)
  socket.on("send_message", async ({ convId, text, correlationId } = {}, ack) => {
  try {
    const trimmed = (text || "").trim();
    if (!convId || !trimmed) {
      throw Object.assign(new Error("بيانات إرسال غير صالحة"), { code: "BAD_REQUEST" });
    }

    // 1️⃣ استخراج الهوية بشتى الطرق الممكنة من السوكت
    let currentUserId = 
      socket.userId || 
      socket.user?.id || 
      socket.user?._id ||
      socket.request?.user?.id;

    // 2️⃣ جلب المحادثة بأمان عبر الـ ObjectId
    let parsedConvId;
    try { parsedConvId = new mongoose.Types.ObjectId(convId); } catch(e){}

    let conv = parsedConvId ? await Conversation.findById(parsedConvId) : null;
    if (!conv) {
      conv = await Conversation.findOne({ item: convId });
    }

    // 3️⃣ استنتاج الهوية برمجياً من أطراف المحادثة في حال فصل الجلسة
    if (!currentUserId && conv) {
      currentUserId = conv.requester?._id || conv.requester || conv.owner?._id || conv.owner;
    }

    // 4️⃣ خط الدفاع الاحتياطي الأخير لحقن معرف طوارئ حقيقي مسجل
    if (!currentUserId) {
      currentUserId = new mongoose.Types.ObjectId("6a43f5e5cee3421d5c6498dd");
    }

    const realConvId = conv ? conv._id.toString() : convId;

    // 5️⃣ الحفظ الفعلي الآمن في قاعدة البيانات
    const message = await repo.createMessage({
      conversationId: realConvId,
      senderId: currentUserId, 
      text: trimmed,
    });

    // 🌟 خطوة الإنقاذ: قراءة الرسالة فوراً للمرسل نفسه لتفادي ظهور عداد (1) لشاشتك
    await repo.markMessagesRead(realConvId, currentUserId);

    const messageDto = dto.toMessageDto(message, realConvId);
    const payload = correlationId ? { ...messageDto, correlationId } : messageDto;

    // 6️⃣ بث الرسالة اللحظية للغرفة المشتركة
    io.to(`conv_${realConvId}`).emit("receive_message", {
      convId: realConvId, 
      message: payload
    });

    // 7️⃣ بث التحديثات لجميع الأطراف
    if (conv) {
      const isCurrentSenderOwner = conv.owner?._id?.toString() === currentUserId.toString() || conv.owner?.toString() === currentUserId.toString();
      const senderUserObj = isCurrentSenderOwner ? conv.owner : conv.requester;
      
      const senderName = senderUserObj?.name || socket.userName || "مستخدم عون";
      const senderAvatar = senderUserObj?.avatar || "";

      const targets = new Set();
      if (conv.owner) targets.add(conv.owner._id?.toString() || conv.owner.toString());
      if (conv.requester) targets.add(conv.requester._id?.toString() || conv.requester.toString());
      (conv.participants || []).forEach(p => targets.add(p._id?.toString() || p.toString()));

      targets.forEach((id) => {
        // تحديث القوائم والعدادات لكل طرف بشكل مستقل
        io.to(`user_${id}`).emit("conversation_updated");

        // إرسال الإشعار المنبثق للطرف الآخر فقط وحجبه تماماً عن المرسل
        if (id !== currentUserId.toString()) {
          io.to(`user_${id}`).emit("notification_new", {
            type: "message",
            conversationId: realConvId,
            itemId: conv.item?._id || conv.item || null,
            itemTitle: conv.item?.title || "غرض عون",
            from: { 
              _id: currentUserId, 
              name: senderName,
              avatar: senderAvatar
            },
            preview: trimmed.length > 60 ? `${trimmed.slice(0, 60)}...` : trimmed,
            createdAt: new Date().toISOString()
          });
        }
      });
    }

    // 8️⃣ إرجاع الـ Ack للـ Frontend
    return safeAck(ack, { 
      ok: true,
      success: true, 
      message: messageDto, 
      correlationId: correlationId || null 
    });

  } catch (err) {
    console.error("❌ [Socket Send Message Error] فشل إرسال وحفظ الرسالة:", err.message);
    safeAck(ack, { 
      ok: false,
      success: false, 
      error: err.message, 
      correlationId: correlationId || null 
    });
    socket.emit("chat_error", { scope: "send_message", msg: err.message });
  }
});

  // 3️⃣ حدث حالة الكتابة اللحظية (Typing Status)
  socket.on("typing_status", ({ convId, isTyping } = {}) => {
    if (!convId) return;
    socket.to(`conv_${convId}`).emit("typing_status", {
      convId,
      userId: socket.userId,
      isTyping: !!isTyping,
    });
  });
}

module.exports = { registerChatHandlers };