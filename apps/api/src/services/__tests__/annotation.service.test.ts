import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clinscriptum/db", () => ({
  prisma: {
    goldenSample: { findUnique: vi.fn() },
    goldenAnnotation: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    goldenAnnotationDecision: {
      upsert: vi.fn(),
    },
    goldenSampleStageStatus: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    $transaction: vi.fn((fn: (tx: unknown) => unknown) =>
      typeof fn === "function"
        ? fn({
            goldenAnnotation: {
              update: vi.fn().mockResolvedValue({}),
              updateMany: vi.fn().mockResolvedValue({ count: 0 }),
            },
            goldenAnnotationDecision: {
              upsert: vi.fn().mockResolvedValue({ id: "dec-1" }),
            },
            goldenSampleStageStatus: {
              upsert: vi.fn().mockResolvedValue({}),
            },
          })
        : Promise.all(fn as unknown as Promise<unknown>[]),
    ),
  },
}));

vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { prisma } from "@clinscriptum/db";
import { annotationService } from "../annotation.service.js";
import { DomainError } from "../errors.js";

const mockSample = prisma.goldenSample as unknown as {
  findUnique: ReturnType<typeof vi.fn>;
};
const mockAnnotation = prisma.goldenAnnotation as unknown as {
  upsert: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  findUnique: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
  updateMany: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};

const SAMPLE_ID = "sample-aaa";
const ANNOTATOR_ID = "annot-1";
const EXPERT_ID = "expert-1";

describe("annotationService.submitAnnotation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSample.findUnique.mockResolvedValue({ id: SAMPLE_ID, tenantId: "t1" });
  });

  it("creates annotation when annotator selects a zone", async () => {
    mockAnnotation.upsert.mockResolvedValue({ id: "a1", proposedZone: "ethics.informed_consent" });

    const result = await annotationService.submitAnnotation({
      goldenSampleId: SAMPLE_ID,
      stage: "classification",
      sectionKey: "Информированное согласие",
      annotatorId: ANNOTATOR_ID,
      proposedZone: "ethics.informed_consent",
      isQuestion: false,
    });

    expect(result.id).toBe("a1");
    const args = mockAnnotation.upsert.mock.calls[0][0];
    expect(args.create.proposedZone).toBe("ethics.informed_consent");
    expect(args.create.isQuestion).toBe(false);
    expect(args.create.status).toBe("open");
  });

  it("creates annotation as question with text", async () => {
    mockAnnotation.upsert.mockResolvedValue({ id: "a2", isQuestion: true });

    await annotationService.submitAnnotation({
      goldenSampleId: SAMPLE_ID,
      stage: "classification",
      sectionKey: "Раздел X",
      annotatorId: ANNOTATOR_ID,
      isQuestion: true,
      questionText: "Не уверена — это safety или ethics?",
    });

    const args = mockAnnotation.upsert.mock.calls[0][0];
    expect(args.create.isQuestion).toBe(true);
    expect(args.create.questionText).toContain("Не уверена");
  });

  it("rejects when isQuestion=false and proposedZone missing", async () => {
    await expect(
      annotationService.submitAnnotation({
        goldenSampleId: SAMPLE_ID,
        stage: "classification",
        sectionKey: "X",
        annotatorId: ANNOTATOR_ID,
        isQuestion: false,
      }),
    ).rejects.toThrow(DomainError);
  });

  it("rejects when isQuestion=true and questionText missing", async () => {
    await expect(
      annotationService.submitAnnotation({
        goldenSampleId: SAMPLE_ID,
        stage: "classification",
        sectionKey: "X",
        annotatorId: ANNOTATOR_ID,
        isQuestion: true,
      }),
    ).rejects.toThrow(DomainError);
  });

  it("rejects when sample not found", async () => {
    mockSample.findUnique.mockResolvedValue(null);
    await expect(
      annotationService.submitAnnotation({
        goldenSampleId: "nope",
        stage: "classification",
        sectionKey: "X",
        annotatorId: ANNOTATOR_ID,
        proposedZone: "x",
        isQuestion: false,
      }),
    ).rejects.toThrow(/not found/);
  });

  it("re-submission resets status to open", async () => {
    mockAnnotation.upsert.mockResolvedValue({ id: "a1", status: "open" });
    await annotationService.submitAnnotation({
      goldenSampleId: SAMPLE_ID,
      stage: "classification",
      sectionKey: "X",
      annotatorId: ANNOTATOR_ID,
      proposedZone: "y",
      isQuestion: false,
    });
    expect(mockAnnotation.upsert.mock.calls[0][0].update.status).toBe("open");
  });
});

