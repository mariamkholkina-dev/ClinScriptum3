import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { prisma } from "@clinscriptum/db";
import { router, protectedProcedure } from "../trpc/trpc.js";

export const generationRouter = router({
  startICFGeneration: protectedProcedure
    .input(
      z.object({
        protocolVersionId: z.string().uuid(),
        templateVersionId: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const version = await prisma.documentVersion.findUnique({
        where: { id: input.protocolVersionId },
        include: { document: { include: { study: true } } },
      });
      if (!version || version.document.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      if (version.document.type !== "protocol") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Source must be a protocol" });
      }

      const run = await prisma.processingRun.create({
        data: {
          studyId: version.document.studyId,
          docVersionId: input.protocolVersionId,
          type: "icf_generation",
        },
      });

      return { runId: run.id };
    }),

  startCSRGeneration: protectedProcedure
    .input(
      z.object({
        protocolVersionId: z.string().uuid(),
        templateVersionId: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const version = await prisma.documentVersion.findUnique({
        where: { id: input.protocolVersionId },
        include: { document: { include: { study: true } } },
      });
      if (!version || version.document.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      if (version.document.type !== "protocol") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Source must be a protocol" });
      }

      const run = await prisma.processingRun.create({
        data: {
          studyId: version.document.studyId,
          docVersionId: input.protocolVersionId,
          type: "csr_generation",
        },
      });

      return { runId: run.id };
    }),

  getGenerationResult: protectedProcedure
    .input(z.object({ runId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const run = await prisma.processingRun.findUnique({
        where: { id: input.runId },
        include: {
          study: true,
          steps: { orderBy: { startedAt: "asc" } },
        },
      });
      if (!run || run.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const llmStep = run.steps.find((s) => s.level === "llm_check" && s.status === "completed");
      const sections = (llmStep?.result as any)?.sections ?? [];

      return {
        run,
        generatedSections: sections,
      };
    }),
});
