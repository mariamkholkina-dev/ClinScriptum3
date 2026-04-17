import { TRPCError } from "@trpc/server";
import { middleware } from "./trpc.js";
import { DomainError, type DomainErrorCode } from "../services/errors.js";

const CODE_MAP: Record<DomainErrorCode, TRPCError["code"]> = {
  NOT_FOUND: "NOT_FOUND",
  FORBIDDEN: "FORBIDDEN",
  BAD_REQUEST: "BAD_REQUEST",
  CONFLICT: "CONFLICT",
  PRECONDITION_FAILED: "PRECONDITION_FAILED",
};

export const withDomainErrors = middleware(async ({ next }) => {
  try {
    return await next();
  } catch (err) {
    if (err instanceof DomainError) {
      throw new TRPCError({
        code: CODE_MAP[err.code],
        message: err.message,
      });
    }
    throw err;
  }
});
