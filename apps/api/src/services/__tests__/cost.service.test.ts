import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clinscriptum/db", () => ({
  prisma: {
    processingRun: { findUnique: vi.fn() },
    llmResponseLog: { findMany: vi.fn() },
    llmModelPricing: { findMany: vi.fn() },
  },
}));

import { prisma } from "@clinscriptum/db";
import { costService, resolveModelCost } from "../cost.service.js";
import { DomainError } from "../errors.js";

const mockRun = prisma.processingRun as unknown as { findUnique: ReturnType<typeof vi.fn> };
const mockLog = prisma.llmResponseLog as unknown as { findMany: ReturnType<typeof vi.fn> };
const mockPricing = prisma.llmModelPricing as unknown as { findMany: ReturnType<typeof vi.fn> };

const PRICING = [
  { modelPattern: "qwen3-235b", costPerInputKTokens: 0.5, costPerOutputKTokens: 0.5, currency: "RUB" },
  { modelPattern: "deepseek-v32", costPerInputKTokens: 0.5, costPerOutputKTokens: 0.8, currency: "RUB" },
  { modelPattern: "deepseek", costPerInputKTokens: 0.3, costPerOutputKTokens: 0.4, currency: "RUB" },
];

describe("resolveModelCost", () => {
  it("matches by substring", () => {
    const c = resolveModelCost("gpt://folder/qwen3-235b-a22b-fp8/latest", PRICING);
    expect(c).toEqual({ inK: 0.5, outK: 0.5, currency: "RUB" });
  });

  it("prefers the longest (most specific) matching pattern", () => {
    // "deepseek-v32" (12) длиннее "deepseek" (8) — берём специфичный.
    const c = resolveModelCost("gpt://folder/deepseek-v32/latest", PRICING);
    expect(c).toEqual({ inK: 0.5, outK: 0.8, currency: "RUB" });
  });

  it("returns null for unknown model", () => {
    expect(resolveModelCost("gpt://folder/llama-70b/latest", PRICING)).toBeNull();
  });

  it("returns null for null model", () => {
    expect(resolveModelCost(null, PRICING)).toBeNull();
  });
});

describe("costService.computeRunCost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRun.findUnique.mockResolvedValue({ id: "run1", study: { tenantId: "t1" } });
    mockPricing.findMany.mockResolvedValue(PRICING);
  });

  it("computes per-call, per-level and total cost", async () => {
    mockLog.findMany.mockResolvedValue([
      { id: "a", label: "self_check:x", level: "llm_check", model: "gpt://f/qwen3-235b-a22b-fp8/latest", promptTokens: 20000, completionTokens: 5000, totalTokens: 25000 },
      { id: "b", label: "qa", level: "llm_qa", model: "gpt://f/deepseek-v32/latest", promptTokens: 10000, completionTokens: 2000, totalTokens: 12000 },
    ]);

    const r = await costService.computeRunCost("t1", "run1");

    // qwen3: 20*0.5 + 5*0.5 = 12.5 ; deepseek-v32: 10*0.5 + 2*0.8 = 6.6
    expect(r.calls[0].costTotal).toBeCloseTo(12.5);
    expect(r.calls[1].costTotal).toBeCloseTo(6.6);
    expect(r.total.cost).toBeCloseTo(19.1);
    expect(r.total.calls).toBe(2);
    expect(r.byLevel.llm_check.cost).toBeCloseTo(12.5);
    expect(r.byLevel.llm_qa.cost).toBeCloseTo(6.6);
    expect(r.unpricedModels).toEqual([]);
  });

  it("flags unpriced models without breaking totals", async () => {
    mockLog.findMany.mockResolvedValue([
      { id: "a", label: "x", level: "llm_check", model: "gpt://f/qwen3-235b-a22b-fp8/latest", promptTokens: 1000, completionTokens: 1000, totalTokens: 2000 },
      { id: "b", label: "y", level: "llm_check", model: "gpt://f/llama-70b/latest", promptTokens: 1000, completionTokens: 1000, totalTokens: 2000 },
    ]);

    const r = await costService.computeRunCost("t1", "run1");

    expect(r.calls[0].priced).toBe(true);
    expect(r.calls[1].priced).toBe(false);
    expect(r.calls[1].costTotal).toBe(0);
    expect(r.total.cost).toBeCloseTo(1.0); // только qwen3: 1*0.5 + 1*0.5
    expect(r.unpricedModels).toContain("gpt://f/llama-70b/latest");
  });

  it("throws if run belongs to another tenant", async () => {
    mockRun.findUnique.mockResolvedValue({ id: "run1", study: { tenantId: "other" } });
    await expect(costService.computeRunCost("t1", "run1")).rejects.toBeInstanceOf(DomainError);
  });
});
