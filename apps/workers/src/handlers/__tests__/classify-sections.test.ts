import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clinscriptum/db", () => ({
  prisma: {
    section: { update: vi.fn() },
    classificationFewShot: { findMany: vi.fn().mockResolvedValue([]) },
  },
  loadRulesForType: vi.fn(),
  snapshotRules: vi.fn().mockReturnValue({}),
  getEffectiveLlmConfig: vi.fn(),
  toConfigSnapshot: vi.fn().mockReturnValue({}),
  getInputBudgetChars: vi.fn().mockReturnValue(100000),
}));

vi.mock("@clinscriptum/rules-engine", () => {
  const classifyMock = vi.fn().mockReturnValue({
    sectionTitle: "Test Section",
    standardSection: "synopsis",
    confidence: 0.95,
    method: "keyword",
  });
  // Hierarchical classification (task 2.1): mock returns Map<id, ClassificationResult>
  // by calling classifyMock with parentZone=null for each section.
  const classifyHierarchicalMock = vi.fn((sections: Array<{ id: string; title: string; contentSnippet?: string }>) => {
    const out = new Map<string, ReturnType<typeof classifyMock>>();
    for (const s of sections) {
      out.set(s.id, classifyMock(s.title, s.contentSnippet, null));
    }
    return out;
  });
  return {
    RulesEngine: class MockRulesEngine {
      getSectionClassifier() {
        return {
          classify: classifyMock,
          classifyHierarchical: classifyHierarchicalMock,
        };
      }
    },
    toSectionMappingRules: vi.fn().mockReturnValue([]),
    __classifyMock: classifyMock,
    __classifyHierarchicalMock: classifyHierarchicalMock,
  };
});

vi.mock("@clinscriptum/llm-gateway", () => ({
  LLMGateway: vi.fn(),
}));

vi.mock("../../pipeline/orchestrator.js", () => ({
  runPipeline: vi.fn(),
}));

vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../lib/concurrency.js", () => ({
  runWithConcurrency: vi.fn().mockImplementation((tasks) => Promise.all(tasks.map((t: () => Promise<unknown>) => t()))),
}));

vi.mock("../../lib/section-cache.js", () => ({
  loadSections: vi.fn(),
  invalidateSectionsCache: vi.fn(),
}));

import { prisma, loadRulesForType, snapshotRules, getEffectiveLlmConfig } from "@clinscriptum/db";
import { runPipeline } from "../../pipeline/orchestrator.js";
import { loadSections, invalidateSectionsCache } from "../../lib/section-cache.js";
import { handleClassifySections } from "../classify-sections.js";
import type { PipelineContext, PipelineStepHandler, PipelineConfig } from "../../pipeline/orchestrator.js";

const { __classifyMock } = await import("@clinscriptum/rules-engine") as any;
const mockClassify = __classifyMock as ReturnType<typeof vi.fn>;

const mockRunPipeline = runPipeline as ReturnType<typeof vi.fn>;
const mockLoadSections = loadSections as ReturnType<typeof vi.fn>;
const mockLoadRulesForType = loadRulesForType as ReturnType<typeof vi.fn>;
const mockGetEffectiveLlmConfig = getEffectiveLlmConfig as ReturnType<typeof vi.fn>;
const mockSectionUpdate = prisma.section.update as ReturnType<typeof vi.fn>;

const RUN_ID = "run-classify-001";

const TEST_SECTIONS = [
  {
    id: "sec-1",
    title: "Synopsis",
    standardSection: null,
    confidence: null,
    classifiedBy: null,
    algoSection: null,
    algoConfidence: null,
    llmSection: null,
    llmConfidence: null,
    level: 0,
    order: 0,
    contentBlocks: [{ id: "cb-1", type: "text", content: "Study overview", rawHtml: null, order: 0 }],
  },
];

