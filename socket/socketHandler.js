const { Server }     = require('socket.io');
const jwt            = require('jsonwebtoken');
const Conversation   = require('../models/Conversation');
const Item           = require('../models/Item');
const User           = require('../models/User');

let io;

const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin:      process.env.CLIENT_URL || 'http://localhost:3000',
      credentials: true,
    },
  });

  // ─── Middleware: تحقق JWT ──────────────────────────────────
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('AUTH_REQUIRED'));

    try {
      const decoded   = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId   = decoded.user.id;
      socket.userName = decoded.user.name;
      next();
    } catch {
      next(new Error('INVALID_TOKEN'));
    }
  });

  io.on('connection', (socket) => {
    // انضم لـ personal room (للإشعارات)
    socket.join(`user_${socket.userId}`);

    // ─── 1. فتح محادثة ──────────────────────────────────────
    socket.on('joinConversation', async ({ itemId }) => {
      try {
        const item = await Item.findById(itemId).select('donor bookedBy');
        if (!item) return socket.emit('error', { msg: 'الغرض غير موجود' });

        const uid = socket.userId.toString();
        const isDonor  = item.donor.toString()    === uid;
        const isBooker = item.bookedBy?.toString() === uid;

        if (!isDonor && !isBooker)
          return socket.emit('error', { msg: 'غير مصرح' });

        // أنشئ أو افتح المحادثة
        let conv = await Conversation.findOne({ item: itemId });
        if (!conv) {
          conv = await Conversation.create({
            item:         itemId,
            participants: [item.donor, item.bookedBy],
          });
        }

        socket.join(`conv_${conv._id}`);

        // أرسل آخر 50 رسالة
        const messages = conv.messages.slice(-50).map(m => ({
          _id:       m._id,
          sender:    m.sender,
          text:      m.text,
          read:      m.read,
          createdAt: m.createdAt,
        }));

        socket.emit('conversationJoined', {
          convId:   conv._id,
          messages,
        });

        // علّم رسائل الطرف الثاني كمقروءة
        await markRead(conv, socket.userId);
        io.to(`conv_${conv._id}`).emit('messagesRead', { by: socket.userId });

      } catch (err) {
        console.error('joinConversation:', err.message);
        socket.emit('error', { msg: 'خطأ في السيرفر' });
      }
    });

    // ─── 2. إرسال رسالة ─────────────────────────────────────
    socket.on('sendMessage', async ({ convId, text }) => {
      if (!text?.trim() || text.length > 1000)
        return socket.emit('error', { msg: 'نص غير صالح' });

      try {
        const conv = await Conversation.findById(convId);
        if (!conv) return socket.emit('error', { msg: 'المحادثة غير موجودة' });

        const isParticipant = conv.participants
          .map(p => p.toString())
          .includes(socket.userId.toString());

        if (!isParticipant)
          return socket.emit('error', { msg: 'غير مصرح' });

        const message = {
          sender:    socket.userId,
          text:      text.trim(),
          read:      false,
          createdAt: new Date(),
        };

        conv.messages.push(message);
        conv.lastActivity = new Date();
        await conv.save();

        const savedMsg = conv.messages[conv.messages.length - 1];

        // أرسل للغرفة كلها
        io.to(`conv_${convId}`).emit('newMessage', {
          _id:       savedMsg._id,
          sender:    socket.userId,
          senderName: socket.userName,
          text:      savedMsg.text,
          read:      false,
          createdAt: savedMsg.createdAt,
        });

        // إشعار للطرف الثاني (personal room)
        const otherId = conv.participants
          .find(p => p.toString() !== socket.userId.toString());

        if (otherId) {
          io.to(`user_${otherId}`).emit('notification', {
            type:   'NEW_MESSAGE',
            convId,
            text:   text.trim().slice(0, 60),
            sender: socket.userName,
          });
        }

      } catch (err) {
        console.error('sendMessage:', err.message);
        socket.emit('error', { msg: 'خطأ في الإرسال' });
      }
    });

    // ─── 3. جاري الكتابة ────────────────────────────────────
    socket.on('typing', ({ convId }) => {
      socket.to(`conv_${convId}`).emit('userTyping', {
        userId: socket.userId,
        name:   socket.userName,
      });
    });

    socket.on('stopTyping', ({ convId }) => {
      socket.to(`conv_${convId}`).emit('userStopTyping', {
        userId: socket.userId,
      });
    });

    // ─── 4. قراءة الرسائل ────────────────────────────────────
    socket.on('readMessages', async ({ convId }) => {
      try {
        const conv = await Conversation.findById(convId);
        if (!conv) return;
        await markRead(conv, socket.userId);
        io.to(`conv_${convId}`).emit('messagesRead', { by: socket.userId });
      } catch (err) {
        console.error('readMessages:', err.message);
      }
    });

    socket.on('disconnect', () => {
      // تلقائي — Socket.io يزيله من كل الغرف
    });
  });

  return io;
};

// ─── Helper: علّم رسائل المستخدم الثاني كمقروءة ──────────────
const markRead = async (conv, userId) => {
  let updated = false;
  conv.messages.forEach(m => {
    if (m.sender.toString() !== userId.toString() && !m.read) {
      m.read   = true;
      updated  = true;
    }
  });
  if (updated) await conv.save();
};

const getIO = () => {
  if (!io) throw new Error('Socket.io not initialized');
  return io;
};

module.exports = { initSocket, getIO };