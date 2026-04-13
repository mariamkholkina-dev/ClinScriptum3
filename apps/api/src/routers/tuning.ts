import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { prisma } from "@clinscriptum/db";
import { router, adminProcedure } from "../trpc/trpc.js";

const tuningTypeEnum = z.enum(["section_classification", "fact_extraction", "soa_detection", "icf_generation"]);
const tuningSessionStatusEnum = z.enum(["processing", "pending_review", "in_review", "completed"]);

export const tuningRouter = router({
  /* ═══════════════ Sessions CRUD ═══════════════ */

  createSession: adminProcedure
    .input(
      z.object({
        docVersionId: z.string().uuid(),
        type: tuningTypeEnum,
        generatedDocId: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const version = await prisma.documentVersion.findUnique({
        where: { id: input.docVersionId },
        include: { document: { include: { study: true } } },
      });
      if (!version || version.document.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      if (input.type === "icf_generation") {
        if (!input.generatedDocId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "generatedDocId is required for icf_generation tuning",
          });
        }
        const genDoc = await prisma.generatedDoc.findUnique({
          where: { id: input.generatedDocId },
        });
        if (!genDoc || genDoc.status !== "completed") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Generated document must be completed",
          });
        }
      } else {
        const isParsed = ["parsed", "ready", "intra_audit", "inter_audit"].includes(version.status);
        if (!isParsed) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Document version must be fully processed (current status: ${version.status})`,
          });
        }
      }

      const session = await prisma.tuningSession.create({
        data: {
          tenantId: ctx.user.tenantId,
          userId: ctx.user.userId,
          docVersionId: input.docVersionId,
          type: input.type,
          status: "pending_review",
          generatedDocId: input.generatedDocId ?? null,
        },
      });

      if (input.type === "section_classification") {
        await populateSectionVerdicts(session.id, input.docVersionId);
      } else if (input.type === "fact_extraction") {
        await populateFactVerdicts(session.id, input.docVersionId);
      } else if (input.type === "soa_detection") {
        await populateSoaVerdicts(session.id, input.docVersionId);
      } else if (input.type === "icf_generation") {
        await populateGenerationVerdicts(session.id, input.generatedDocId!);
      }

      return session;
    }),

  listSessions: adminProcedure
    .input(
      z.object({
        type: tuningTypeEnum.optional(),
        status: tuningSessionStatusEnum.optional(),
        goldenOnly: z.boolean().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const where: any = { tenantId: ctx.user.tenantId };
      if (input.type) where.type = input.type;
      if (input.status) where.status = input.status;
      if (input.goldenOnly) where.isGoldenSet = true;

      const sessions = await prisma.tuningSession.findMany({
        where,
        include: {
          docVersion: {
            select: {
              id: true,
              versionLabel: true,
              versionNumber: true,
              document: { select: { id: true, title: true, type: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      return sessions;
    }),

  getSession: adminProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const session = await prisma.tuningSession.findUnique({
        where: { id: input.sessionId },
        include: {
          docVersion: {
            select: {
              id: true,
              versionLabel: true,
              versionNumber: true,
              document: { select: { id: true, title: true, type: true } },
            },
          },
          generatedDoc: {
            select: {
              id: true,
              docType: true,
              status: true,
              createdAt: true,
            },
          },
        },
      });
      if (!session || session.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return session;
    }),

  /* ═══════════════ Section Verdicts ═══════════════ */

  getSectionVerdicts: adminProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const session = await prisma.tuningSession.findUnique({
        where: { id: input.sessionId },
      });
      if (!session || session.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const verdicts = await prisma.sectionVerdict.findMany({
        where: { tuningSessionId: input.sessionId },
        orderBy: { algoConfidence: "asc" },
      });

      const sectionIds = verdicts.map((v) => v.sectionId);
      const sections = await prisma.section.findMany({
        where: { id: { in: sectionIds } },
        include: {
          contentBlocks: { orderBy: { order: "asc" }, take: 3 },
        },
      });
      const sectionMap = new Map(sections.map((s) => [s.id, s]));

      return verdicts.map((v) => {
        const section = sectionMap.get(v.sectionId);
        return {
          ...v,
          sectionTitle: section?.title ?? "",
          sectionLevel: section?.level ?? 0,
          sectionOrder: section?.order ?? 0,
          contentPreview: section?.contentBlocks
            .map((b) => b.content)
            .join(" ")
            .slice(0, 300) ?? "",
        };
      });
    }),

  saveSectionVerdict: adminProcedure
    .input(
      z.object({
        verdictId: z.string().uuid(),
        auditorChoice: z.string(),
        auditorAgreedWith: z.enum(["algo", "llm", "custom"]),
        comment: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const verdict = await prisma.sectionVerdict.findUnique({
        where: { id: input.verdictId },
        include: { tuningSession: true },
      });
      if (!verdict || verdict.tuningSession.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      return prisma.sectionVerdict.update({
        where: { id: input.verdictId },
        data: {
          auditorChoice: input.auditorChoice,
          auditorAgreedWith: input.auditorAgreedWith,
          comment: input.comment ?? null,
          reviewedAt: new Date(),
        },
      });
    }),

  /* ═══════════════ Fact Verdicts ═══════════════ */

  getFactVerdicts: adminProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const session = await prisma.tuningSession.findUnique({
        where: { id: input.sessionId },
      });
      if (!session || session.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const verdicts = await prisma.factVerdict.findMany({
        where: { tuningSessionId: input.sessionId },
        orderBy: { factKey: "asc" },
      });

      const factIds = verdicts.map((v) => v.factId).filter(Boolean) as string[];
      const facts = await prisma.fact.findMany({
        where: { id: { in: factIds } },
      });
      const factMap = new Map(facts.map((f) => [f.id, f]));

      return verdicts.map((v) => {
        const fact = v.factId ? factMap.get(v.factId) : null;
        return {
          ...v,
          factCategory: fact?.factCategory ?? "",
          factDescription: fact?.description ?? "",
          sources: fact?.sources ?? [],
        };
      });
    }),

  saveFactVerdict: adminProcedure
    .input(
      z.object({
        verdictId: z.string().uuid(),
        isCorrect: z.boolean(),
        auditorValue: z.string().optional(),
        comment: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const verdict = await prisma.factVerdict.findUnique({
        where: { id: input.verdictId },
        include: { tuningSession: true },
      });
      if (!verdict || verdict.tuningSession.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      return prisma.factVerdict.update({
        where: { id: input.verdictId },
        data: {
          isCorrect: input.isCorrect,
          auditorValue: input.auditorValue ?? null,
          comment: input.comment ?? null,
          reviewedAt: new Date(),
        },
      });
    }),

  /* ═══════════════ SOA Verdicts ═══════════════ */

  getSoaVerdicts: adminProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const session = await prisma.tuningSession.findUnique({
        where: { id: input.sessionId },
      });
      if (!session || session.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const verdicts = await prisma.soaVerdict.findMany({
        where: { tuningSessionId: input.sessionId },
      });

      const soaTableIds = verdicts.map((v) => v.soaTableId).filter(Boolean) as string[];
      const soaTables = await prisma.soaTable.findMany({
        where: { id: { in: soaTableIds } },
        include: { cells: { orderBy: [{ rowIndex: "asc" }, { colIndex: "asc" }] } },
      });
      const tableMap = new Map(soaTables.map((t) => [t.id, t]));

      return verdicts.map((v) => {
        const table = v.soaTableId ? tableMap.get(v.soaTableId) : null;
        return {
          ...v,
          tableTitle: table?.title ?? "",
          soaScore: table?.soaScore ?? 0,
          cellCount: table?.cells.length ?? 0,
        };
      });
    }),

  saveSoaVerdict: adminProcedure
    .input(
      z.object({
        verdictId: z.string().uuid(),
        isCorrectDetection: z.boolean(),
        comment: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const verdict = await prisma.soaVerdict.findUnique({
        where: { id: input.verdictId },
        include: { tuningSession: true },
      });
      if (!verdict || verdict.tuningSession.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      return prisma.soaVerdict.update({
        where: { id: input.verdictId },
        data: {
          isCorrectDetection: input.isCorrectDetection,
          comment: input.comment ?? null,
          reviewedAt: new Date(),
        },
      });
    }),

  /* ═══════════════ Generation Verdicts ═══════════════ */

  getGenerationVerdicts: adminProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const session = await prisma.tuningSession.findUnique({
        where: { id: input.sessionId },
      });
      if (!session || session.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const verdicts = await prisma.generationVerdict.findMany({
        where: { tuningSessionId: input.sessionId },
        orderBy: { sectionTitle: "asc" },
      });

      const sectionIds = verdicts.map((v) => v.generatedDocSectionId);
      const sections = await prisma.generatedDocSection.findMany({
        where: { id: { in: sectionIds } },
      });
      const sectionMap = new Map(sections.map((s) => [s.id, s]));

      return verdicts.map((v) => {
        const section = sectionMap.get(v.generatedDocSectionId);
        return {
          ...v,
          content: section?.content ?? "",
          order: section?.order ?? 0,
          sectionStatus: section?.status ?? "unknown",
          qaFindings: section?.qaFindings ?? [],
        };
      });
    }),

  saveGenerationVerdict: adminProcedure
    .input(
      z.object({
        verdictId: z.string().uuid(),
        rating: z.number().min(1).max(5),
        comment: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const verdict = await prisma.generationVerdict.findUnique({
        where: { id: input.verdictId },
        include: { tuningSession: true },
      });
      if (!verdict || verdict.tuningSession.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      return prisma.generationVerdict.update({
        where: { id: input.verdictId },
        data: {
          rating: input.rating,
          comment: input.comment ?? null,
          reviewedAt: new Date(),
        },
      });
    }),

  getGeneratedDocsForTuning: adminProcedure
    .input(z.object({ protocolVersionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const version = await prisma.documentVersion.findUnique({
        where: { id: input.protocolVersionId },
        include: { document: { include: { study: true } } },
      });
      if (!version || version.document.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const docs = await prisma.generatedDoc.findMany({
        where: {
          protocolVersionId: input.protocolVersionId,
          status: "completed",
        },
        orderBy: { createdAt: "desc" },
        include: { sections: { select: { id: true, status: true } } },
      });

      return docs.map((d) => ({
        id: d.id,
        docType: d.docType,
        status: d.status,
        createdAt: d.createdAt,
        totalSections: d.sections.length,
      }));
    }),

  /* ═══════════════ Session lifecycle ═══════════════ */

  completeSession: adminProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const session = await prisma.tuningSession.findUnique({
        where: { id: input.sessionId },
      });
      if (!session || session.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      if (session.status === "completed") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Session already completed" });
      }

      const stats = await computeSessionStats(session.id, session.type);

      return prisma.tuningSession.update({
        where: { id: input.sessionId },
        data: {
          status: "completed",
          completedAt: new Date(),
          stats,
        },
      });
    }),

  toggleGoldenSet: adminProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const session = await prisma.tuningSession.findUnique({
        where: { id: input.sessionId },
      });
      if (!session || session.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      if (session.status !== "completed") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only completed sessions can be marked as golden set",
        });
      }

      return prisma.tuningSession.update({
        where: { id: input.sessionId },
        data: { isGoldenSet: !session.isGoldenSet },
      });
    }),

  listGoldenSets: adminProcedure
    .input(z.object({ type: tuningTypeEnum.optional() }))
    .query(async ({ ctx, input }) => {
      const where: any = { tenantId: ctx.user.tenantId, isGoldenSet: true };
      if (input.type) where.type = input.type;

      return prisma.tuningSession.findMany({
        where,
        include: {
          docVersion: {
            select: {
              id: true,
              versionLabel: true,
              versionNumber: true,
              document: { select: { id: true, title: true, type: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });
    }),

  runRegression: adminProcedure
    .input(z.object({ type: tuningTypeEnum }))
    .mutation(async ({ ctx, input }) => {
      const goldenSessions = await prisma.tuningSession.findMany({
        where: {
          tenantId: ctx.user.tenantId,
          isGoldenSet: true,
          type: input.type,
          status: "completed",
        },
      });

      if (goldenSessions.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No golden sets found for this type",
        });
      }

      const results: Array<{
        sessionId: string;
        docVersionId: string;
        totalItems: number;
        matches: number;
        mismatches: number;
        accuracy: number;
        details: Array<{ itemId: string; expected: string; current: string }>;
      }> = [];

      for (const session of goldenSessions) {
        if (input.type === "section_classification") {
          const result = await runSectionRegression(session);
          results.push(result);
        } else if (input.type === "fact_extraction") {
          const result = await runFactRegression(session);
          results.push(result);
        } else if (input.type === "soa_detection") {
          const result = await runSoaRegression(session);
          results.push(result);
        } else if (input.type === "icf_generation") {
          const result = await runGenerationRegression(session);
          results.push(result);
        }
      }

      const totalItems = results.reduce((s, r) => s + r.totalItems, 0);
      const totalMatches = results.reduce((s, r) => s + r.matches, 0);

      return {
        type: input.type,
        goldenSetCount: goldenSessions.length,
        totalItems,
        totalMatches,
        overallAccuracy: totalItems > 0 ? totalMatches / totalItems : 0,
        sessions: results,
      };
    }),

  getTaxonomy: adminProcedure.query(async () => {
    const ruleSet = await prisma.ruleSet.findFirst({
      where: { type: "section_classification" },
      include: {
        versions: {
          where: { isActive: true },
          include: { rules: true },
          take: 1,
        },
      },
    });

    if (!ruleSet || ruleSet.versions.length === 0) return [];

    return ruleSet.versions[0].rules.map((r) => {
      const config = r.config as any;
      return {
        key: config.key ?? r.name,
        name: r.name,
        titleRu: config.titleRu ?? r.name,
        type: config.type ?? "zone",
        parentZone: config.parentZone ?? null,
      };
    });
  }),

  getVersionsForTuning: adminProcedure
    .query(async ({ ctx }) => {
      const versions = await prisma.documentVersion.findMany({
        where: {
          document: { study: { tenantId: ctx.user.tenantId } },
          status: { in: ["parsed", "ready", "intra_audit", "inter_audit"] },
        },
        include: {
          document: { select: { id: true, title: true, type: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      });

      return versions.map((v) => ({
        id: v.id,
        versionNumber: v.versionNumber,
        versionLabel: v.versionLabel,
        status: v.status,
        documentTitle: v.document.title,
        documentType: v.document.type,
      }));
    }),
});

/* ═══════════════ Helper functions ═══════════════ */

async function populateSectionVerdicts(sessionId: string, docVersionId: string) {
  const sections = await prisma.section.findMany({
    where: { docVersionId },
    orderBy: { order: "asc" },
  });

  await prisma.sectionVerdict.createMany({
    data: sections.map((s) => ({
      tuningSessionId: sessionId,
      sectionId: s.id,
      algoResult: s.algoSection,
      algoConfidence: s.algoConfidence,
      llmResult: s.llmSection,
      llmConfidence: s.llmConfidence,
    })),
  });
}

async function populateFactVerdicts(sessionId: string, docVersionId: string) {
  const facts = await prisma.fact.findMany({
    where: { docVersionId },
    orderBy: { factKey: "asc" },
  });

  await prisma.factVerdict.createMany({
    data: facts.map((f) => ({
      tuningSessionId: sessionId,
      factId: f.id,
      factKey: f.factKey,
      llmValue: f.value,
      llmConfidence: f.confidence,
    })),
  });
}

async function populateSoaVerdicts(sessionId: string, docVersionId: string) {
  const soaTables = await prisma.soaTable.findMany({
    where: { docVersionId },
  });

  await prisma.soaVerdict.createMany({
    data: soaTables.map((t) => ({
      tuningSessionId: sessionId,
      soaTableId: t.id,
    })),
  });
}

async function populateGenerationVerdicts(sessionId: string, generatedDocId: string) {
  const sections = await prisma.generatedDocSection.findMany({
    where: { generatedDocId },
    orderBy: { order: "asc" },
  });

  await prisma.generationVerdict.createMany({
    data: sections.map((s) => ({
      tuningSessionId: sessionId,
      generatedDocSectionId: s.id,
      sectionTitle: s.title,
      standardSection: s.standardSection,
    })),
  });
}

async function computeSessionStats(sessionId: string, type: string) {
  if (type === "section_classification") {
    const verdicts = await prisma.sectionVerdict.findMany({
      where: { tuningSessionId: sessionId },
    });
    const total = verdicts.length;
    const reviewed = verdicts.filter((v) => v.reviewedAt).length;
    const algoCorrect = verdicts.filter((v) => v.auditorAgreedWith === "algo").length;
    const llmCorrect = verdicts.filter((v) => v.auditorAgreedWith === "llm").length;
    const custom = verdicts.filter((v) => v.auditorAgreedWith === "custom").length;

    return { total, reviewed, algoCorrect, llmCorrect, custom };
  }

  if (type === "fact_extraction") {
    const verdicts = await prisma.factVerdict.findMany({
      where: { tuningSessionId: sessionId },
    });
    const total = verdicts.length;
    const reviewed = verdicts.filter((v) => v.reviewedAt).length;
    const correct = verdicts.filter((v) => v.isCorrect === true).length;
    const incorrect = verdicts.filter((v) => v.isCorrect === false).length;

    return { total, reviewed, correct, incorrect };
  }

  if (type === "soa_detection") {
    const verdicts = await prisma.soaVerdict.findMany({
      where: { tuningSessionId: sessionId },
    });
    const total = verdicts.length;
    const reviewed = verdicts.filter((v) => v.reviewedAt).length;
    const correctDetections = verdicts.filter((v) => v.isCorrectDetection === true).length;
    const falseDetections = verdicts.filter((v) => v.isCorrectDetection === false).length;

    return { total, reviewed, correctDetections, falseDetections };
  }

  if (type === "icf_generation") {
    const verdicts = await prisma.generationVerdict.findMany({
      where: { tuningSessionId: sessionId },
    });
    const total = verdicts.length;
    const reviewed = verdicts.filter((v) => v.reviewedAt).length;
    const ratings = verdicts.filter((v) => v.rating > 0).map((v) => v.rating);
    const avgRating = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;
    const withComments = verdicts.filter((v) => v.comment && v.comment.length > 0).length;
    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of ratings) distribution[r] = (distribution[r] ?? 0) + 1;

    return { total, reviewed, avgRating: Math.round(avgRating * 100) / 100, withComments, distribution };
  }

  return {};
}

async function runSectionRegression(session: { id: string; docVersionId: string }) {
  const verdicts = await prisma.sectionVerdict.findMany({
    where: { tuningSessionId: session.id, auditorChoice: { not: null } },
  });

  const sections = await prisma.section.findMany({
    where: { docVersionId: session.docVersionId },
  });
  const sectionMap = new Map(sections.map((s) => [s.id, s]));

  const details: Array<{ itemId: string; expected: string; current: string }> = [];
  let matches = 0;

  for (const v of verdicts) {
    const section = sectionMap.get(v.sectionId);
    const current = section?.standardSection ?? "";
    const expected = v.auditorChoice ?? "";

    if (current === expected) {
      matches++;
    } else {
      details.push({ itemId: v.sectionId, expected, current });
    }
  }

  return {
    sessionId: session.id,
    docVersionId: session.docVersionId,
    totalItems: verdicts.length,
    matches,
    mismatches: verdicts.length - matches,
    accuracy: verdicts.length > 0 ? matches / verdicts.length : 0,
    details,
  };
}

async function runFactRegression(session: { id: string; docVersionId: string }) {
  const verdicts = await prisma.factVerdict.findMany({
    where: { tuningSessionId: session.id, isCorrect: { not: null } },
  });

  const facts = await prisma.fact.findMany({
    where: { docVersionId: session.docVersionId },
  });
  const factMap = new Map(facts.map((f) => [f.id, f]));

  const details: Array<{ itemId: string; expected: string; current: string }> = [];
  let matches = 0;

  for (const v of verdicts) {
    const fact = v.factId ? factMap.get(v.factId) : null;
    const currentValue = fact?.value ?? "";
    const expectedValue = v.auditorValue ?? (v.isCorrect ? currentValue : "");

    if (v.isCorrect && currentValue === (fact?.value ?? "")) {
      matches++;
    } else if (!v.isCorrect) {
      details.push({
        itemId: v.factKey,
        expected: v.auditorValue ?? "[marked incorrect]",
        current: currentValue,
      });
    } else {
      matches++;
    }
  }

  return {
    sessionId: session.id,
    docVersionId: session.docVersionId,
    totalItems: verdicts.length,
    matches,
    mismatches: verdicts.length - matches,
    accuracy: verdicts.length > 0 ? matches / verdicts.length : 0,
    details,
  };
}

async function runSoaRegression(session: { id: string; docVersionId: string }) {
  const verdicts = await prisma.soaVerdict.findMany({
    where: { tuningSessionId: session.id, isCorrectDetection: { not: null } },
  });

  const details: Array<{ itemId: string; expected: string; current: string }> = [];
  let matches = 0;

  const currentSoaTables = await prisma.soaTable.findMany({
    where: { docVersionId: session.docVersionId },
  });
  const currentIds = new Set(currentSoaTables.map((t) => t.id));

  for (const v of verdicts) {
    const stillExists = v.soaTableId ? currentIds.has(v.soaTableId) : false;

    if (v.isCorrectDetection && stillExists) {
      matches++;
    } else if (!v.isCorrectDetection && !stillExists) {
      matches++;
    } else {
      details.push({
        itemId: v.soaTableId ?? "unknown",
        expected: v.isCorrectDetection ? "should_exist" : "should_not_exist",
        current: stillExists ? "exists" : "missing",
      });
    }
  }

  return {
    sessionId: session.id,
    docVersionId: session.docVersionId,
    totalItems: verdicts.length,
    matches,
    mismatches: verdicts.length - matches,
    accuracy: verdicts.length > 0 ? matches / verdicts.length : 0,
    details,
  };
}

async function runGenerationRegression(session: { id: string; docVersionId: string }) {
  const verdicts = await prisma.generationVerdict.findMany({
    where: { tuningSessionId: session.id, reviewedAt: { not: null } },
  });

  const GOOD_THRESHOLD = 4;
  const details: Array<{ itemId: string; expected: string; current: string }> = [];
  let matches = 0;

  for (const v of verdicts) {
    if (v.rating >= GOOD_THRESHOLD) {
      matches++;
    } else {
      details.push({
        itemId: v.generatedDocSectionId,
        expected: `rating >= ${GOOD_THRESHOLD}`,
        current: `rating ${v.rating}${v.comment ? ` — ${v.comment.slice(0, 80)}` : ""}`,
      });
    }
  }

  return {
    sessionId: session.id,
    docVersionId: session.docVersionId,
    totalItems: verdicts.length,
    matches,
    mismatches: verdicts.length - matches,
    accuracy: verdicts.length > 0 ? matches / verdicts.length : 0,
    details,
  };
}
