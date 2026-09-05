const { Server }: typeof import('socket.io') = require('socket.io');
import type { IncomingMessage, Server as HttpServer } from 'http';
import type { ServerOptions } from 'socket.io';
import type { AounSocket, AounSocketServer } from './socketTypes';

const { corsOrigin, isOriginAllowed } = require('../config/cors');
const { socketAuthMiddleware } = require('./auth');
const { registerChatHandlers } = require('./chatHandlers');
const {
  SOCKET_EVENTS,
  userRoom,
} = require('./contracts');

let io: AounSocketServer | null = null;

const TOKEN_REFRESH_LEEWAY_MS = 30_000;

const buildSocketServerOptions = (): Partial<ServerOptions> => ({
  cors: {
    origin: corsOrigin,
    credentials: true,
    methods: ['GET', 'POST'],
  },
  allowRequest: (
    request: IncomingMessage,
    callback: (error: string | null | undefined, success: boolean) => void
  ) => {
    try {
      callback(null, isOriginAllowed(request.headers.origin));
    } catch {
      callback(null, false);
    }
  },
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    // Always re-run authentication so a banned or invalidated user cannot recover a session.
    skipMiddlewares: false,
  },
  connectTimeout: 10_000,
  maxHttpBufferSize: 100_000,
  perMessageDeflate: false,
  serveClient: false,
  pingInterval: 25_000,
  pingTimeout: 20_000,
});

const scheduleTokenLifecycle = (socket: AounSocket): (() => void) => {
  const expiresAt = Number(socket.data.tokenExpiresAt);
  if (!Number.isFinite(expiresAt)) return () => {};

  const untilExpiry = Math.max(0, expiresAt - Date.now());
  const refreshTimer = setTimeout(() => {
    if (!socket.connected) return;
    socket.emit(SOCKET_EVENTS.AUTH_TOKEN_EXPIRING, { expiresAt });
  }, Math.max(0, untilExpiry - TOKEN_REFRESH_LEEWAY_MS));

  const expiryTimer = setTimeout(() => {
    if (!socket.connected) return;
    socket.emit(SOCKET_EVENTS.AUTH_TOKEN_EXPIRED, {
      code: 'TOKEN_EXPIRED',
      msg: 'انتهت صلاحية اتصالك الفوري',
    });
    socket.disconnect(true);
  }, untilExpiry + 250);

  refreshTimer.unref?.();
  expiryTimer.unref?.();
  return () => {
    clearTimeout(refreshTimer);
    clearTimeout(expiryTimer);
  };
};

const initSocket = (httpServer: HttpServer): AounSocketServer => {
  if (io) throw new Error('Socket.io initialized more than once');

  io = new Server(httpServer, buildSocketServerOptions());

  io.use(socketAuthMiddleware);

  io.on('connection', async (rawSocket) => {
    const socket = rawSocket as AounSocket;
    const userId = socket.data.userId;
    await socket.join(userRoom(userId));
    registerChatHandlers(io, socket);
    const clearTokenLifecycle = scheduleTokenLifecycle(socket);

    socket.emit(SOCKET_EVENTS.SOCKET_READY, {
      recovered: Boolean(socket.recovered),
      serverTime: new Date().toISOString(),
      tokenExpiresAt: socket.data.tokenExpiresAt,
    });

    socket.on('disconnecting', () => {
      for (const room of socket.rooms) {
        if (room.startsWith('conv_')) {
          socket.to(room).emit(SOCKET_EVENTS.TYPING_STATUS, {
            convId: room.replace('conv_', ''),
            userId,
            isTyping: false,
          });
        }
      }
    });

    socket.once('disconnect', clearTokenLifecycle);
  });

  return io;
};

const getIO = (): AounSocketServer => {
  if (!io) throw new Error('Socket.io not initialized');
  return io;
};

const getIOOrNull = (): AounSocketServer | null => io;

const resetIO = (): void => {
  io = null;
};

module.exports = {
  TOKEN_REFRESH_LEEWAY_MS,
  buildSocketServerOptions,
  getIO,
  getIOOrNull,
  initSocket,
  resetIO,
  scheduleTokenLifecycle,
};
