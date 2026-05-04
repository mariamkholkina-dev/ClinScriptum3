import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clinscriptum/db", () => ({
  prisma: {
    evaluationRun: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    evaluationResult: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("../../lib/queue.js", () => ({
  enqueueJob: vi.fn(),
}));

vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { prisma } from "@clinscriptum/db";
import { evaluationService } from "../evaluation.service.js";
import { enqueueJob } from "../../lib/queue.js";
import { DomainError } from "../errors.js";

const mockEvalRun = prisma.evaluationRun as unknown as {
  findUnique: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

const mockEvalResult = prisma.evaluationResult as unknown as {
  findMany: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
};

const mockEnqueue = enqueueJob as unknown as ReturnType<typeof vi.fn>;

const TENANT_A = "tenant-aaa";
const TENANT_B = "tenant-bbb";

function makeRun(id: string, tenantId: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    tenantId,
    name: `Run ${id}`,
    status: "completed",
    createdAt: new Date(),
    results: [],
    ...overrides,
  };
}

describe("evaluationService — tenant isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getRun", () => {
    it("returns run when tenantId matches", async () => {
      const run = makeRun("r1", TENANT_A);
      mockEvalRun.findUnique.mockResolvedValue(run);

      const result = await evaluationService.getRun("r1", TENANT_A);
      expect(result.id).toBe("r1");
    });

    it("throws NOT_FOUND when tenantId does not match", async () => {
      const run = makeRun("r1", TENANT_A);
      mockEvalRun.findUnique.mockResolvedValue(run);

      await expect(evaluationService.getRun("r1", TENANT_B)).rejects.toThrow(DomainError);
      await expect(evaluationService.getRun("r1", TENANT_B)).rejects.toThrow("not found");
    });

    it("throws NOT_FOUND when run does not exist", async () => {
      mockEvalRun.findUnique.mockResolvedValue(null);

      await expect(evaluationService.getRun("nope", TENANT_A)).rejects.toThrow(DomainError);
    });
  });

  describe("getRunResults", () => {
    it("returns results when tenantId matches", async () => {
      mockEvalRun.findUnique.mockResolvedValue(makeRun("r1", TENANT_A));
      mockEvalResult.findMany.mockResolvedValue([{ id: "res1" }]);

      const results = await evaluationService.getRunResults("r1", TENANT_A);
      expect(results).toHaveLength(1);
    });

    it("throws NOT_FOUND for cross-tenant access", async () => {
      mockEvalRun.findUnique.mockResolvedValue(makeRun("r1", TENANT_A));

      await expect(
        evaluationService.getRunResults("r1", TENANT_B),
      ).rejects.toThrow(DomainError);
    });

    it("passes filters to query", async () => {
      mockEvalRun.findUnique.mockResolvedValue(makeRun("r1", TENANT_A));
      mockEvalResult.findMany.mockResolvedValue([]);

      await evaluationService.getRunResults("r1", TENANT_A, {
        stage: "deterministic",
        status: "pass",
      });

      const where = mockEvalResult.findMany.mock.calls[0][0].where;
      expect(where.stage).toBe("deterministic");
      expect(where.status).toBe("pass");
    });
  });

  describe("getRunMetrics", () => {
    it("returns metrics when tenantId matches", async () => {
      mockEvalRun.findUnique.mockResolvedValue(makeRun("r1", TENANT_A));
      mockEvalResult.findMany.mockResolvedValue([
        { stage: "s1", status: "pass", precision: 0.9, recall: 0.8, f1: 0.85, latencyMs: 100, tokenCost: 5 },
        { stage: "s1", status: "fail", precision: 0.5, recall: 0.4, f1: 0.45, latencyMs: 200, tokenCost: 3 },
      ]);

      const metrics = await evaluationService.getRunMetrics("r1", TENANT_A);
      expect(metrics.totalResults).toBe(2);
      expect(metrics.passed).toBe(1);
      expect(metrics.failed).toBe(1);
      expect(metrics.overallPassRate).toBe(0.5);
      expect(metrics.stages.s1.avgPrecision).toBeCloseTo(0.7);
    });

    it("throws NOT_FOUND for cross-tenant access", async () => {
      mockEvalRun.findUnique.mockResolvedValue(makeRun("r1", TENANT_A));

      await expect(
        evaluationService.getRunMetrics("r1", TENANT_B),
      ).rejects.toThrow(DomainError);
    });
  });

  describe("compareRuns", () => {
    it("compares two runs belonging to the same tenant", async () => {
      mockEvalRun.findUnique
        .mockResolvedValueOnce(makeRun("r1", TENANT_A))
        .mockResolvedValueOnce(makeRun("r2", TENANT_A));
      mockEvalResult.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await evaluationService.compareRuns("r1", "r2", TENANT_A);
      expect(result.run1.id).toBe("r1");
      expect(result.run2.id).toBe("r2");
    });

    it("throws NOT_FOUND when first run belongs to different tenant", async () => {
      mockEvalRun.findUnique
        .mockResolvedValueOnce(makeRun("r1", TENANT_B))
        .mockResolvedValueOnce(makeRun("r2", TENANT_A));

      await expect(
        evaluationService.compareRuns("r1", "r2", TENANT_A),
      ).rejects.toThrow(DomainError);
    });

    it("throws NOT_FOUND when second run belongs to different tenant", async () => {
      mockEvalRun.findUnique
        .mockResolvedValueOnce(makeRun("r1", TENANT_A))
        .mockResolvedValueOnce(makeRun("r2", TENANT_B));

      await expect(
        evaluationService.compareRuns("r1", "r2", TENANT_A),
      ).rejects.toThrow(DomainError);
    });
  });

  describe("deleteRun", () => {
    it("deletes run when tenantId matches", async () => {
      mockEvalRun.findUnique.mockResolvedValue(makeRun("r1", TENANT_A));
      mockEvalRun.delete.mockResolvedValue({});

      const result = await evaluationService.deleteRun("r1", TENANT_A);
      expect(result.success).toBe(true);
      expect(mockEvalRun.delete).toHaveBeenCalledWith({
        where: { id: "r1" },
      });
    });

    it("throws NOT_FOUND for cross-tenant delete", async () => {
      mockEvalRun.findUnique.mockResolvedValue(makeRun("r1", TENANT_A));

      await expect(
        evaluationService.deleteRun("r1", TENANT_B),
      ).rejects.toThrow(DomainError);
      expect(mockEvalRun.delete).not.toHaveBeenCalled();
    });

    it("throws NOT_FOUND when run does not exist", async () => {
      mockEvalRun.findUnique.mockResolvedValue(null);

      await expect(
        evaluationService.deleteRun("nope", TENANT_A),
      ).rejects.toThrow(DomainError);
    });
  });

  describe("listRuns", () => {
    it("filters by tenantId", async () => {
      mockEvalRun.findMany.mockResolvedValue([]);

      await evaluationService.listRuns(TENANT_A, { type: "section_classification" });

      const where = mockEvalRun.findMany.mock.calls[0][0].where;
      expect(where.tenantId).toBe(TENANT_A);
      expect(where.type).toBe("section_classification");
    });
  });

  describe("createRun — worker enqueue", () => {
    const USER_ID = "user-aaa";

    it("enqueues run_evaluation for single type", async () => {
      mockEvalRun.create.mockResolvedValue({ id: "run-1", tenantId: TENANT_A, type: "single" });

      await evaluationService.createRun(TENANT_A, { type: "single", createdById: USER_ID });

      expect(mockEnqueue).toHaveBeenCalledTimes(1);
      expect(mockEnqueue).toHaveBeenCalledWith("run_evaluation", { evaluationRunId: "run-1" });
    });

    it("enqueues run_batch_evaluation for batch type", async () => {
      mockEvalRun.create.mockResolvedValue({ id: "run-2", tenantId: TENANT_A, type: "batch" });

      await evaluationService.createRun(TENANT_A, { type: "batch", createdById: USER_ID });

      expect(mockEnqueue).toHaveBeenCalledTimes(1);
      expect(mockEnqueue).toHaveBeenCalledWith("run_batch_evaluation", {
        evaluationRunId: "run-2",
      });
    });

    it("does not enqueue for llm_comparison (no handler yet)", async () => {
      mockEvalRun.create.mockResolvedValue({
        id: "run-3",
        tenantId: TENANT_A,
        type: "llm_comparison",
      });

      await evaluationService.createRun(TENANT_A, {
        type: "llm_comparison",
        createdById: USER_ID,
      });

      expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it("does not enqueue for context_window_test", async () => {
      mockEvalRun.create.mockResolvedValue({
        id: "run-4",
        tenantId: TENANT_A,
        type: "context_window_test",
      });

      await evaluationService.createRun(TENANT_A, {
        type: "context_window_test",
        createdById: USER_ID,
      });

      expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it("returns the created run record", async () => {
      const created = { id: "run-5", tenantId: TENANT_A, type: "single" };
      mockEvalRun.create.mockResolvedValue(created);

      const result = await evaluationService.createRun(TENANT_A, {
        type: "single",
        createdById: USER_ID,
      });

      expect(result).toEqual(created);
    });
  });
});
