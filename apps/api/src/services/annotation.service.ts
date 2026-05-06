import { prisma } from "@clinscriptum/db";
import type { AnnotationStatus, GoldenStageStatus } from "@prisma/client";
import { DomainError } from "./errors.js";
import { logger } from "../lib/logger.js";

/**
 * Golden-dataset annotation service (Sprint 7b).
 *
 * Workflow:
 *  1. Annotator opens a sample → submitAnnotation(sectionKey, proposedZone OR question)
 *  2. If !isQuestion → annotation.status = 'open' → finalizeOpenAnnotations() can
 *     promote it into the stage's expected_results (auto-finalize on submit).
 *  3. If isQuestion → annotation.status = 'open', visible in expert queue.
 *  4. Expert opens queue → resolveQuestion(annotationId, finalZone, rationale)
 *     creates GoldenAnnotationDecision and marks annotation 'answered'.
 *  5. finalizeAnnotations(sample, stage) merges all 'open' (non-question) and
 *     'answered' annotations into the stage's expected_results JSON, marks them
 *     'finalized', and bumps the stage status to in_review (if was draft).
 */

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

    const annotation = await prisma.goldenAnnotation.upsert({
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
        status: "open",
      },
      update: {
        proposedZone: input.proposedZone,
        isQuestion: input.isQuestion,
        questionText: input.questionText,
        // Re-submission resets status: previously 'finalized' → 'open' so the
        // change can be re-finalized; previously 'answered' → 'open' too.
        status: "open",
      },
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
      await tx.goldenAnnotation.update({
        where: { id: input.annotationId },
        data: { status: "answered" },
      });
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
    const annotations = await prisma.goldenAnnotation.findMany({
      where: {
        goldenSampleId,
        stage,
        status: { in: ["open", "answered"] },
      },
      include: { decision: true },
    });

    // Skip questions that have no decision yet — they remain in expert queue.
    const finalizableNow = annotations.filter(
      (a) => !a.isQuestion || a.decision !== null,
    );
    const pendingQuestions = annotations.filter(
      (a) => a.isQuestion && a.decision === null,
    );

    // Build sections array for expected_results (classification stage shape).
    const sectionsByKey = new Map<string, string>();
    for (const a of finalizableNow) {
      const finalZone = a.decision?.finalZone ?? a.proposedZone;
      if (finalZone) sectionsByKey.set(a.sectionKey, finalZone);
    }

    // Read current expected_results to preserve unannotated entries.
    const currentStatus = await prisma.goldenSampleStageStatus.findUnique({
      where: { goldenSampleId_stage: { goldenSampleId, stage } },
    });
    const currentExpected = (currentStatus?.expectedResults ?? {}) as Record<
      string,
      unknown
    >;

    // For classification: expected_results.sections is array of {title, standardSection}
    // For other stages we just merge sections-by-key naively.
    const sectionsArray = Array.from(sectionsByKey.entries()).map(
      ([sectionKey, standardSection]) => ({
        title: sectionKey,
        standardSection,
      }),
    );
    const newExpected = { ...currentExpected, sections: sectionsArray };

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
          expectedResults: newExpected as object,
          status: "in_review" as GoldenStageStatus,
          reviewedById: actorId,
          reviewedAt: new Date(),
        },
      });
      const finalizedIds = finalizableNow.map((a) => a.id);
      if (finalizedIds.length > 0) {
        await tx.goldenAnnotation.updateMany({
          where: { id: { in: finalizedIds } },
          data: { status: "finalized" },
        });
      }
      return {
        finalizedCount: finalizedIds.length,
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
