import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clinscriptum/db", () => ({
  prisma: {
    processingRun: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    processingStep: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    tenantConfig: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@clinscriptum/shared", () => ({
  PipelineLevel: {},
  ProcessingStepStatus: {},
}));

vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../lib/metrics.js", () => ({
  recordPipelineMetric: vi.fn(),
  recordPipelineComplete: vi.fn(),
}));

vi.mock("../../lib/event-publisher.js", () => ({
  publishProcessingEvent: vi.fn(),
}));

import { prisma } from "@clinscriptum/db";
import { runPipeline } from "../orchestrator.js";
import type { PipelineStepHandler, StepResult, PipelineLevel } from "../orchestrator.js";

const mockRun = prisma.processingRun as unknown as {
  findUnique: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};
const mockStep = prisma.processingStep as unknown as {
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};
const mockTenantConfig = (prisma as any).tenantConfig as unknown as {
  findUnique: ReturnType<typeof vi.fn>;
};

const RUN_ID = "run-001";

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    studyId: "study-001",
    docVersionId: "version-001",
    type: "classify_sections",
    status: "queued",
    ruleSetBundleId: "bundle-1",
    steps: [],
    study: {
      tenantId: "tenant-aaa",
      llmThinkingEnabled: false,
      excludedSectionPrefixes: [],
      auditMode: "auto",
      crossCheckPairs: null,
    },
    ...overrides,
  };
}

