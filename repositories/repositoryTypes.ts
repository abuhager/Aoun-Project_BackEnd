import type { ClientSession, Types } from 'mongoose';

export type EntityId = string | Types.ObjectId;
export type RepositoryRecord = Record<string, unknown>;
export type RepositoryPayload = Record<string, unknown>;
export type RepositoryFilter = Record<string, unknown>;
export type RepositorySession = ClientSession | null;

export type PaginationOptions = {
  page?: number;
  limit?: number;
};

export type PersistedDocument = RepositoryRecord & {
  save: () => Promise<unknown>;
};

export type DeletableDocument = RepositoryRecord & {
  deleteOne: () => Promise<unknown>;
};
