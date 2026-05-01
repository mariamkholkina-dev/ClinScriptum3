import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clinscriptum/db", () => ({
  prisma: {
    documentVersion: { findUnique: vi.fn() },
    document: { findFirst: vi.fn() },
    fact: { findMany: vi.fn() },
  },
}));

vi.mock("@clinscriptum/diff-engine", () => ({
  diffSections: vi.fn().mockReturnValue({ sectionDiffs: [], summary: "ok" }),
  diffFacts: vi.fn().mockReturnValue([]),
  analyzeProtocolImpactOnICF: vi.fn().mockReturnValue({ kind: "icf-impact" }),
  analyzeProtocolImpactOnIB: vi.fn().mockReturnValue({ kind: "ib-impact" }),
}));

import { prisma } from "@clinscriptum/db";
import { comparisonService } from "../comparison.service.js";
import { DomainError } from "../errors.js";
import { analyzeProtocolImpactOnICF, analyzeProtocolImpactOnIB } from "@clinscriptum/diff-engine";

const mockVersion = prisma.documentVersion as unknown as {
  findUnique: ReturnType<typeof vi.fn>;
};
const mockDocument = prisma.document as unknown as {
  findFirst: ReturnType<typeof vi.fn>;
};
const mockFact = prisma.fact as unknown as {
  findMany: ReturnType<typeof vi.fn>;
};

const TENANT_A = "tenant-aaa";
const TENANT_B = "tenant-bbb";
const OLD_ID = "v-old";
const NEW_ID = "v-new";

function makeVersion(id: string, tenantId = TENANT_A) {
  return {
    id,
    documentId: "doc-1",
    document: {
      id: "doc-1",
      title: "Protocol",
      study: { tenantId },
    },
    sections: [
      {
        id: "s1",
        title: "Synopsis",
        standardSection: "synopsis",
        contentBlocks: [{ content: "para 1" }, { content: "para 2" }],
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFact.findMany.mockResolvedValue([]);
});

describe("comparisonService.compare", () => {
  it("compares two versions in same tenant and returns sectionDiffs + factChanges", async () => {
    mockVersion.findUnique
      .mockResolvedValueOnce(makeVersion(OLD_ID))
      .mockResolvedValueOnce(makeVersion(NEW_ID));
    mockFact.findMany
      .mockResolvedValueOnce([{ factKey: "phase", value: "II" }])
      .mockResolvedValueOnce([{ factKey: "phase", value: "III" }]);

    const result = await comparisonService.compare(TENANT_A, OLD_ID, NEW_ID);

    expect(result).toHaveProperty("factChanges");
    expect(result).toHaveProperty("sectionDiffs");
  });

  it("throws NOT_FOUND when oldVersion is missing", async () => {
    mockVersion.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeVersion(NEW_ID));

    await expect(
      comparisonService.compare(TENANT_A, OLD_ID, NEW_ID),
    ).rejects.toThrow(DomainError);
  });

  it("throws NOT_FOUND when newVersion is missing", async () => {
    mockVersion.findUnique
      .mockResolvedValueOnce(makeVersion(OLD_ID))
      .mockResolvedValueOnce(null);

    await expect(
      comparisonService.compare(TENANT_A, OLD_ID, NEW_ID),
    ).rejects.toThrow(DomainError);
  });

  it("rejects cross-tenant access (oldVersion in another tenant)", async () => {
    mockVersion.findUnique
      .mockResolvedValueOnce(makeVersion(OLD_ID, TENANT_B))
      .mockResolvedValueOnce(makeVersion(NEW_ID, TENANT_A));

    await expect(
      comparisonService.compare(TENANT_A, OLD_ID, NEW_ID),
    ).rejects.toThrow(DomainError);
  });
});

describe("comparisonService.impactAnalysis", () => {
  function makeTargetDoc(type: "icf" | "ib", id = "target-1") {
    return { id, type, title: `${type.toUpperCase()} Doc` };
  }

  it("routes ICF target to analyzeProtocolImpactOnICF", async () => {
    mockVersion.findUnique
      .mockResolvedValueOnce(makeVersion(OLD_ID))
      .mockResolvedValueOnce(makeVersion(NEW_ID));
    mockDocument.findFirst.mockResolvedValueOnce(makeTargetDoc("icf"));

    const result = await comparisonService.impactAnalysis(TENANT_A, OLD_ID, NEW_ID, "target-1");

    expect(analyzeProtocolImpactOnICF).toHaveBeenCalledTimes(1);
    expect(analyzeProtocolImpactOnIB).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: "icf-impact" });
  });

  it("routes IB target to analyzeProtocolImpactOnIB", async () => {
    mockVersion.findUnique
      .mockResolvedValueOnce(makeVersion(OLD_ID))
      .mockResolvedValueOnce(makeVersion(NEW_ID));
    mockDocument.findFirst.mockResolvedValueOnce(makeTargetDoc("ib"));

    const result = await comparisonService.impactAnalysis(TENANT_A, OLD_ID, NEW_ID, "target-1");

    expect(analyzeProtocolImpactOnIB).toHaveBeenCalledTimes(1);
    expect(analyzeProtocolImpactOnICF).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: "ib-impact" });
  });

  it("throws NOT_FOUND when target document is missing or in another tenant", async () => {
    mockVersion.findUnique
      .mockResolvedValueOnce(makeVersion(OLD_ID))
      .mockResolvedValueOnce(makeVersion(NEW_ID));
    mockDocument.findFirst.mockResolvedValueOnce(null); // tenant filter excluded it

    await expect(
      comparisonService.impactAnalysis(TENANT_A, OLD_ID, NEW_ID, "target-1"),
    ).rejects.toThrow(/Target document not found/);
  });

  it("filters target document by tenantId", async () => {
    mockVersion.findUnique
      .mockResolvedValueOnce(makeVersion(OLD_ID))
      .mockResolvedValueOnce(makeVersion(NEW_ID));
    mockDocument.findFirst.mockResolvedValueOnce(makeTargetDoc("icf"));

    await comparisonService.impactAnalysis(TENANT_A, OLD_ID, NEW_ID, "target-1");

    expect(mockDocument.findFirst).toHaveBeenCalledWith({
      where: { id: "target-1", study: { tenantId: TENANT_A } },
    });
  });
});
