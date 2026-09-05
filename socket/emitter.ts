const { SOCKET_EVENTS, userRoom } = require('./contracts');
import type { AounSocketServer } from './socketTypes';

const getSocketServer = (): AounSocketServer | null => {
  const { getIOOrNull } = require('./index');
  return getIOOrNull();
};

const emitToUser = (userId: unknown, event: string, payload?: unknown): boolean => {
  if (!userId) return false;
  const io = getSocketServer();
  if (!io) return false;

  io.to(userRoom(userId)).emit(event, payload);
  return true;
};

const emitToAll = (event: string, payload?: unknown): boolean => {
  const io = getSocketServer();
  if (!io) return false;

  io.emit(event, payload);
  return true;
};

const disconnectUserSockets = async (
  userId: unknown,
  {
    code = 'SESSION_INVALIDATED',
    msg = 'انتهت صلاحية الجلسة، أعد تسجيل الدخول',
  }: { code?: string; msg?: string } = {}
): Promise<number> => {
  const io = getSocketServer();
  if (!io || !userId) return 0;

  const room = userRoom(userId);
  const sockets = await io.in(room).fetchSockets();
  if (sockets.length === 0) return 0;

  io.to(room).emit(SOCKET_EVENTS.AUTH_FORCED_LOGOUT, { code, msg });
  io.in(room).disconnectSockets(true);
  return sockets.length;
};

module.exports = {
  disconnectUserSockets,
  emitToAll,
  emitToUser,
};
