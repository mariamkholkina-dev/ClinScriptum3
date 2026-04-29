import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clinscriptum/db", () => ({
  prisma: {
    study: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("@clinscriptum/shared/fact-extraction", () => ({
  EXCLUDED_SECTION_PREFIXES: ["appendix", "reference"],
}));

import { prisma } from "@clinscriptum/db";
import { studyService } from "../study.service.js";

const mockStudy = prisma.study as unknown as {
  findMany: ReturnType<typeof vi.fn>;
  findFirst: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  updateMany: ReturnType<typeof vi.fn>;
  deleteMany: ReturnType<typeof vi.fn>;
};

const TENANT_A = "tenant-aaa";
const TENANT_B = "tenant-bbb";
const STUDY_ID = "study-001";

function makeStudy(overrides: Record<string, unknown> = {}) {
  return {
    id: STUDY_ID,
    tenantId: TENANT_A,
    title: "Test Study",
    sponsor: "Sponsor",
    drug: "Drug",
    therapeuticArea: "Oncology",
    phase: "III",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("studyService", () => {
  describe("list", () => {
    it("returns studies for tenant", async () => {
      const studies = [makeStudy()];
      mockStudy.findMany.mockResolvedValue(studies);

      const result = await studyService.list(TENANT_A);

      expect(result).toEqual(studies);
      expect(mockStudy.findMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT_A },
        orderBy: { createdAt: "desc" },
      });
    });

    it("returns empty array for tenant with no studies", async () => {
      mockStudy.findMany.mockResolvedValue([]);
      const result = await studyService.list(TENANT_B);
      expect(result).toEqual([]);
    });
  });

  describe("getById", () => {
    it("returns study with documents", async () => {
      const study = makeStudy();
      mockStudy.findFirst.mockResolvedValue(study);

      const result = await studyService.getById(TENANT_A, STUDY_ID);
      expect(result).toEqual(study);
      expect(mockStudy.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: STUDY_ID, tenantId: TENANT_A },
        }),
      );
    });

    it("returns null for non-existent study", async () => {
      mockStudy.findFirst.mockResolvedValue(null);
      const result = await studyService.getById(TENANT_A, "no-such-id");
      expect(result).toBeNull();
    });
  });

  describe("create", () => {
    it("creates study with all fields", async () => {
      const created = makeStudy();
      mockStudy.create.mockResolvedValue(created);

      const result = await studyService.create(TENANT_A, {
        title: "Test Study",
        sponsor: "Sponsor",
        drug: "Drug",
        therapeuticArea: "Oncology",
        phase: "III",
      });

      expect(result).toEqual(created);
      expect(mockStudy.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT_A,
          title: "Test Study",
          phase: "III",
        }),
      });
    });

    it("creates study with optional fields as null", async () => {
      mockStudy.create.mockResolvedValue(makeStudy({ sponsor: null }));

      await studyService.create(TENANT_A, {
        title: "Minimal Study",
        phase: "I",
      });

      expect(mockStudy.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          sponsor: null,
          drug: null,
          therapeuticArea: null,
        }),
      });
    });
  });

  describe("update", () => {
    it("updates study scoped to tenant", async () => {
      mockStudy.updateMany.mockResolvedValue({ count: 1 });

      await studyService.update(TENANT_A, STUDY_ID, { title: "New Title" });

      expect(mockStudy.updateMany).toHaveBeenCalledWith({
        where: { id: STUDY_ID, tenantId: TENANT_A },
        data: { title: "New Title" },
      });
    });

    it("updates 0 rows for wrong tenant", async () => {
      mockStudy.updateMany.mockResolvedValue({ count: 0 });

      const result = await studyService.update(TENANT_B, STUDY_ID, { title: "Hack" });
      expect(result.count).toBe(0);
    });
  });

  describe("delete", () => {
    it("deletes study scoped to tenant", async () => {
      mockStudy.deleteMany.mockResolvedValue({ count: 1 });

      await studyService.delete(TENANT_A, STUDY_ID);

      expect(mockStudy.deleteMany).toHaveBeenCalledWith({
        where: { id: STUDY_ID, tenantId: TENANT_A },
      });
    });

    it("deletes 0 rows for wrong tenant", async () => {
      mockStudy.deleteMany.mockResolvedValue({ count: 0 });
      const result = await studyService.delete(TENANT_B, STUDY_ID);
      expect(result.count).toBe(0);
    });
  });
});
