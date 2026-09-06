import type { Types } from 'mongoose';
import type { Server as SocketServer } from 'socket.io';

export type EntityId = string | Types.ObjectId;
export type ServiceRecord = Record<string, unknown>;
export type ServicePayload = Record<string, unknown>;
export type UploadedFile = Express.Multer.File;
export type RealtimeServer = SocketServer;

export type ErrorDetails = {
  code?: unknown;
  hasErrorLabel?: unknown;
  message?: unknown;
  status?: unknown;
};

export const getErrorDetails = (error: unknown): ErrorDetails => (
  typeof error === 'object' && error !== null ? error : {}
);

export const getErrorMessage = (error: unknown, fallback = 'Unknown error'): string => {
  const { message } = getErrorDetails(error);
  return typeof message === 'string' ? message : fallback;
};

export const hasErrorCode = (error: unknown, code: string | number): boolean => (
  getErrorDetails(error).code === code
);
