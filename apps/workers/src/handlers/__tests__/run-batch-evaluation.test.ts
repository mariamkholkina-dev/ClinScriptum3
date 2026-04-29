import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  runFindUnique,
  runUpdate,
  studyFindMany,
  documentFindMany,
  versionFindMany,
  sectionFindMany,
  factFindMany,
} = vi.hoisted(() => ({
  runFindUnique: vi.fn(),
  runUpdate: vi.fn(),
  studyFindMany: vi.fn(),
  documentFindMany: vi.fn(),
  versionFindMany: vi.fn(),
  sectionFindMany: vi.fn(),
  factFindMany: vi.fn(),
}));

vi.mock("@clinscriptum/db", () => ({
  prisma: {
    evaluationRun: { findUnique: runFindUnique, update: runUpdate },
    study: { findMany: studyFindMany },
    document: { findMany: documentFindMany },
    documentVersion: { findMany: versionFindMany },
    section: { findMany: sectionFindMany },
    fact: { findMany: factFindMany },
  },
}));

vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { handleRunBatchEvaluation } from "../run-batch-evaluation.js";

const RUN_ID = "run-1";
const TENANT = "tenant-1";

function makeRun(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: RUN_ID,
    tenantId: TENANT,
    ruleSetVersion: null,
    llmConfig: null,
    comparedToRunId: null,
    metrics: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  runUpdate.mockResolvedValue({});
  studyFindMany.mockResolvedValue([{ id: "study-1" }]);
  documentFindMany.mockResolvedValue([{ id: "doc-1" }]);
  versionFindMany.mockResolvedValue([]);
  sectionFindMany.mockResolvedValue([]);
  factFindMany.mockResolvedValue([]);
});

