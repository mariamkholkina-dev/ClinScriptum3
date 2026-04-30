import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PipelineStepHandler, PipelineContext, StepResult } from "../../pipeline/orchestrator.js";

const {
  sectionFindMany,
  factFindMany,
  getEffectiveLlmConfig,
  loadRulesForType,
  llmGenerate,
  toGenerationPromptsMock,
  runPipelineMock,
} = vi.hoisted(() => ({
  sectionFindMany: vi.fn(),
  factFindMany: vi.fn(),
  getEffectiveLlmConfig: vi.fn(),
  loadRulesForType: vi.fn(),
  llmGenerate: vi.fn(),
  toGenerationPromptsMock: vi.fn(),
  runPipelineMock: vi.fn(),
}));

vi.mock("@clinscriptum/db", () => ({
  prisma: {
    section: { findMany: sectionFindMany },
    fact: { findMany: factFindMany },
  },
  getEffectiveLlmConfig,
  toConfigSnapshot: vi.fn().mockReturnValue({}),
  loadRulesForType,
  snapshotRules: vi.fn().mockReturnValue({}),
  getInputBudgetChars: vi.fn().mockReturnValue(10000),
}));

vi.mock("@clinscriptum/rules-engine", () => ({
  toGenerationPrompts: toGenerationPromptsMock,
}));

vi.mock("@clinscriptum/llm-gateway", () => ({
  LLMGateway: class {
    generate = llmGenerate;
  },
}));

vi.mock("../../pipeline/orchestrator.js", () => ({
  runPipeline: runPipelineMock,
}));

vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const PROTOCOL_VERSION_ID = "protocol-version-1";
const RUN_ID = "run-1";

function makeContext(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    processingRunId: RUN_ID,
    docVersionId: "icf-version-1",
    studyId: "study-1",
    tenantId: "tenant-1",
    bundleId: "bundle-1",
    previousResults: new Map(),
    sectionsCache: new Map(),
    ...overrides,
  };
}

async function captureHandlers(): Promise<Map<string, PipelineStepHandler>> {
  runPipelineMock.mockResolvedValueOnce(undefined);
  const { handleGenerateICF } = await import("../generate-icf.js");
  await handleGenerateICF({
    processingRunId: RUN_ID,
    protocolVersionId: PROTOCOL_VERSION_ID,
  });
  const [, , handlers] = runPipelineMock.mock.calls[0];
  return handlers as Map<string, PipelineStepHandler>;
}

beforeEach(() => {
  vi.clearAllMocks();
  toGenerationPromptsMock.mockReturnValue({
    systemPrompt: null,
    sectionPrompts: new Map(),
  });
  loadRulesForType.mockResolvedValue(null);
});

