import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PipelineStepHandler, PipelineContext } from "../../pipeline/orchestrator.js";

/* ═══════════════ Mocks ═══════════════ */

const findingCreate = vi.fn();
const findingFindMany = vi.fn();
const findingUpdate = vi.fn();
const processingRunFindUnique = vi.fn();
const documentVersionUpdate = vi.fn();

vi.mock("@clinscriptum/db", () => ({
  prisma: {
    finding: { create: findingCreate, findMany: findingFindMany, update: findingUpdate },
    processingRun: { findUnique: processingRunFindUnique },
    documentVersion: { update: documentVersionUpdate },
  },
  getEffectiveLlmConfig: vi.fn(),
  toConfigSnapshot: vi.fn().mockReturnValue({}),
  loadRulesForType: vi.fn().mockResolvedValue(null),
  snapshotRules: vi.fn().mockReturnValue({}),
  getInputBudgetChars: vi.fn().mockReturnValue(100000),
}));

vi.mock("@clinscriptum/rules-engine", () => ({
  toAuditPromptMap: vi.fn().mockReturnValue(new Map()),
}));

const mockLlmGenerate = vi.fn();
const MockLLMGateway = vi.fn(function (this: any) {
  this.generate = mockLlmGenerate;
} as any);
vi.mock("@clinscriptum/llm-gateway", () => ({
  LLMGateway: MockLLMGateway,
}));

const runPipelineMock = vi.fn();
vi.mock("../../pipeline/orchestrator.js", () => ({
  runPipeline: runPipelineMock,
}));

vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../lib/concurrency.js", () => ({
  runWithConcurrency: vi.fn(),
}));

const loadSectionsMock = vi.fn();
vi.mock("../../lib/section-cache.js", () => ({
  loadSections: loadSectionsMock,
  invalidateSectionsCache: vi.fn(),
}));

/* ═══════════════ Helpers ═══════════════ */

function makeContext(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    processingRunId: "run-1",
    docVersionId: "dv-1",
    studyId: "study-1",
    tenantId: "tenant-1",
    bundleId: null,
    previousResults: new Map(),
    sectionsCache: new Map(),
    ...overrides,
  };
}

function makeSection(title: string, content: string, standardSection: string | null = null) {
  return {
    id: `sec-${title}`,
    title,
    standardSection,
    confidence: 0.9,
    classifiedBy: "rules",
    algoSection: standardSection,
    algoConfidence: 0.9,
    llmSection: null,
    llmConfidence: null,
    level: 1,
    order: 1,
    contentBlocks: [{ id: `cb-${title}`, type: "paragraph", content, rawHtml: null, order: 1 }],
  };
}

/**
 * Calls handleIntraDocAudit, captures the handlers map passed to runPipeline,
 * and returns it so individual handlers can be tested.
 */
async function captureHandlers(): Promise<Map<string, PipelineStepHandler>> {
  runPipelineMock.mockResolvedValueOnce(undefined);

  const { handleIntraDocAudit } = await import("../intra-doc-audit.js");
  await handleIntraDocAudit({ processingRunId: "run-1" });

  const [, , handlers] = runPipelineMock.mock.calls[0];
  return handlers as Map<string, PipelineStepHandler>;
}

/* ═══════════════ Tests ═══════════════ */

