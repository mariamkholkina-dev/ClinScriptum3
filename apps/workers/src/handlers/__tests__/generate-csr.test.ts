import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PipelineStepHandler, PipelineContext } from "../../pipeline/orchestrator.js";

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
    docVersionId: "csr-version-1",
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
  const { handleGenerateCSR } = await import("../generate-csr.js");
  await handleGenerateCSR({
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

describe("handleGenerateCSR", () => {
  it("registers deterministic + llm_check handlers", async () => {
    const handlers = await captureHandlers();
    expect(handlers.size).toBe(2);
    expect(handlers.has("deterministic")).toBe(true);
    expect(handlers.has("llm_check")).toBe(true);
  });

  describe("deterministic handler", () => {
    it("loads protocol sections grouped by standardSection and facts", async () => {
      const handlers = await captureHandlers();
      sectionFindMany.mockResolvedValueOnce([
        { standardSection: "synopsis", contentBlocks: [{ content: "Synopsis text", order: 1 }] },
        { standardSection: "ethics", contentBlocks: [{ content: "Ethics text", order: 1 }] },
        { standardSection: null, contentBlocks: [{ content: "ignored", order: 1 }] },
      ]);
      factFindMany.mockResolvedValueOnce([{ factKey: "phase", value: "III" }]);

      const result = await handlers.get("deterministic")!.execute(makeContext());

      expect(result.data.protocolByStandard).toEqual({
        synopsis: "Synopsis text",
        ethics: "Ethics text",
      });
      expect(result.data.facts).toEqual([{ key: "phase", value: "III" }]);
      expect(result.needsNextStep).toBe(true);
    });
  });

  describe("llm_check handler", () => {
    it("skips when LLM apiKey is missing", async () => {
      const handlers = await captureHandlers();
      getEffectiveLlmConfig.mockResolvedValueOnce({ apiKey: null, provider: "openai", model: "x" });

      const result = await handlers.get("llm_check")!.execute(
        makeContext({
          previousResults: new Map([
            ["deterministic", { data: { protocolByStandard: { synopsis: "x" }, facts: [] } } as any],
          ]),
        }),
      );

      expect(result.data.message).toBe("LLM API key not configured");
      expect(llmGenerate).not.toHaveBeenCalled();
    });

    it("URS-082: only generates first 10 priority sections (priority <= 10)", async () => {
      const handlers = await captureHandlers();
      getEffectiveLlmConfig.mockResolvedValueOnce({
        apiKey: "sk-x",
        provider: "openai",
        model: "gpt-4",
        temperature: 0.3,
        maxTokens: 4096,
      });
      // Provide source content for ALL standardSections (priority 1-15)
      const allStandardSections = [
        "title_page", "synopsis", "ethics", "investigators_and_sites",
        "introduction", "study_objectives", "study_design", "study_population",
        "treatments", "efficacy_evaluation",
        // priority > 10 — должны быть пропущены даже если source есть
        "safety_evaluation", "statistics", "efficacy_results", "safety_results", "discussion",
      ];
      const protocolByStandard: Record<string, string> = {};
      for (const s of allStandardSections) protocolByStandard[s] = `${s} content`;

      llmGenerate.mockResolvedValue({ content: "Generated", usage: {} });

      const result = await handlers.get("llm_check")!.execute(
        makeContext({
          previousResults: new Map([
            ["deterministic", { data: { protocolByStandard, facts: [] } } as any],
          ]),
        }),
      );

      // Только 10 секций должны быть сгенерированы
      expect(result.data.generatedSections).toBe(10);
      expect(llmGenerate).toHaveBeenCalledTimes(10);
      // Discussion (priority 15) не должен попасть в вывод
      const titles = (result.data.sections as Array<any>).map((s) => s.standardSection);
      expect(titles).not.toContain("discussion");
      expect(titles).not.toContain("safety_results");
    });

    it("URS-063: prompt instructs to convert future tense to past tense", async () => {
      const handlers = await captureHandlers();
      getEffectiveLlmConfig.mockResolvedValueOnce({
        apiKey: "sk-x",
        provider: "openai",
        model: "gpt-4",
        temperature: 0.3,
        maxTokens: 4096,
      });
      llmGenerate.mockResolvedValue({ content: "x", usage: {} });

      await handlers.get("llm_check")!.execute(
        makeContext({
          previousResults: new Map([
            ["deterministic", { data: { protocolByStandard: { synopsis: "src" }, facts: [] } } as any],
          ]),
        }),
      );

      const userMsg = llmGenerate.mock.calls[0][0].messages[0].content;
      expect(userMsg).toMatch(/future tense to past tense/i);
      expect(userMsg).toMatch(/Clinical Study Report/);
    });

    it("inserts placeholder for sections without source content", async () => {
      const handlers = await captureHandlers();
      getEffectiveLlmConfig.mockResolvedValueOnce({
        apiKey: "sk-x",
        provider: "openai",
        model: "gpt-4",
        temperature: 0.3,
        maxTokens: 4096,
      });
      llmGenerate.mockResolvedValue({ content: "x", usage: {} });

      const result = await handlers.get("llm_check")!.execute(
        makeContext({
          previousResults: new Map([
            ["deterministic", { data: { protocolByStandard: { synopsis: "x" }, facts: [] } } as any],
          ]),
        }),
      );

      // Только synopsis имеет source → 1 LLM-вызов, 9 placeholder
      expect(llmGenerate).toHaveBeenCalledTimes(1);
      const placeholders = (result.data.sections as Array<any>).filter((s) =>
        s.content.includes("No corresponding protocol content"),
      );
      expect(placeholders.length).toBe(9);
    });

    it("uses section-specific prompt when available, otherwise system fallback", async () => {
      const handlers = await captureHandlers();
      getEffectiveLlmConfig.mockResolvedValueOnce({
        apiKey: "sk-x",
        provider: "openai",
        model: "gpt-4",
        temperature: 0.3,
        maxTokens: 4096,
      });
      toGenerationPromptsMock.mockReturnValue({
        systemPrompt: "DB_FALLBACK_SYSTEM",
        sectionPrompts: new Map([["synopsis", "CUSTOM_SYNOPSIS_PROMPT"]]),
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
                  protocolByStandard: { synopsis: "syn-src", ethics: "eth-src" },
                  facts: [],
                },
              } as any,
            ],
          ]),
        }),
      );

      const synopsisCall = llmGenerate.mock.calls.find((c) =>
        c[0].messages[0].content.includes("Synopsis"),
      );
      const ethicsCall = llmGenerate.mock.calls.find((c) =>
        c[0].messages[0].content.includes("Ethics"),
      );
      expect(synopsisCall![0].system).toBe("CUSTOM_SYNOPSIS_PROMPT");
      expect(ethicsCall![0].system).toBe("DB_FALLBACK_SYSTEM");
    });

    it("propagates LLM errors", async () => {
      const handlers = await captureHandlers();
      getEffectiveLlmConfig.mockResolvedValueOnce({
        apiKey: "sk-x",
        provider: "openai",
        model: "gpt-4",
        temperature: 0.3,
        maxTokens: 4096,
      });
      llmGenerate.mockRejectedValueOnce(new Error("rate limit"));

      await expect(
        handlers.get("llm_check")!.execute(
          makeContext({
            previousResults: new Map([
              ["deterministic", { data: { protocolByStandard: { synopsis: "x" }, facts: [] } } as any],
            ]),
          }),
        ),
      ).rejects.toThrow("rate limit");
    });

    it("trims source to inputBudgetChars (10000 in this test)", async () => {
      const handlers = await captureHandlers();
      getEffectiveLlmConfig.mockResolvedValueOnce({
        apiKey: "sk-x",
        provider: "openai",
        model: "gpt-4",
        temperature: 0.3,
        maxTokens: 4096,
      });
      llmGenerate.mockResolvedValue({ content: "x", usage: {} });
      const longContent = "B".repeat(50000);

      await handlers.get("llm_check")!.execute(
        makeContext({
          previousResults: new Map([
            ["deterministic", { data: { protocolByStandard: { synopsis: longContent }, facts: [] } } as any],
          ]),
        }),
      );

      const call = llmGenerate.mock.calls[0];
      expect(call[0].messages[0].content).toContain("B".repeat(10000));
      expect(call[0].messages[0].content).not.toContain("B".repeat(10001));
    });

    it("filters generation rules by documentType='csr'", async () => {
      const handlers = await captureHandlers();
      getEffectiveLlmConfig.mockResolvedValueOnce({
        apiKey: "sk-x",
        provider: "openai",
        model: "gpt-4",
        temperature: 0.3,
        maxTokens: 4096,
      });
      loadRulesForType.mockResolvedValueOnce({
        rules: [
          { documentType: "icf", name: "icf-rule" },
          { documentType: "csr", name: "csr-rule" },
          { documentType: null, name: "common-rule" },
        ],
        ruleSetVersionId: "rsv-1",
      });
      llmGenerate.mockResolvedValue({ content: "x", usage: {} });

      await handlers.get("llm_check")!.execute(
        makeContext({
          previousResults: new Map([
            ["deterministic", { data: { protocolByStandard: { synopsis: "x" }, facts: [] } } as any],
          ]),
        }),
      );

      const passedRules = toGenerationPromptsMock.mock.calls[0][0];
      // Only csr + common rules pass through
      expect(passedRules).toHaveLength(2);
      expect(passedRules.map((r: any) => r.name)).toEqual(["csr-rule", "common-rule"]);
    });
  });
});
