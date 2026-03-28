import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { verifyAccessToken } from "../lib/auth.js";
import type { JwtPayload } from "@clinscriptum/shared";

export interface Context {
  user: JwtPayload | null;
}

export function createContext({ req }: CreateExpressContextOptions): Context {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return { user: null };
  }

  try {
    const token = authHeader.slice(7);
    const user = verifyAccessToken(token);
    return { user };
  } catch {
    return { user: null };
  }
}
