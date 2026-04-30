import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clinscriptum/shared/fact-extraction", () => ({
  runDeterministic: vi.fn(),
  runLlmCheck: vi.fn(),
  runLlmQa: vi.fn(),
}));

vi.mock("../../pipeline/orchestrator.js", () => ({
  runPipeline: vi.fn(),
}));

vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { runDeterministic, runLlmCheck, runLlmQa } from "@clinscriptum/shared/fact-extraction";
import { runPipeline } from "../../pipeline/orchestrator.js";
import { logger } from "../../lib/logger.js";
import { handleExtractFacts } from "../extract-facts.js";
import type { PipelineContext, PipelineStepHandler, PipelineConfig } from "../../pipeline/orchestrator.js";

const mockRunPipeline = runPipeline as ReturnType<typeof vi.fn>;
const mockRunDeterministic = runDeterministic as ReturnType<typeof vi.fn>;
const mockRunLlmCheck = runLlmCheck as ReturnType<typeof vi.fn>;
const mockRunLlmQa = runLlmQa as ReturnType<typeof vi.fn>;

const RUN_ID = "run-extract-001";

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
});

describe("handleExtractFacts", () => {
  it("calls runPipeline with the processingRunId", async () => {
    await handleExtractFacts({ processingRunId: RUN_ID });

    expect(mockRunPipeline).toHaveBeenCalledTimes(1);
    expect(mockRunPipeline).toHaveBeenCalledWith(
      RUN_ID,
      expect.any(Object),
      expect.any(Map),
    );
  });

  it("passes operatorReviewEnabled=false by default", async () => {
    await handleExtractFacts({ processingRunId: RUN_ID });

    const config: PipelineConfig = mockRunPipeline.mock.calls[0][1];
    expect(config.operatorReviewEnabled).toBe(false);
  });

  it("passes operatorReviewEnabled=true when provided", async () => {
    await handleExtractFacts({ processingRunId: RUN_ID, operatorReviewEnabled: true });

    const config: PipelineConfig = mockRunPipeline.mock.calls[0][1];
    expect(config.operatorReviewEnabled).toBe(true);
  });

  it("creates handlers map with 3 levels: deterministic, llm_check, llm_qa", async () => {
    await handleExtractFacts({ processingRunId: RUN_ID });

    const handlers: Map<string, PipelineStepHandler> = mockRunPipeline.mock.calls[0][2];

    expect(handlers.size).toBe(3);
    expect(handlers.has("deterministic")).toBe(true);
    expect(handlers.has("llm_check")).toBe(true);
    expect(handlers.has("llm_qa")).toBe(true);
  });

  it("deterministic handler delegates to runDeterministic and adds needsNextStep: true", async () => {
    const deterministicResult = { data: { facts: ["fact1"] } };
    mockRunDeterministic.mockResolvedValue(deterministicResult);

    await handleExtractFacts({ processingRunId: RUN_ID });

    const handlers: Map<string, PipelineStepHandler> = mockRunPipeline.mock.calls[0][2];
    const deterministicHandler = handlers.get("deterministic")!;

    const ctx = makeMockContext();
    const result = await deterministicHandler.execute(ctx);

    expect(mockRunDeterministic).toHaveBeenCalledWith(ctx);
    expect(result).toEqual({ ...deterministicResult, needsNextStep: true });
  });

  it("llm_check handler delegates to runLlmCheck with logger", async () => {
    const llmCheckResult = { data: { verified: true } };
    mockRunLlmCheck.mockResolvedValue(llmCheckResult);

    await handleExtractFacts({ processingRunId: RUN_ID });

    const handlers: Map<string, PipelineStepHandler> = mockRunPipeline.mock.calls[0][2];
    const llmCheckHandler = handlers.get("llm_check")!;

    const ctx = makeMockContext();
    const result = await llmCheckHandler.execute(ctx);

    expect(mockRunLlmCheck).toHaveBeenCalledWith(ctx, logger);
    expect(result).toEqual({ ...llmCheckResult, needsNextStep: true });
  });

  it("llm_qa handler delegates to runLlmQa with logger", async () => {
    const llmQaResult = { data: { resolved: true } };
    mockRunLlmQa.mockResolvedValue(llmQaResult);

    await handleExtractFacts({ processingRunId: RUN_ID });

    const handlers: Map<string, PipelineStepHandler> = mockRunPipeline.mock.calls[0][2];
    const llmQaHandler = handlers.get("llm_qa")!;

    const ctx = makeMockContext();
    const result = await llmQaHandler.execute(ctx);

    expect(mockRunLlmQa).toHaveBeenCalledWith(ctx, logger);
    expect(result).toEqual({ ...llmQaResult, needsNextStep: true });
  });

  it("handler levels match their map keys", async () => {
    await handleExtractFacts({ processingRunId: RUN_ID });

    const handlers: Map<string, PipelineStepHandler> = mockRunPipeline.mock.calls[0][2];

    for (const [key, handler] of handlers) {
      expect(handler.level).toBe(key);
    }
  });
});
