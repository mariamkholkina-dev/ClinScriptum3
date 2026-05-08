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

/**
 * Relational upsert of an expected section row (PR F).
 *
 * Replaces the previous JSON `expected_results.sections` mutation with explicit
 * `expectedSection` rows. Match is by case-insensitive trimmed `title` within
 * the stage status. `standardSection === null` deletes the row (used when
 * annotator switches to "question" mode and the previous zone proposal needs
 * to disappear from the truth set until the expert resolves).
 *
 * When creating a new row, we attempt to anchor it to a real `Section` from
 * any of the sample's documents — that way, after a re-parse, the relink
 * routine has paragraphIndex/title to re-bind. Anchor is best-effort: if no
 * matching real section exists (annotator added the row pre-parse), we still
 * create the expected row with a textSnippet-only anchor and `realSectionId=null`.
 *
 * The deprecated JSON column `expected_results` is intentionally left alone —
 * UI clients migrate gradually; cleanup PR drops the column later.
 */
async function upsertSectionInExpected(
  tx: Prisma.TransactionClient,
  goldenSampleId: string,
  stage: string,
  sectionKey: string,
  standardSection: string | null, // null => удалить запись
) {
  // Ensure the stage status row exists (create as draft if missing) so the
  // FK on ExpectedSection has a target. Mirrors previous behaviour where the
  // upsert in the JSON helper would lazily create the stage status on first
  // annotation submission.
  const stageStatus = await tx.goldenSampleStageStatus.upsert({
    where: { goldenSampleId_stage: { goldenSampleId, stage } },
    create: {
      goldenSampleId,
      stage,
      status: "draft" as GoldenStageStatus,
      expectedResults: {},
    },
    update: {},
    select: { id: true },
  });

  // Look up an existing expected row (by title) within this stage status.
  const existing = await tx.expectedSection.findFirst({
    where: {
      goldenSampleStageStatusId: stageStatus.id,
      title: { equals: sectionKey, mode: "insensitive" },
    },
  });

  if (standardSection === null) {
    if (existing) {
      await tx.expectedSection.delete({ where: { id: existing.id } });
    }
    return;
  }

  if (existing) {
    await tx.expectedSection.update({
      where: { id: existing.id },
      data: { standardSection },
    });
    return;
  }

  // Creating a new expected row — try to anchor it to a real Section from
  // any of the sample's bound documents. If no doc / no matching section,
  // we still create the row with a textSnippet-only anchor.
  const docLinks = await tx.goldenSampleDocument.findMany({
    where: { goldenSampleId },
    select: { documentVersionId: true },
  });
  const docVersionIds = docLinks.map((d) => d.documentVersionId);
  const realSection = docVersionIds.length
    ? await tx.section.findFirst({
        where: {
          docVersionId: { in: docVersionIds },
          title: { equals: sectionKey, mode: "insensitive" },
        },
      })
    : null;

  const realAnchor = (realSection?.sourceAnchor ?? null) as
    | { paragraphIndex?: number; textSnippet?: string }
    | null;
  const anchor: Record<string, unknown> = {
    textSnippet: (realSection?.title ?? sectionKey).slice(0, 200),
    occurrenceIndex: 0,
  };
  if (realAnchor && typeof realAnchor.paragraphIndex === "number") {
    anchor.paragraphIndex = realAnchor.paragraphIndex;
  }

  await tx.expectedSection.create({
    data: {
      goldenSampleStageStatusId: stageStatus.id,
      title: sectionKey,
      level: realSection?.level ?? 1,
      standardSection,
      anchor: anchor as Prisma.InputJsonValue,
      order: 0,
      realSectionId: realSection?.id ?? null,
      matchMethod: realSection ? "paragraph" : null,
      matchedAt: realSection ? new Date() : null,
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

    // Auto-save mode: данные уже в expectedSection rows (через submit/resolve).
    // Этот метод теперь только меняет status stage → in_review для workflow.
    const result = await prisma.$transaction(async (tx) => {
      await tx.goldenSampleStageStatus.upsert({
        where: { goldenSampleId_stage: { goldenSampleId, stage } },
        create: {
          goldenSampleId,
          stage,
          status: "in_review" as GoldenStageStatus,
          expectedResults: {},
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
