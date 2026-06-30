const { Server }       = require('socket.io');
const jwt              = require('jsonwebtoken');
const Conversation     = require('../models/Conversation');
const Message          = require('../models/Message');
const Item             = require('../models/Item');

let io;

function getAllowedOrigins() {
  return (process.env.ALLOWED_ORIGINS || process.env.CLIENT_URL || '')
    .split(',').map((o) => o.trim()).filter(Boolean);
}

const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin(origin, cb) {
        if (!origin) return cb(null, true);
        if (getAllowedOrigins().includes(origin)) return cb(null, true);
        return cb(new Error(`CORS_ORIGIN_DENIED:${origin}`));
      },
      credentials: true,
    },
  });

  // ── Auth Middleware ──────────────────────────────────────────────────────
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('AUTH_REQUIRED'));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (!decoded.exp || decoded.exp < Math.floor(Date.now() / 1000))
        return next(new Error('TOKEN_EXPIRED'));
      socket.userId   = decoded.user.id;
      socket.userName = decoded.user.name;
      socket.userRole = decoded.user.role || 'user';
      next();
    } catch (err) {
      next(new Error(err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(`user_${socket.userId}`);

    // ── joinConversation ──────────────────────────────────────────────────
    socket.on('joinConversation', async ({ itemId, convId }, ack) => {
      try {
        let conv;

        if (convId) {
          conv = await Conversation.findById(convId).select('participants item');
        } else if (itemId) {
          const item = await Item.findById(itemId).select('donor bookedBy status');
          if (!item)
            return socket.emit('error', { msg: 'الغرض غير موجود' });
          if (!item.bookedBy || !['محجوز', 'تم التسليم'].includes(item.status))
            return socket.emit('error', { msg: 'لا يمكن فتح محادثة قبل الحجز' });

          const uid      = socket.userId.toString();
          const isDonor  = item.donor.toString()    === uid;
          const isBooker = item.bookedBy.toString() === uid;
          if (!isDonor && !isBooker)
            return socket.emit('error', { msg: 'غير مصرح 🚫' });

          conv = await Conversation.findOneAndUpdate(
            { item: itemId },
            { $setOnInsert: { item: itemId, participants: [item.donor, item.bookedBy] } },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          ).select('participants item');
        } else {
          return socket.emit('error', { msg: 'itemId أو convId مطلوب' });
        }

        if (!conv) return socket.emit('error', { msg: 'المحادثة غير موجودة' });

        const isParticipant = conv.participants
          .map((p) => p.toString())
          .includes(socket.userId.toString());
        if (!isParticipant)
          return socket.emit('error', { msg: 'غير مصرح 🚫' });

        socket.join(`conv_${conv._id}`);

        const messages = await Message.find({ conversation: conv._id })
          .populate('sender', 'name avatar _id')
          .sort({ createdAt: 1 }) 
          .limit(50)
          .lean();

        // ✅ FIX-1: إرسال conversationJoined — الـ useChat يستمع لهذا
        socket.emit('conversationJoined', { convId: conv._id, messages });

        await markRead(conv._id, socket.userId);
        io.to(`conv_${conv._id}`).emit('messagesRead', { by: socket.userId });

        if (typeof ack === 'function') ack({ ok: true });
      } catch (err) {
        console.error('[joinConversation]', err.message);
        socket.emit('error', { msg: 'خطأ في السيرفر' });
      }
    });

    // ── sendMessage ──────────────────────────────────────────────────────
    // ✅ FIX-4: يبث على conv_ room — يصل للطرفين بغض النظر عن user_ room
    socket.on('sendMessage', async ({ convId, text }, ack) => {
      if (!text?.trim() || text.length > 1000)
        return socket.emit('error', { msg: 'نص الرسالة غير صالح' });

      try {
        const conv = await Conversation.findById(convId).select('participants');
        if (!conv) return socket.emit('error', { msg: 'المحادثة غير موجودة' });

        const isParticipant = conv.participants
          .map((p) => p.toString())
          .includes(socket.userId.toString());
        if (!isParticipant)
          return socket.emit('error', { msg: 'غير مصرح 🚫' });

        const newMessage = await Message.create({
          conversation: convId,
          sender:       socket.userId,
          text:         text.trim(),
          read:         false,
        });

        await Conversation.findByIdAndUpdate(convId, {
          $set: { lastMessage: newMessage._id, lastActivity: new Date() },
          $inc: { unreadCount: 1 },
        });

        const populated = await Message.findById(newMessage._id)
          .populate('sender', 'name avatar _id')
          .lean();

        // ✅ البث على غرفة المحادثة — كلا الطرفين يستقبلان
        io.to(`conv_${convId}`).emit('message:new', {
          conversationId: convId,
          message:        populated,
        });

        // إشعار للطرف الآخر حتى لو مش فاتح المحادثة
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

        // ✅ FIX-3: acknowledgement للـ client
        if (typeof ack === 'function') ack({ ok: true, messageId: newMessage._id });
      } catch (err) {
        console.error('[sendMessage]', err.message);
        socket.emit('error', { msg: 'خطأ أثناء الإرسال' });
        if (typeof ack === 'function') ack({ ok: false });
      }
    });

    // ── Typing ────────────────────────────────────────────────────────────
    socket.on('typing', ({ convId }) => {
      socket.to(`conv_${convId}`).emit('userTyping', {
        userId: socket.userId,
        name:   socket.userName,
      });
    });

    socket.on('stopTyping', ({ convId }) => {
      socket.to(`conv_${convId}`).emit('userStopTyping', { userId: socket.userId });
    });

    // ── readMessages ──────────────────────────────────────────────────────
    socket.on('readMessages', async ({ convId }) => {
      try {
        await markRead(convId, socket.userId);
        io.to(`conv_${convId}`).emit('messagesRead', { by: socket.userId });
      } catch (err) {
        console.error('[readMessages]', err.message);
      }
    });

    // ── leaveConversation ─────────────────────────────────────────────────
    socket.on('leaveConversation', ({ convId }) => {
      if (convId) socket.leave(`conv_${convId}`);
    });

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

// ── Helper ───────────────────────────────────────────────────────────────────
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