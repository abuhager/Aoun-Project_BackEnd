const { Server } = require('socket.io');
const jwt          = require('jsonwebtoken');
const Conversation = require('../models/Conversation');
const Message      = require('../models/Message');
const Item         = require('../models/Item');

let io;

function getAllowedOrigins() {
  return (process.env.ALLOWED_ORIGINS || process.env.CLIENT_URL || '')
    .split(',').map((o) => o.trim()).filter(Boolean);
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

  // ── 1. Auth Middleware ────────────────────────────────────────────────────
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('AUTH_REQUIRED'));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const nowSec  = Math.floor(Date.now() / 1000);
      if (!decoded.exp || decoded.exp < nowSec) return next(new Error('TOKEN_EXPIRED'));
      socket.userId   = decoded.user.id;
      socket.userName = decoded.user.name;
      socket.userRole = decoded.user.role || 'user';
      next();
    } catch (err) {
      return next(new Error(err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN'));
    }
  });

  // ── 2. Connection ─────────────────────────────────────────────────────────
  io.on('connection', (socket) => {

    // غرفة شخصية للإشعارات
    socket.join(`user_${socket.userId}`);

    // ── joinConversation ─────────────────────────────────────────────────
    // يقبل { itemId } أو { convId } أو كليهما
    socket.on('joinConversation', async ({ itemId, convId }) => {
      try {
        let conv;

        if (convId) {
          // إذا عنده convId مباشرة — أسرع
          conv = await Conversation.findById(convId).select('participants item');
        } else if (itemId) {
          // تحقق من الـ Item أولاً
          const item = await Item.findById(itemId).select('donor bookedBy status');
          if (!item)
            return socket.emit('error', { msg: 'الغرض غير موجود' });
          if (!item.bookedBy || !['محجوز', 'تم التسليم'].includes(item.status))
            return socket.emit('error', { msg: 'لا يمكن فتح محادثة قبل وجود حجز نشط' });

          const uid      = socket.userId.toString();
          const isDonor  = item.donor.toString()    === uid;
          const isBooker = item.bookedBy.toString() === uid;
          if (!isDonor && !isBooker)
            return socket.emit('error', { msg: 'غير مصرح لك بدخول هذه المحادثة 🚫' });

          conv = await Conversation.findOne({ item: itemId }).select('participants item');
          if (!conv) {
            conv = await Conversation.create({
              item:         itemId,
              participants: [item.donor, item.bookedBy],
            });
          }
        } else {
          return socket.emit('error', { msg: 'itemId أو convId مطلوب' });
        }

        if (!conv) return socket.emit('error', { msg: 'المحادثة غير موجودة' });

        // تحقق من الصلاحية
        const isParticipant = conv.participants
          .map((p) => p.toString())
          .includes(socket.userId.toString());
        if (!isParticipant)
          return socket.emit('error', { msg: 'غير مصرح لك بدخول هذه المحادثة 🚫' });

        socket.join(`conv_${conv._id}`);

        // جلب آخر 50 رسالة من Message collection المنفصل
        const messages = await Message.find({ conversation: conv._id })
          .populate('sender', 'name avatar _id')
          .sort({ createdAt: -1 })
          .limit(50)
          .lean()
          .then((msgs) => msgs.reverse()); // الأقدم أولاً للعرض

        socket.emit('conversationJoined', { convId: conv._id, messages });

        // علّم الرسائل مقروءة
        await markRead(conv._id, socket.userId);
        io.to(`conv_${conv._id}`).emit('messagesRead', { by: socket.userId });

      } catch (err) {
        console.error('[joinConversation]', err.message);
        socket.emit('error', { msg: 'خطأ في السيرفر' });
      }
    });

    // ── sendMessage ──────────────────────────────────────────────────────
    socket.on('sendMessage', async ({ convId, text }) => {
      if (!text?.trim() || text.length > 1000)
        return socket.emit('error', { msg: 'نص الرسالة غير صالح أو طويل جداً' });

      try {
        const conv = await Conversation.findById(convId).select('participants');
        if (!conv) return socket.emit('error', { msg: 'المحادثة غير موجودة' });

        const isParticipant = conv.participants
          .map((p) => p.toString())
          .includes(socket.userId.toString());
        if (!isParticipant)
          return socket.emit('error', { msg: 'غير مصرح لك بالإرسال في هذه المحادثة 🚫' });

        // ✅ حفظ في Message collection المنفصل (متوافق مع conversationRepository)
        const newMessage = await Message.create({
          conversation: convId,
          sender:       socket.userId,
          text:         text.trim(),
          read:         false,
        });

        // تحديث lastMessage في Conversation
        await Conversation.findByIdAndUpdate(convId, {
          $set: { lastMessage: newMessage._id, lastActivity: new Date() },
          $inc: { unreadCount: 1 },
        });

        const populated = await Message.findById(newMessage._id)
          .populate('sender', 'name avatar _id')
          .lean();

        // ✅ اسم الحدث 'message:new' — متوافق مع useChat.ts
        io.to(`conv_${convId}`).emit('message:new', {
          conversationId: convId,
          message: populated,
        });

        // إشعار للطرف الآخر في غرفته الشخصية
        const otherId = conv.participants.find(
          (p) => p.toString() !== socket.userId.toString()
        );
        if (otherId) {
          io.to(`user_${otherId}`).emit('notification', {
            type:   'NEW_MESSAGE',
            convId,
            text:   text.trim().slice(0, 60),
            sender: socket.userName,
          });
        }

      } catch (err) {
        console.error('[sendMessage]', err.message);
        socket.emit('error', { msg: 'حدث خطأ أثناء إرسال الرسالة' });
      }
    });

    // ── Typing ───────────────────────────────────────────────────────────
    socket.on('typing', ({ convId }) => {
      socket.to(`conv_${convId}`).emit('userTyping', {
        userId: socket.userId,
        name:   socket.userName,
      });
    });

    socket.on('stopTyping', ({ convId }) => {
      socket.to(`conv_${convId}`).emit('userStopTyping', { userId: socket.userId });
    });

    // ── readMessages ─────────────────────────────────────────────────────
    socket.on('readMessages', async ({ convId }) => {
      try {
        await markRead(convId, socket.userId);
        io.to(`conv_${convId}`).emit('messagesRead', { by: socket.userId });
      } catch (err) {
        console.error('[readMessages]', err.message);
      }
    });

    // ── leaveConversation ────────────────────────────────────────────────
    socket.on('leaveConversation', ({ convId }) => {
      if (convId) socket.leave(`conv_${convId}`);
    });

    // ── Cleanup on disconnect ────────────────────────────────────────────
    socket.on('disconnecting', () => {
      for (const room of socket.rooms) {
        if (room.startsWith('conv_')) {
          socket.to(room).emit('userStopTyping', { userId: socket.userId });
        }
      }
    });
  });

  return io;
};

// ── Helper: markRead ──────────────────────────────────────────────────────────
const markRead = async (conversationId, userId) => {
  await Message.updateMany(
    { conversation: conversationId, sender: { $ne: userId }, read: false },
    { $set: { read: true } }
  );
  await Conversation.findByIdAndUpdate(conversationId, { $set: { unreadCount: 0 } });
};

const getIO = () => {
  if (!io) throw new Error('Socket.io not initialized');
  return io;
};

module.exports = { initSocket, getIO };