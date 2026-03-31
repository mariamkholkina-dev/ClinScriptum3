import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { prisma } from "@clinscriptum/db";
import { router, protectedProcedure } from "../trpc/trpc.js";
import {
  loadFactRegistry,
  FACT_CATEGORY_LABELS,
} from "../data/fact-registry.js";

export const processingRouter = router({
  startRun: protectedProcedure
    .input(
      z.object({
        docVersionId: z.string().uuid(),
        type: z.enum([
          "section_classification",
          "fact_extraction",
          "soa_detection",
          "intra_doc_audit",
          "inter_doc_audit",
          "icf_generation",
          "csr_generation",
          "version_comparison",
        ]),
        ruleSetVersionId: z.string().uuid().optional(),
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

      const run = await prisma.processingRun.create({
        data: {
          studyId: version.document.studyId,
          docVersionId: input.docVersionId,
          type: input.type,
          ruleSetVersionId: input.ruleSetVersionId ?? null,
        },
      });

      return { runId: run.id, status: run.status };
    }),

  getRun: protectedProcedure
    .input(z.object({ runId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const run = await prisma.processingRun.findUnique({
        where: { id: input.runId },
        include: {
          steps: { orderBy: { startedAt: "asc" } },
          study: true,
        },
      });
      if (!run || run.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return run;
    }),

  listRuns: protectedProcedure
    .input(z.object({ docVersionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return prisma.processingRun.findMany({
        where: {
          docVersionId: input.docVersionId,
          study: { tenantId: ctx.user.tenantId },
        },
        include: { steps: true },
        orderBy: { createdAt: "desc" },
      });
    }),

  listFacts: protectedProcedure
    .input(z.object({ docVersionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const version = await prisma.documentVersion.findUnique({
        where: { id: input.docVersionId },
        include: { document: { include: { study: true } } },
      });
      if (!version || version.document.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return prisma.fact.findMany({
        where: { docVersionId: input.docVersionId },
        orderBy: { factKey: "asc" },
      });
    }),

  listFindings: protectedProcedure
    .input(z.object({ docVersionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const version = await prisma.documentVersion.findUnique({
        where: { id: input.docVersionId },
        include: { document: { include: { study: true } } },
      });
      if (!version || version.document.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return prisma.finding.findMany({
        where: { docVersionId: input.docVersionId },
        orderBy: { createdAt: "desc" },
      });
    }),

  updateFindingStatus: protectedProcedure
    .input(
      z.object({
        findingId: z.string().uuid(),
        status: z.enum(["pending", "confirmed", "rejected", "resolved", "false_positive"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const finding = await prisma.finding.findUnique({
        where: { id: input.findingId },
        include: { docVersion: { include: { document: { include: { study: true } } } } },
      });
      if (!finding || finding.docVersion.document.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return prisma.finding.update({
        where: { id: input.findingId },
        data: { status: input.status },
      });
    }),

  listFactsByStudy: protectedProcedure
    .input(z.object({ studyId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const study = await prisma.study.findFirst({
        where: { id: input.studyId, tenantId: ctx.user.tenantId },
      });
      if (!study) throw new TRPCError({ code: "NOT_FOUND" });

      return prisma.fact.findMany({
        where: {
          docVersion: { document: { studyId: input.studyId } },
        },
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
        orderBy: { factKey: "asc" },
      });
    }),

  listFindingsByStudy: protectedProcedure
    .input(z.object({ studyId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const study = await prisma.study.findFirst({
        where: { id: input.studyId, tenantId: ctx.user.tenantId },
      });
      if (!study) throw new TRPCError({ code: "NOT_FOUND" });

      return prisma.finding.findMany({
        where: {
          docVersion: { document: { studyId: input.studyId } },
        },
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

  getFactRegistry: protectedProcedure.query(async () => {
    const registry = loadFactRegistry();
    return { entries: registry, categoryLabels: FACT_CATEGORY_LABELS };
  }),

  updateFactStatus: protectedProcedure
    .input(
      z.object({
        factId: z.string().uuid(),
        status: z.enum(["extracted", "verified", "validated", "deferred", "not_found", "rejected"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const fact = await prisma.fact.findUnique({
        where: { id: input.factId },
        include: { docVersion: { include: { document: { include: { study: true } } } } },
      });
      if (!fact || fact.docVersion.document.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return prisma.fact.update({
        where: { id: input.factId },
        data: { status: input.status },
      });
    }),

  updateFactValue: protectedProcedure
    .input(
      z.object({
        factId: z.string().uuid(),
        manualValue: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const fact = await prisma.fact.findUnique({
        where: { id: input.factId },
        include: { docVersion: { include: { document: { include: { study: true } } } } },
      });
      if (!fact || fact.docVersion.document.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return prisma.fact.update({
        where: { id: input.factId },
        data: {
          manualValue: input.manualValue,
          status: fact.status === "not_found" ? "extracted" : fact.status,
        },
      });
    }),

  validateAllFacts: protectedProcedure
    .input(z.object({ docVersionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const version = await prisma.documentVersion.findUnique({
        where: { id: input.docVersionId },
        include: { document: { include: { study: true } } },
      });
      if (!version || version.document.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await prisma.fact.updateMany({
        where: {
          docVersionId: input.docVersionId,
          status: { notIn: ["not_found", "rejected"] },
        },
        data: { status: "validated" },
      });
      return { success: true };
    }),

  createManualFact: protectedProcedure
    .input(
      z.object({
        docVersionId: z.string().uuid(),
        factKey: z.string(),
        factCategory: z.string(),
        description: z.string(),
        value: z.string(),
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
      return prisma.fact.create({
        data: {
          docVersionId: input.docVersionId,
          factKey: input.factKey,
          factCategory: input.factCategory,
          description: input.description,
          value: input.value,
          manualValue: input.value,
          confidence: 1.0,
          factClass: input.factCategory === "bioequivalence" ? "phase_specific" : "general",
          sources: [],
          hasContradiction: false,
          status: "extracted",
        },
      });
    }),

  // ─── SOA endpoints ─────────────────────────────────────

  getSoaData: protectedProcedure
    .input(z.object({ docVersionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const version = await prisma.documentVersion.findUnique({
        where: { id: input.docVersionId },
        include: { document: { include: { study: true } } },
      });
      if (!version || version.document.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const tables = await prisma.soaTable.findMany({
        where: { docVersionId: input.docVersionId },
        include: { cells: { orderBy: [{ rowIndex: "asc" }, { colIndex: "asc" }] } },
        orderBy: { createdAt: "asc" },
      });

      // Fetch source block rawHtml for each table
      const result = await Promise.all(
        tables.map(async (table) => {
          let sourceHtml: string | null = null;
          if (table.sourceBlockId) {
            const block = await prisma.contentBlock.findUnique({
              where: { id: table.sourceBlockId },
              select: { rawHtml: true },
            });
            sourceHtml = block?.rawHtml ?? null;
          }
          return { ...table, sourceHtml };
        })
      );

      return result;
    }),

  updateSoaCell: protectedProcedure
    .input(
      z.object({
        cellId: z.string().uuid(),
        manualValue: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const cell = await prisma.soaCell.findUnique({
        where: { id: input.cellId },
        include: {
          soaTable: {
            include: {
              docVersion: { include: { document: { include: { study: true } } } },
            },
          },
        },
      });
      if (!cell || cell.soaTable.docVersion.document.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return prisma.soaCell.update({
        where: { id: input.cellId },
        data: { manualValue: input.manualValue },
      });
    }),

  validateSoa: protectedProcedure
    .input(z.object({ soaTableId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const table = await prisma.soaTable.findUnique({
        where: { id: input.soaTableId },
        include: {
          docVersion: { include: { document: { include: { study: true } } } },
        },
      });
      if (!table || table.docVersion.document.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return prisma.soaTable.update({
        where: { id: input.soaTableId },
        data: { status: "validated" },
      });
    }),

  addSoaVisit: protectedProcedure
    .input(
      z.object({
        soaTableId: z.string().uuid(),
        visitName: z.string().min(1),
        dayLabel: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const table = await prisma.soaTable.findUnique({
        where: { id: input.soaTableId },
        include: {
          docVersion: { include: { document: { include: { study: true } } } },
          cells: true,
        },
      });
      if (!table || table.docVersion.document.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const headerData = table.headerData as { visits: string[] };
      const newColIndex = headerData.visits.length;
      headerData.visits.push(input.visitName);

      // Get unique procedures (rows)
      const procedures = [...new Set(table.cells.map((c) => c.procedureName))];
      const maxRow = table.cells.length > 0
        ? Math.max(...table.cells.map((c) => c.rowIndex))
        : -1;

      await prisma.$transaction(async (tx) => {
        await tx.soaTable.update({
          where: { id: input.soaTableId },
          data: { headerData },
        });

        // Create empty cells for the new visit column
        for (let row = 0; row <= maxRow; row++) {
          const existingCell = table.cells.find((c) => c.rowIndex === row);
          if (!existingCell) continue;
          await tx.soaCell.create({
            data: {
              soaTableId: input.soaTableId,
              rowIndex: row,
              colIndex: newColIndex,
              procedureName: existingCell.procedureName,
              visitName: input.visitName,
              rawValue: "",
              normalizedValue: "",
              confidence: 1.0,
            },
          });
        }
      });

      return { success: true };
    }),

  addSoaProcedure: protectedProcedure
    .input(
      z.object({
        soaTableId: z.string().uuid(),
        procedureName: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const table = await prisma.soaTable.findUnique({
        where: { id: input.soaTableId },
        include: {
          docVersion: { include: { document: { include: { study: true } } } },
          cells: true,
        },
      });
      if (!table || table.docVersion.document.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const headerData = table.headerData as { visits: string[] };
      const newRowIndex = table.cells.length > 0
        ? Math.max(...table.cells.map((c) => c.rowIndex)) + 1
        : 0;

      await prisma.$transaction(async (tx) => {
        for (let col = 0; col < headerData.visits.length; col++) {
          await tx.soaCell.create({
            data: {
              soaTableId: input.soaTableId,
              rowIndex: newRowIndex,
              colIndex: col,
              procedureName: input.procedureName,
              visitName: headerData.visits[col],
              rawValue: "",
              normalizedValue: "",
              confidence: 1.0,
            },
          });
        }
      });

      return { success: true };
    }),

  updateSectionStatus: protectedProcedure
    .input(
      z.object({
        sectionId: z.string().uuid(),
        status: z.enum(["validated", "not_validated", "requires_rework"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const section = await prisma.section.findUnique({
        where: { id: input.sectionId },
        include: { docVersion: { include: { document: { include: { study: true } } } } },
      });
      if (!section || section.docVersion.document.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return prisma.section.update({
        where: { id: input.sectionId },
        data: { status: input.status },
      });
    }),
});
