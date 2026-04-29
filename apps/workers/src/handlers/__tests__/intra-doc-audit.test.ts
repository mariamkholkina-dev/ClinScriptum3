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

vi.mock("@clinscriptum/llm-gateway", () => ({
  LLMGateway: vi.fn(),
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
