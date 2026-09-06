import type { AounSocketServer } from './socketTypes.js';

let socketServer: AounSocketServer | null = null;

export const setIO = (io: AounSocketServer): void => {
  if (socketServer) throw new Error('Socket.io initialized more than once');
  socketServer = io;
};

export const getIO = (): AounSocketServer => {
  if (!socketServer) throw new Error('Socket.io not initialized');
  return socketServer;
};

export const getIOOrNull = (): AounSocketServer | null => socketServer;

export const resetIO = (): void => {
  socketServer = null;
};
