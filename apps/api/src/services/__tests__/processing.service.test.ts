import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clinscriptum/db", () => ({
  prisma: {
    documentVersion: {
      findUnique: vi.fn(),
    },
    processingRun: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
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
  findMany: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
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
});