describe("annotationService.resolveQuestion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates decision and marks annotation as answered", async () => {
    mockAnnotation.findUnique.mockResolvedValue({
      id: "a-q",
      isQuestion: true,
      status: "open",
    });

    const result = await annotationService.resolveQuestion({
      annotationId: "a-q",
      decidedById: EXPERT_ID,
      finalZone: "safety.adverse_events.reporting",
      rationale: "Это про процедуру сообщения",
    });

    expect(result.id).toBe("dec-1");
  });

  it("rejects when annotation is not a question", async () => {
    mockAnnotation.findUnique.mockResolvedValue({
      id: "a1",
      isQuestion: false,
      status: "open",
    });

    await expect(
      annotationService.resolveQuestion({
        annotationId: "a1",
        decidedById: EXPERT_ID,
        finalZone: "x",
      }),
    ).rejects.toThrow(/not a question/);
  });

  it("rejects when annotation already finalized", async () => {
    mockAnnotation.findUnique.mockResolvedValue({
      id: "a1",
      isQuestion: true,
      status: "finalized",
    });

    await expect(
      annotationService.resolveQuestion({
        annotationId: "a1",
        decidedById: EXPERT_ID,
        finalZone: "x",
      }),
    ).rejects.toThrow(/already finalized/);
  });

  it("rejects when annotation not found", async () => {
    mockAnnotation.findUnique.mockResolvedValue(null);
    await expect(
      annotationService.resolveQuestion({
        annotationId: "nope",
        decidedById: EXPERT_ID,
        finalZone: "x",
      }),
    ).rejects.toThrow(/not found/);
  });
});

describe("annotationService.getProgress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns counts of each status", async () => {
    (mockAnnotation.count as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(5) // open non-question
      .mockResolvedValueOnce(2) // answered
      .mockResolvedValueOnce(10) // finalized
      .mockResolvedValueOnce(3); // open questions

    const result = await annotationService.getProgress("s1", "classification");
    expect(result).toEqual({ open: 5, answered: 2, finalized: 10, openQuestions: 3 });
  });
});

describe("annotationService.listAnnotations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("filters by goldenSampleId, stage, status", async () => {
    mockAnnotation.findMany.mockResolvedValue([{ id: "a1" }]);

    await annotationService.listAnnotations({
      goldenSampleId: SAMPLE_ID,
      stage: "classification",
      status: "open",
    });

    const where = mockAnnotation.findMany.mock.calls[0][0].where;
    expect(where.goldenSampleId).toBe(SAMPLE_ID);
    expect(where.stage).toBe("classification");
    expect(where.status).toBe("open");
  });

  it("optionally filters by isQuestion + annotatorId", async () => {
    mockAnnotation.findMany.mockResolvedValue([]);
    await annotationService.listAnnotations({
      goldenSampleId: SAMPLE_ID,
      isQuestion: true,
      annotatorId: ANNOTATOR_ID,
    });
    const where = mockAnnotation.findMany.mock.calls[0][0].where;
    expect(where.isQuestion).toBe(true);
    expect(where.annotatorId).toBe(ANNOTATOR_ID);
  });
});
