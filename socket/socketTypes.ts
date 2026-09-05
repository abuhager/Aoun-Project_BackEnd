import type { ExtendedError, Server, Socket } from 'socket.io';

export type AounSocketData = {
  userId: string;
  userName: string;
  userRole: Express.AuthenticatedUser['role'];
  tokenExpiresAt: number;
};

export type AounSocket = Socket & { data: AounSocketData };
export type AounSocketServer = Server;
export type SocketNext = (error?: ExtendedError) => void;

export type SocketAckPayload = {
  ok: boolean;
  success: boolean;
  [key: string]: unknown;
};

export type SocketAck = (payload: SocketAckPayload) => void;

export type SocketOperationError = Error & {
  code?: string;
  statusCode?: number;
  data?: { code?: string };
};

export const asSocketError = (error: unknown): SocketOperationError => (
  error instanceof Error
    ? error as SocketOperationError
    : new Error(String(error)) as SocketOperationError
);
