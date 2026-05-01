import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  runFindUnique,
  runUpdate,
  goldenFindMany,
  resultCreate,
  resultFindMany,
  sectionFindMany,
  factFindMany,
} = vi.hoisted(() => ({
  runFindUnique: vi.fn(),
  runUpdate: vi.fn(),
  goldenFindMany: vi.fn(),
  resultCreate: vi.fn(),
  resultFindMany: vi.fn(),
  sectionFindMany: vi.fn(),
  factFindMany: vi.fn(),
}));

vi.mock("@clinscriptum/db", () => ({
  prisma: {
    evaluationRun: { findUnique: runFindUnique, update: runUpdate },
    evaluationResult: { create: resultCreate, findMany: resultFindMany },
    goldenSample: { findMany: goldenFindMany },
    section: { findMany: sectionFindMany },
    fact: { findMany: factFindMany },
  },
}));

vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { handleRunEvaluation } from "../run-evaluation.js";

const RUN_ID = "run-1";
const TENANT = "tenant-1";

function makeRun(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: RUN_ID,
    tenantId: TENANT,
    ruleSetVersion: null,
    llmConfig: null,
    comparedToRunId: null,
    ...overrides,
  };
}

function makeSample(id: string, stages: Array<{ stage: string; expected: any }>, withDoc = true) {
  return {
    id,
    stageStatuses: stages.map((s) => ({
      stage: s.stage,
      status: "approved",
      expectedResults: s.expected,
    })),
    documents: withDoc ? [{ documentVersionId: `dv-${id}` }] : [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  runUpdate.mockResolvedValue({});
  resultCreate.mockResolvedValue({});
  resultFindMany.mockResolvedValue([]);
});

describe("handleRunEvaluation", () => {
  it("throws when EvaluationRun is not found", async () => {
    runFindUnique.mockResolvedValueOnce(null);

    await expect(
      handleRunEvaluation({ evaluationRunId: RUN_ID }),
    ).rejects.toThrow(/EvaluationRun .* not found/);
  });

  it("marks run 'running' on start and 'completed' on success with metrics", async () => {
    runFindUnique.mockResolvedValueOnce(makeRun());
    goldenFindMany.mockResolvedValueOnce([]);

    await handleRunEvaluation({ evaluationRunId: RUN_ID });

    const updates = runUpdate.mock.calls.map((c) => c[0].data.status);
    expect(updates[0]).toBe("running");
    expect(updates.at(-1)).toBe("completed");
  });

  it("skips samples without documents and warns", async () => {
    runFindUnique.mockResolvedValueOnce(makeRun());
    goldenFindMany.mockResolvedValueOnce([
      makeSample("s-empty", [{ stage: "classification", expected: { sections: [] } }], false),
    ]);

    await handleRunEvaluation({ evaluationRunId: RUN_ID });

    expect(resultCreate).not.toHaveBeenCalled();
  });

  it("creates EvaluationResult with status='pass' when f1 >= 0.8 (all matching)", async () => {
    runFindUnique.mockResolvedValueOnce(makeRun());
    goldenFindMany.mockResolvedValueOnce([
      makeSample("s1", [
        {
          stage: "classification",
          expected: { sections: [{ title: "S", standardSection: "synopsis" }] },
        },
      ]),
    ]);
    sectionFindMany.mockResolvedValueOnce([
      { id: "sec-1", title: "S", standardSection: "synopsis" },
    ]);

    await handleRunEvaluation({ evaluationRunId: RUN_ID });

    expect(resultCreate).toHaveBeenCalledTimes(1);
    const data = resultCreate.mock.calls[0][0].data;
    expect(data.status).toBe("pass");
    expect(data.f1).toBe(1);
    expect(data.precision).toBe(1);
    expect(data.recall).toBe(1);
  });

  it("creates EvaluationResult with status='fail' when f1 < 0.8 (no overlap)", async () => {
    runFindUnique.mockResolvedValueOnce(makeRun());
    goldenFindMany.mockResolvedValueOnce([
      makeSample("s1", [
        {
          stage: "classification",
          expected: { sections: [{ title: "Synopsis", standardSection: "synopsis" }] },
        },
      ]),
    ]);
    sectionFindMany.mockResolvedValueOnce([
      { id: "sec-1", title: "Other", standardSection: "objectives" },
    ]);

    await handleRunEvaluation({ evaluationRunId: RUN_ID });

    const data = resultCreate.mock.calls[0][0].data;
    expect(data.status).toBe("fail");
    expect(data.f1).toBe(0);
  });

  it("on stage error, creates result with status='error' and continues", async () => {
    runFindUnique.mockResolvedValueOnce(makeRun());
    goldenFindMany.mockResolvedValueOnce([
      makeSample("s1", [{ stage: "classification", expected: { sections: [] } }]),
    ]);
    sectionFindMany.mockRejectedValueOnce(new Error("db down"));

    await handleRunEvaluation({ evaluationRunId: RUN_ID });

    const data = resultCreate.mock.calls[0][0].data;
    expect(data.status).toBe("error");
    expect(data.diff).toEqual({ error: "db down" });
  });

  it("aggregates per-stage metrics: total / passed / failed / passRate / avgF1", async () => {
    runFindUnique.mockResolvedValueOnce(makeRun());
    goldenFindMany.mockResolvedValueOnce([
      makeSample("s1", [
        { stage: "classification", expected: { sections: [{ title: "x", standardSection: "synopsis" }] } },
      ]),
      makeSample("s2", [
        { stage: "classification", expected: { sections: [{ title: "x", standardSection: "objectives" }] } },
      ]),
    ]);
    sectionFindMany
      .mockResolvedValueOnce([{ id: "1", title: "x", standardSection: "synopsis" }])
      .mockResolvedValueOnce([{ id: "2", title: "x", standardSection: "wrong" }]);

    await handleRunEvaluation({ evaluationRunId: RUN_ID });

    const finalCall = runUpdate.mock.calls.find((c) => c[0].data.status === "completed");
    const metrics = finalCall![0].data.metrics as any;
    expect(metrics.classification.total).toBe(2);
    expect(metrics.classification.passed).toBe(1);
    expect(metrics.classification.failed).toBe(1);
    expect(metrics.classification.passRate).toBe(0.5);
  });

  it("on outer exception (e.g. golden findMany throws), marks run 'failed' and rethrows", async () => {
    runFindUnique.mockResolvedValueOnce(makeRun());
    goldenFindMany.mockRejectedValueOnce(new Error("catastrophic"));

    await expect(handleRunEvaluation({ evaluationRunId: RUN_ID })).rejects.toThrow("catastrophic");

    const failedCall = runUpdate.mock.calls.find((c) => c[0].data.status === "failed");
    expect(failedCall).toBeDefined();
    expect((failedCall![0].data.metrics as any).error).toBe("catastrophic");
  });

  it("loadActualResults: extraction stage pulls facts via prisma.fact.findMany", async () => {
    runFindUnique.mockResolvedValueOnce(makeRun());
    goldenFindMany.mockResolvedValueOnce([
      makeSample("s1", [
        { stage: "extraction", expected: { facts: [{ factKey: "phase" }] } },
      ]),
    ]);
    factFindMany.mockResolvedValueOnce([
      { id: "f1", factKey: "phase", value: "II", confidence: 0.9, factClass: "general", factCategory: null },
    ]);

    await handleRunEvaluation({ evaluationRunId: RUN_ID });

    expect(factFindMany).toHaveBeenCalledWith({
      where: { docVersionId: "dv-s1" },
      select: expect.any(Object),
    });
    const data = resultCreate.mock.calls[0][0].data;
    expect(data.status).toBe("pass");
  });

  it("computes delta when comparedToRunId is set", async () => {
    runFindUnique.mockResolvedValueOnce(
      makeRun({ comparedToRunId: "prev-run" }),
    );
    goldenFindMany.mockResolvedValueOnce([]);
    resultFindMany.mockResolvedValue([]);

    await handleRunEvaluation({ evaluationRunId: RUN_ID });

    const finalCall = runUpdate.mock.calls.find((c) => c[0].data.status === "completed");
    expect(finalCall![0].data.delta).toBeDefined();
  });
});
