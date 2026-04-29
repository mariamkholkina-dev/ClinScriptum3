import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  correctionFindMany,
  correctionUpdateMany,
  recommendationFindFirst,
  recommendationCreate,
  recommendationUpdate,
} = vi.hoisted(() => ({
  correctionFindMany: vi.fn(),
  correctionUpdateMany: vi.fn(),
  recommendationFindFirst: vi.fn(),
  recommendationCreate: vi.fn(),
  recommendationUpdate: vi.fn(),
}));

vi.mock("@clinscriptum/db", () => ({
  prisma: {
    correctionRecord: { findMany: correctionFindMany, updateMany: correctionUpdateMany },
    correctionRecommendation: {
      findFirst: recommendationFindFirst,
      create: recommendationCreate,
      update: recommendationUpdate,
    },
  },
}));

vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { handleAnalyzeCorrections } from "../analyze-corrections.js";

const TENANT = "tenant-1";

function makeCorrection(
  id: string,
  stage: string,
  entityType: string,
  original: Record<string, unknown>,
  corrected: Record<string, unknown>,
) {
  return {
    id,
    tenantId: TENANT,
    stage,
    entityType,
    isProcessed: false,
    originalValue: original,
    correctedValue: corrected,
    createdAt: new Date(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  recommendationFindFirst.mockResolvedValue(null);
  recommendationCreate.mockResolvedValue({ id: "rec-1" });
  recommendationUpdate.mockResolvedValue({});
  correctionUpdateMany.mockResolvedValue({});
});

describe("handleAnalyzeCorrections", () => {
  it("returns early when there are no unprocessed corrections", async () => {
    correctionFindMany.mockResolvedValue([]);

    const result = await handleAnalyzeCorrections({ tenantId: TENANT });

    expect(result).toEqual({ success: true, processed: 0, recommendations: 0 });
    expect(recommendationCreate).not.toHaveBeenCalled();
  });

  it("creates a recommendation once frequency reaches the threshold (3)", async () => {
    const original = { value: "old" };
    const corrected = { value: "new" };
    correctionFindMany.mockResolvedValue([
      makeCorrection("c1", "classification", "section", original, corrected),
      makeCorrection("c2", "classification", "section", original, corrected),
      makeCorrection("c3", "classification", "section", original, corrected),
    ]);

    const result = await handleAnalyzeCorrections({ tenantId: TENANT });

    expect(recommendationCreate).toHaveBeenCalledTimes(1);
    expect(recommendationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: TENANT,
        stage: "classification",
        frequency: 3,
        status: "pending",
        suggestedChange: expect.stringContaining("\"old\""),
      }),
    });
    expect(correctionUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["c1", "c2", "c3"] } },
      data: { isProcessed: true, recommendationId: "rec-1" },
    });
    expect(result.recommendations).toBe(1);
    expect(result.processed).toBe(3);
  });

  it("does NOT create a recommendation below threshold but still marks corrections processed", async () => {
    correctionFindMany.mockResolvedValue([
      makeCorrection("c1", "extraction", "fact", { v: 1 }, { v: 2 }),
      makeCorrection("c2", "extraction", "fact", { v: 1 }, { v: 2 }),
    ]);

    const result = await handleAnalyzeCorrections({ tenantId: TENANT });

    expect(recommendationCreate).not.toHaveBeenCalled();
    expect(correctionUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["c1", "c2"] } },
      data: { isProcessed: true },
    });
    expect(result.recommendations).toBe(0);
    expect(result.processed).toBe(2);
  });

  it("groups corrections by (stage, entityType, patternKey)", async () => {
    correctionFindMany.mockResolvedValue([
      // group A — 3 hits
      makeCorrection("a1", "classification", "section", { x: "y" }, { x: "z" }),
      makeCorrection("a2", "classification", "section", { x: "y" }, { x: "z" }),
      makeCorrection("a3", "classification", "section", { x: "y" }, { x: "z" }),
      // group B — different stage, also 3 hits
      makeCorrection("b1", "extraction", "section", { x: "y" }, { x: "z" }),
      makeCorrection("b2", "extraction", "section", { x: "y" }, { x: "z" }),
      makeCorrection("b3", "extraction", "section", { x: "y" }, { x: "z" }),
    ]);

    const result = await handleAnalyzeCorrections({ tenantId: TENANT });

    expect(recommendationCreate).toHaveBeenCalledTimes(2);
    expect(result.recommendations).toBe(2);
  });

  it("updates frequency on an existing pending recommendation instead of creating a new one", async () => {
    recommendationFindFirst.mockResolvedValueOnce({
      id: "existing-rec",
      frequency: 5,
    });

    correctionFindMany.mockResolvedValue([
      makeCorrection("c1", "classification", "section", { x: 1 }, { x: 2 }),
      makeCorrection("c2", "classification", "section", { x: 1 }, { x: 2 }),
      makeCorrection("c3", "classification", "section", { x: 1 }, { x: 2 }),
    ]);

    const result = await handleAnalyzeCorrections({ tenantId: TENANT });

    expect(recommendationCreate).not.toHaveBeenCalled();
    expect(recommendationUpdate).toHaveBeenCalledWith({
      where: { id: "existing-rec" },
      data: { frequency: 8 },
    });
    expect(correctionUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["c1", "c2", "c3"] } },
      data: { isProcessed: true, recommendationId: "existing-rec" },
    });
    expect(result.recommendations).toBe(0); // not incremented for updates
  });

  it("derivePatternKey: same change shape produces same group across corrections", async () => {
    correctionFindMany.mockResolvedValue([
      makeCorrection("c1", "x", "y", { a: 1, b: "old" }, { a: 1, b: "new1" }),
      makeCorrection("c2", "x", "y", { a: 2, b: "old" }, { a: 2, b: "new2" }),
      makeCorrection("c3", "x", "y", { a: 3, b: "old" }, { a: 3, b: "new3" }),
    ]);

    await handleAnalyzeCorrections({ tenantId: TENANT });

    expect(recommendationCreate).toHaveBeenCalledTimes(1);
    const callArgs = recommendationCreate.mock.calls[0][0];
    expect(callArgs.data.pattern).toBe("b:string->string");
  });

  it("describeSuggestedChange: produces a human-readable description of the change", async () => {
    correctionFindMany.mockResolvedValue([
      makeCorrection("c1", "stg", "ent", { name: "Foo" }, { name: "Bar" }),
      makeCorrection("c2", "stg", "ent", { name: "Foo" }, { name: "Bar" }),
      makeCorrection("c3", "stg", "ent", { name: "Foo" }, { name: "Bar" }),
    ]);

    await handleAnalyzeCorrections({ tenantId: TENANT });

    const call = recommendationCreate.mock.calls[0][0];
    expect(call.data.suggestedChange).toContain("\"name\"");
    expect(call.data.suggestedChange).toContain("\"Foo\"");
    expect(call.data.suggestedChange).toContain("\"Bar\"");
  });

  it("filters to isProcessed: false and current tenant", async () => {
    correctionFindMany.mockResolvedValue([]);

    await handleAnalyzeCorrections({ tenantId: TENANT });

    expect(correctionFindMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT, isProcessed: false },
      orderBy: { createdAt: "asc" },
    });
  });
});
