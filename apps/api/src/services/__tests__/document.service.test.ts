import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock-объект транзакции — collected here чтобы тесты могли управлять
// возвратами и проверять вызовы.
const txMock = {
  section: {
    update: vi.fn(),
  },
  goldenAnnotation: {
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  goldenSampleStageStatus: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
};

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
    goldenAnnotation: {
      findMany: vi.fn(),
    },
    goldenSampleStageStatus: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn((fn: (tx: unknown) => unknown) =>
      typeof fn === "function"
        ? fn(txMock)
        : Promise.all(fn as unknown as Promise<unknown>[]),
    ),
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
const mockGoldenAnnotation = prisma.goldenAnnotation as unknown as {
  findMany: ReturnType<typeof vi.fn>;
};
const mockGoldenSampleStageStatus = prisma.goldenSampleStageStatus as unknown as {
  findMany: ReturnType<typeof vi.fn>;
};

const TENANT_A = "tenant-aaa";
const TENANT_B = "tenant-bbb";
const STUDY_ID = "study-001";
const SECTION_ID = "sec-001";
const DOC_VERSION_ID = "dv-001";

function makeStudy(tenantId = TENANT_A) {
  return { id: STUDY_ID, tenantId, title: "Test Study" };
}

function makeSection(overrides: Partial<{
  id: string;
  title: string;
  isFalseHeading: boolean;
  standardSection: string | null;
  algoSection: string | null;
  llmSection: string | null;
  docVersionId: string;
  tenantId: string;
}> = {}) {
  return {
    id: overrides.id ?? SECTION_ID,
    title: overrides.title ?? "Информированное согласие",
    isFalseHeading: overrides.isFalseHeading ?? false,
    standardSection: overrides.standardSection ?? null,
    algoSection: overrides.algoSection ?? null,
    llmSection: overrides.llmSection ?? null,
    docVersionId: overrides.docVersionId ?? DOC_VERSION_ID,
    docVersion: {
      document: { study: { tenantId: overrides.tenantId ?? TENANT_A } },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default tx mock returns to keep tests focused on what they assert.
  txMock.section.update.mockResolvedValue({ id: SECTION_ID, isFalseHeading: true });
  txMock.goldenAnnotation.findMany.mockResolvedValue([]);
  txMock.goldenAnnotation.deleteMany.mockResolvedValue({ count: 0 });
  txMock.goldenSampleStageStatus.findMany.mockResolvedValue([]);
  txMock.goldenSampleStageStatus.update.mockResolvedValue({});
});

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

  describe("markSectionFalseHeading — cascade cleanup", () => {
    it("transition false → true clears classification + cascades to annotations + expected_results", async () => {
      mockSection.findUnique.mockResolvedValue(
        makeSection({ isFalseHeading: false, standardSection: "ethics.informed_consent" }),
      );
      txMock.section.update.mockResolvedValue({
        id: SECTION_ID,
        isFalseHeading: true,
        standardSection: null,
      });
      // 2 annotations to delete
      txMock.goldenAnnotation.findMany.mockResolvedValue([
        { id: "ann-1" },
        { id: "ann-2" },
      ]);
      txMock.goldenAnnotation.deleteMany.mockResolvedValue({ count: 2 });
      // Stage statuses with matching expected sections
      txMock.goldenSampleStageStatus.findMany.mockResolvedValue([
        {
          id: "ss-1",
          expectedResults: {
            sections: [
              { title: "Информированное согласие", level: 1 },
              { title: "Другая секция", level: 2 },
            ],
          },
        },
        {
          id: "ss-2",
          expectedResults: {
            sections: [{ title: "ИНФОРМИРОВАННОЕ СОГЛАСИЕ  ", level: 1 }],
          },
        },
      ]);

      const result = await documentService.markSectionFalseHeading(
        TENANT_A,
        SECTION_ID,
        true,
      );

      // Section update with isFalseHeading=true AND classification cleared
      expect(txMock.section.update).toHaveBeenCalledWith({
        where: { id: SECTION_ID },
        data: expect.objectContaining({
          isFalseHeading: true,
          standardSection: null,
          algoSection: null,
          algoConfidence: 0,
          llmSection: null,
          llmConfidence: 0,
          classifiedBy: null,
          confidence: 0,
          classificationStatus: "not_validated",
          classificationComment: null,
        }),
      });

      // Annotations deleted by id batch
      expect(txMock.goldenAnnotation.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ["ann-1", "ann-2"] } },
      });

      // Both stage statuses updated (each had a matching entry)
      expect(txMock.goldenSampleStageStatus.update).toHaveBeenCalledTimes(2);
      const firstUpdate = txMock.goldenSampleStageStatus.update.mock.calls[0][0];
      expect(firstUpdate.where).toEqual({ id: "ss-1" });
      const updatedSections = (firstUpdate.data.expectedResults as { sections: Array<{ title: string }> }).sections;
      expect(updatedSections).toHaveLength(1);
      expect(updatedSections[0].title).toBe("Другая секция");

      // cleanupSummary in result
      expect(result.cleanupSummary).toEqual({
        clearedClassification: true,
        deletedAnnotations: 2,
        clearedExpectedEntries: 2,
        clearedStageStatuses: 2,
      });
    });

    it("transition false → true with no annotations + no expected — only Section.update", async () => {
      mockSection.findUnique.mockResolvedValue(
        makeSection({ isFalseHeading: false }),
      );
      txMock.section.update.mockResolvedValue({ id: SECTION_ID, isFalseHeading: true });
      txMock.goldenAnnotation.findMany.mockResolvedValue([]);
      txMock.goldenSampleStageStatus.findMany.mockResolvedValue([]);

      const result = await documentService.markSectionFalseHeading(
        TENANT_A,
        SECTION_ID,
        true,
      );

      expect(txMock.section.update).toHaveBeenCalledTimes(1);
      expect(txMock.goldenAnnotation.deleteMany).not.toHaveBeenCalled();
      expect(txMock.goldenSampleStageStatus.update).not.toHaveBeenCalled();
      expect(result.cleanupSummary).toEqual({
        clearedClassification: true,
        deletedAnnotations: 0,
        clearedExpectedEntries: 0,
        clearedStageStatuses: 0,
      });
    });

    it("no-op transition (already true → mark true) does NOT clear classification or run cleanup", async () => {
      mockSection.findUnique.mockResolvedValue(
        makeSection({ isFalseHeading: true, standardSection: "ethics.informed_consent" }),
      );
      txMock.section.update.mockResolvedValue({
        id: SECTION_ID,
        isFalseHeading: true,
        standardSection: "ethics.informed_consent",
      });

      const result = await documentService.markSectionFalseHeading(
        TENANT_A,
        SECTION_ID,
        true,
      );

      // Only isFalseHeading updated — no clearing fields
      const updateArgs = txMock.section.update.mock.calls[0][0];
      expect(updateArgs.data).toEqual({ isFalseHeading: true });
      expect(updateArgs.data).not.toHaveProperty("standardSection");

      // Cleanup must not run
      expect(txMock.goldenAnnotation.findMany).not.toHaveBeenCalled();
      expect(txMock.goldenAnnotation.deleteMany).not.toHaveBeenCalled();
      expect(txMock.goldenSampleStageStatus.findMany).not.toHaveBeenCalled();

      expect(result.cleanupSummary).toEqual({
        clearedClassification: false,
        deletedAnnotations: 0,
        clearedExpectedEntries: 0,
        clearedStageStatuses: 0,
      });
    });

    it("un-mark (true → false) does NOT restore classification + does NOT delete annotations", async () => {
      mockSection.findUnique.mockResolvedValue(
        makeSection({ isFalseHeading: true }),
      );
      txMock.section.update.mockResolvedValue({ id: SECTION_ID, isFalseHeading: false });

      const result = await documentService.markSectionFalseHeading(
        TENANT_A,
        SECTION_ID,
        false,
      );

      // Only isFalseHeading=false; никаких snapshot'ов восстановления.
      const updateArgs = txMock.section.update.mock.calls[0][0];
      expect(updateArgs.data).toEqual({ isFalseHeading: false });

      // Cleanup branch не должен запуститься (transitioning=false).
      expect(txMock.goldenAnnotation.findMany).not.toHaveBeenCalled();
      expect(txMock.goldenAnnotation.deleteMany).not.toHaveBeenCalled();

      expect(result.cleanupSummary.clearedClassification).toBe(false);
    });

    it("rejects cross-tenant access", async () => {
      mockSection.findUnique.mockResolvedValue(makeSection());

      await expect(
        documentService.markSectionFalseHeading(TENANT_B, SECTION_ID, true),
      ).rejects.toThrow(DomainError);
      expect(txMock.section.update).not.toHaveBeenCalled();
    });

    it("throws NOT_FOUND when section missing", async () => {
      mockSection.findUnique.mockResolvedValue(null);

      await expect(
        documentService.markSectionFalseHeading(TENANT_A, SECTION_ID, true),
      ).rejects.toThrow(DomainError);
    });
  });

  describe("previewFalseHeadingCleanup", () => {
    it("returns counts for not-yet-false section with annotations + expected entries", async () => {
      mockSection.findUnique.mockResolvedValue(
        makeSection({
          isFalseHeading: false,
          standardSection: "ethics.informed_consent",
        }),
      );
      mockGoldenAnnotation.findMany.mockResolvedValue([
        {
          id: "ann-1",
          proposedZone: "ethics.informed_consent",
          isQuestion: false,
          annotator: { id: "u-1", name: "Анна", email: "a@x" },
        },
        {
          id: "ann-2",
          proposedZone: null,
          isQuestion: true,
          annotator: { id: "u-2", name: "Борис", email: "b@x" },
        },
      ]);
      mockGoldenSampleStageStatus.findMany.mockResolvedValue([
        {
          expectedResults: {
            sections: [
              { title: "Информированное согласие", level: 1 },
              { title: "Другая", level: 2 },
            ],
          },
        },
        {
          expectedResults: {
            sections: [{ title: "ИНФОРМИРОВАННОЕ согласие", level: 1 }],
          },
        },
      ]);

      const result = await documentService.previewFalseHeadingCleanup(
        TENANT_A,
        SECTION_ID,
      );

      expect(result.clearedClassification).toBe(true); // standardSection != null
      expect(result.currentZone).toBe("ethics.informed_consent");
      expect(result.annotations).toHaveLength(2);
      expect(result.annotations[0]).toMatchObject({
        id: "ann-1",
        annotator: { id: "u-1", name: "Анна" },
      });
      expect(result.expectedEntries).toBe(2);
    });

    it("returns empty preview for already-false section", async () => {
      mockSection.findUnique.mockResolvedValue(
        makeSection({ isFalseHeading: true, standardSection: "ethics.informed_consent" }),
      );

      const result = await documentService.previewFalseHeadingCleanup(
        TENANT_A,
        SECTION_ID,
      );

      expect(result).toEqual({
        clearedClassification: false,
        annotations: [],
        expectedEntries: 0,
      });
      // Не должно даже искать аннотации.
      expect(mockGoldenAnnotation.findMany).not.toHaveBeenCalled();
      expect(mockGoldenSampleStageStatus.findMany).not.toHaveBeenCalled();
    });

    it("returns clearedClassification=false when section has no zone yet", async () => {
      mockSection.findUnique.mockResolvedValue(
        makeSection({
          isFalseHeading: false,
          standardSection: null,
          algoSection: null,
          llmSection: null,
        }),
      );
      mockGoldenAnnotation.findMany.mockResolvedValue([]);
      mockGoldenSampleStageStatus.findMany.mockResolvedValue([]);

      const result = await documentService.previewFalseHeadingCleanup(
        TENANT_A,
        SECTION_ID,
      );

      expect(result.clearedClassification).toBe(false);
      expect(result.annotations).toEqual([]);
      expect(result.expectedEntries).toBe(0);
    });

    it("rejects cross-tenant access", async () => {
      mockSection.findUnique.mockResolvedValue(makeSection());

      await expect(
        documentService.previewFalseHeadingCleanup(TENANT_B, SECTION_ID),
      ).rejects.toThrow(DomainError);
    });
  });
});
