import type { Types } from "mongoose";

declare global {
  namespace Express {
    interface AuthenticatedUser {
      id: string;
      _id?: string | Types.ObjectId;
      name: string;
      role: "user" | "admin" | "super_admin";
      trustLevel: number;
      phoneVerified: boolean;
      isVerified: boolean;
      isBanned: boolean;
      isFrozen: boolean;
      sessionVersion: number;
      sessionIssuedAt: Date | string | null;
    }

    interface Request {
      user?: AuthenticatedUser | null;
      id?: string;
      requestId?: string;
    }
  }
}

export {};