function makeMockContext(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    processingRunId: RUN_ID,
    docVersionId: "version-001",
    studyId: "study-001",
    tenantId: "tenant-001",
    bundleId: null,
    previousResults: new Map(),
    sectionsCache: new Map(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRunPipeline.mockResolvedValue(undefined);
  mockLoadSections.mockResolvedValue(TEST_SECTIONS);
  mockLoadRulesForType.mockResolvedValue(null);
  mockSectionUpdate.mockResolvedValue({});
});

describe("handleClassifySections", () => {
  it("calls runPipeline with processingRunId and 3 handler levels", async () => {
    await handleClassifySections({ processingRunId: RUN_ID });

    expect(mockRunPipeline).toHaveBeenCalledTimes(1);
    expect(mockRunPipeline).toHaveBeenCalledWith(
      RUN_ID,
      expect.any(Object),
      expect.any(Map),
    );

    const handlers: Map<string, PipelineStepHandler> = mockRunPipeline.mock.calls[0][2];
    expect(handlers.size).toBe(3);
    expect(handlers.has("deterministic")).toBe(true);
    expect(handlers.has("llm_check")).toBe(true);
    expect(handlers.has("llm_qa")).toBe(true);
  });

  it("passes operatorReviewEnabled to runPipeline config", async () => {
    await handleClassifySections({ processingRunId: RUN_ID, operatorReviewEnabled: true });

    const config: PipelineConfig = mockRunPipeline.mock.calls[0][1];
    expect(config.operatorReviewEnabled).toBe(true);
  });

  it("defaults operatorReviewEnabled to false when not provided", async () => {
    await handleClassifySections({ processingRunId: RUN_ID });

    const config: PipelineConfig = mockRunPipeline.mock.calls[0][1];
    expect(config.operatorReviewEnabled).toBe(false);
  });

  describe("deterministic handler", () => {
    async function getDeterministicHandler(): Promise<PipelineStepHandler> {
      await handleClassifySections({ processingRunId: RUN_ID });
      const handlers: Map<string, PipelineStepHandler> = mockRunPipeline.mock.calls[0][2];
      return handlers.get("deterministic")!;
    }

    it("classifies sections using RulesEngine and updates prisma", async () => {
      const handler = await getDeterministicHandler();
      const ctx = makeMockContext();

      const result = await handler.execute(ctx);

      expect(mockLoadSections).toHaveBeenCalledWith(ctx);
      expect(mockSectionUpdate).toHaveBeenCalledWith({
        where: { id: "sec-1" },
        data: {
          algoSection: "synopsis",
          algoConfidence: 0.95,
          standardSection: "synopsis",
          confidence: 0.95,
          classifiedBy: "deterministic",
        },
      });
      expect(result.needsNextStep).toBe(true);
    });

    it("tracks classified vs unclassified counts", async () => {
      const handler = await getDeterministicHandler();
      const ctx = makeMockContext();

      const result = await handler.execute(ctx);

      expect(result.data.classified).toBe(1);
      expect(result.data.unclassified).toBe(0);
    });

    it("does not update prisma for unclassified sections", async () => {
      mockClassify.mockReturnValueOnce({
        sectionTitle: "Unknown",
        standardSection: null,
        confidence: 0,
        method: "none",
      });

      const handler = await getDeterministicHandler();
      const ctx = makeMockContext();

      const result = await handler.execute(ctx);

      expect(mockSectionUpdate).not.toHaveBeenCalled();
      expect(result.data.classified).toBe(0);
      expect(result.data.unclassified).toBe(1);
    });

    it("invalidates sections cache after classification", async () => {
      const handler = await getDeterministicHandler();
      const ctx = makeMockContext();

      await handler.execute(ctx);

      expect(invalidateSectionsCache).toHaveBeenCalledWith(ctx);
    });
  });

  describe("llm_check handler", () => {
    async function getLlmCheckHandler(): Promise<PipelineStepHandler> {
      await handleClassifySections({ processingRunId: RUN_ID });
      const handlers: Map<string, PipelineStepHandler> = mockRunPipeline.mock.calls[0][2];
      return handlers.get("llm_check")!;
    }

    it("skips when no API key configured", async () => {
      mockGetEffectiveLlmConfig.mockResolvedValue({
        provider: "openai",
        model: "gpt-4o",
        apiKey: "",
        baseUrl: "",
        temperature: 0,
      });

      const handler = await getLlmCheckHandler();
      const ctx = makeMockContext();

      const result = await handler.execute(ctx);

      expect(result.data.message).toBe("LLM API key not configured, skipping");
      expect(result.needsNextStep).toBe(true);
    });
  });

  it("handler levels match their map keys", async () => {
    await handleClassifySections({ processingRunId: RUN_ID });

    const handlers: Map<string, PipelineStepHandler> = mockRunPipeline.mock.calls[0][2];

    for (const [key, handler] of handlers) {
      expect(handler.level).toBe(key);
    }
  });
});

