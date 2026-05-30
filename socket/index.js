const { Server } = require('socket.io');
const { verifyAccessToken } = require('../utils/tokenUtils');

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
    socket.on('join', (token) => {
      // ✅ M2 — تحقق من JWT بدل قبول userId مباشرة
      if (!token) return socket.emit('auth_error', { msg: 'توكن مطلوب 🔒' });

      try {
        const decoded = verifyAccessToken(token);
        const userId  = decoded.user.id;

        if (decoded.user.isBanned) {
          return socket.emit('auth_error', { msg: 'حسابك محظور 🚫' });
        }

        socket.join(`user:${userId}`);
        socket.emit('joined', { userId }); // ✅ تأكيد الانضمام للفرونت
      } catch (err) {
        const isExpired = err.name === 'TokenExpiredError';
        socket.emit('auth_error', {
          msg:  isExpired ? 'انتهت صلاحية الجلسة ⏰' : 'توكن غير صالح ⚠️',
          code: isExpired ? 'TOKEN_EXPIRED'           : 'INVALID_TOKEN',
        });
      }
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