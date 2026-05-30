// socket/socketHandler.js
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const Conversation = require('../models/Conversation');
const Item = require('../models/Item');

let io;

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

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('AUTH_REQUIRED'));

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.user.id;
      socket.userName = decoded.user.name;
      next();
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return next(new Error('TOKEN_EXPIRED'));
      }
      return next(new Error('INVALID_TOKEN'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(`user_${socket.userId}`);

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

        if (!isDonor && !isBooker) {
          return socket.emit('error', { msg: 'غير مصرح' });
        }

        let conv = await Conversation.findOne({ item: itemId });
        if (!conv) {
          conv = await Conversation.create({
            item: itemId,
            participants: [item.donor, item.bookedBy],
          });
        }

        socket.join(`conv_${conv._id}`);

        const messages = conv.messages.slice(-50).map((m) => ({
          _id: m._id,
          sender: m.sender,
          text: m.text,
          read: m.read,
          createdAt: m.createdAt,
        }));

        socket.emit('conversationJoined', {
          convId: conv._id,
          messages,
        });

        await markRead(conv, socket.userId);
        io.to(`conv_${conv._id}`).emit('messagesRead', { by: socket.userId });
      } catch (err) {
        console.error('joinConversation:', err.message);
        socket.emit('error', { msg: 'خطأ في السيرفر' });
      }
    });

    socket.on('sendMessage', async ({ convId, text }) => {
      if (!text?.trim() || text.length > 1000) {
        return socket.emit('error', { msg: 'نص غير صالح' });
      }

      try {
        const conv = await Conversation.findById(convId);
        if (!conv) return socket.emit('error', { msg: 'المحادثة غير موجودة' });

        const isParticipant = conv.participants
          .map((p) => p.toString())
          .includes(socket.userId.toString());

        if (!isParticipant) {
          return socket.emit('error', { msg: 'غير مصرح' });
        }

        const message = {
          sender: socket.userId,
          text: text.trim(),
          read: false,
          createdAt: new Date(),
        };

        conv.messages.push(message);
        conv.lastActivity = new Date();
        await conv.save();

        const savedMsg = conv.messages[conv.messages.length - 1];

        io.to(`conv_${convId}`).emit('newMessage', {
          _id: savedMsg._id,
          sender: socket.userId,
          senderName: socket.userName,
          text: savedMsg.text,
          read: false,
          createdAt: savedMsg.createdAt,
        });

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
        console.error('sendMessage:', err.message);
        socket.emit('error', { msg: 'خطأ في الإرسال' });
      }
    });

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

    socket.on('disconnect', () => {});
  });

  return io;
};

const markRead = async (conv, userId) => {
  let updated = false;

  conv.messages.forEach((m) => {
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