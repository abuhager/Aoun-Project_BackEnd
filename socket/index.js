const { Server } = require('socket.io');

let io;

function initSocket(server) {
  const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  io = new Server(server, {
    cors: {
      origin: ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : 'http://localhost:3000',
      credentials: true,
    },
  });

  io.on('connection', (socket) => {
    socket.on('join', (userId) => {
      if (userId) socket.join(`user:${userId}`);
    });

    socket.on('disconnect', () => {});
  });

  console.log('✅ Socket.io جاهز');
  return io;
}

function getIo() {
  if (!io) throw new Error('Socket.io لم يُهيَّأ بعد — استدعِ initSocket أولاً');
  return io;
}

module.exports = { initSocket, getIo };