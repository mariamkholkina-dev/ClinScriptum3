import { z } from "zod";
import { prisma } from "@clinscriptum/db";
import { router, protectedProcedure } from "../trpc/trpc.js";

export const studyRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return prisma.study.findMany({
      where: { tenantId: ctx.user.tenantId },
      orderBy: { createdAt: "desc" },
    });
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return prisma.study.findFirst({
        where: { id: input.id, tenantId: ctx.user.tenantId },
        include: {
          documents: {
            include: {
              versions: { orderBy: { versionNumber: "desc" } },
            },
            orderBy: { createdAt: "asc" },
          },
        },
      });
    }),

  create: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1),
        phase: z.enum(["I", "II", "III", "IV", "I_II", "II_III", "unknown"]).default("unknown"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return prisma.study.create({
        data: {
          tenantId: ctx.user.tenantId,
          title: input.title,
          phase: input.phase,
        },
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        title: z.string().min(1).optional(),
        phase: z.enum(["I", "II", "III", "IV", "I_II", "II_III", "unknown"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      return prisma.study.updateMany({
        where: { id, tenantId: ctx.user.tenantId },
        data,
      });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return prisma.study.deleteMany({
        where: { id: input.id, tenantId: ctx.user.tenantId },
      });
    }),
});
