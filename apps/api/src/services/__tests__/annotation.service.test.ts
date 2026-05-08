import { describe, it, expect, vi, beforeEach } from "vitest";

// Auto-save mode (PR F): транзакции включают relational expectedSection
// upsert (findFirst → create/update/delete) + lookup в goldenSampleDocument
// и section. Все tx.* операции мокаем чтобы они возвращали разумные значения.
const txMock = {
  goldenAnnotation: {
    upsert: vi.fn().mockResolvedValue({ id: "a-tx", status: "finalized" }),
    update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  goldenAnnotationDecision: {
    upsert: vi.fn().mockResolvedValue({ id: "dec-1" }),
  },
  goldenSampleStageStatus: {
    findUnique: vi.fn().mockResolvedValue({ expectedResults: {} }),
    upsert: vi.fn().mockResolvedValue({ id: "stage-status-1" }),
  },
  expectedSection: {
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: "exp-1" }),
    update: vi.fn().mockResolvedValue({ id: "exp-1" }),
    delete: vi.fn().mockResolvedValue({ id: "exp-1" }),
  },
  goldenSampleDocument: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  section: {
    findFirst: vi.fn().mockResolvedValue(null),
  },
};

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
    expectedSection: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    goldenSampleDocument: {
      findMany: vi.fn(),
    },
    section: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn((fn: (tx: unknown) => unknown) =>
      typeof fn === "function"
        ? fn(txMock)
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
    txMock.goldenSampleStageStatus.findUnique.mockResolvedValue({ expectedResults: {} });
    txMock.goldenSampleStageStatus.upsert.mockResolvedValue({ id: "stage-status-1" });
    txMock.goldenAnnotation.upsert.mockResolvedValue({ id: "a-tx", status: "finalized" });
    txMock.expectedSection.findFirst.mockResolvedValue(null);
    txMock.expectedSection.create.mockResolvedValue({ id: "exp-1" });
    txMock.expectedSection.update.mockResolvedValue({ id: "exp-1" });
    txMock.expectedSection.delete.mockResolvedValue({ id: "exp-1" });
    txMock.goldenSampleDocument.findMany.mockResolvedValue([]);
    txMock.section.findFirst.mockResolvedValue(null);
  });

  it("creates annotation with status=finalized when annotator selects a zone (auto-save)", async () => {
    txMock.goldenAnnotation.upsert.mockResolvedValue({
      id: "a1",
      proposedZone: "ethics.informed_consent",
      status: "finalized",
    });

    const result = await annotationService.submitAnnotation({
      goldenSampleId: SAMPLE_ID,
      stage: "classification",
      sectionKey: "Информированное согласие",
      annotatorId: ANNOTATOR_ID,
      proposedZone: "ethics.informed_consent",
      isQuestion: false,
    });

    expect(result.id).toBe("a1");
    const args = txMock.goldenAnnotation.upsert.mock.calls[0][0];
    expect(args.create.proposedZone).toBe("ethics.informed_consent");
    expect(args.create.isQuestion).toBe(false);
    expect(args.create.status).toBe("finalized");
    // Auto-save (relational): создаётся expectedSection row.
    expect(txMock.goldenSampleStageStatus.upsert).toHaveBeenCalled();
    expect(txMock.expectedSection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          standardSection: "ethics.informed_consent",
          title: "Информированное согласие",
        }),
      }),
    );
  });

  it("creates annotation as question with status=open", async () => {
    txMock.goldenAnnotation.upsert.mockResolvedValue({
      id: "a2",
      isQuestion: true,
      status: "open",
    });

    await annotationService.submitAnnotation({
      goldenSampleId: SAMPLE_ID,
      stage: "classification",
      sectionKey: "Раздел X",
      annotatorId: ANNOTATOR_ID,
      isQuestion: true,
      questionText: "Не уверена — это safety или ethics?",
    });

    const args = txMock.goldenAnnotation.upsert.mock.calls[0][0];
    expect(args.create.isQuestion).toBe(true);
    expect(args.create.status).toBe("open");
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

  it("re-submission as zone keeps status=finalized (auto-save)", async () => {
    txMock.goldenAnnotation.upsert.mockResolvedValue({ id: "a1", status: "finalized" });
    await annotationService.submitAnnotation({
      goldenSampleId: SAMPLE_ID,
      stage: "classification",
      sectionKey: "X",
      annotatorId: ANNOTATOR_ID,
      proposedZone: "y",
      isQuestion: false,
    });
    expect(txMock.goldenAnnotation.upsert.mock.calls[0][0].update.status).toBe("finalized");
  });

  it("re-submit as question removes section from expected (relational delete)", async () => {
    // Pre-existing expected row (relational) with this sectionKey
    txMock.expectedSection.findFirst.mockResolvedValue({
      id: "exp-old",
      title: "X",
      standardSection: "old",
    });
    txMock.goldenAnnotation.upsert.mockResolvedValue({ id: "a1", status: "open" });

    await annotationService.submitAnnotation({
      goldenSampleId: SAMPLE_ID,
      stage: "classification",
      sectionKey: "X",
      annotatorId: ANNOTATOR_ID,
      isQuestion: true,
      questionText: "Передумала — задаю вопрос",
    });

    expect(txMock.expectedSection.delete).toHaveBeenCalledWith({
      where: { id: "exp-old" },
    });
    expect(txMock.expectedSection.create).not.toHaveBeenCalled();
    expect(txMock.expectedSection.update).not.toHaveBeenCalled();
  });

  it("re-submit as zone updates existing expectedSection row", async () => {
    txMock.expectedSection.findFirst.mockResolvedValue({
      id: "exp-old",
      title: "X",
      standardSection: "old",
    });
    txMock.goldenAnnotation.upsert.mockResolvedValue({ id: "a1", status: "finalized" });

    await annotationService.submitAnnotation({
      goldenSampleId: SAMPLE_ID,
      stage: "classification",
      sectionKey: "X",
      annotatorId: ANNOTATOR_ID,
      proposedZone: "new.zone",
      isQuestion: false,
    });

    expect(txMock.expectedSection.update).toHaveBeenCalledWith({
      where: { id: "exp-old" },
      data: { standardSection: "new.zone" },
    });
    expect(txMock.expectedSection.create).not.toHaveBeenCalled();
  });

  it("anchors new expected row to a real Section when title matches", async () => {
    txMock.expectedSection.findFirst.mockResolvedValue(null);
    txMock.goldenSampleDocument.findMany.mockResolvedValue([
      { documentVersionId: "doc-v-1" },
    ]);
    txMock.section.findFirst.mockResolvedValue({
      id: "sec-1",
      title: "X",
      level: 2,
      sourceAnchor: { paragraphIndex: 42, textSnippet: "X heading" },
    });
    txMock.goldenAnnotation.upsert.mockResolvedValue({ id: "a1", status: "finalized" });

    await annotationService.submitAnnotation({
      goldenSampleId: SAMPLE_ID,
      stage: "classification",
      sectionKey: "X",
      annotatorId: ANNOTATOR_ID,
      proposedZone: "zone.a",
      isQuestion: false,
    });

    const args = txMock.expectedSection.create.mock.calls[0][0];
    expect(args.data.realSectionId).toBe("sec-1");
    expect(args.data.matchMethod).toBe("paragraph");
    expect(args.data.level).toBe(2);
    expect(args.data.anchor).toMatchObject({
      paragraphIndex: 42,
      occurrenceIndex: 0,
    });
  });
});

