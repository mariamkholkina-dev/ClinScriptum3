import { prisma, getEffectiveLlmConfig, toConfigSnapshot, loadRulesForType, snapshotRules } from "@clinscriptum/db";
import { toGenerationPrompts } from "@clinscriptum/rules-engine";
import { LLMGateway } from "@clinscriptum/llm-gateway";
import type { LLMProvider } from "@clinscriptum/llm-gateway";
import { runPipeline } from "../pipeline/orchestrator.js";
import type { PipelineStepHandler, PipelineContext, StepResult } from "../pipeline/orchestrator.js";

/**
 * URS-055..059, URS-081
 * ICF generation: section-by-section from protocol data.
 * Limits usage of template text (URS-081).
 */

interface ICFSection {
  title: string;
  standardSection: string;
  content: string;
  status: "generated" | "pending" | "validated";
}

const ICF_SECTIONS = [
  { standardSection: "purpose_of_study", title: "Purpose of the Study" },
  { standardSection: "study_procedures", title: "Study Procedures" },
  { standardSection: "who_can_participate", title: "Who Can Participate" },
  { standardSection: "study_drug_description", title: "Study Drug Description" },
  { standardSection: "risks_side_effects", title: "Risks and Side Effects" },
  { standardSection: "benefits", title: "Possible Benefits" },
  { standardSection: "alternatives", title: "Alternatives to Participation" },
  { standardSection: "confidentiality", title: "Confidentiality" },
  { standardSection: "voluntary_participation", title: "Voluntary Participation" },
  { standardSection: "compensation", title: "Compensation" },
  { standardSection: "contact_information", title: "Contact Information" },
  { standardSection: "visits", title: "Visits and Procedures Schedule" },
];

const SECTION_TO_PROTOCOL_MAP: Record<string, string[]> = {
  purpose_of_study: ["study_objectives", "introduction"],
  study_procedures: ["study_design", "schedule_of_assessments", "efficacy_assessments"],
  who_can_participate: ["study_population"],
  study_drug_description: ["treatments"],
  risks_side_effects: ["safety_assessments"],
  benefits: ["study_objectives", "efficacy_assessments"],
  alternatives: ["treatments"],
  confidentiality: ["ethics"],
  voluntary_participation: ["ethics"],
  visits: ["schedule_of_assessments"],
};

export async function handleGenerateICF(data: {
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
          protocolSectionsCount: protocolSections.length,
          factsCount: facts.length,
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

      const genRules = await loadRulesForType(ctx.bundleId, "generation");
      const icfRules = genRules
        ? genRules.rules.filter((r) => !r.documentType || r.documentType === "icf")
        : [];
      const { systemPrompt: dbSystemPrompt, sectionPrompts } = toGenerationPrompts(icfRules);
      const fallbackPrompt = dbSystemPrompt ?? ICF_GENERATION_PROMPT;

      const generated: ICFSection[] = [];

      for (const icfSection of ICF_SECTIONS) {
        const sourceSections = SECTION_TO_PROTOCOL_MAP[icfSection.standardSection] ?? [];
        const sourceContent = sourceSections
          .map((s) => protocolByStandard[s])
          .filter(Boolean)
          .join("\n\n");

        if (!sourceContent) {
          generated.push({
            ...icfSection,
            content: `[No corresponding protocol content found for ${icfSection.title}]`,
            status: "pending",
          });
          continue;
        }

        const factsContext = facts.map((f) => `${f.key}: ${f.value}`).join("\n");

        const sectionPrompt = sectionPrompts.get(icfSection.standardSection) ?? fallbackPrompt;

        const response = await gateway.generate({
          system: sectionPrompt,
          messages: [
            {
              role: "user",
              content: `Generate the ICF section "${icfSection.title}" based on the following protocol content:\n\n` +
                `PROTOCOL CONTENT:\n${sourceContent}\n\n` +
                `KEY FACTS:\n${factsContext}\n\n` +
                `Generate clear, patient-friendly language for the informed consent form.`,
            },
          ],
          maxTokens: 2048,
        });

        generated.push({
          ...icfSection,
          content: response.content,
          status: "generated",
        });
      }

      return {
        data: {
          generatedSections: generated.length,
          sections: generated,
        },
        needsNextStep: true,
        llmConfigSnapshot: toConfigSnapshot(llmConfig) as unknown as Record<string, unknown>,
        ruleSnapshot: snapshotRules(genRules?.rules, {
          ruleSetVersionId: genRules?.ruleSetVersionId,
          ruleSetType: "generation",
        }),
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

const ICF_GENERATION_PROMPT = `You are a clinical documentation specialist generating Informed Consent Form (ICF) sections.

Rules:
1. Use patient-friendly language (6th-8th grade reading level)
2. Avoid medical jargon; explain technical terms
3. Use short sentences and paragraphs
4. Be factually accurate based ONLY on the provided protocol content
5. Do NOT copy template text verbatim (URS-081) - rephrase based on protocol facts
6. Include all relevant information for informed decision-making
7. Use "you" and "your" to address the participant directly`;
