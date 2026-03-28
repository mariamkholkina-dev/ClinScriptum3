import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { prisma } from "@clinscriptum/db";
import { router, publicProcedure } from "../trpc/trpc.js";
import {
  hashPassword,
  verifyPassword,
  signAccessToken,
  createRefreshToken,
  rotateRefreshToken,
} from "../lib/auth.js";

export const authRouter = router({
  register: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string().min(8),
        name: z.string().min(1),
        tenantName: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      const existing = await prisma.user.findUnique({ where: { email: input.email } });
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "Email already registered" });
      }

      const tenant = await prisma.tenant.create({
        data: { name: input.tenantName },
      });

      const passwordHash = await hashPassword(input.password);

      const user = await prisma.user.create({
        data: {
          tenantId: tenant.id,
          email: input.email,
          passwordHash,
          name: input.name,
          role: "tenant_admin",
        },
      });

      const accessToken = signAccessToken({
        userId: user.id,
        tenantId: tenant.id,
        role: user.role,
      });
      const refreshToken = await createRefreshToken(user.id);

      return { accessToken, refreshToken, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
    }),

  login: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const user = await prisma.user.findUnique({ where: { email: input.email } });
      if (!user) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid credentials" });
      }

      const valid = await verifyPassword(input.password, user.passwordHash);
      if (!valid) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid credentials" });
      }

      const accessToken = signAccessToken({
        userId: user.id,
        tenantId: user.tenantId,
        role: user.role,
      });
      const refreshToken = await createRefreshToken(user.id);

      return { accessToken, refreshToken, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
    }),

  refresh: publicProcedure
    .input(z.object({ refreshToken: z.string() }))
    .mutation(async ({ input }) => {
      const result = await rotateRefreshToken(input.refreshToken);
      if (!result) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid refresh token" });
      }
      return result;
    }),
});
