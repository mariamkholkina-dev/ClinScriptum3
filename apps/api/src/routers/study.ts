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
        sponsor: z.string().optional(),
        drug: z.string().optional(),
        therapeuticArea: z.string().optional(),
        protocolTitle: z.string().optional(),
        phase: z.string().default(""),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return prisma.study.create({
        data: {
          tenantId: ctx.user.tenantId,
          title: input.title,
          sponsor: input.sponsor || null,
          drug: input.drug || null,
          therapeuticArea: input.therapeuticArea || null,
          protocolTitle: input.protocolTitle || null,
          phase: input.phase,
        },
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        title: z.string().min(1).optional(),
        sponsor: z.string().optional(),
        drug: z.string().optional(),
        therapeuticArea: z.string().optional(),
        protocolTitle: z.string().optional(),
        phase: z.string().optional(),
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
