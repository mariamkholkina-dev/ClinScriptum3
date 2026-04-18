import { prisma, getEffectiveLlmConfig, toConfigSnapshot } from "@clinscriptum/db";
import { LLMGateway } from "@clinscriptum/llm-gateway";
import type { LLMProvider } from "@clinscriptum/llm-gateway";
import { runPipeline } from "../pipeline/orchestrator.js";
import type { PipelineStepHandler, PipelineContext, StepResult } from "../pipeline/orchestrator.js";

/**
 * URS-060..067, URS-082
 * CSR generation from protocol data.
 * Priority: first 10 sections (URS-082).
 * Tense adaptation: future -> past (URS-063).
 */

const CSR_SECTIONS = [
  { standardSection: "title_page", title: "Title Page", priority: 1 },
  { standardSection: "synopsis", title: "Synopsis", priority: 2 },
  { standardSection: "ethics", title: "Ethics", priority: 3 },
  { standardSection: "investigators_and_sites", title: "Investigators and Study Sites", priority: 4 },
  { standardSection: "introduction", title: "Introduction", priority: 5 },
  { standardSection: "study_objectives", title: "Study Objectives", priority: 6 },
  { standardSection: "study_design", title: "Investigational Plan", priority: 7 },
  { standardSection: "study_population", title: "Study Patients", priority: 8 },
  { standardSection: "treatments", title: "Study Drug and Treatments", priority: 9 },
  { standardSection: "efficacy_evaluation", title: "Efficacy Evaluation", priority: 10 },
  { standardSection: "safety_evaluation", title: "Safety Evaluation", priority: 11 },
  { standardSection: "statistics", title: "Statistical Methods", priority: 12 },
  { standardSection: "efficacy_results", title: "Efficacy Results", priority: 13 },
  { standardSection: "safety_results", title: "Safety Results", priority: 14 },
  { standardSection: "discussion", title: "Discussion and Conclusions", priority: 15 },
];

export async function handleGenerateCSR(data: {
  processingRunId: string;
  protocolVersionId: string;
  templateVersionId?: string;
  operatorReviewEnabled?: boolean;
}) {
  const deterministicHandler: PipelineStepHandler = {
    level: "deterministic",
    async execute(ctx: PipelineContext): Promise<StepResult> {
      const protocolSections = await prisma.section.findMany({
        where: { docVersionId: data.protocolVersionId },
        include: { contentBlocks: { orderBy: { order: "asc" } } },
        orderBy: { order: "asc" },
      });

      const protocolByStandard = new Map<string, string>();
      for (const s of protocolSections) {
        if (s.standardSection) {
          const content = s.contentBlocks.map((b) => b.content).join("\n");
          protocolByStandard.set(s.standardSection, content);
        }
      }

      const facts = await prisma.fact.findMany({
        where: { docVersionId: data.protocolVersionId },
      });

      return {
        data: {
          protocolByStandard: Object.fromEntries(protocolByStandard),
          facts: facts.map((f) => ({ key: f.factKey, value: f.value })),
        },
        needsNextStep: true,
      };
    },
  };

  const llmCheckHandler: PipelineStepHandler = {
    level: "llm_check",
    async execute(ctx: PipelineContext): Promise<StepResult> {
      const llmConfig = await getEffectiveLlmConfig("generation", ctx.tenantId);
      if (!llmConfig.apiKey) {
        return {
          data: { message: "LLM API key not configured" },
          needsNextStep: true,
        };
      }

      const prev = ctx.previousResults.get("deterministic");
      const protocolByStandard = (prev?.data?.protocolByStandard ?? {}) as Record<string, string>;
      const facts = (prev?.data?.facts ?? []) as Array<{ key: string; value: string }>;

      const gateway = new LLMGateway({
        provider: llmConfig.provider as LLMProvider,
        model: llmConfig.model,
        apiKey: llmConfig.apiKey,
        baseUrl: llmConfig.baseUrl || undefined,
        temperature: llmConfig.temperature,
      });

      const generated: Array<{ title: string; standardSection: string; content: string; priority: number }> = [];

      // URS-082: Priority first 10 sections
      const prioritySections = CSR_SECTIONS.filter((s) => s.priority <= 10);

      for (const csrSection of prioritySections) {
        const sourceContent = protocolByStandard[csrSection.standardSection] ?? "";

        if (!sourceContent) {
          generated.push({
            ...csrSection,
            content: `[No corresponding protocol content for ${csrSection.title}]`,
          });
          continue;
        }

        const factsContext = facts.map((f) => `${f.key}: ${f.value}`).join("\n");

        const response = await gateway.generate({
          system: CSR_GENERATION_PROMPT,
          messages: [
            {
              role: "user",
              content: `Generate the CSR section "${csrSection.title}" based on:\n\n` +
                `PROTOCOL CONTENT:\n${sourceContent}\n\n` +
                `KEY FACTS:\n${factsContext}\n\n` +
                `Convert future tense to past tense. This is a Clinical Study Report, ` +
                `so describe what WAS done, not what WILL be done.`,
            },
          ],
          maxTokens: 2048,
        });

        generated.push({ ...csrSection, content: response.content });
      }

      return {
        data: { generatedSections: generated.length, sections: generated },
        needsNextStep: true,
        llmConfigSnapshot: toConfigSnapshot(llmConfig) as unknown as Record<string, unknown>,
      };
    },
  };

  const handlers = new Map([
    ["deterministic" as const, deterministicHandler],
    ["llm_check" as const, llmCheckHandler],
  ]);

  await runPipeline(data.processingRunId, {
    operatorReviewEnabled: data.operatorReviewEnabled ?? false,
    steps: Array.from(handlers.values()),
  }, handlers);
}

const CSR_GENERATION_PROMPT = `You are a clinical documentation specialist generating Clinical Study Report (CSR) sections per ICH E3 guidelines.

Rules:
1. Convert ALL future tense to past tense (URS-063): "will be" → "was", "shall" → "[remove]", "will enroll" → "enrolled"
2. Use formal scientific/medical writing style
3. Be factually accurate based ONLY on the provided protocol content
4. Follow ICH E3 structure and conventions
5. Include relevant statistical methodology descriptions
6. Reference tables and figures where appropriate (e.g., "See Table X")
7. Maintain objectivity and precision`;
