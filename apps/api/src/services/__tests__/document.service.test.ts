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
    ruleSet: {
      findFirst: vi.fn(),
    },
    section: {
      findUnique: vi.fn(),
      update: vi.fn(),
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
const mockRuleSet = prisma.ruleSet as unknown as {
  findFirst: ReturnType<typeof vi.fn>;
};
const mockSection = prisma.section as unknown as {
  findUnique: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
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

  describe("getTaxonomy", () => {
    const tenantRuleSet = {
      id: "rs-tenant",
      tenantId: TENANT_A,
      versions: [
        {
          isActive: true,
          rules: [{ name: "synopsis", pattern: "^syn", config: { key: "synopsis" } }],
        },
      ],
    };
    const globalRuleSet = {
      id: "rs-global",
      tenantId: null,
      versions: [
        {
          isActive: true,
          rules: [{ name: "objectives", pattern: "^obj", config: { key: "objectives" } }],
        },
      ],
    };

    it("filters by tenant + nullable global, prefers tenant-specific", async () => {
      mockRuleSet.findFirst.mockResolvedValue(tenantRuleSet);

      const result = await documentService.getTaxonomy(TENANT_A);

      expect(mockRuleSet.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            type: "section_classification",
            OR: [{ tenantId: TENANT_A }, { tenantId: null }],
          },
          orderBy: { tenantId: { sort: "desc", nulls: "last" } },
        }),
      );
      expect(result).toEqual([
        { name: "synopsis", pattern: "^syn", config: { key: "synopsis" } },
      ]);
    });

    it("falls back to global ruleset when tenant has none", async () => {
      mockRuleSet.findFirst.mockResolvedValue(globalRuleSet);

      const result = await documentService.getTaxonomy(TENANT_B);

      expect(result[0]?.name).toBe("objectives");
    });

    it("returns empty array when no matching ruleset exists", async () => {
      mockRuleSet.findFirst.mockResolvedValue(null);

      const result = await documentService.getTaxonomy(TENANT_A);
      expect(result).toEqual([]);
    });

    it("never queries without tenant filter (regression: leak across tenants)", async () => {
      mockRuleSet.findFirst.mockResolvedValue(null);
      await documentService.getTaxonomy(TENANT_A);

      const call = mockRuleSet.findFirst.mock.calls[0]?.[0];
      const where = call?.where;
      expect(where?.OR).toBeDefined();
      const tenantIds = (where.OR as Array<{ tenantId: string | null }>).map((e) => e.tenantId);
      expect(tenantIds).toContain(TENANT_A);
      expect(tenantIds).toContain(null);
      expect(tenantIds).not.toContain(TENANT_B);
    });
  });

  describe("markSectionFalseHeading", () => {
    const SECTION_ID = "sec-001";
    const sectionForTenantA = {
      id: SECTION_ID,
      docVersion: { document: { study: { tenantId: TENANT_A } } },
    };

    it("sets isFalseHeading=true for tenant-owned section", async () => {
      mockSection.findUnique.mockResolvedValue(sectionForTenantA);
      mockSection.update.mockResolvedValue({ id: SECTION_ID, isFalseHeading: true });

      const result = await documentService.markSectionFalseHeading(TENANT_A, SECTION_ID, true);

      expect(mockSection.update).toHaveBeenCalledWith({
        where: { id: SECTION_ID },
        data: { isFalseHeading: true },
      });
      expect(result.isFalseHeading).toBe(true);
    });

    it("clears isFalseHeading=false (toggle back)", async () => {
      mockSection.findUnique.mockResolvedValue(sectionForTenantA);
      mockSection.update.mockResolvedValue({ id: SECTION_ID, isFalseHeading: false });

      await documentService.markSectionFalseHeading(TENANT_A, SECTION_ID, false);

      expect(mockSection.update).toHaveBeenCalledWith({
        where: { id: SECTION_ID },
        data: { isFalseHeading: false },
      });
    });

    it("rejects cross-tenant access", async () => {
      mockSection.findUnique.mockResolvedValue(sectionForTenantA);

      await expect(
        documentService.markSectionFalseHeading(TENANT_B, SECTION_ID, true),
      ).rejects.toThrow(DomainError);
      expect(mockSection.update).not.toHaveBeenCalled();
    });

    it("throws NOT_FOUND when section missing", async () => {
      mockSection.findUnique.mockResolvedValue(null);

      await expect(
        documentService.markSectionFalseHeading(TENANT_A, SECTION_ID, true),
      ).rejects.toThrow(DomainError);
    });
  });
});
