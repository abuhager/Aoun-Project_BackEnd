// socket/conversationSocket.js
// MED-03 ► conversationJoined يرجع آخر 50 رسالة
const Conversation = require('../models/Conversation');

module.exports = (io, socket) => {
  socket.on('joinConversation', async ({ convId }) => {
    if (!convId) return;
    try {
      const conv = await Conversation.findById(convId, { messages: { $slice: -50 } }).populate('messages.sender', 'name avatar');
      if (!conv) return;
      const uid = socket.user?._id?.toString() || socket.user?.id?.toString();
      if (!conv.participants.some((p) => p.toString() === uid)) return;
      socket.join('conv_' + convId);
      socket.emit('conversationJoined', { convId, messages: conv.messages.map((m) => ({ _id: m._id?.toString(), sender: typeof m.sender === 'object' ? { _id: m.sender._id?.toString(), name: m.sender.name } : m.sender?.toString(), text: m.text, createdAt: m.createdAt, read: m.read })) });
    } catch { socket.emit('error', { message: 'تعذّر الانضمام' }); }
  });
  socket.on('leaveConversation', ({ convId }) => { if (convId) socket.leave('conv_' + convId); });
  socket.on('typing',       ({ convId }) => { socket.to('conv_' + convId).emit('userTyping',     { userId: socket.user?._id?.toString(), name: socket.user?.name }); });
  socket.on('stopTyping',   ({ convId }) => { socket.to('conv_' + convId).emit('userStopTyping'); });
  socket.on('readMessages', ({ convId }) => { socket.to('conv_' + convId).emit('messagesRead',   { by: socket.user?._id?.toString() || socket.user?.id?.toString() }); });
};
