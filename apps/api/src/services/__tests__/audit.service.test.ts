import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clinscriptum/db", () => ({
  prisma: {
    documentVersion: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    processingRun: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    finding: {
      count: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    findingReview: {
      findUnique: vi.fn(),
    },
  },
  resolveActiveBundle: vi.fn().mockResolvedValue("bundle-1"),
}));

vi.mock("../../lib/queue.js", () => ({
  enqueueJob: vi.fn(),
}));

vi.mock("../../lib/inter-audit.js", () => ({
  runInterDocAudit: vi.fn(),
}));

vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { prisma } from "@clinscriptum/db";
import { auditService } from "../audit.service.js";
import { DomainError } from "../errors.js";

const mockVersion = prisma.documentVersion as unknown as {
  findUnique: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};
const mockRun = prisma.processingRun as unknown as {
  findFirst: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
};
const mockFinding = prisma.finding as unknown as {
  count: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  deleteMany: ReturnType<typeof vi.fn>;
};
const mockFindingReview = (prisma as any).findingReview as unknown as {
  findUnique: ReturnType<typeof vi.fn>;
};

const TENANT_A = "tenant-aaa";
const TENANT_B = "tenant-bbb";
const VERSION_ID = "version-001";

function makeVersion(tenantId = TENANT_A, status = "parsed") {
  return {
    id: VERSION_ID,
    status,
    document: {
      studyId: "study-001",
      study: { tenantId, operatorReviewEnabled: false },
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe("auditService", () => {
  describe("startIntraAudit", () => {
    it("starts audit for valid tenant version", async () => {
      mockVersion.findUnique.mockResolvedValue(makeVersion());
      mockRun.create.mockResolvedValue({ id: "run-1", status: "queued" });

      const result = await auditService.startIntraAudit(TENANT_A, VERSION_ID);

      expect(result.status).toBe("started");
      expect(result.runId).toBe("run-1");
      expect(mockFinding.deleteMany).toHaveBeenCalled();
      expect(mockVersion.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: "intra_audit" },
        }),
      );
    });

    it("throws NOT_FOUND for wrong tenant", async () => {
      mockVersion.findUnique.mockResolvedValue(makeVersion(TENANT_A));

      await expect(
        auditService.startIntraAudit(TENANT_B, VERSION_ID),
      ).rejects.toThrow(DomainError);
    });

    it("returns already_running if audit is in progress", async () => {
      mockVersion.findUnique.mockResolvedValue(makeVersion(TENANT_A, "intra_audit"));
      mockRun.findFirst.mockResolvedValue({ id: "existing-run" });

      const result = await auditService.startIntraAudit(TENANT_A, VERSION_ID);
      expect(result.status).toBe("already_running");
      expect(result.runId).toBe("existing-run");
    });
  });

  describe("getAuditStatus", () => {
    it("returns status for valid tenant", async () => {
      mockVersion.findUnique.mockResolvedValue(makeVersion());
      mockRun.findFirst.mockResolvedValue({ id: "run-1", status: "completed" });
      mockFinding.count.mockResolvedValue(5);
      mockFindingReview.findUnique.mockResolvedValue(null);

      const result = await auditService.getAuditStatus(TENANT_A, VERSION_ID);

      expect(result).toHaveProperty("totalFindings");
      expect(result.totalFindings).toBe(5);
      expect(result.runStatus).toBe("completed");
    });

    it("throws NOT_FOUND for wrong tenant", async () => {
      mockVersion.findUnique.mockResolvedValue(null);

      await expect(
        auditService.getAuditStatus(TENANT_B, VERSION_ID),
      ).rejects.toThrow(DomainError);
    });
  });
});
