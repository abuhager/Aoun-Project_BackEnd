const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const Conversation = require('../models/Conversation');
const Item = require('../models/Item');

let io;

const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.CLIENT_URL || 'http://localhost:3000',
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
    } catch {
      next(new Error('INVALID_TOKEN'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(`user_${socket.userId}`);

    socket.on('joinConversation', async ({ itemId, convId }) => {
      try {
        let conversation = null;

        if (convId) {
          conversation = await Conversation.findById(convId);
        } else if (itemId) {
          const item = await Item.findById(itemId).select('donor bookedBy');
          if (!item) return socket.emit('error', { msg: 'الغرض غير موجود' });

          const uid = socket.userId.toString();
          const isDonor = item.donor.toString() === uid;
          const isBooker = item.bookedBy?.toString() === uid;

          if (!isDonor && !isBooker) {
            return socket.emit('error', { msg: 'غير مصرح' });
          }

          conversation = await Conversation.findOne({ item: itemId });
        }

        if (!conversation) {
          return socket.emit('error', { msg: 'المحادثة غير موجودة' });
        }

        const isParticipant = conversation.participants
          .map((p) => p.toString())
          .includes(socket.userId.toString());

        if (!isParticipant) {
          return socket.emit('error', { msg: 'غير مصرح' });
        }

        socket.join(`conv_${conversation._id}`);

        socket.emit('conversationJoined', {
          convId: conversation._id,
        });
      } catch (err) {
        console.error('joinConversation:', err.message);
        socket.emit('error', { msg: 'خطأ في السيرفر' });
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

    socket.on('readMessages', ({ convId }) => {
      io.to(`conv_${convId}`).emit('messagesRead', { by: socket.userId });
    });
  });

  return io;
};

const getIO = () => {
  if (!io) throw new Error('Socket.io not initialized');
  return io;
};

module.exports = { initSocket, getIO };