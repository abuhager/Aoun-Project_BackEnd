// socket/index.js
const { Server } = require('socket.io');

let io;

function initSocket(server) {
  const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
    .split(',').map(o => o.trim()).filter(Boolean);

  io = new Server(server, {
    cors: {
      origin:      ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : 'http://localhost:3000',
      credentials: true,
    },
  });

  io.on('connection', (socket) => {
    // كل مستخدم ينضم لـ room خاصة به عند الاتصال
    socket.on('join', (userId) => {
      if (userId) socket.join(`user:${userId}`);
    });

    socket.on('disconnect', () => {});
  });

  console.log('✅ Socket.io جاهز');
  return io;
}

// يُستخدم في أي controller لإرسال event لمستخدم بعينه
// مثال: getIo().to(`user:${userId}`).emit('item:booked', { itemId })
function getIo() {
  if (!io) throw new Error('Socket.io لم يُهيَّأ بعد — استدعِ initSocket أولاً');
  return io;
}

module.exports = { initSocket, getIo };