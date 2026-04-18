import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { Context } from "./context.js";

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const middleware = t.middleware;

const isAuthenticated = middleware(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { user: ctx.user } });
});

export const protectedProcedure = t.procedure.use(isAuthenticated);

const isAdmin = middleware(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  if (ctx.user.role !== "tenant_admin" && ctx.user.role !== "rule_admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }
  return next({ ctx: { user: ctx.user } });
});

export const adminProcedure = t.procedure.use(isAdmin);

const QUALITY_ROLES = new Set(["rule_admin", "rule_approver", "tenant_admin"]);

const isQualityUser = middleware(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  if (!QUALITY_ROLES.has(ctx.user.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Quality system access required" });
  }
  return next({ ctx: { user: ctx.user } });
});

export const qualityProcedure = t.procedure.use(isQualityUser);

const REVIEWER_ROLES = new Set(["findings_reviewer", "rule_admin", "tenant_admin"]);

const isReviewer = middleware(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  if (!REVIEWER_ROLES.has(ctx.user.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Reviewer access required" });
  }
  return next({ ctx: { user: ctx.user } });
});

export const reviewerProcedure = t.procedure.use(isReviewer);