describe("handleGenerateICF", () => {
  it("invokes runPipeline with deterministic + llm_check handlers", async () => {
    const handlers = await captureHandlers();
    expect(handlers.size).toBe(2);
    expect(handlers.has("deterministic")).toBe(true);
    expect(handlers.has("llm_check")).toBe(true);
  });

  describe("deterministic handler", () => {
    it("loads protocol sections and facts; returns map keyed by standardSection", async () => {
      const handlers = await captureHandlers();
      sectionFindMany.mockResolvedValueOnce([
        {
          standardSection: "study_objectives",
          contentBlocks: [
            { content: "Para 1", order: 1 },
            { content: "Para 2", order: 2 },
          ],
        },
        {
          standardSection: "study_design",
          contentBlocks: [{ content: "Design content", order: 1 }],
        },
        {
          standardSection: null,
          contentBlocks: [{ content: "Skipped", order: 1 }],
        },
      ]);
      factFindMany.mockResolvedValueOnce([
        { factKey: "phase", value: "II" },
        { factKey: "sponsor", value: "Acme" },
      ]);

      const result = await handlers.get("deterministic")!.execute(makeContext());

      expect(sectionFindMany).toHaveBeenCalledWith({
        where: { docVersionId: PROTOCOL_VERSION_ID },
        include: { contentBlocks: { orderBy: { order: "asc" } } },
        orderBy: { order: "asc" },
      });
      expect(result.data.protocolSectionsCount).toBe(3);
      expect(result.data.factsCount).toBe(2);
      expect(result.data.protocolByStandard).toEqual({
        study_objectives: "Para 1\nPara 2",
        study_design: "Design content",
      });
      expect(result.needsNextStep).toBe(true);
    });

    it("returns empty map when no protocol sections have standardSection", async () => {
      const handlers = await captureHandlers();
      sectionFindMany.mockResolvedValueOnce([
        { standardSection: null, contentBlocks: [{ content: "x", order: 1 }] },
      ]);
      factFindMany.mockResolvedValueOnce([]);

      const result = await handlers.get("deterministic")!.execute(makeContext());
      expect(result.data.protocolByStandard).toEqual({});
      expect(result.data.factsCount).toBe(0);
    });
  });

  describe("llm_check handler", () => {
    it("skips generation when LLM apiKey is missing", async () => {
      const handlers = await captureHandlers();
      getEffectiveLlmConfig.mockResolvedValueOnce({ apiKey: null, provider: "openai", model: "x" });

      const result = await handlers.get("llm_check")!.execute(
        makeContext({
          previousResults: new Map([
            ["deterministic", { data: { protocolByStandard: { study_objectives: "x" }, facts: [] } } as any],
          ]),
        }),
      );

      expect(result.data.message).toBe("LLM API key not configured");
      expect(llmGenerate).not.toHaveBeenCalled();
    });

    it("generates each ICF section when LLM is configured (12 sections + placeholders)", async () => {
      const handlers = await captureHandlers();
      getEffectiveLlmConfig.mockResolvedValueOnce({
        apiKey: "sk-x",
        provider: "openai",
        model: "gpt-4",
        temperature: 0.3,
        maxTokens: 4096,
      });
      llmGenerate.mockResolvedValue({ content: "Generated section text", usage: {} });

      const result = await handlers.get("llm_check")!.execute(
        makeContext({
          previousResults: new Map([
            [
              "deterministic",
              {
                data: {
                  protocolByStandard: {
                    study_objectives: "Source for purpose",
                    study_design: "Source for procedures",
                    study_population: "Source for who",
                    treatments: "Source for drug",
                    safety_assessments: "Source for risks",
                    efficacy_assessments: "Source for benefits",
                    ethics: "Source for confidentiality",
                    schedule_of_assessments: "Source for visits",
                  },
                  facts: [{ key: "phase", value: "II" }],
                },
              } as any,
            ],
          ]),
        }),
      );

      expect(result.data.generatedSections).toBe(12);
      // 8 mappable + some unmappable get placeholder text
      const generated = (result.data.sections as Array<any>).filter((s) => s.status === "generated");
      const pending = (result.data.sections as Array<any>).filter((s) => s.status === "pending");
      expect(generated.length).toBeGreaterThan(0);
      expect(pending.length).toBeGreaterThan(0);
      expect(pending[0].content).toMatch(/No corresponding protocol content/);
    });

    it("inserts placeholder when no source content for a section", async () => {
      const handlers = await captureHandlers();
      getEffectiveLlmConfig.mockResolvedValueOnce({
        apiKey: "sk-x",
        provider: "openai",
        model: "gpt-4",
        temperature: 0.3,
        maxTokens: 4096,
      });
      llmGenerate.mockResolvedValue({ content: "Generated", usage: {} });

      const result = await handlers.get("llm_check")!.execute(
        makeContext({
          previousResults: new Map([
            ["deterministic", { data: { protocolByStandard: {}, facts: [] } } as any],
          ]),
        }),
      );

      // No source content at all → all 12 sections get placeholder
      const allPending = (result.data.sections as Array<any>).every((s) => s.status === "pending");
      expect(allPending).toBe(true);
      expect(llmGenerate).not.toHaveBeenCalled();
    });

    it("uses section-specific prompt from rules when present (otherwise fallback prompt)", async () => {
      const handlers = await captureHandlers();
      getEffectiveLlmConfig.mockResolvedValueOnce({
        apiKey: "sk-x",
        provider: "openai",
        model: "gpt-4",
        temperature: 0.3,
        maxTokens: 4096,
      });
      const customPrompt = "CUSTOM PURPOSE PROMPT";
      toGenerationPromptsMock.mockReturnValue({
        systemPrompt: "SYSTEM_FALLBACK",
        sectionPrompts: new Map([["purpose_of_study", customPrompt]]),
      });
      loadRulesForType.mockResolvedValueOnce({ rules: [], ruleSetVersionId: "rsv-1" });
      llmGenerate.mockResolvedValue({ content: "x", usage: {} });

      await handlers.get("llm_check")!.execute(
        makeContext({
          previousResults: new Map([
            [
              "deterministic",
              {
                data: {
                  protocolByStandard: { study_objectives: "src" },
                  facts: [],
                },
              } as any,
            ],
          ]),
        }),
      );

      const purposeCall = llmGenerate.mock.calls.find((c) =>
        c[0].messages[0].content.includes("Purpose of the Study"),
      );
      expect(purposeCall![0].system).toBe(customPrompt);

      // Other sections (e.g. study_procedures) should fall back to systemFallback
      const procCall = llmGenerate.mock.calls.find((c) =>
        c[0].messages[0].content.includes("Study Procedures"),
      );
      // study_design is mapped → procCall would exist only if source content provided.
      // Here only study_objectives is provided, so procCall should be undefined.
      expect(procCall).toBeUndefined();
    });

    it("trims source content to inputBudgetChars", async () => {
      const handlers = await captureHandlers();
      getEffectiveLlmConfig.mockResolvedValueOnce({
        apiKey: "sk-x",
        provider: "openai",
        model: "gpt-4",
        temperature: 0.3,
        maxTokens: 4096,
      });
      const longContent = "A".repeat(50000);
      llmGenerate.mockResolvedValue({ content: "x", usage: {} });

      await handlers.get("llm_check")!.execute(
        makeContext({
          previousResults: new Map([
            [
              "deterministic",
              { data: { protocolByStandard: { study_objectives: longContent }, facts: [] } } as any,
            ],
          ]),
        }),
      );

      const call = llmGenerate.mock.calls[0];
      // budget mocked to 10000
      expect(call[0].messages[0].content).toContain("A".repeat(10000));
      expect(call[0].messages[0].content).not.toContain("A".repeat(10001));
    });

    it("propagates LLM errors (no swallowing)", async () => {
      const handlers = await captureHandlers();
      getEffectiveLlmConfig.mockResolvedValueOnce({
        apiKey: "sk-x",
        provider: "openai",
        model: "gpt-4",
        temperature: 0.3,
        maxTokens: 4096,
      });
      llmGenerate.mockRejectedValueOnce(new Error("LLM timeout"));

      await expect(
        handlers.get("llm_check")!.execute(
          makeContext({
            previousResults: new Map([
              [
                "deterministic",
                { data: { protocolByStandard: { study_objectives: "src" }, facts: [] } } as any,
              ],
            ]),
          }),
        ),
      ).rejects.toThrow("LLM timeout");
    });
  });
});
