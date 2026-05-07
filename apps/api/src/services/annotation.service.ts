import { prisma } from "@clinscriptum/db";
import type { AnnotationStatus, GoldenStageStatus, Prisma } from "@prisma/client";
import { DomainError } from "./errors.js";
import { logger } from "../lib/logger.js";

/**
 * Golden-dataset annotation service (Sprint 7b — H+I auto-save mode).
 *
 * Workflow:
 *  1. Annotator opens a sample → submitAnnotation(sectionKey, proposedZone OR question)
 *  2. If !isQuestion → annotation 'open' AND expected_results.sections instantly
 *     updated with the new zone (auto-save).
 *  3. If isQuestion → annotation 'open', visible in expert queue. The previous
 *     entry for this section in expected_results.sections (if any) is removed —
 *     pending question shouldn't influence eval until expert resolves.
 *  4. Expert resolveQuestion → decision created, annotation 'answered',
 *     expected_results.sections updated with finalZone.
 *  5. Stage status changes (draft → in_review → approved) are managed by the
 *     existing UI on /golden-dataset/[id] — no separate "finalize" step.
 */

// Helper: одна запись секции в expected_results.sections.
type ExpectedSectionEntry = { title: string; standardSection: string };

/** Мутирующий helper. Принимает tx, модифицирует expected_results.sections atomic. */
async function upsertSectionInExpected(
  tx: Prisma.TransactionClient,
  goldenSampleId: string,
  stage: string,
  sectionKey: string,
  standardSection: string | null, // null => удалить запись
) {
  const current = await tx.goldenSampleStageStatus.findUnique({
    where: { goldenSampleId_stage: { goldenSampleId, stage } },
  });
  const expected = (current?.expectedResults ?? {}) as { sections?: ExpectedSectionEntry[] };
  const sections: ExpectedSectionEntry[] = Array.isArray(expected.sections)
    ? [...expected.sections]
    : [];

  const idx = sections.findIndex((s) => s.title === sectionKey);
  if (standardSection === null) {
    if (idx >= 0) sections.splice(idx, 1);
  } else {
    if (idx >= 0) sections[idx] = { title: sectionKey, standardSection };
    else sections.push({ title: sectionKey, standardSection });
  }
  expected.sections = sections;

  await tx.goldenSampleStageStatus.upsert({
    where: { goldenSampleId_stage: { goldenSampleId, stage } },
    create: {
      goldenSampleId,
      stage,
      status: "draft" as GoldenStageStatus,
      expectedResults: expected as object,
    },
    update: {
      expectedResults: expected as object,
    },
  });
}

interface SubmitInput {
  goldenSampleId: string;
  stage: string;
  sectionKey: string;
  annotatorId: string;
  proposedZone?: string;
  isQuestion: boolean;
  questionText?: string;
}

interface ResolveInput {
  annotationId: string;
  decidedById: string;
  finalZone: string;
  rationale?: string;
}

