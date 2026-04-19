import { prisma, loadRulesForType, snapshotRules, getEffectiveLlmConfig, toConfigSnapshot, getInputBudgetChars } from "@clinscriptum/db";
import { RulesEngine, detectContradictions, toFactExtractionRules } from "@clinscriptum/rules-engine";
import { LLMGateway } from "@clinscriptum/llm-gateway";
import type { LLMProvider } from "@clinscriptum/llm-gateway";
import { runPipeline } from "../pipeline/orchestrator.js";
import type { PipelineStepHandler, PipelineContext, StepResult } from "../pipeline/orchestrator.js";
import { logger } from "../lib/logger.js";

const EXCLUDED_SECTION_PREFIXES = ["overview", "admin", "appendix"];
const LOW_CONFIDENCE_THRESHOLD = 0.6;

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

      const resolved = await loadRulesForType(ctx.bundleId, "fact_extraction");
      const engine = resolved
        ? new RulesEngine({ factExtractions: toFactExtractionRules(resolved.rules) })
        : new RulesEngine();
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
            confidence: 1.0,
            factClass: fact.factClass,
            sources: [fact.source] as any,
            hasContradiction,
            status: "extracted",
            deterministicValue: fact.value,
            deterministicConfidence: 1.0,
          },
        });
      }

      return {
        data: {
          totalExtracted: extracted.length,
          contradictions: contradictions.length,
          factKeys: [...new Set(extracted.map((f) => f.factKey))],
        },
        needsNextStep: true,
        ruleSnapshot: snapshotRules(resolved?.rules, {
          ruleSetVersionId: resolved?.ruleSetVersionId,
          ruleSetType: "fact_extraction",
        }),
      };
    },
  };

  const llmCheckHandler: PipelineStepHandler = {
    level: "llm_check",
    async execute(ctx: PipelineContext): Promise<StepResult> {
      const llmConfig = await getEffectiveLlmConfig("fact_extraction", ctx.tenantId);
      if (!llmConfig.apiKey) {
        logger.info("[facts:llm_check] LLM API key not configured, skipping");
        return { data: { message: "LLM API key not configured" }, needsNextStep: true };
      }

      const facts = await prisma.fact.findMany({
        where: { docVersionId: ctx.docVersionId },
      });
      const isDiscoveryMode = facts.length === 0;

      const sections = await prisma.section.findMany({
        where: { docVersionId: ctx.docVersionId },
        include: { contentBlocks: { orderBy: { order: "asc" } } },
        orderBy: { order: "asc" },
      });

      const relevantSections = sections.filter((s) => {
        if (!s.standardSection) return true;
        return !EXCLUDED_SECTION_PREFIXES.some((p) => s.standardSection!.startsWith(p));
      });

      const inputBudget = getInputBudgetChars(llmConfig);

      const docText = relevantSections
        .map((s) => {
          const isSynopsis = s.standardSection?.startsWith("synopsis") ?? false;
          const marker = isSynopsis ? "[SYNOPSIS]" : `[SECTION: ${s.title}]`;
          const text = s.contentBlocks.map((b) => b.content).join("\n");
          return `\n${marker}\n${text}\n`;
        })
        .join("")
        .slice(0, inputBudget);

      let systemPrompt: string;
      let userPrompt: string;

      if (isDiscoveryMode) {
        const resolved = await loadRulesForType(ctx.bundleId, "fact_extraction");
        const registryRules = resolved?.rules ?? [];
        const registryList = registryRules
          .filter((r) => r.pattern !== "system_prompt")
          .map((r) => {
            const cfg = (r.config ?? {}) as Record<string, unknown>;
            const desc = (cfg.description as string) ?? r.name;
            const valueType = (cfg.valueType as string) ?? "string";
            const labels = Array.isArray(cfg.labelsRu) ? (cfg.labelsRu as string[]).join(", ") : "";
            const category = (cfg.category as string) ?? "general";
            return `- ${category}.${r.pattern}: ${desc} (тип: ${valueType}${labels ? `, метки: ${labels}` : ""})`;
          })
          .join("\n");

        systemPrompt = `Ты — эксперт по клиническим протоколам. Извлеки факты из документа.

Тебе дан реестр известных фактов — найди их значения в тексте документа.
Также найди другие важные факты, которых нет в реестре.

Для каждого факта:
1. Укажи ключ факта (category.key из реестра, или новый).
2. Укажи извлечённое значение.
3. Укажи уверенность (0.0–1.0).
4. Укажи фрагмент текста-источника (до 200 символов).

Верни СТРОГО JSON (без markdown):
{
  "verified": [],
  "new_facts": [
    {
      "fact_key": "category.key",
      "value": "значение",
      "confidence": 0.85,
      "source_text": "фрагмент из документа"
    }
  ]
}`;

        userPrompt = `РЕЕСТР ФАКТОВ:\n${registryList}\n\nДОКУМЕНТ:\n${docText}`;
      } else {
        const factList = facts
          .map((f) => `- ${f.factCategory}.${f.factKey}: "${f.value}" (confidence: ${f.confidence})`)
          .join("\n");

        systemPrompt = `Ты — эксперт по клиническим протоколам. Проверь извлечённые факты.

Для каждого факта:
1. Подтверди или исправь значение на основе текста документа.
2. Укажи уверенность (0.0–1.0).
3. Укажи фрагмент текста-источника (до 200 символов).
4. Найди факты, которые могли быть пропущены детерминистическим извлечением.

Верни СТРОГО JSON (без markdown):
{
  "verified": [
    {
      "fact_key": "category.key",
      "value": "подтверждённое или исправленное значение",
      "confidence": 0.95,
      "source_text": "фрагмент из документа",
      "changed": false
    }
  ],
  "new_facts": [
    {
      "fact_key": "category.key",
      "value": "значение",
      "confidence": 0.85,
      "source_text": "фрагмент"
    }
  ]
}`;

        userPrompt = `ИЗВЛЕЧЁННЫЕ ФАКТЫ:\n${factList}\n\nДОКУМЕНТ:\n${docText}`;
      }

      const gateway = new LLMGateway({
        provider: llmConfig.provider as LLMProvider,
        model: llmConfig.model,
        apiKey: llmConfig.apiKey,
        baseUrl: llmConfig.baseUrl || undefined,
        temperature: llmConfig.temperature,
      });

      const response = await gateway.generate({
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
        maxTokens: llmConfig.maxTokens,
      });

      let verifiedCount = 0;
      let changedCount = 0;
      let newCount = 0;

      try {
        const jsonMatch = response.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const data = JSON.parse(jsonMatch[0]);

          if (Array.isArray(data.verified)) {
            for (const v of data.verified) {
              const fullKey = v.fact_key as string;
              const dotIdx = fullKey.indexOf(".");
              const factKey = dotIdx > -1 ? fullKey.slice(dotIdx + 1) : fullKey;
              const category = dotIdx > -1 ? fullKey.slice(0, dotIdx) : "";

              const fact = facts.find(
                (f) => f.factKey === factKey && (!category || f.factCategory === category),
              );
              if (!fact) continue;

              const llmVal = String(v.value ?? fact.value);
              const llmConf = typeof v.confidence === "number"
                ? Math.min(Math.max(v.confidence, 0), 1)
                : fact.confidence;

              await prisma.fact.update({
                where: { id: fact.id },
                data: {
                  llmValue: llmVal,
                  llmConfidence: llmConf,
                  ...(v.changed
                    ? { value: llmVal, confidence: llmConf }
                    : { confidence: Math.max(fact.confidence, llmConf) }),
                },
              });

              verifiedCount++;
              if (v.changed) changedCount++;
            }
          }

          if (Array.isArray(data.new_facts)) {
            for (const nf of data.new_facts) {
              const fullKey = nf.fact_key as string;
              const dotIdx = fullKey.indexOf(".");
              const factKey = dotIdx > -1 ? fullKey.slice(dotIdx + 1) : fullKey;
              const category = dotIdx > -1 ? fullKey.slice(0, dotIdx) : "general";

              const exists = facts.some((f) => f.factKey === factKey);
              if (exists) continue;

              const llmVal = String(nf.value);
              const llmConf = typeof nf.confidence === "number"
                ? Math.min(Math.max(nf.confidence, 0), 1)
                : 0.5;

              await prisma.fact.create({
                data: {
                  docVersionId: ctx.docVersionId,
                  factKey,
                  factCategory: category,
                  value: llmVal,
                  confidence: llmConf,
                  factClass: "general",
                  sources: nf.source_text
                    ? [{ sectionTitle: "", text: String(nf.source_text).slice(0, 500), isSynopsis: false }]
                    : [],
                  hasContradiction: false,
                  status: "extracted",
                  llmValue: llmVal,
                  llmConfidence: llmConf,
                },
              });
              newCount++;
            }
          }
        }
      } catch (err) {
        logger.warn("[facts:llm_check] Failed to parse LLM response", { error: String(err) });
      }

      return {
        data: {
          verified: verifiedCount,
          changed: changedCount,
          newFacts: newCount,
          tokensUsed: response.usage.totalTokens,
        },
        needsNextStep: true,
        llmConfigSnapshot: toConfigSnapshot(llmConfig) as unknown as Record<string, unknown>,
      };
    },
  };

  const llmQaHandler: PipelineStepHandler = {
    level: "llm_qa",
    async execute(ctx: PipelineContext): Promise<StepResult> {
      const facts = await prisma.fact.findMany({
        where: { docVersionId: ctx.docVersionId },
      });

      const lowConfidence = facts.filter(
        (f) => f.confidence < LOW_CONFIDENCE_THRESHOLD && f.confidence > 0,
      );
      const disagreements = facts.filter(
        (f) => f.deterministicValue && f.llmValue && f.deterministicValue !== f.llmValue,
      );
      const toCheck = [
        ...lowConfidence,
        ...disagreements.filter((d) => !lowConfidence.some((l) => l.id === d.id)),
      ];

      if (toCheck.length === 0) {
        return { data: { message: "No facts require QA", checked: 0 }, needsNextStep: true };
      }

      const llmConfig = await getEffectiveLlmConfig("fact_extraction_qa", ctx.tenantId);
      if (!llmConfig.apiKey) {
        logger.info("[facts:llm_qa] QA LLM API key not configured, skipping");
        return { data: { message: "QA LLM API key not configured" }, needsNextStep: true };
      }

      const sections = await prisma.section.findMany({
        where: { docVersionId: ctx.docVersionId },
        include: { contentBlocks: { orderBy: { order: "asc" } } },
        orderBy: { order: "asc" },
      });

      const qaInputBudget = getInputBudgetChars(llmConfig);

      const docSnippet = sections
        .filter((s) => !s.standardSection || !EXCLUDED_SECTION_PREFIXES.some((p) => s.standardSection!.startsWith(p)))
        .map((s) => {
          const text = s.contentBlocks.map((b) => b.content).join("\n");
          return `[${s.title}]\n${text}`;
        })
        .join("\n")
        .slice(0, qaInputBudget);

      const factsSummary = toCheck
        .map((f) => {
          const src = (f.sources as any[])?.map((s: any) => `"${s.text ?? s.textSnippet ?? ""}"`).join("; ") ?? "";
          const algoVal = f.deterministicValue ? `алго="${f.deterministicValue}"` : "";
          const llmVal = f.llmValue ? `LLM="${f.llmValue}"` : "";
          return `- ${f.factCategory}.${f.factKey}: значение="${f.value}", уверенность=${f.confidence}, ${algoVal} ${llmVal}, источники: ${src}`;
        })
        .join("\n");

      const systemPrompt = `Ты — QA-аудитор извлечения фактов из клинического протокола.
Тебе даны факты с низкой уверенностью или расхождением между алгоритмом и LLM.
Для каждого факта:
1. Проверь правильность значения по тексту документа.
2. Если алгоритм и LLM дали разные значения — выбери правильное или предложи своё.
3. Укажи итоговую уверенность.

Верни СТРОГО JSON массив:
[
  {
    "fact_key": "category.key",
    "correct": true,
    "corrected_value": "исправленное значение (если correct=false)",
    "new_confidence": 0.9,
    "reason": "краткое обоснование"
  }
]`;

      const userPrompt = `ФАКТЫ ДЛЯ ПРОВЕРКИ:\n${factsSummary}\n\nКОНТЕКСТ ДОКУМЕНТА:\n${docSnippet}`;

      const gateway = new LLMGateway({
        provider: llmConfig.provider as LLMProvider,
        model: llmConfig.model,
        apiKey: llmConfig.apiKey,
        baseUrl: llmConfig.baseUrl || undefined,
        temperature: llmConfig.temperature,
      });

      const response = await gateway.generate({
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
        maxTokens: llmConfig.maxTokens,
      });

      let correctedCount = 0;
      let confirmedCount = 0;

      try {
        const jsonMatch = response.content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const corrections = JSON.parse(jsonMatch[0]) as any[];

          for (const correction of corrections) {
            const fullKey = correction.fact_key as string;
            const dotIdx = fullKey.indexOf(".");
            const factKey = dotIdx > -1 ? fullKey.slice(dotIdx + 1) : fullKey;
            const category = dotIdx > -1 ? fullKey.slice(0, dotIdx) : "";

            const fact = toCheck.find(
              (f) => f.factKey === factKey && (!category || f.factCategory === category),
            );
            if (!fact) continue;

            const qaConf = typeof correction.new_confidence === "number"
              ? Math.min(Math.max(correction.new_confidence, 0), 1)
              : fact.confidence;

            if (correction.correct === false && correction.corrected_value) {
              const correctedVal = String(correction.corrected_value);
              await prisma.fact.update({
                where: { id: fact.id },
                data: {
                  qaValue: correctedVal,
                  qaConfidence: qaConf,
                  value: correctedVal,
                  confidence: qaConf,
                },
              });
              correctedCount++;
            } else {
              await prisma.fact.update({
                where: { id: fact.id },
                data: {
                  qaValue: fact.value,
                  qaConfidence: qaConf,
                  confidence: qaConf,
                },
              });
              confirmedCount++;
            }
          }
        }
      } catch (err) {
        logger.warn("[facts:llm_qa] Failed to parse QA response", { error: String(err) });
      }

      return {
        data: {
          checked: toCheck.length,
          corrected: correctedCount,
          confirmed: confirmedCount,
          tokensUsed: response.usage.totalTokens,
        },
        needsNextStep: true,
        llmConfigSnapshot: toConfigSnapshot(llmConfig) as unknown as Record<string, unknown>,
      };
    },
  };

  const handlers = new Map([
    ["deterministic" as const, deterministicHandler],
    ["llm_check" as const, llmCheckHandler],
    ["llm_qa" as const, llmQaHandler],
  ]);

  await runPipeline(data.processingRunId, {
    operatorReviewEnabled: data.operatorReviewEnabled ?? false,
    steps: Array.from(handlers.values()),
  }, handlers);
}
