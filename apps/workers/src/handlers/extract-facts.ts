import { prisma } from "@clinscriptum/db";
import { RulesEngine, detectContradictions } from "@clinscriptum/rules-engine";
import { runPipeline } from "../pipeline/orchestrator.js";
import type { PipelineStepHandler, PipelineContext, StepResult } from "../pipeline/orchestrator.js";

export async function handleExtractFacts(data: {
  processingRunId: string;
  operatorReviewEnabled?: boolean;
}) {
  const deterministicHandler: PipelineStepHandler = {
    level: "deterministic",
    async execute(ctx: PipelineContext): Promise<StepResult> {
      const sections = await prisma.section.findMany({
        where: { docVersionId: ctx.docVersionId },
        include: { contentBlocks: { orderBy: { order: "asc" } } },
        orderBy: { order: "asc" },
      });

      const engine = new RulesEngine();
      const extractor = engine.getFactExtractor();

      const sectionData = sections.map((s) => ({
        title: s.title,
        content: s.contentBlocks.map((b) => b.content).join("\n"),
        isSynopsis: s.standardSection === "synopsis",
      }));

      const extracted = extractor.extractFromSections(sectionData);
      const contradictions = detectContradictions(extracted);

      for (const fact of extracted) {
        const hasContradiction = contradictions.some((c) => c.factKey === fact.factKey);

        await prisma.fact.create({
          data: {
            docVersionId: ctx.docVersionId,
            factKey: fact.factKey,
            factCategory: "general",
            value: fact.value,
            factClass: fact.factClass,
            sources: [fact.source] as any,
            hasContradiction,
            status: "extracted",
          },
        });
      }

      return {
        data: {
          totalExtracted: extracted.length,
          contradictions: contradictions.length,
          factKeys: [...new Set(extracted.map((f) => f.factKey))],
        },
        needsNextStep: extracted.length > 0,
      };
    },
  };

  const llmCheckHandler: PipelineStepHandler = {
    level: "llm_check",
    async execute(ctx: PipelineContext): Promise<StepResult> {
      // URS-074: LLM fallback for facts not found by deterministic methods
      return {
        data: { message: "LLM fact verification placeholder" },
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
