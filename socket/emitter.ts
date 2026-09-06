import { SOCKET_EVENTS, userRoom } from './contracts.js';
import type { AounSocketServer } from './socketTypes.js';
import { getIOOrNull } from './registry.js';

const getSocketServer = (): AounSocketServer | null => getIOOrNull();

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

export { disconnectUserSockets, emitToAll, emitToUser };
export default {
  disconnectUserSockets,
  emitToAll,
  emitToUser,
};
