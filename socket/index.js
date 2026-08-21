const { Server } = require('socket.io');

const { corsOrigin, isOriginAllowed } = require('../config/cors');
const { socketAuthMiddleware } = require('./auth');
const { registerChatHandlers } = require('./chatHandlers');

let io = null;

const initSocket = (httpServer) => {
  if (io) throw new Error('Socket.io initialized more than once');

  io = new Server(httpServer, {
    cors: {
      origin: corsOrigin,
      credentials: true,
      methods: ['GET', 'POST'],
    },
    allowRequest: (request, callback) => {
      try {
        callback(null, isOriginAllowed(request.headers.origin));
      } catch {
        callback(null, false);
      }
    },
    maxHttpBufferSize: 100_000,
    perMessageDeflate: false,
  });

  io.use(socketAuthMiddleware);

  io.on('connection', (socket) => {
    console.log(`[Socket] اتصال المستخدم: ${socket.userId}`);
    socket.join(`user_${socket.userId}`);
    registerChatHandlers(io, socket);

    socket.on('disconnecting', () => {
      for (const room of socket.rooms) {
        if (room.startsWith('conv_')) {
          socket.to(room).emit('typing_status', {
            convId: room.replace('conv_', ''),
            userId: socket.userId,
            isTyping: false,
          });
        }
      }
    });
  });

  return io;
};

const getIO = () => {
  if (!io) throw new Error('Socket.io not initialized');
  return io;
};

const resetIO = () => {
  io = null;
};

module.exports = { initSocket, getIO, resetIO };
