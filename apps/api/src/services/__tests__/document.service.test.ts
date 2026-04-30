import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clinscriptum/db", () => ({
  prisma: {
    documentVersion: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    document: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    study: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("../../lib/storage.js", () => ({
  storage: {
    getPresignedUploadUrl: vi.fn(),
    getPresignedDownloadUrl: vi.fn(),
  },
}));

vi.mock("../../lib/queue.js", () => ({
  enqueueJob: vi.fn(),
}));

vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { prisma } from "@clinscriptum/db";
import { documentService } from "../document.service.js";
import { DomainError } from "../errors.js";

const mockStudy = prisma.study as unknown as {
  findFirst: ReturnType<typeof vi.fn>;
};
const mockDocument = prisma.document as unknown as {
  findMany: ReturnType<typeof vi.fn>;
  findFirst: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
};

const TENANT_A = "tenant-aaa";
const TENANT_B = "tenant-bbb";
const STUDY_ID = "study-001";

function makeStudy(tenantId = TENANT_A) {
  return { id: STUDY_ID, tenantId, title: "Test Study" };
}

beforeEach(() => vi.clearAllMocks());

describe("documentService", () => {
  describe("listByStudy", () => {
    it("returns documents for valid tenant study", async () => {
      mockStudy.findFirst.mockResolvedValue(makeStudy());
      mockDocument.findMany.mockResolvedValue([]);

      const result = await documentService.listByStudy(TENANT_A, STUDY_ID);
      expect(result).toEqual([]);
      expect(mockStudy.findFirst).toHaveBeenCalledWith({
        where: { id: STUDY_ID, tenantId: TENANT_A },
      });
    });

    it("throws NOT_FOUND for wrong tenant", async () => {
      mockStudy.findFirst.mockResolvedValue(null);

      await expect(
        documentService.listByStudy(TENANT_B, STUDY_ID),
      ).rejects.toThrow(DomainError);
    });
  });

  describe("create", () => {
    it("creates protocol document", async () => {
      mockStudy.findFirst.mockResolvedValue(makeStudy());
      mockDocument.create.mockResolvedValue({ id: "doc-1", type: "protocol" });

      const result = await documentService.create(TENANT_A, {
        studyId: STUDY_ID,
        type: "protocol",
        title: "Protocol v1",
      });

      expect(result.type).toBe("protocol");
    });

    it("requires protocol before ICF", async () => {
      mockStudy.findFirst.mockResolvedValue(makeStudy());
      mockDocument.findFirst.mockResolvedValue(null);

      await expect(
        documentService.create(TENANT_A, {
          studyId: STUDY_ID,
          type: "icf",
          title: "ICF v1",
        }),
      ).rejects.toThrow("Protocol must be uploaded first");
    });

    it("allows ICF when protocol exists", async () => {
      mockStudy.findFirst.mockResolvedValue(makeStudy());
      mockDocument.findFirst.mockResolvedValue({ id: "doc-p", type: "protocol" });
      mockDocument.create.mockResolvedValue({ id: "doc-icf", type: "icf" });

      const result = await documentService.create(TENANT_A, {
        studyId: STUDY_ID,
        type: "icf",
        title: "ICF v1",
      });

      expect(result.type).toBe("icf");
    });

    it("throws NOT_FOUND for wrong tenant", async () => {
      mockStudy.findFirst.mockResolvedValue(null);

      await expect(
        documentService.create(TENANT_B, {
          studyId: STUDY_ID,
          type: "protocol",
          title: "Hack",
        }),
      ).rejects.toThrow(DomainError);
    });
  });
});
