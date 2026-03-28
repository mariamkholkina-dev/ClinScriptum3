import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { prisma } from "@clinscriptum/db";
import { router, protectedProcedure } from "../trpc/trpc.js";
import { diffSections, diffFacts, analyzeProtocolImpactOnICF, analyzeProtocolImpactOnIB } from "@clinscriptum/diff-engine";

export const comparisonRouter = router({
  compare: protectedProcedure
    .input(
      z.object({
        oldVersionId: z.string().uuid(),
        newVersionId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [oldVersion, newVersion] = await Promise.all([
        prisma.documentVersion.findUnique({
          where: { id: input.oldVersionId },
          include: {
            document: { include: { study: true } },
            sections: { include: { contentBlocks: { orderBy: { order: "asc" } } }, orderBy: { order: "asc" } },
          },
        }),
        prisma.documentVersion.findUnique({
          where: { id: input.newVersionId },
          include: {
            document: { include: { study: true } },
            sections: { include: { contentBlocks: { orderBy: { order: "asc" } } }, orderBy: { order: "asc" } },
          },
        }),
      ]);

      if (!oldVersion || !newVersion) throw new TRPCError({ code: "NOT_FOUND" });
      if (oldVersion.document.study.tenantId !== ctx.user.tenantId) throw new TRPCError({ code: "FORBIDDEN" });

      const oldSections = oldVersion.sections.map((s) => ({
        id: s.id,
        title: s.title,
        standardSection: s.standardSection,
        content: s.contentBlocks.map((b) => b.content).join("\n"),
      }));

      const newSections = newVersion.sections.map((s) => ({
        id: s.id,
        title: s.title,
        standardSection: s.standardSection,
        content: s.contentBlocks.map((b) => b.content).join("\n"),
      }));

      const diffResult = diffSections(oldSections, newSections);

      const [oldFacts, newFacts] = await Promise.all([
        prisma.fact.findMany({ where: { docVersionId: input.oldVersionId } }),
        prisma.fact.findMany({ where: { docVersionId: input.newVersionId } }),
      ]);

      const factChanges = diffFacts(
        oldFacts.map((f) => ({ factKey: f.factKey, value: f.value })),
        newFacts.map((f) => ({ factKey: f.factKey, value: f.value }))
      );

      return { ...diffResult, factChanges };
    }),

  impactAnalysis: protectedProcedure
    .input(
      z.object({
        oldVersionId: z.string().uuid(),
        newVersionId: z.string().uuid(),
        targetDocumentId: z.string().uuid(),
      })
    )
    .query(async ({ ctx, input }) => {
      const [oldVersion, newVersion] = await Promise.all([
        prisma.documentVersion.findUnique({
          where: { id: input.oldVersionId },
          include: {
            document: { include: { study: true } },
            sections: { include: { contentBlocks: { orderBy: { order: "asc" } } }, orderBy: { order: "asc" } },
          },
        }),
        prisma.documentVersion.findUnique({
          where: { id: input.newVersionId },
          include: {
            document: { include: { study: true } },
            sections: { include: { contentBlocks: { orderBy: { order: "asc" } } }, orderBy: { order: "asc" } },
          },
        }),
      ]);

      if (!oldVersion || !newVersion) throw new TRPCError({ code: "NOT_FOUND" });
      if (oldVersion.document.study.tenantId !== ctx.user.tenantId) throw new TRPCError({ code: "FORBIDDEN" });

      const targetDoc = await prisma.document.findFirst({
        where: { id: input.targetDocumentId, study: { tenantId: ctx.user.tenantId } },
      });
      if (!targetDoc) throw new TRPCError({ code: "NOT_FOUND" });

      const oldSections = oldVersion.sections.map((s) => ({
        id: s.id,
        title: s.title,
        standardSection: s.standardSection,
        content: s.contentBlocks.map((b) => b.content).join("\n"),
      }));

      const newSections = newVersion.sections.map((s) => ({
        id: s.id,
        title: s.title,
        standardSection: s.standardSection,
        content: s.contentBlocks.map((b) => b.content).join("\n"),
      }));

      const diff = diffSections(oldSections, newSections);

      const sourceDoc = { id: oldVersion.documentId, title: oldVersion.document.title };
      const target = { id: targetDoc.id, title: targetDoc.title };

      if (targetDoc.type === "icf") {
        return analyzeProtocolImpactOnICF(diff.sectionDiffs, sourceDoc, target);
      }
      return analyzeProtocolImpactOnIB(diff.sectionDiffs, sourceDoc, target);
    }),
});