describe("Sprint 3.2 — robust JSON parser", () => {
  // Импортируем приватные хелперы через __testing namespace.
  const importTesting = async () => {
    const mod = (await import("../classify-sections.js")) as { __testing: {
      extractBalanced: (s: string, open: string, close: string) => string | null;
      parseLlmJsonArray: (s: string) => unknown[] | null;
      parseLlmJsonObject: (s: string) => Record<string, unknown> | null;
    } };
    return mod.__testing;
  };

  it("parseLlmJsonArray handles think-tags + JSON array", async () => {
    const { parseLlmJsonArray } = await importTesting();
    const raw = '<think>reasoning</think>\n[{"idx":1,"zone":"synopsis"}]';
    const result = parseLlmJsonArray(raw);
    expect(result).toEqual([{ idx: 1, zone: "synopsis" }]);
  });

  it("parseLlmJsonArray ignores brackets inside reasoning text", async () => {
    const { parseLlmJsonArray } = await importTesting();
    // Старый greedy regex matched бы от первого [ до последнего ] (через
    // примеры в тексте) → JSON.parse failed. Balanced parser берёт первый
    // valid range.
    const raw = 'Пример: [1,2,3]. Результат:\n[{"idx":1,"zone":"synopsis"}]';
    const result = parseLlmJsonArray(raw);
    expect(result).toEqual([1, 2, 3]); // первый balanced — это [1,2,3]
  });

  it("parseLlmJsonArray handles markdown code block", async () => {
    const { parseLlmJsonArray } = await importTesting();
    const raw = '```json\n[{"idx":1,"zone":"synopsis"}]\n```';
    const result = parseLlmJsonArray(raw);
    expect(result).toEqual([{ idx: 1, zone: "synopsis" }]);
  });

  it("parseLlmJsonArray returns null for garbage", async () => {
    const { parseLlmJsonArray } = await importTesting();
    const raw = "это просто текст без JSON";
    expect(parseLlmJsonArray(raw)).toBeNull();
  });

  it("parseLlmJsonObject parses bare object with extra text", async () => {
    const { parseLlmJsonObject } = await importTesting();
    const raw = 'Ответ: {"zone":"synopsis","confidence":0.95}';
    expect(parseLlmJsonObject(raw)).toEqual({ zone: "synopsis", confidence: 0.95 });
  });

  it("extractBalanced ignores brackets inside strings", async () => {
    const { extractBalanced } = await importTesting();
    const s = '{"a":"value with } inside","b":1}';
    expect(extractBalanced(s, "{", "}")).toBe(s);
  });

  it("extractBalanced returns null when no opening bracket", async () => {
    const { extractBalanced } = await importTesting();
    expect(extractBalanced("no brackets here", "[", "]")).toBeNull();
  });

  it("parseLlmJsonArray refuses suspicious refusal phrases", async () => {
    const { parseLlmJsonArray } = await importTesting();
    expect(parseLlmJsonArray("не могу помочь с этим [1,2,3]")).toBeNull();
  });
});
