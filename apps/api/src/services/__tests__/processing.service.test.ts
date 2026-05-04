import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clinscriptum/db", () => ({
  prisma: {
    documentVersion: {
      findUnique: vi.fn(),
    },
    processingRun: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
    fact: {
      findMany: vi.fn(),
    },
  },
  resolveActiveBundle: vi.fn().mockResolvedValue("bundle-1"),
}));

vi.mock("../../data/fact-registry.js", () => ({
  loadFactRegistry: vi.fn().mockReturnValue([]),
  FACT_CATEGORY_LABELS: {},
}));

import { prisma } from "@clinscriptum/db";
import { processingService } from "../processing.service.js";
import { DomainError } from "../errors.js";

const mockVersion = prisma.documentVersion as unknown as {
  findUnique: ReturnType<typeof vi.fn>;
};
const mockRun = prisma.processingRun as unknown as {
  findUnique: ReturnType<typeof vi.fn>;
  findFirst: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
};
const mockFact = prisma.fact as unknown as {
  findMany: ReturnType<typeof vi.fn>;
};

const TENANT_A = "tenant-aaa";
const TENANT_B = "tenant-bbb";
const VERSION_ID = "version-001";

function makeVersion(tenantId = TENANT_A) {
  return {
    id: VERSION_ID,
    document: {
      studyId: "study-001",
      study: { tenantId },
    },
  };
}

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-001",
    studyId: "study-001",
    docVersionId: VERSION_ID,
    type: "classify_sections",
    status: "completed",
    study: { tenantId: TENANT_A },
    steps: [],
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("processingService", () => {
  describe("startRun", () => {
    it("creates processing run for valid tenant", async () => {
      mockVersion.findUnique.mockResolvedValue(makeVersion());
      mockRun.create.mockResolvedValue({ id: "run-new", status: "queued" });

      const result = await processingService.startRun(TENANT_A, {
        docVersionId: VERSION_ID,
        type: "classify_sections",
      });

      expect(result.runId).toBe("run-new");
      expect(result.status).toBe("queued");
    });

    it("throws NOT_FOUND for wrong tenant", async () => {
      mockVersion.findUnique.mockResolvedValue(null);

      await expect(
        processingService.startRun(TENANT_B, {
          docVersionId: VERSION_ID,
          type: "classify_sections",
        }),
      ).rejects.toThrow(DomainError);
    });
  });

  describe("getRun", () => {
    it("returns run for valid tenant", async () => {
      mockRun.findUnique.mockResolvedValue(makeRun());

      const result = await processingService.getRun(TENANT_A, "run-001");

      expect(result.id).toBe("run-001");
    });

    it("throws NOT_FOUND for wrong tenant", async () => {
      mockRun.findUnique.mockResolvedValue(makeRun({ study: { tenantId: TENANT_A } }));

      await expect(
        processingService.getRun(TENANT_B, "run-001"),
      ).rejects.toThrow(DomainError);
    });

    it("throws NOT_FOUND for non-existent run", async () => {
      mockRun.findUnique.mockResolvedValue(null);

      await expect(
        processingService.getRun(TENANT_A, "no-such-run"),
      ).rejects.toThrow(DomainError);
    });
  });

  describe("listRuns", () => {
    it("returns runs scoped to tenant", async () => {
      mockRun.findMany.mockResolvedValue([makeRun()]);

      const result = await processingService.listRuns(TENANT_A, VERSION_ID);

      expect(result).toHaveLength(1);
      expect(mockRun.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { docVersionId: VERSION_ID, study: { tenantId: TENANT_A } },
        }),
      );
    });
  });

  describe("getFactExtractionSummary", () => {
    it("throws NOT_FOUND when document version doesn't belong to tenant", async () => {
      mockVersion.findUnique.mockResolvedValue(makeVersion(TENANT_A));

      await expect(
        processingService.getFactExtractionSummary(TENANT_B, VERSION_ID),
      ).rejects.toThrow(DomainError);
    });

    it("returns run=null when no fact_extraction run exists", async () => {
      mockVersion.findUnique.mockResolvedValue(makeVersion());
      mockRun.findFirst.mockResolvedValue(null);
      mockFact.findMany.mockResolvedValue([]);

      const result = await processingService.getFactExtractionSummary(TENANT_A, VERSION_ID);

      expect(result.run).toBeNull();
      expect(result.failures).toEqual({
        parseErrors: 0,
        skippedSections: 0,
        llmRetries: 0,
        totalTokens: 0,
        stepFailures: 0,
      });
      expect(result.facts.total).toBe(0);
    });

    it("aggregates failure counters from ProcessingStep.result (flat shape)", async () => {
      mockVersion.findUnique.mockResolvedValue(makeVersion());
      mockRun.findFirst.mockResolvedValue({
        id: "run-1",
        status: "completed",
        createdAt: new Date("2026-05-01"),
        attemptNumber: 1,
        steps: [
          { status: "completed", result: { parseErrors: 2, skippedSections: 1, retries: 3, totalTokens: 1000 } },
          { status: "completed", result: { parseErrors: 1, totalTokens: 500 } },
          { status: "failed", result: null },
          { status: "skipped", result: null },
        ],
      });
      mockFact.findMany.mockResolvedValue([]);

      const result = await processingService.getFactExtractionSummary(TENANT_A, VERSION_ID);

      expect(result.run?.id).toBe("run-1");
      expect(result.run?.stepCount).toBe(4);
      expect(result.failures.parseErrors).toBe(3);
      expect(result.failures.skippedSections).toBe(1);
      expect(result.failures.llmRetries).toBe(3);
      expect(result.failures.totalTokens).toBe(1500);
      expect(result.failures.stepFailures).toBe(1);
    });

    it("supports legacy result shape with `data` wrapper", async () => {
      mockVersion.findUnique.mockResolvedValue(makeVersion());
      mockRun.findFirst.mockResolvedValue({
        id: "run-2",
        status: "completed",
        createdAt: new Date(),
        attemptNumber: 1,
        steps: [
          { status: "completed", result: { data: { parseErrors: 5, skippedSections: 2 } } },
        ],
      });
      mockFact.findMany.mockResolvedValue([]);

      const result = await processingService.getFactExtractionSummary(TENANT_A, VERSION_ID);

      expect(result.failures.parseErrors).toBe(5);
      expect(result.failures.skippedSections).toBe(2);
    });

    it("buckets facts by confidence (high/mid/low)", async () => {
      mockVersion.findUnique.mockResolvedValue(makeVersion());
      mockRun.findFirst.mockResolvedValue(null);
      mockFact.findMany.mockResolvedValue([
        { confidence: 0.95, hasContradiction: false, status: "extracted" },
        { confidence: 0.85, hasContradiction: false, status: "validated" },
        { confidence: 0.7, hasContradiction: true, status: "extracted" },
        { confidence: 0.5, hasContradiction: false, status: "extracted" },
        { confidence: 0.3, hasContradiction: false, status: "extracted" },
        { confidence: 0.1, hasContradiction: false, status: "extracted" },
      ]);

      const result = await processingService.getFactExtractionSummary(TENANT_A, VERSION_ID);

      expect(result.facts.total).toBe(6);
      expect(result.facts.highConfidence).toBe(2); // 0.95, 0.85
      expect(result.facts.midConfidence).toBe(2); // 0.7, 0.5
      expect(result.facts.lowConfidence).toBe(2); // 0.3, 0.1
      expect(result.facts.validated).toBe(1);
      expect(result.facts.contradictions).toBe(1);
    });

    it("filters fact_extraction runs only", async () => {
      mockVersion.findUnique.mockResolvedValue(makeVersion());
      mockRun.findFirst.mockResolvedValue(null);
      mockFact.findMany.mockResolvedValue([]);

      await processingService.getFactExtractionSummary(TENANT_A, VERSION_ID);

      expect(mockRun.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { docVersionId: VERSION_ID, type: "fact_extraction" },
        }),
      );
    });
  });
});
