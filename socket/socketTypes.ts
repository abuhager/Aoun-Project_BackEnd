import type { ExtendedError, Server, Socket } from 'socket.io';

export type AounSocketData = {
  userId: string;
  userName: string;
  userRole: Express.AuthenticatedUser['role'];
  tokenExpiresAt: number;
};

export type SocketAckPayload = {
  ok: boolean;
  success: boolean;
  [key: string]: unknown;
};

export type SocketAck = (payload: SocketAckPayload) => void;

export type ChatCommandPayload = {
  convId?: string;
  text?: string;
  correlationId?: string;
  isTyping?: boolean;
};

export interface ClientToServerEvents {
  join_room: (payload?: ChatCommandPayload, ack?: SocketAck) => void;
  leave_room: (payload?: ChatCommandPayload) => void;
  send_message: (payload?: ChatCommandPayload, ack?: SocketAck) => void;
  mark_read: (payload?: ChatCommandPayload, ack?: SocketAck) => void;
  typing_status: (payload?: ChatCommandPayload) => void;
}

export interface ServerToClientEvents {
  [event: string]: (payload?: unknown) => void;
}

export interface InterServerEvents {
  [event: string]: (payload?: unknown) => void;
}

export type AounSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  AounSocketData
>;
export type AounSocketServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  AounSocketData
>;
export type SocketNext = (error?: ExtendedError) => void;

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
