import { prisma, loadRulesForType, snapshotRules } from "@clinscriptum/db";
import { RulesEngine, toSectionMappingRules } from "@clinscriptum/rules-engine";
import { runPipeline } from "../pipeline/orchestrator.js";
import type { PipelineStepHandler, PipelineContext, StepResult } from "../pipeline/orchestrator.js";

export async function handleClassifySections(data: {
  processingRunId: string;
  operatorReviewEnabled?: boolean;
}) {
  const deterministicHandler: PipelineStepHandler = {
    level: "deterministic",
    async execute(ctx: PipelineContext): Promise<StepResult> {
      const sections = await prisma.section.findMany({
        where: { docVersionId: ctx.docVersionId },
        include: { contentBlocks: { take: 1, orderBy: { order: "asc" } } },
        orderBy: { order: "asc" },
      });

      const resolved = await loadRulesForType(ctx.bundleId, "section_classification");
      const engine = resolved
        ? new RulesEngine({ sectionMappings: toSectionMappingRules(resolved.rules) })
        : new RulesEngine();
      const classifier = engine.getSectionClassifier();

      const results = sections.map((section) => {
        const contentSnippet = section.contentBlocks[0]?.content ?? "";
        return {
          sectionId: section.id,
          ...classifier.classify(section.title, contentSnippet),
        };
      });

      for (const result of results) {
        if (result.standardSection) {
          await prisma.section.update({
            where: { id: result.sectionId },
            data: { standardSection: result.standardSection },
          });
        }
      }

      return {
        data: {
          classified: results.filter((r) => r.standardSection).length,
          unclassified: results.filter((r) => !r.standardSection).length,
          results,
        },
        needsNextStep: results.some((r) => !r.standardSection || r.confidence < 0.8),
        ruleSnapshot: snapshotRules(resolved?.rules, {
          ruleSetVersionId: resolved?.ruleSetVersionId,
          ruleSetType: "section_classification",
        }),
      };
    },
  };

  const llmCheckHandler: PipelineStepHandler = {
    level: "llm_check",
    async execute(ctx: PipelineContext): Promise<StepResult> {
      // LLM verification of classifications will be implemented
      // when LLM Gateway is fully wired in workers
      const prev = ctx.previousResults.get("deterministic");
      return {
        data: { message: "LLM check placeholder", previousResults: prev?.data },
        needsNextStep: true,
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
