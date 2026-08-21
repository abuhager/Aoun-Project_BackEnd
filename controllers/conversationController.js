// backend/controllers/conversationController.js

const mongoose = require("mongoose"); // 👈 السطر المصلح والمنقذ للانهيار!
const conversationService = require("../services/conversationService");
const Conversation = require("../models/Conversation");
const conversationDto = require("../dtos/conversationDto");
const catchAsync = require("../utils/asyncHandler");

const uid = (req) => req.user?.id || req.user?._id?.toString();

// 1️⃣ دالة جلب قائمة المحادثات
exports.listConversations = catchAsync(async (req, res) => {
  // جلب المصفوفة الصافية مباشرة من الـ Service
  const conversations = await conversationService.listConversationsLogic(uid(req));
  
  // التأكد من معالجة البيانات كمصفوفة مباشرة دون البحث عن حقل .conversations
  const mappedConversations = (conversations || []).map((conv) =>
    conversationDto.toConversationListItem(conv, conv.unreadCount || 0)
  );

  res.status(200).json({
    status: "success",
    results: mappedConversations.length,
    data: mappedConversations
  });
});

// 2️⃣ دالة فتح أو جلب المحادثة (الإصدار الفولاذي الشامل)
exports.openConversation = async (req, res, next) => {
  try {
    const userId = uid(req);
    const { itemId, donorId } = req.body;

    if (!itemId || !donorId) {
      return res.status(400).json({ status: "fail", message: "بيانات إرسال غير صالحة" });
    }

    // أ) تحويل المعرفات صراحة إلى ObjectIds لضمان دقة الاستعلام ومطابقة الـ Unique Index في MongoDB
    const queryItem = new mongoose.Types.ObjectId(itemId);
    const queryOwner = new mongoose.Types.ObjectId(donorId);
    const queryRequester = new mongoose.Types.ObjectId(userId);

    // ب) الفحص الوقائي الصارم: نبحث عن وجود السجل الفعلي قبل محاولة ضرب الـ Service أو الـ Upsert
    const existingConv = await Conversation.findOne({
      item: queryItem,
      owner: queryOwner,
      requester: queryRequester
    })
    .populate("item", "title images imageUrl")
    .populate("owner", "name avatar")
    .populate("requester", "name avatar");

    // ج) إذا وُجدت، اقطع الطريق فوراً ورجّع الاستجابة بـ 200 (مستحيل يمر للـ errorHandler)
    if (existingConv) {
      return res.status(200).json({
        status: "success",
        data: {
          conversation: conversationDto.toConversationListItem(existingConv, 0),
          isNew: false
        }
      });
    }

    // د) إذا لم تكن موجودة نهائياً، نطلب إنشائها
    const data = await conversationService.openConversationLogic({
      itemId,
      donorId,
      userId,
      io: req.app.get('io'),
    });

    return res.status(200).json({ status: "success", data });

  } catch (error) {
    // 🛡️ خط دفاع الطوارئ الأخير: صد خطأ التكرار إذا حدث تزامن Race Condition لحظي
    if (error.code === 11000 || error.message.includes("E11000") || error.statusCode === 409 || error.code === 'DUPLICATE_KEY') {
      console.log("🛡️ [Controller - Critical Catch] تم اعتراض الـ Duplicate، تصفية الاستجابة بسلام...");
      
      try {
        const safetyConv = await Conversation.findOne({
          item: new mongoose.Types.ObjectId(req.body.itemId),
          owner: new mongoose.Types.ObjectId(req.body.donorId),
          requester: new mongoose.Types.ObjectId(uid(req))
        })
        .populate("item", "title images imageUrl")
        .populate("owner", "name avatar")
        .populate("requester", "name avatar");

        if (safetyConv) {
          return res.status(200).json({
            status: "success",
            data: {
              conversation: conversationDto.toConversationListItem(safetyConv, 0),
              isNew: false
            }
          });
        }
      } catch (innerErr) {
        return next(innerErr);
      }
    }
    
    return next(error);
  }
};

// 3️⃣ دالة جلب الرسائل
exports.getMessages = catchAsync(async (req, res) => {
  const data = await conversationService.getMessagesLogic({
    conversationId: req.params.conversationId,
    userId: uid(req),
    page: req.query.page || 1,
  });
  res.status(200).json({ status: "success", ...data });
});

// 4️⃣ دالة تعيين الرسائل كمقروءة
exports.markConversationRead = catchAsync(async (req, res) => {
  const data = await conversationService.markConversationReadLogic({
    conversationId: req.params.conversationId,
    userId: uid(req),
    io: req.app.get('io'),
  });
  res.status(200).json({ status: "success", ...data });
});