export const annotationService = {
  /**
   * Submit (or update) one annotation for a section. The same annotator can
   * re-submit for the same section — it overwrites the previous proposal.
   */
  async submitAnnotation(input: SubmitInput) {
    if (!input.isQuestion && !input.proposedZone) {
      throw new DomainError(
        "BAD_REQUEST",
        "proposedZone is required when isQuestion=false",
      );
    }
    if (input.isQuestion && !input.questionText) {
      throw new DomainError(
        "BAD_REQUEST",
        "questionText is required when isQuestion=true",
      );
    }

    const sample = await prisma.goldenSample.findUnique({
      where: { id: input.goldenSampleId },
    });
    if (!sample) {
      throw new DomainError("NOT_FOUND", "Golden sample not found");
    }

    const annotation = await prisma.$transaction(async (tx) => {
      const a = await tx.goldenAnnotation.upsert({
        where: {
          goldenSampleId_stage_sectionKey_annotatorId: {
            goldenSampleId: input.goldenSampleId,
            stage: input.stage,
            sectionKey: input.sectionKey,
            annotatorId: input.annotatorId,
          },
        },
        create: {
          goldenSampleId: input.goldenSampleId,
          stage: input.stage,
          sectionKey: input.sectionKey,
          annotatorId: input.annotatorId,
          proposedZone: input.proposedZone,
          isQuestion: input.isQuestion,
          questionText: input.questionText,
          status: input.isQuestion ? "open" : "finalized",
        },
        update: {
          proposedZone: input.proposedZone,
          isQuestion: input.isQuestion,
          questionText: input.questionText,
          // Auto-save mode: non-question annotations land in expected_results
          // immediately, so their workflow status is 'finalized' from the start.
          // Questions stay 'open' until expert resolves.
          status: input.isQuestion ? "open" : "finalized",
        },
      });

      // Auto-save into expected_results.sections — H+I mode.
      // Question (no zone yet) → удалить запись; zone → upsert.
      const targetZone = input.isQuestion ? null : (input.proposedZone ?? null);
      await upsertSectionInExpected(
        tx,
        input.goldenSampleId,
        input.stage,
        input.sectionKey,
        targetZone,
      );
      return a;
    });

    logger.info("annotation_submitted", {
      annotationId: annotation.id,
      sampleId: input.goldenSampleId,
      stage: input.stage,
      isQuestion: input.isQuestion,
    });

    return annotation;
  },

  /**
   * List annotations for a sample/stage. Optionally filter by status or
   * annotator. Used by annotator UI (his own) and expert UI (questions).
   */
  async listAnnotations(filters: {
    goldenSampleId: string;
    stage?: string;
    status?: AnnotationStatus;
    isQuestion?: boolean;
    annotatorId?: string;
  }) {
    const where: Record<string, unknown> = {
      goldenSampleId: filters.goldenSampleId,
    };
    if (filters.stage) where.stage = filters.stage;
    if (filters.status) where.status = filters.status;
    if (filters.isQuestion !== undefined) where.isQuestion = filters.isQuestion;
    if (filters.annotatorId) where.annotatorId = filters.annotatorId;

    return prisma.goldenAnnotation.findMany({
      where,
      include: {
        annotator: { select: { id: true, name: true, email: true } },
        decision: {
          include: {
            decidedBy: { select: { id: true, name: true, email: true } },
          },
        },
      },
      orderBy: { annotatedAt: "asc" },
    });
  },

  /**
   * Expert queue: questions across all samples in a tenant that need a decision.
   */
  async listExpertQueue(tenantId: string, limit = 50) {
    return prisma.goldenAnnotation.findMany({
      where: {
        isQuestion: true,
        status: "open",
        goldenSample: { tenantId },
      },
      include: {
        annotator: { select: { id: true, name: true, email: true } },
        goldenSample: { select: { id: true, name: true } },
      },
      orderBy: { annotatedAt: "asc" },
      take: limit,
    });
  },

  /**
   * Expert resolves a question: records the final zone with optional rationale.
   * Annotation moves to 'answered' status (will be picked up by next finalize).
   */
  async resolveQuestion(input: ResolveInput) {
    const annotation = await prisma.goldenAnnotation.findUnique({
      where: { id: input.annotationId },
    });
    if (!annotation) {
      throw new DomainError("NOT_FOUND", "Annotation not found");
    }
    if (!annotation.isQuestion) {
      throw new DomainError(
        "BAD_REQUEST",
        "Annotation is not a question — no decision required",
      );
    }
    if (annotation.status === "finalized") {
      throw new DomainError(
        "CONFLICT",
        "Annotation already finalized — cannot resolve",
      );
    }

    const decision = await prisma.$transaction(async (tx) => {
      const d = await tx.goldenAnnotationDecision.upsert({
        where: { annotationId: input.annotationId },
        create: {
          annotationId: input.annotationId,
          finalZone: input.finalZone,
          decidedById: input.decidedById,
          rationale: input.rationale,
        },
        update: {
          finalZone: input.finalZone,
          decidedById: input.decidedById,
          rationale: input.rationale,
        },
      });
      // Auto-save mode: expert decision instantly applied to expected_results,
      // annotation status → 'finalized' (it's now in the truth set).
      await tx.goldenAnnotation.update({
        where: { id: input.annotationId },
        data: { status: "finalized" },
      });
      await upsertSectionInExpected(
        tx,
        annotation.goldenSampleId,
        annotation.stage,
        annotation.sectionKey,
        input.finalZone,
      );
      return d;
    });

    logger.info("annotation_question_resolved", {
      annotationId: input.annotationId,
      finalZone: input.finalZone,
    });

    return decision;
  },

  /**
   * Bulk-finalize all open/answered annotations for a sample+stage. Pushes
   * them into the stage's expected_results JSON and marks them finalized.
   *
   * Called when annotator submits the whole sample for review (status:
   * draft → in_review).
   */
  async finalizeAnnotations(
    goldenSampleId: string,
    stage: string,
    actorId: string,
  ) {
    // H+I auto-save mode: данные уже в expected_results (через submit/resolve).
    // Этот метод теперь только меняет status stage → in_review для workflow.
    // Считаем количество pending questions для UI (показать сколько ещё не
    // решено экспертом).
    const annotations = await prisma.goldenAnnotation.findMany({
      where: { goldenSampleId, stage },
      include: { decision: true },
    });
    const finalizedCount = annotations.filter((a) => a.status === "finalized").length;
    const pendingQuestions = annotations.filter(
      (a) => a.isQuestion && a.decision === null,
    );

    const currentStatus = await prisma.goldenSampleStageStatus.findUnique({
      where: { goldenSampleId_stage: { goldenSampleId, stage } },
    });
    // Сохраняем текущий expected_results как есть — он уже актуальный благодаря
    // auto-save в submitAnnotation / resolveQuestion.
    const newExpected = (currentStatus?.expectedResults ?? {}) as object;

    const result = await prisma.$transaction(async (tx) => {
      await tx.goldenSampleStageStatus.upsert({
        where: { goldenSampleId_stage: { goldenSampleId, stage } },
        create: {
          goldenSampleId,
          stage,
          status: "in_review" as GoldenStageStatus,
          expectedResults: newExpected as object,
          reviewedById: actorId,
          reviewedAt: new Date(),
        },
        update: {
          status: "in_review" as GoldenStageStatus,
          reviewedById: actorId,
          reviewedAt: new Date(),
        },
      });
      return {
        finalizedCount,
        pendingQuestionsCount: pendingQuestions.length,
      };
    });

    logger.info("annotations_finalized", {
      goldenSampleId,
      stage,
      ...result,
    });

    return result;
  },

  /**
   * Get a single annotation with its decision, for UI detail view.
   */
  async getAnnotation(id: string) {
    const annotation = await prisma.goldenAnnotation.findUnique({
      where: { id },
      include: {
        annotator: { select: { id: true, name: true, email: true } },
        goldenSample: { select: { id: true, name: true, tenantId: true } },
        decision: {
          include: {
            decidedBy: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });
    if (!annotation) {
      throw new DomainError("NOT_FOUND", "Annotation not found");
    }
    return annotation;
  },

  /**
   * Stats for sample/stage progress: how many sections annotated vs total
   * (caller passes total, since it depends on actual section count).
   */
  async getProgress(goldenSampleId: string, stage: string) {
    const [open, answered, finalized, questions] = await Promise.all([
      prisma.goldenAnnotation.count({
        where: { goldenSampleId, stage, status: "open", isQuestion: false },
      }),
      prisma.goldenAnnotation.count({
        where: { goldenSampleId, stage, status: "answered" },
      }),
      prisma.goldenAnnotation.count({
        where: { goldenSampleId, stage, status: "finalized" },
      }),
      prisma.goldenAnnotation.count({
        where: { goldenSampleId, stage, isQuestion: true, status: "open" },
      }),
    ]);
    return { open, answered, finalized, openQuestions: questions };
  },
};
