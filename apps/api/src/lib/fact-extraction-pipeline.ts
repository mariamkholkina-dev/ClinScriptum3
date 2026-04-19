/**
 * Единый 3-уровневый конвейер извлечения фактов.
 * Используется как in-process pipeline (API), так и worker pipeline.
 *
 * Уровни:
 *   1. Deterministic — regex-правила из rules-engine
 *   2. LLM Check    — LLM проверяет/дополняет результаты Level 1
 *   3. LLM QA       — арбитраж для low-confidence и расхождений
 */

import { prisma, loadRulesForType, snapshotRules, getEffectiveLlmConfig, toConfigSnapshot } from "@clinscriptum/db";
import { RulesEngine, detectContradictions, toFactExtractionRules } from "@clinscriptum/rules-engine";
import { LLMGateway } from "@clinscriptum/llm-gateway";
import type { LLMProvider } from "@clinscriptum/llm-gateway";
import { logger } from "./logger.js";

const EXCLUDED_SECTION_PREFIXES = ["overview", "admin", "appendix"];
const LOW_CONFIDENCE_THRESHOLD = 0.6;

interface StepResult {
  data: Record<string, unknown>;
  llmConfigSnapshot?: Record<string, unknown>;
  ruleSnapshot?: Record<string, unknown>;
}

export async function handleExtractFacts(data: {
  processingRunId: string;
  operatorReviewEnabled?: boolean;
}) {
  const run = await prisma.processingRun.findUnique({
    where: { id: data.processingRunId },
    include: { study: { select: { tenantId: true } } },
  });
  if (!run) throw new Error(`ProcessingRun ${data.processingRunId} not found`);

  const ctx = {
    docVersionId: run.docVersionId,
    tenantId: run.study.tenantId,
    bundleId: (run as any).ruleSetBundleId as string | null,
  };

  await prisma.processingRun.update({
    where: { id: data.processingRunId },
    data: { status: "running" },
  });

  try {
    // Level 1: Deterministic
    const step1 = await createStep(data.processingRunId, "deterministic");
    const deterResult = await runDeterministic(ctx);
    await completeStep(step1.id, deterResult);
    logger.info("[facts] Level 1 (deterministic) complete", deterResult.data);

    if ((deterResult.data.totalExtracted as number) === 0) {
      await prisma.processingRun.update({ where: { id: data.processingRunId }, data: { status: "completed" } });
      return;
    }

    // Level 2: LLM Check
    const step2 = await createStep(data.processingRunId, "llm_check");
    const llmResult = await runLlmCheck(ctx);
    await completeStep(step2.id, llmResult);
    logger.info("[facts] Level 2 (llm_check) complete", llmResult.data);

    // Level 3: LLM QA
    const step3 = await createStep(data.processingRunId, "llm_qa");
    const qaResult = await runLlmQa(ctx);
    await completeStep(step3.id, qaResult);
    logger.info("[facts] Level 3 (llm_qa) complete", qaResult.data);

    await prisma.processingRun.update({ where: { id: data.processingRunId }, data: { status: "completed" } });
  } catch (err) {
    await prisma.processingRun.update({
      where: { id: data.processingRunId },
      data: { status: "failed", lastError: (err as Error).message },
    });
    throw err;
  }
}

async function createStep(processingRunId: string, level: string) {
  return prisma.processingStep.create({
    data: { processingRunId, level: level as any, status: "running", startedAt: new Date() },
  });
}

async function completeStep(stepId: string, result: StepResult) {
  await prisma.processingStep.update({
    where: { id: stepId },
    data: {
      status: "completed",
      result: result.data as any,
      llmConfigSnapshot: result.llmConfigSnapshot as any ?? undefined,
      ruleSnapshot: result.ruleSnapshot as any ?? undefined,
      completedAt: new Date(),
    },
  });
}

/* ═══════════════ Level 1: Deterministic ═══════════════ */

async function runDeterministic(ctx: { docVersionId: string; bundleId: string | null }): Promise<StepResult> {
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
    ruleSnapshot: snapshotRules(resolved?.rules, {
      ruleSetVersionId: resolved?.ruleSetVersionId,
      ruleSetType: "fact_extraction",
    }),
  };
}

/* ═══════════════ Level 2: LLM Check ═══════════════ */

