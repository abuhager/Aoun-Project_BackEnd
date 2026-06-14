// socket/socketHandler.js
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const Conversation = require('../models/Conversation');
const Item = require('../models/Item');

let io;

// دالة جلب النطاقات المسموحة لـ CORS
function getAllowedOrigins() {
  return (process.env.ALLOWED_ORIGINS || process.env.CLIENT_URL || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

const initSocket = (httpServer) => {
  const allowedOrigins = getAllowedOrigins();

  io = new Server(httpServer, {
    cors: {
      origin(origin, cb) {
        if (!origin) return cb(null, true);
        if (allowedOrigins.includes(origin)) return cb(null, true);
        return cb(new Error(`CORS_ORIGIN_DENIED:${origin}`));
      },
      credentials: true,
    },
  });

  // ─── 1. برمجية التحقق من الهوية (Authentication Middleware) ───
   io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('AUTH_REQUIRED'));

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // ✅ [WARN-4 FIX] فحص exp صريح لتوضيح النية للفريق وإضافة طبقة دفاع
      // jwt.verify يتحقق من exp تلقائياً لكن التحقق الصريح يمنع الـ clock skew edge cases
      const nowSec = Math.floor(Date.now() / 1000);
      if (!decoded.exp || decoded.exp < nowSec) {
        return next(new Error('TOKEN_EXPIRED'));
      }

      socket.userId   = decoded.user.id;
      socket.userName = decoded.user.name;
      socket.userRole = decoded.user.role || 'user';

      next();
    } catch (err) {
      if (err.name === 'TokenExpiredError') return next(new Error('TOKEN_EXPIRED'));
      return next(new Error('INVALID_TOKEN'));
    }
  });
  // ─── 2. أحداث الاتصال وإدارة الغرف والمحادثات ───
  io.on('connection', (socket) => {
    
    // ✅ تلقائياً: ينضم المستخدم لغرفته الخاصة الآمنة لتلقي الإشعارات الشخصية
    socket.join(`user_${socket.userId}`);

    // حدث دخول محادثة خاصة بغرض معين
    socket.on('joinConversation', async ({ itemId }) => {
      try {
        const item = await Item.findById(itemId).select('donor bookedBy');
        if (!item) return socket.emit('error', { msg: 'الغرض غير موجود' });

        if (!item.bookedBy) {
          return socket.emit('error', { msg: 'لا يمكن فتح محادثة قبل وجود حجز' });
        }

        const uid = socket.userId.toString();
        const isDonor = item.donor.toString() === uid;
        const isBooker = item.bookedBy.toString() === uid;

        // ✅ حماية برمجية: منع أي مستخدم غريب من التجسس أو الدخول للمحادثة
        if (!isDonor && !isBooker) {
          return socket.emit('error', { msg: 'غير مصرح لك بدخول هذه المحادثة 🚫' });
        }

        // إيجاد المحادثة أو إنشاؤها إن لم تكن موجودة
        let conv = await Conversation.findOne({ item: itemId });
        if (!conv) {
          conv = await Conversation.create({
            item: itemId,
            participants: [item.donor, item.bookedBy],
          });
        }

        // جعل السوكيت ينضم لغرفة المحادثة المشتركة
        socket.join(`conv_${conv._id}`);

        // جلب آخر 50 رسالة فقط للأداء العالي
        const messages = conv.messages.slice(-50).map((m) => ({
          _id: m._id,
          sender: m.sender,
          text: m.text,
          read: m.read,
          createdAt: m.createdAt,
        }));

        // إرسال تأكيد الدخول مع الرسائل القديمة للعميل الحالي
        socket.emit('conversationJoined', {
          convId: conv._id,
          messages,
        });

        // تحديث الرسائل كمقروءة وإعلام الطرف الآخر
        await markRead(conv, socket.userId);
        io.to(`conv_${conv._id}`).emit('messagesRead', { by: socket.userId });
      } catch (err) {
        console.error('joinConversation Error:', err.message);
        socket.emit('error', { msg: 'خطأ في السيرفر' });
      }
    });

    // حدث إرسال رسالة جديدة
    socket.on('sendMessage', async ({ convId, text }) => {
      if (!text?.trim() || text.length > 1000) {
        return socket.emit('error', { msg: 'نص الرسالة غير صالح أو طويل جداً' });
      }

      try {
        const conv = await Conversation.findById(convId);
        if (!conv) return socket.emit('error', { msg: 'المحادثة غير موجودة' });

        // ✅ التحقق من أن المرسل هو جزء فعلي من أطراف المحادثة
        const isParticipant = conv.participants
          .map((p) => p.toString())
          .includes(socket.userId.toString());

        if (!isParticipant) {
          return socket.emit('error', { msg: 'غير مصرح لك بالإرسال في هذه المحادثة 🚫' });
        }

        const message = {
          sender: socket.userId, // ✅ الهوية من السيرفر وليست ممررة من الـ Client
          text: text.trim(),
          read: false,
          createdAt: new Date(),
        };

        conv.messages.push(message);
        conv.lastActivity = new Date();
        await conv.save();

        const savedMsg = conv.messages[conv.messages.length - 1];

        // بث الرسالة لجميع المتواجدين داخل غرفة المحادثة الحالية
        io.to(`conv_${convId}`).emit('newMessage', {
          _id: savedMsg._id,
          sender: socket.userId,
          senderName: socket.userName,
          text: savedMsg.text,
          read: false,
          createdAt: savedMsg.createdAt,
        });

        // إرسال إشعار فوري (Notification) للطرف الآخر في غرفته الخاصة في حال كان خارج المحادثة
        const otherId = conv.participants.find(
          (p) => p.toString() !== socket.userId.toString()
        );

        if (otherId) {
          io.to(`user_${otherId}`).emit('notification', {
            type: 'NEW_MESSAGE',
            convId,
            text: text.trim().slice(0, 60),
            sender: socket.userName,
          });
        }
      } catch (err) {
        console.error('sendMessage Error:', err.message);
        socket.emit('error', { msg: 'حدث خطأ أثناء إرسال الرسالة' });
      }
    });

    // ─── أحداث الكتابة (Typing Indicators) ───
    socket.on('typing', ({ convId }) => {
      socket.to(`conv_${convId}`).emit('userTyping', {
        userId: socket.userId,
        name: socket.userName,
      });
    });

    socket.on('stopTyping', ({ convId }) => {
      socket.to(`conv_${convId}`).emit('userStopTyping', {
        userId: socket.userId,
      });
    });

    // حدث قراءة الرسائل اليدوي
    socket.on('readMessages', async ({ convId }) => {
      try {
        const conv = await Conversation.findById(convId);
        if (!conv) return;

        await markRead(conv, socket.userId);
        io.to(`conv_${convId}`).emit('messagesRead', { by: socket.userId });
      } catch (err) {
        console.error('readMessages Error:', err.message);
      }
    });

    socket.on('disconnect', () => {
      // تنظيف تلقائي عند قطع الاتصال يتم بواسطة Socket.io
    });
  });

  return io;
};

// ─── دالة مساعدة لتحديث حالة القراءة ───
const markRead = async (conv, userId) => {
  let updated = false;

  conv.messages.forEach((m) => {
    // إذا لم تكن الرسالة من هذا المستخدم وكانت غير مقروءة، اجعلها مقروءة
    if (m.sender.toString() !== userId.toString() && !m.read) {
      m.read = true;
      updated = true;
    }
  });

  if (updated) {
    await conv.save();
  }
};

const getIO = () => {
  if (!io) throw new Error('Socket.io not initialized');
  return io;
};

module.exports = { initSocket, getIO };