describe("annotationService.resolveQuestion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    txMock.goldenSampleStageStatus.upsert.mockResolvedValue({ id: "stage-status-1" });
    txMock.expectedSection.findFirst.mockResolvedValue(null);
    txMock.expectedSection.create.mockResolvedValue({ id: "exp-1" });
    txMock.expectedSection.update.mockResolvedValue({ id: "exp-1" });
    txMock.expectedSection.delete.mockResolvedValue({ id: "exp-1" });
    txMock.goldenSampleDocument.findMany.mockResolvedValue([]);
    txMock.section.findFirst.mockResolvedValue(null);
  });

  it("creates decision, marks annotation finalized, and creates expectedSection row", async () => {
    mockAnnotation.findUnique.mockResolvedValue({
      id: "a-q",
      isQuestion: true,
      status: "open",
      goldenSampleId: SAMPLE_ID,
      stage: "classification",
      sectionKey: "Сообщения о AE",
    });

    const result = await annotationService.resolveQuestion({
      annotationId: "a-q",
      decidedById: EXPERT_ID,
      finalZone: "safety.adverse_events.reporting",
      rationale: "Это про процедуру сообщения",
    });

    expect(result.id).toBe("dec-1");
    // annotation должен переключиться на finalized
    expect(txMock.goldenAnnotation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "finalized" }) }),
    );
    // Relational expected row создан с финальной зоной
    expect(txMock.expectedSection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          standardSection: "safety.adverse_events.reporting",
          title: "Сообщения о AE",
        }),
      }),
    );
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