async function runLlmCheck(ctx: { docVersionId: string; tenantId: string }): Promise<StepResult> {
  const llmConfig = await getEffectiveLlmConfig("fact_extraction", ctx.tenantId);
  if (!llmConfig.apiKey) {
    return { data: { message: "LLM API key not configured" } };
  }

  const facts = await prisma.fact.findMany({ where: { docVersionId: ctx.docVersionId } });
  if (facts.length === 0) {
    return { data: { message: "No facts to verify" } };
  }

  const sections = await prisma.section.findMany({
    where: { docVersionId: ctx.docVersionId },
    include: { contentBlocks: { orderBy: { order: "asc" } } },
    orderBy: { order: "asc" },
  });

  const docText = sections
    .filter((s) => !s.standardSection || !EXCLUDED_SECTION_PREFIXES.some((p) => s.standardSection!.startsWith(p)))
    .map((s) => {
      const isSynopsis = s.standardSection?.startsWith("synopsis") ?? false;
      const marker = isSynopsis ? "[SYNOPSIS]" : `[SECTION: ${s.title}]`;
      const text = s.contentBlocks.map((b) => b.content).join("\n");
      return `\n${marker}\n${text}\n`;
    })
    .join("")
    .slice(0, 60_000);

  const factList = facts
    .map((f) => `- ${f.factCategory}.${f.factKey}: "${f.value}" (confidence: ${f.confidence})`)
    .join("\n");

  const systemPrompt = `Ты — эксперт по клиническим протоколам. Проверь извлечённые факты.

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

  const gateway = new LLMGateway({
    provider: llmConfig.provider as LLMProvider,
    model: llmConfig.model,
    apiKey: llmConfig.apiKey,
    baseUrl: llmConfig.baseUrl || undefined,
    temperature: llmConfig.temperature,
  });

  const response = await gateway.generate({
    system: systemPrompt,
    messages: [{ role: "user", content: `ИЗВЛЕЧЁННЫЕ ФАКТЫ:\n${factList}\n\nДОКУМЕНТ:\n${docText}` }],
    maxTokens: 4096,
  });

  let verifiedCount = 0;
  let changedCount = 0;
  let newCount = 0;

  try {
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);

      if (Array.isArray(parsed.verified)) {
        for (const v of parsed.verified) {
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

      if (Array.isArray(parsed.new_facts)) {
        for (const nf of parsed.new_facts) {
          const fullKey = nf.fact_key as string;
          const dotIdx = fullKey.indexOf(".");
          const factKey = dotIdx > -1 ? fullKey.slice(dotIdx + 1) : fullKey;
          const category = dotIdx > -1 ? fullKey.slice(0, dotIdx) : "general";

          if (facts.some((f) => f.factKey === factKey)) continue;

          const llmVal = String(nf.value);
          const llmConf = typeof nf.confidence === "number"
            ? Math.min(Math.max(nf.confidence, 0), 1) : 0.5;

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
    data: { verified: verifiedCount, changed: changedCount, newFacts: newCount, tokensUsed: response.usage.totalTokens },
    llmConfigSnapshot: toConfigSnapshot(llmConfig) as unknown as Record<string, unknown>,
  };
}

/* ═══════════════ Level 3: LLM QA ═══════════════ */

async function runLlmQa(ctx: { docVersionId: string; tenantId: string }): Promise<StepResult> {
  const facts = await prisma.fact.findMany({ where: { docVersionId: ctx.docVersionId } });

  const lowConfidence = facts.filter((f) => f.confidence < LOW_CONFIDENCE_THRESHOLD && f.confidence > 0);
  const disagreements = facts.filter(
    (f) => f.deterministicValue && f.llmValue && f.deterministicValue !== f.llmValue,
  );
  const toCheck = [
    ...lowConfidence,
    ...disagreements.filter((d) => !lowConfidence.some((l) => l.id === d.id)),
  ];

  if (toCheck.length === 0) {
    return { data: { message: "No facts require QA", checked: 0 } };
  }

  const llmConfig = await getEffectiveLlmConfig("fact_extraction_qa", ctx.tenantId);
  if (!llmConfig.apiKey) {
    return { data: { message: "QA LLM API key not configured" } };
  }

  const sections = await prisma.section.findMany({
    where: { docVersionId: ctx.docVersionId },
    include: { contentBlocks: { orderBy: { order: "asc" } } },
    orderBy: { order: "asc" },
  });

  const docSnippet = sections
    .filter((s) => !s.standardSection || !EXCLUDED_SECTION_PREFIXES.some((p) => s.standardSection!.startsWith(p)))
    .map((s) => `[${s.title}]\n${s.contentBlocks.map((b) => b.content).join("\n")}`)
    .join("\n")
    .slice(0, 30_000);

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

  const gateway = new LLMGateway({
    provider: llmConfig.provider as LLMProvider,
    model: llmConfig.model,
    apiKey: llmConfig.apiKey,
    baseUrl: llmConfig.baseUrl || undefined,
    temperature: llmConfig.temperature,
  });

  const response = await gateway.generate({
    system: systemPrompt,
    messages: [{ role: "user", content: `ФАКТЫ ДЛЯ ПРОВЕРКИ:\n${factsSummary}\n\nКОНТЕКСТ ДОКУМЕНТА:\n${docSnippet}` }],
    maxTokens: 2048,
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
            data: { qaValue: correctedVal, qaConfidence: qaConf, value: correctedVal, confidence: qaConf },
          });
          correctedCount++;
        } else {
          await prisma.fact.update({
            where: { id: fact.id },
            data: { qaValue: fact.value, qaConfidence: qaConf, confidence: qaConf },
          });
          confirmedCount++;
        }
      }
    }
  } catch (err) {
    logger.warn("[facts:llm_qa] Failed to parse QA response", { error: String(err) });
  }

  return {
    data: { checked: toCheck.length, corrected: correctedCount, confirmed: confirmedCount, tokensUsed: response.usage.totalTokens },
    llmConfigSnapshot: toConfigSnapshot(llmConfig) as unknown as Record<string, unknown>,
  };
}