function makeHandler(
  level: string,
  result: Partial<StepResult> = {},
): PipelineStepHandler {
  return {
    level: level as PipelineLevel,
    execute: vi.fn().mockResolvedValue({
      data: {},
      needsNextStep: true,
      ...result,
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStep.create.mockResolvedValue({ id: "step-1" });
  mockStep.update.mockResolvedValue({});
  mockStep.delete.mockResolvedValue({});
  mockRun.update.mockResolvedValue({});
  mockTenantConfig.findUnique.mockResolvedValue(null);
});

describe("runPipeline", () => {
  it("executes handlers in pipeline order", async () => {
    const deterministicHandler = makeHandler("deterministic");
    const llmCheckHandler = makeHandler("llm_check");

    mockRun.findUnique.mockResolvedValue(makeRun());

    const handlers = new Map<PipelineLevel, PipelineStepHandler>([
      ["deterministic" as PipelineLevel, deterministicHandler],
      ["llm_check" as PipelineLevel, llmCheckHandler],
    ]);

    await runPipeline(RUN_ID, { operatorReviewEnabled: false, steps: [] }, handlers);

    expect(deterministicHandler.execute).toHaveBeenCalledTimes(1);
    expect(llmCheckHandler.execute).toHaveBeenCalledTimes(1);

    const detOrder = (deterministicHandler.execute as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    const llmOrder = (llmCheckHandler.execute as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    expect(detOrder).toBeLessThan(llmOrder);
  });

  it("stops pipeline when needsNextStep is false", async () => {
    const deterministicHandler = makeHandler("deterministic", { needsNextStep: false });
    const llmCheckHandler = makeHandler("llm_check");

    mockRun.findUnique.mockResolvedValue(makeRun());

    const handlers = new Map<PipelineLevel, PipelineStepHandler>([
      ["deterministic" as PipelineLevel, deterministicHandler],
      ["llm_check" as PipelineLevel, llmCheckHandler],
    ]);

    await runPipeline(RUN_ID, { operatorReviewEnabled: false, steps: [] }, handlers);

    expect(deterministicHandler.execute).toHaveBeenCalledTimes(1);
    expect(llmCheckHandler.execute).not.toHaveBeenCalled();
  });

  it("skips already completed steps", async () => {
    const deterministicHandler = makeHandler("deterministic");

    mockRun.findUnique.mockResolvedValue(
      makeRun({
        steps: [{ id: "step-existing", level: "deterministic", status: "completed", result: { test: true } }],
      }),
    );

    const handlers = new Map<PipelineLevel, PipelineStepHandler>([
      ["deterministic" as PipelineLevel, deterministicHandler],
    ]);

    await runPipeline(RUN_ID, { operatorReviewEnabled: false, steps: [] }, handlers);

    expect(deterministicHandler.execute).not.toHaveBeenCalled();
  });

  it("marks run as completed on success", async () => {
    const handler = makeHandler("deterministic", { needsNextStep: false });
    mockRun.findUnique.mockResolvedValue(makeRun());

    const handlers = new Map<PipelineLevel, PipelineStepHandler>([
      ["deterministic" as PipelineLevel, handler],
    ]);

    await runPipeline(RUN_ID, { operatorReviewEnabled: false, steps: [] }, handlers);

    expect(mockRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: RUN_ID },
        data: expect.objectContaining({ status: "completed" }),
      }),
    );
  });

  it("marks run as failed on handler error", async () => {
    const failingHandler: PipelineStepHandler = {
      level: "deterministic" as PipelineLevel,
      execute: vi.fn().mockRejectedValue(new Error("LLM timeout")),
    };
    mockRun.findUnique.mockResolvedValue(makeRun());

    const handlers = new Map<PipelineLevel, PipelineStepHandler>([
      ["deterministic" as PipelineLevel, failingHandler],
    ]);

    await expect(
      runPipeline(RUN_ID, { operatorReviewEnabled: false, steps: [] }, handlers),
    ).rejects.toThrow("LLM timeout");

    expect(mockRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "failed" }),
      }),
    );
  });

  it("throws if processing run not found", async () => {
    mockRun.findUnique.mockResolvedValue(null);

    await expect(
      runPipeline("non-existent", { operatorReviewEnabled: false, steps: [] }, new Map()),
    ).rejects.toThrow("not found");
  });

  it("deletes failed step before re-executing", async () => {
    const handler = makeHandler("deterministic");
    mockRun.findUnique.mockResolvedValue(
      makeRun({
        steps: [{ id: "step-failed", level: "deterministic", status: "failed" }],
      }),
    );

    const handlers = new Map<PipelineLevel, PipelineStepHandler>([
      ["deterministic" as PipelineLevel, handler],
    ]);

    await runPipeline(RUN_ID, { operatorReviewEnabled: false, steps: [] }, handlers);

    expect(mockStep.delete).toHaveBeenCalledWith({ where: { id: "step-failed" } });
    expect(handler.execute).toHaveBeenCalledTimes(1);
  });

  describe("step-level retry + idempotency", () => {
    it("sets idempotencyKey on first attempt of every step", async () => {
      const handler = makeHandler("deterministic", { needsNextStep: false });
      mockRun.findUnique.mockResolvedValue(makeRun());

      const handlers = new Map<PipelineLevel, PipelineStepHandler>([
        ["deterministic" as PipelineLevel, handler],
      ]);
      await runPipeline(RUN_ID, { operatorReviewEnabled: false, steps: [] }, handlers);

      const setKeyCall = mockStep.update.mock.calls.find(
        (c) =>
          c[0].where.id === "step-1" &&
          c[0].data.idempotencyKey != null,
      );
      expect(setKeyCall).toBeDefined();
      expect(setKeyCall![0].data.idempotencyKey).toBe(`${RUN_ID}:deterministic:1`);
      expect(setKeyCall![0].data.attemptNumber).toBe(1);
    });

    it("retries an llm_check handler on transient failure (idempotencyKey advances per attempt)", async () => {
      const handler: PipelineStepHandler = {
        level: "llm_check" as PipelineLevel,
        execute: vi
          .fn()
          .mockRejectedValueOnce(new Error("transient 1"))
          .mockResolvedValueOnce({ data: { ok: true }, needsNextStep: false }),
      };
      mockRun.findUnique.mockResolvedValue(makeRun());

      const handlers = new Map<PipelineLevel, PipelineStepHandler>([
        ["llm_check" as PipelineLevel, handler],
      ]);

      // Suppress real exponential delay (mocked elsewhere; here we just rely on
      // step-retry.ts to await setTimeout — tests run fast enough with default 5s
      // baseDelay because we mock vi.useFakeTimers? No, leave default — only 1 retry,
      // so 5s delay. Use fake timers.
      vi.useFakeTimers();
      const promise = runPipeline(RUN_ID, { operatorReviewEnabled: false, steps: [] }, handlers);
      await vi.advanceTimersByTimeAsync(0); // attempt 1 fails synchronously
      await vi.advanceTimersByTimeAsync(5_000); // skip retry delay
      await promise;
      vi.useRealTimers();

      expect(handler.execute).toHaveBeenCalledTimes(2);

      // Check that idempotencyKey was set for both attempts
      const idempotencyUpdates = mockStep.update.mock.calls.filter(
        (c) => c[0].data.idempotencyKey != null,
      );
      const keys = idempotencyUpdates.map((c) => c[0].data.idempotencyKey);
      expect(keys).toContain(`${RUN_ID}:llm_check:1`);
      expect(keys).toContain(`${RUN_ID}:llm_check:2`);

      // attemptNumber should be 2 on the second update
      const attemptUpdates = mockStep.update.mock.calls.filter(
        (c) => typeof c[0].data.attemptNumber === "number",
      );
      const attempts = attemptUpdates.map((c) => c[0].data.attemptNumber);
      expect(attempts).toContain(2);

      // Final step status should be 'completed'
      const completedCall = mockStep.update.mock.calls.find(
        (c) => c[0].data.status === "completed",
      );
      expect(completedCall).toBeDefined();
    });

    it("after maxAttempts exhausted, marks step 'failed' and propagates error", async () => {
      const handler: PipelineStepHandler = {
        level: "llm_check" as PipelineLevel,
        execute: vi.fn().mockRejectedValue(new Error("rate limit")),
      };
      mockRun.findUnique.mockResolvedValue(makeRun());

      const handlers = new Map<PipelineLevel, PipelineStepHandler>([
        ["llm_check" as PipelineLevel, handler],
      ]);

      vi.useFakeTimers();
      const promise = runPipeline(RUN_ID, { operatorReviewEnabled: false, steps: [] }, handlers).catch((e) => e);
      // Drain all pending timers (no further sleeps after final attempt)
      await vi.runAllTimersAsync();
      const result = await promise;
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toBe("rate limit");
      vi.useRealTimers();

      // 3 attempts (default for llm_check)
      expect(handler.execute).toHaveBeenCalledTimes(3);
      const failedCall = mockStep.update.mock.calls.find(
        (c) => c[0].data.status === "failed",
      );
      expect(failedCall).toBeDefined();
    });

    it("deterministic level does NOT retry (maxAttempts=1)", async () => {
      const handler: PipelineStepHandler = {
        level: "deterministic" as PipelineLevel,
        execute: vi.fn().mockRejectedValue(new Error("logic bug")),
      };
      mockRun.findUnique.mockResolvedValue(makeRun());

      const handlers = new Map<PipelineLevel, PipelineStepHandler>([
        ["deterministic" as PipelineLevel, handler],
      ]);

      await expect(
        runPipeline(RUN_ID, { operatorReviewEnabled: false, steps: [] }, handlers),
      ).rejects.toThrow("logic bug");

      // No retries for deterministic
      expect(handler.execute).toHaveBeenCalledTimes(1);
    });
  });
});