describe("handleRunBatchEvaluation", () => {
  it("throws when EvaluationRun is not found", async () => {
    runFindUnique.mockResolvedValueOnce(null);

    await expect(
      handleRunBatchEvaluation({ evaluationRunId: RUN_ID }),
    ).rejects.toThrow(/EvaluationRun .* not found/);
  });

  it("queries only DocumentVersions with status in ['parsed','ready']", async () => {
    runFindUnique.mockResolvedValueOnce(makeRun());

    await handleRunBatchEvaluation({ evaluationRunId: RUN_ID });

    expect(versionFindMany).toHaveBeenCalledWith({
      where: {
        documentId: { in: ["doc-1"] },
        status: { in: ["parsed", "ready"] },
      },
      select: { id: true, documentId: true },
    });
  });

  it("classification stage: confidence = classified/total sections", async () => {
    runFindUnique.mockResolvedValueOnce(makeRun());
    versionFindMany.mockResolvedValueOnce([{ id: "dv1", documentId: "doc-1" }]);
    sectionFindMany.mockResolvedValueOnce([
      { standardSection: "synopsis" },
      { standardSection: "objectives" },
      { standardSection: null },
      { standardSection: null },
    ]);

    await handleRunBatchEvaluation({ evaluationRunId: RUN_ID });

    const completed = runUpdate.mock.calls.find((c) => c[0].data.status === "completed");
    const metrics = completed![0].data.metrics as any;
    // 2 of 4 classified
    expect(metrics.classification.avgConfidence).toBe(0.5);
    expect(metrics.classification.totalDocs).toBe(1);
  });

  it("extraction stage: confidence = average of fact confidences", async () => {
    runFindUnique.mockResolvedValueOnce(makeRun());
    versionFindMany.mockResolvedValueOnce([{ id: "dv1", documentId: "doc-1" }]);
    sectionFindMany.mockResolvedValueOnce([]);
    factFindMany.mockResolvedValueOnce([
      { confidence: 0.9 },
      { confidence: 0.7 },
      { confidence: 0.8 },
    ]);

    await handleRunBatchEvaluation({ evaluationRunId: RUN_ID });

    const completed = runUpdate.mock.calls.find((c) => c[0].data.status === "completed");
    const metrics = completed![0].data.metrics as any;
    expect(metrics.extraction.avgConfidence).toBeCloseTo(0.8, 5);
  });

  it("buckets confidences into the correct distribution range", async () => {
    runFindUnique.mockResolvedValueOnce(makeRun());
    versionFindMany.mockResolvedValueOnce([
      { id: "dv1", documentId: "doc-1" },
      { id: "dv2", documentId: "doc-1" },
    ]);
    // dv1: 4/4 → 1.0 → bucket 0.8-1.0
    sectionFindMany
      .mockResolvedValueOnce([
        { standardSection: "x" },
        { standardSection: "x" },
        { standardSection: "x" },
        { standardSection: "x" },
      ])
      // dv2: 1/4 → 0.25 → bucket 0.2-0.4
      .mockResolvedValueOnce([
        { standardSection: "x" },
        { standardSection: null },
        { standardSection: null },
        { standardSection: null },
      ]);
    factFindMany.mockResolvedValue([]);

    await handleRunBatchEvaluation({ evaluationRunId: RUN_ID });

    const completed = runUpdate.mock.calls.find((c) => c[0].data.status === "completed");
    const dist = (completed![0].data.metrics as any).classification.confidenceDistribution;
    expect(dist["0.8-1.0"]).toBe(1);
    expect(dist["0.2-0.4"]).toBe(1);
  });

  it("when section findMany throws for a stage, records null confidence and continues", async () => {
    runFindUnique.mockResolvedValueOnce(makeRun());
    versionFindMany.mockResolvedValueOnce([{ id: "dv1", documentId: "doc-1" }]);
    sectionFindMany.mockRejectedValueOnce(new Error("db down"));

    await handleRunBatchEvaluation({ evaluationRunId: RUN_ID });

    const completed = runUpdate.mock.calls.find((c) => c[0].data.status === "completed");
    const metrics = completed![0].data.metrics as any;
    // The doc still counts in totalDocs but its confidence was null and excluded from average
    expect(metrics.classification.totalDocs).toBe(1);
    expect(metrics.classification.avgConfidence).toBeNull();
  });

  it("on outer exception (e.g. studyFindMany throws) marks run 'failed' and rethrows", async () => {
    runFindUnique.mockResolvedValueOnce(makeRun());
    studyFindMany.mockRejectedValueOnce(new Error("crash"));

    await expect(handleRunBatchEvaluation({ evaluationRunId: RUN_ID })).rejects.toThrow("crash");

    const failedCall = runUpdate.mock.calls.find((c) => c[0].data.status === "failed");
    expect(failedCall).toBeDefined();
    expect((failedCall![0].data.metrics as any).error).toBe("crash");
  });

  it("computes delta when comparedToRunId is set and previous run has metrics", async () => {
    runFindUnique
      .mockResolvedValueOnce(makeRun({ comparedToRunId: "prev" }))
      .mockResolvedValueOnce({
        id: "prev",
        metrics: {
          classification: { avgConfidence: 0.5, agreementRate: 0.6 },
          extraction: { avgConfidence: 0.7, agreementRate: 0.8 },
        },
      });
    versionFindMany.mockResolvedValueOnce([{ id: "dv1", documentId: "doc-1" }]);
    sectionFindMany.mockResolvedValueOnce([
      { standardSection: "x" },
      { standardSection: "x" },
    ]);
    factFindMany.mockResolvedValueOnce([{ confidence: 0.9 }]);

    await handleRunBatchEvaluation({ evaluationRunId: RUN_ID });

    const completed = runUpdate.mock.calls.find((c) => c[0].data.status === "completed");
    const delta = (completed![0].data.delta as any).classification;
    expect(delta.avgConfidenceDelta).toBeCloseTo(0.5, 5); // 1.0 - 0.5
  });

  it("processes documents in batches with concurrency=5", async () => {
    runFindUnique.mockResolvedValueOnce(makeRun());
    // 7 versions → 5 in first batch, 2 in second
    const versions = Array.from({ length: 7 }, (_, i) => ({ id: `dv${i}`, documentId: "doc-1" }));
    versionFindMany.mockResolvedValueOnce(versions);
    sectionFindMany.mockResolvedValue([{ standardSection: "x" }]);
    factFindMany.mockResolvedValue([]);

    await handleRunBatchEvaluation({ evaluationRunId: RUN_ID });

    // each version triggers section + fact = 2 queries; 7×2 = 14 expected
    expect(sectionFindMany).toHaveBeenCalledTimes(7);
    expect(factFindMany).toHaveBeenCalledTimes(7);

    const completed = runUpdate.mock.calls.find((c) => c[0].data.status === "completed");
    expect(completed![0].data.totalSamples).toBe(7);
  });
});