describe("handleIntraDocAudit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls runPipeline with processingRunId and 3 handler levels", async () => {
    runPipelineMock.mockResolvedValueOnce(undefined);

    const { handleIntraDocAudit } = await import("../intra-doc-audit.js");
    await handleIntraDocAudit({ processingRunId: "run-1" });

    expect(runPipelineMock).toHaveBeenCalledTimes(1);

    const [processingRunId, config, handlers] = runPipelineMock.mock.calls[0];
    expect(processingRunId).toBe("run-1");
    expect(config.operatorReviewEnabled).toBe(false);
    expect(config.steps).toHaveLength(3);

    const handlerMap = handlers as Map<string, PipelineStepHandler>;
    expect(handlerMap.has("deterministic")).toBe(true);
    expect(handlerMap.has("llm_check")).toBe(true);
    expect(handlerMap.has("llm_qa")).toBe(true);
  });

  describe("deterministic handler", () => {
    it("creates editorial findings for double spaces in content", async () => {
      const handlers = await captureHandlers();
      const deterministicHandler = handlers.get("deterministic")!;

      loadSectionsMock.mockResolvedValueOnce([
        makeSection("Study Design", "This protocol has  double spaces in the text"),
      ]);

      const ctx = makeContext();
      const result = await deterministicHandler.execute(ctx);

      expect(findingCreate).toHaveBeenCalledTimes(1);
      expect(findingCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          docVersionId: "dv-1",
          type: "editorial",
          description: "Double or multiple spaces detected",
          suggestion: "Replace multiple spaces with a single space",
          status: "pending",
          sourceRef: expect.objectContaining({
            sectionTitle: "Study Design",
          }),
          extraAttributes: expect.objectContaining({
            severity: "low",
            method: "deterministic",
          }),
        }),
      });
      expect(result.data.deterministicFindings).toBe(1);
      expect(result.needsNextStep).toBe(true);
    });

    it("detects placeholder text [TBD]", async () => {
      const handlers = await captureHandlers();
      const deterministicHandler = handlers.get("deterministic")!;

      loadSectionsMock.mockResolvedValueOnce([
        makeSection("Study Objectives", "The primary objective is [TBD] pending review"),
      ]);

      const ctx = makeContext();
      const result = await deterministicHandler.execute(ctx);

      expect(findingCreate).toHaveBeenCalledTimes(1);
      expect(findingCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: "editorial",
          description: "Placeholder text found",
          suggestion: "Replace placeholder with actual content",
          extraAttributes: expect.objectContaining({
            severity: "high",
          }),
        }),
      });
      expect(result.data.deterministicFindings).toBe(1);
    });

    it("detects mixed tense (future + past)", async () => {
      const handlers = await captureHandlers();
      const deterministicHandler = handlers.get("deterministic")!;

      const mixedTenseText = [
        "The study will evaluate the drug. Patients will be randomized. Dosing will occur daily.",
        "The trial was conducted at multiple sites. Subjects were screened. Data has been collected.",
      ].join(" ");

      loadSectionsMock.mockResolvedValueOnce([
        makeSection("Study Design", mixedTenseText),
      ]);

      const ctx = makeContext();
      const result = await deterministicHandler.execute(ctx);

      expect(findingCreate).toHaveBeenCalledTimes(1);
      expect(findingCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: "semantic",
          description: "Mixed future and past tense detected in the same section",
          suggestion: "Ensure consistent tense usage within the section",
          extraAttributes: expect.objectContaining({
            severity: "medium",
          }),
        }),
      });
      expect(result.data.deterministicFindings).toBe(1);
    });

    it("creates no findings for clean text", async () => {
      const handlers = await captureHandlers();
      const deterministicHandler = handlers.get("deterministic")!;

      loadSectionsMock.mockResolvedValueOnce([
        makeSection("Synopsis", "This is a clean section with no issues."),
      ]);

      const ctx = makeContext();
      const result = await deterministicHandler.execute(ctx);

      expect(findingCreate).not.toHaveBeenCalled();
      expect(result.data.deterministicFindings).toBe(0);
      expect(result.needsNextStep).toBe(true);
    });
  });

  describe("llm_check handler — Variant 1 hybrid (3 focused calls)", () => {
    beforeEach(async () => {
      mockLlmGenerate.mockReset();

      const { getEffectiveLlmConfig } = await import("@clinscriptum/db");
      (getEffectiveLlmConfig as any).mockResolvedValue({
        provider: "yandexgpt",
        model: "test-model",
        apiKey: "test-key",
        baseUrl: "",
        temperature: 0.1,
        maxTokens: 4096,
        maxInputTokens: 200000,
        timeoutMs: 120000,
        reasoningMode: "DISABLED",
        sourceType: "env_global",
      });
    });

    it("makes 3 sequential LLM calls with distinct focused prompts", async () => {
      const handlers = await captureHandlers();
      const llmCheckHandler = handlers.get("llm_check")!;

      loadSectionsMock.mockResolvedValueOnce([
        makeSection("Synopsis", "Study evaluates drug X at 100mg", "synopsis"),
      ]);

      mockLlmGenerate
        .mockResolvedValueOnce({ content: "[]", usage: { totalTokens: 1000 } })
        .mockResolvedValueOnce({ content: "[]", usage: { totalTokens: 1500 } })
        .mockResolvedValueOnce({ content: "[]", usage: { totalTokens: 800 } });

      const ctx = makeContext();
      const result = await llmCheckHandler.execute(ctx);

      expect(mockLlmGenerate).toHaveBeenCalledTimes(3);

      const call1System = mockLlmGenerate.mock.calls[0][0].system as string;
      const call2System = mockLlmGenerate.mock.calls[1][0].system as string;
      const call3System = mockLlmGenerate.mock.calls[2][0].system as string;

      expect(call1System).toContain("SELF-CHECK");
      expect(call2System).toContain("CROSS-CHECK");
      expect(call3System).toContain("РЕДАКТОРСКУЮ");

      expect(call1System).not.toContain("CROSS-CHECK");
      expect(call2System).not.toContain("SELF-CHECK");

      expect(result.data.llmFindings).toBe(0);
      expect(result.data.tokensUsed).toBe(3300);
      expect(result.data.variant).toBe(1);
      expect(result.data.phases).toBe(3);
      expect(result.needsNextStep).toBe(true);
    });

    it("persists findings from all 3 phases with correct phase metadata", async () => {
      const handlers = await captureHandlers();
      const llmCheckHandler = handlers.get("llm_check")!;

      loadSectionsMock.mockResolvedValueOnce([
        makeSection("Synopsis", "Study text here", "synopsis"),
      ]);

      const selfCheckFinding = JSON.stringify([{
        mode: "self_check", issue_type: "contradiction_number", severity: "Major",
        description: "Число участников различается", target_quote: "100 vs 120",
        recommendation: "Уточнить", confidence: "High", context_status: "ok",
      }]);
      const crossCheckFinding = JSON.stringify([{
        mode: "cross_check", issue_type: "dose_mismatch", severity: "Critical",
        description: "Доза в синопсисе отличается", reference_quote: "100мг",
        target_quote: "200мг", recommendation: "Исправить", confidence: "High",
        context_status: "ok",
      }]);

      mockLlmGenerate
        .mockResolvedValueOnce({ content: selfCheckFinding, usage: { totalTokens: 2000 } })
        .mockResolvedValueOnce({ content: crossCheckFinding, usage: { totalTokens: 3000 } })
        .mockResolvedValueOnce({ content: "[]", usage: { totalTokens: 500 } });

      const ctx = makeContext();
      const result = await llmCheckHandler.execute(ctx);

      expect(result.data.llmFindings).toBe(2);
      expect(findingCreate).toHaveBeenCalledTimes(2);

      const firstCall = findingCreate.mock.calls[0][0].data;
      expect(firstCall.extraAttributes.phase).toBe("full_doc_self_check");
      expect(firstCall.sourceRef.phase).toBe("full_doc_self_check");

      const secondCall = findingCreate.mock.calls[1][0].data;
      expect(secondCall.extraAttributes.phase).toBe("full_doc_cross_check");
    });

    it("uses at least 8192 maxTokens even when llmConfig.maxTokens is lower", async () => {
      const handlers = await captureHandlers();
      const llmCheckHandler = handlers.get("llm_check")!;

      loadSectionsMock.mockResolvedValueOnce([
        makeSection("Synopsis", "Short text", "synopsis"),
      ]);

      mockLlmGenerate
        .mockResolvedValue({ content: "[]", usage: { totalTokens: 100 } });

      const ctx = makeContext();
      await llmCheckHandler.execute(ctx);

      for (const call of mockLlmGenerate.mock.calls) {
        expect(call[0].maxTokens).toBeGreaterThanOrEqual(8192);
      }
    });

    it("uses custom prompts from rule set when available", async () => {
      const { toAuditPromptMap } = await import("@clinscriptum/rules-engine");
      const { loadRulesForType } = await import("@clinscriptum/db");
      const customMap = new Map([
        ["full_doc_self_check_prompt", "CUSTOM SELF CHECK PROMPT"],
        ["full_doc_cross_check_prompt", "CUSTOM CROSS CHECK"],
        ["full_doc_editorial_prompt", "CUSTOM EDITORIAL"],
      ]);
      (toAuditPromptMap as any).mockReturnValue(customMap);
      (loadRulesForType as any).mockResolvedValueOnce({ rules: [], ruleSetVersionId: "rsv-1" });

      const handlers = await captureHandlers();
      const llmCheckHandler = handlers.get("llm_check")!;

      loadSectionsMock.mockResolvedValueOnce([
        makeSection("Synopsis", "Short text", "synopsis"),
      ]);

      mockLlmGenerate
        .mockResolvedValue({ content: "[]", usage: { totalTokens: 100 } });

      const ctx = makeContext();
      await llmCheckHandler.execute(ctx);

      expect(mockLlmGenerate.mock.calls[0][0].system).toBe("CUSTOM SELF CHECK PROMPT");
      expect(mockLlmGenerate.mock.calls[1][0].system).toBe("CUSTOM CROSS CHECK");
      expect(mockLlmGenerate.mock.calls[2][0].system).toBe("CUSTOM EDITORIAL");

      (toAuditPromptMap as any).mockReturnValue(new Map());
    });
  });

  describe("restoreStatusOnComplete", () => {
    it("restores document version status after pipeline completes", async () => {
      runPipelineMock.mockResolvedValueOnce(undefined);
      processingRunFindUnique.mockResolvedValueOnce({
        docVersionId: "dv-1",
        status: "completed",
      });
      documentVersionUpdate.mockResolvedValueOnce({});

      const { handleIntraDocAudit } = await import("../intra-doc-audit.js");
      await handleIntraDocAudit({
        processingRunId: "run-1",
        restoreStatusOnComplete: true,
      });

      expect(processingRunFindUnique).toHaveBeenCalledWith({
        where: { id: "run-1" },
        select: { docVersionId: true, status: true },
      });
      expect(documentVersionUpdate).toHaveBeenCalledWith({
        where: { id: "dv-1" },
        data: { status: "parsed" },
      });
    });

    it("restores status to parsed even when pipeline fails", async () => {
      runPipelineMock.mockRejectedValueOnce(new Error("Pipeline failed"));
      processingRunFindUnique.mockResolvedValueOnce({
        docVersionId: "dv-1",
        status: "failed",
      });
      documentVersionUpdate.mockResolvedValueOnce({});

      const { handleIntraDocAudit } = await import("../intra-doc-audit.js");

      await expect(
        handleIntraDocAudit({
          processingRunId: "run-1",
          restoreStatusOnComplete: true,
        }),
      ).rejects.toThrow("Pipeline failed");

      expect(processingRunFindUnique).toHaveBeenCalledWith({
        where: { id: "run-1" },
        select: { docVersionId: true, status: true },
      });
      expect(documentVersionUpdate).toHaveBeenCalledWith({
        where: { id: "dv-1" },
        data: { status: "parsed" },
      });
    });

    it("does not restore status when restoreStatusOnComplete is not set", async () => {
      runPipelineMock.mockResolvedValueOnce(undefined);

      const { handleIntraDocAudit } = await import("../intra-doc-audit.js");
      await handleIntraDocAudit({ processingRunId: "run-1" });

      expect(processingRunFindUnique).not.toHaveBeenCalled();
      expect(documentVersionUpdate).not.toHaveBeenCalled();
    });
  });
});
