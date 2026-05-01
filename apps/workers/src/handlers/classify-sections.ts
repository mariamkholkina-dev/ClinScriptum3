import { prisma, loadRulesForType, snapshotRules, getEffectiveLlmConfig, toConfigSnapshot, getInputBudgetChars } from "@clinscriptum/db";
import { RulesEngine, toSectionMappingRules } from "@clinscriptum/rules-engine";
import { LLMGateway } from "@clinscriptum/llm-gateway";
import type { LLMProvider } from "@clinscriptum/llm-gateway";
import { runPipeline } from "../pipeline/orchestrator.js";
import type { PipelineStepHandler, PipelineContext, StepResult } from "../pipeline/orchestrator.js";
import { logger } from "../lib/logger.js";
import { runWithConcurrency } from "../lib/concurrency.js";
import { loadSections, invalidateSectionsCache } from "../lib/section-cache.js";
import type { CachedSection } from "../lib/section-cache.js";

interface SectionClassifyRow {
  sectionId: string;
  sectionTitle: string;
  standardSection: string | null;
  confidence: number;
  method: string;
}

function buildZoneCatalog(
  rules: Array<{ pattern: string; config: unknown }>,
): string {
  return rules
    .filter((r) => r.pattern !== "system_prompt")
    .map((r) => {
      const cfg = (r.config ?? {}) as Record<string, unknown>;
      const key = (cfg.key as string) ?? r.pattern;
      const titleRu = (cfg.titleRu as string) ?? key;
      const type = (cfg.type as string) ?? "zone";
      const parent = (cfg.parentZone as string) ?? "";
      return `- ${key} (${type}${parent ? `, parent: ${parent}` : ""}): ${titleRu}`;
    })
    .join("\n");
}

function buildZoneLookup(
  rules: Array<{ pattern: string; config: unknown }>,
): Map<string, string> {
  const lookup = new Map<string, string>();
  const suffixToKeys = new Map<string, string[]>();

  for (const r of rules) {
    if (r.pattern === "system_prompt") continue;
    const cfg = (r.config ?? {}) as Record<string, unknown>;
    const shortKey = (cfg.key as string) ?? r.pattern;
    const canonical = r.pattern;

    lookup.set(canonical, canonical);
    lookup.set(shortKey, canonical);
    const lower = shortKey.toLowerCase();
    if (lower !== shortKey) lookup.set(lower, canonical);
    lookup.set(lower.replace(/[.\s-]+/g, "_"), canonical);

    const lastDot = lower.lastIndexOf(".");
    if (lastDot >= 0) {
      const suffix = lower.slice(lastDot + 1);
      const existing = suffixToKeys.get(suffix) ?? [];
      existing.push(canonical);
      suffixToKeys.set(suffix, existing);
    }
  }

  for (const [suffix, keys] of suffixToKeys) {
    if (keys.length === 1 && !lookup.has(suffix)) {
      lookup.set(suffix, keys[0]);
    }
  }

  return lookup;
}

function resolveZoneKey(zone: string, lookup: Map<string, string>): string | null {
  if (lookup.has(zone)) return lookup.get(zone)!;
  const normalized = zone.toLowerCase().replace(/[.\s-]+/g, "_");
  if (lookup.has(normalized)) return lookup.get(normalized)!;

  const firstDot = zone.indexOf(".");
  if (firstDot >= 0) {
    const withoutParent = zone.slice(firstDot + 1);
    if (lookup.has(withoutParent)) return lookup.get(withoutParent)!;
    const wpNorm = withoutParent.toLowerCase().replace(/[.\s-]+/g, "_");
    if (lookup.has(wpNorm)) return lookup.get(wpNorm)!;
  }

  return null;
}

function buildParentChains(sections: CachedSection[]): Map<string, string[]> {
  const chains = new Map<string, string[]>();
  const stack: { level: number; title: string }[] = [];

  for (const sec of sections) {
    const level = sec.level ?? 0;
    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }
    chains.set(sec.id, stack.map((s) => s.title));
    stack.push({ level, title: sec.title });
  }

  return chains;
}

// Уменьшено с 25 до 10 в рамках задачи 0.1: на batch=25 LLM QA-step
// (DeepSeek-V32 с reasoning) стабильно падал с TypeError: fetch failed на
// всех batch'ах (см. логи от 2026-05-01: 8/8 batch'ей failed, totalTokens=0).
// Гипотеза: payload + reasoning превышают практический connection budget
// провайдера. Меньший batch уменьшает шанс timeout/connect failure.
const MAX_SECTIONS_PER_BATCH = 10;
const MAX_RETRIES = 2;
// Per-batch retry на TypeError: fetch failed.
const QA_BATCH_RETRY_ATTEMPTS = 2;
const QA_BATCH_RETRY_DELAY_MS = 5000;

function batchByBudget(items: string[], budget: number): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let currentLen = 0;
  for (const item of items) {
    const itemLen = item.length + 5;
    if ((currentLen + itemLen > budget || current.length >= MAX_SECTIONS_PER_BATCH) && current.length > 0) {
      batches.push(current);
      current = [];
      currentLen = 0;
    }
    current.push(item);
    currentLen += itemLen;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

const LLM_CONCURRENCY = 3;
const CONTENT_MAX_CHARS = 2000;
const CONTENT_FOR_DETERMINISTIC_CHARS = 1000;
const HIGH_CONFIDENCE_SKIP = 0.85;

// Fallback-промпты на случай если БД (RuleSet section_classification_qa)
// не содержит section_classify:llm_check / section_classify:qa правил.
// В нормальном workflow промпты редактируются в rule-admin UI и грузятся
// через loadRulesForType — эти константы — safety net для свежих/тестовых
// инсталляций. Шаблон содержит {{catalog}} плейсхолдер.

const DEFAULT_LLM_CHECK_PROMPT = `Ты — эксперт по структуре документов клинических исследований (протокол, ICF, IB, CSR).

ЗАДАЧА: Классифицируй секцию документа, присвоив ей стандартную зону из каталога ниже.

ПРИОРИТЕТ ИСТОЧНИКОВ ИНФОРМАЦИИ:
1. ЗАГОЛОВОК секции + ПУТЬ родительских заголовков — главный источник. В большинстве случаев заголовка и его позиции в иерархии достаточно для уверенной классификации.
2. СТРУКТУРА ДОКУМЕНТА (список всех заголовков) — помогает определить контекст и тип документа.
3. СОДЕРЖАНИЕ РАЗДЕЛА — используй ТОЛЬКО если заголовок неоднозначен и не позволяет уверенно определить зону (confidence < 0.7 по заголовку). Не позволяй содержанию перевесить очевидный заголовок.

КАТАЛОГ ЗОН (выбирай ТОЛЬКО из этого списка):
{{catalog}}

ПРАВИЛА:
1. Используй zone key ТОЧНО как он написан в каталоге. НЕ добавляй к нему имя родительской зоны — поле «parent» в каталоге это метаданные, а не часть ключа. Например, если в каталоге написано «preclinical_data (subzone, parent: ip)», верни "preclinical_data", а НЕ "ip.preclinical_data"
2. Если секция является подзоной — используй ключ подзоны, а не родительской зоны
3. Учитывай иерархию: путь родительских заголовков и общую структуру документа
4. Если алгоритм уже предложил зону — проверь: если согласен, верни ту же; если нет — верни правильную
5. Если секция не подходит ни к одной зоне — zone: null, confidence: 0
6. confidence: 0.0–1.0

ФОРМАТ ОТВЕТА — только JSON-объект, без текста, без markdown:
{"zone":"preclinical_data","confidence":0.95}`;

const DEFAULT_LLM_QA_PROMPT = `Ты — QA-ревьюер структуры документа клинического исследования.
Проверь корректность присвоенных зон. Для секций с ошибочной зоной предложи исправление.

КАТАЛОГ ЗОН:
{{catalog}}

ПРАВИЛА:
- Проверь, что присвоенная зона соответствует заголовку и месту секции в иерархии документа
- Если зона правильная — не включай секцию в ответ
- Если зона неправильная — укажи правильную зону строго из каталога выше
- Если секция не подходит ни к одной зоне — correct_zone: null

ФОРМАТ ОТВЕТА — только JSON-массив (без markdown). Если все зоны верны — пустой массив []:
[{"idx":1,"current_zone":"overview","correct_zone":"introduction","confidence":0.9,"reason":"..."}]`;

function parseLlmJsonArray(raw: string): unknown[] | null {
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

  if (/не могу обсуждать|давайте поговорим|не могу помочь с этим/i.test(cleaned)) {
    return null;
  }

  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    return JSON.parse(arrayMatch[0]);
  }

  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!objMatch) return null;

  const obj = JSON.parse(objMatch[0]);
  return Array.isArray(obj.sections) ? obj.sections
    : Array.isArray(obj.results) ? obj.results
    : Array.isArray(obj.corrections) ? obj.corrections
    : [obj];
}

function parseLlmJsonObject(raw: string): Record<string, unknown> | null {
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  if (/не могу обсуждать|давайте поговорим|не могу помочь с этим/i.test(cleaned)) {
    return null;
  }
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!objMatch) return null;
  try {
    return JSON.parse(objMatch[0]);
  } catch {
    return null;
  }
}

export async function handleClassifySections(data: {
  processingRunId: string;
  operatorReviewEnabled?: boolean;
}) {
  /* ───── Step 1: Deterministic ───── */

  const deterministicHandler: PipelineStepHandler = {
    level: "deterministic",
    async execute(ctx: PipelineContext): Promise<StepResult> {
      const sections = await loadSections(ctx);

      const resolved = await loadRulesForType(ctx.bundleId, "section_classification");
      const engine = resolved
        ? new RulesEngine({ sectionMappings: toSectionMappingRules(resolved.rules) })
        : new RulesEngine();
      const classifier = engine.getSectionClassifier();

      // Task 2.1: иерархическая классификация — учитываем document-parent-zone
      // при выборе зоны. Sections загружаются sorted by .order, в loadSections —
      // подходит для stack-based определения parent.
      const sectionInputs = sections.map((section) => ({
        id: section.id,
        title: section.title,
        level: section.level,
        contentSnippet: section.contentBlocks
          .map((b) => b.content)
          .join("\n")
          .slice(0, CONTENT_FOR_DETERMINISTIC_CHARS),
      }));
      const hierarchicalResults = classifier.classifyHierarchical(sectionInputs);

      const results: SectionClassifyRow[] = sections.map((section) => {
        const result = hierarchicalResults.get(section.id);
        return {
          sectionId: section.id,
          sectionTitle: result?.sectionTitle ?? section.title,
          standardSection: result?.standardSection ?? null,
          confidence: result?.confidence ?? 0,
          method: result?.method ?? "pattern",
        };
      });

      for (const result of results) {
        if (result.standardSection) {
          await prisma.section.update({
            where: { id: result.sectionId },
            data: {
              algoSection: result.standardSection,
              algoConfidence: result.confidence,
              standardSection: result.standardSection,
              confidence: result.confidence,
              classifiedBy: "deterministic",
            },
          });
        }
      }

      invalidateSectionsCache(ctx);

      return {
        data: {
          classified: results.filter((r) => r.standardSection).length,
          unclassified: results.filter((r) => !r.standardSection).length,
          results,
        },
        needsNextStep: true,
        ruleSnapshot: snapshotRules(resolved?.rules, {
          ruleSetVersionId: resolved?.ruleSetVersionId,
          ruleSetType: "section_classification",
        }),
      };
    },
  };

  /* ───── Step 2: LLM Check — individual request per section ───── */

  const llmCheckHandler: PipelineStepHandler = {
    level: "llm_check",
    async execute(ctx: PipelineContext): Promise<StepResult> {
      const llmConfig = await getEffectiveLlmConfig("section_classify", ctx.tenantId);
      if (!llmConfig.apiKey) {
        return { data: { message: "LLM API key not configured, skipping" }, needsNextStep: true };
      }

      const sections = await loadSections(ctx);
      if (sections.length === 0) {
        return { data: { message: "No sections found", updated: 0 }, needsNextStep: true };
      }

      const [resolved, promptRules] = await Promise.all([
        loadRulesForType(ctx.bundleId, "section_classification"),
        loadRulesForType(ctx.bundleId, "section_classification_qa"),
      ]);
      const catalog = resolved ? buildZoneCatalog(resolved.rules) : "";
      const zoneLookup = resolved ? buildZoneLookup(resolved.rules) : new Map<string, string>();
      const parentChains = buildParentChains(sections);

      // Task 2.2: окно ±3 соседей вокруг текущей секции, маркированных уже
      // присвоенными zones из deterministic step. Даёт LLM sequence-context —
      // если рядом safety-секции, более вероятно что текущая тоже в safety.
      const idToIdx = new Map(sections.map((s, i) => [s.id, i]));
      const NEIGHBOR_WINDOW = 3;
      const buildEnrichedOutline = (currentId: string): string => {
        const i = idToIdx.get(currentId);
        if (i === undefined) return "";
        const start = Math.max(0, i - NEIGHBOR_WINDOW);
        const end = Math.min(sections.length, i + NEIGHBOR_WINDOW + 1);
        return sections
          .slice(start, end)
          .map((s) => {
            const marker = s.id === currentId ? "→" : " ";
            const indent = "  ".repeat(Math.max(0, (s.level ?? 0) - 1));
            const zoneTag = s.standardSection ? ` [${s.standardSection}]` : "";
            return `${marker} ${indent}${s.title}${zoneTag}`;
          })
          .join("\n");
      };

      const checkPromptTemplate =
        promptRules?.rules.find((r) => r.name === "section_classify:llm_check")?.promptTemplate ??
        DEFAULT_LLM_CHECK_PROMPT;
      const systemPrompt = checkPromptTemplate.replace("{{catalog}}", catalog);

      const gateway = new LLMGateway({
        provider: llmConfig.provider as LLMProvider,
        model: llmConfig.model,
        apiKey: llmConfig.apiKey,
        baseUrl: llmConfig.baseUrl || undefined,
        temperature: llmConfig.temperature,
        thinkingEnabled: ctx.llmThinkingEnabled,
        reasoningMode: llmConfig.reasoningMode,
        timeoutMs: llmConfig.timeoutMs,
      });

      let updated = 0;
      let totalTokens = 0;
      let retries = 0;
      const parseErrorDetails: Array<{ title: string; sectionId: string; reason: string }> = [];
      const skippedNoZoneDetails: Array<{ title: string; sectionId: string; rawZone: string | null; rawConfidence: unknown }> = [];
      const skippedInvalidZoneDetails: Array<{ title: string; sectionId: string; zone: string }> = [];

      const classifyOne = async (section: CachedSection): Promise<void> => {
        const breadcrumb = parentChains.get(section.id);
        const path = breadcrumb?.length
          ? breadcrumb.join(" → ") + " → " + section.title
          : section.title;
        const contentParts = section.contentBlocks.map((b) => b.content).join("\n");
        const content = contentParts.slice(0, CONTENT_MAX_CHARS);
        const algo = section.algoSection
          ? `\nАЛГОРИТМ ПРЕДЛОЖИЛ: ${section.algoSection} (${Math.round((section.algoConfidence ?? 0) * 100)}%)`
          : "";

        const userMessage = `ЗАГОЛОВОК: ${section.title}
ПУТЬ В ИЕРАРХИИ: ${path}${algo}

ОКРУЖЕНИЕ В ДОКУМЕНТЕ (соседние секции, → текущая, в скобках уже присвоенные зоны):
${buildEnrichedOutline(section.id)}

СОДЕРЖАНИЕ РАЗДЕЛА:
${content || "(пусто)"}`;

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            if (attempt > 0) {
              retries++;
              await new Promise((r) => setTimeout(r, 2000 * attempt));
            }

            const response = await gateway.generate({
              system: systemPrompt,
              messages: [{ role: "user", content: userMessage }],
              maxTokens: 512,
              responseFormat: "json",
            });

            totalTokens += response.usage.totalTokens;

            const parsed = parseLlmJsonObject(response.content);
            if (!parsed) {
              if (attempt === MAX_RETRIES) {
                parseErrorDetails.push({ title: section.title, sectionId: section.id, reason: `json_parse: ${response.content.slice(0, 150)}` });
                logger.warn("LLM classify parse error", {
                  sectionId: section.id, title: section.title,
                  preview: response.content.slice(0, 200),
                });
              }
              continue;
            }

            const zone = (parsed.zone as string | null) ?? (parsed.zone_key as string | null) ?? null;
            const conf = typeof parsed.confidence === "number" ? parsed.confidence
              : parseFloat(String(parsed.confidence ?? ""));

            if (!zone || isNaN(conf)) {
              skippedNoZoneDetails.push({ title: section.title, sectionId: section.id, rawZone: zone, rawConfidence: parsed.confidence ?? null });
              return;
            }

            const resolvedZone = zoneLookup.size > 0 ? resolveZoneKey(zone, zoneLookup) : zone;
            if (!resolvedZone) {
              skippedInvalidZoneDetails.push({ title: section.title, sectionId: section.id, zone });
              return;
            }

            await prisma.section.update({
              where: { id: section.id },
              data: {
                llmSection: resolvedZone,
                llmConfidence: conf,
                standardSection: resolvedZone,
                confidence: conf,
                classifiedBy: "llm_check",
              },
            });
            updated++;
            return;
          } catch (err) {
            if (attempt === MAX_RETRIES) {
              parseErrorDetails.push({ title: section.title, sectionId: section.id, reason: String(err).slice(0, 200) });
              logger.warn("LLM classify section error", { sectionId: section.id, error: String(err) });
            }
          }
        }
      };

      const sectionsToVerify = sections.filter(
        (s) => !s.algoSection || (s.algoConfidence ?? 0) < HIGH_CONFIDENCE_SKIP,
      );
      const skippedHighConfidence = sections.length - sectionsToVerify.length;

      logger.info("LLM Check filtering", {
        total: sections.length,
        toVerify: sectionsToVerify.length,
        skippedHighConfidence,
        threshold: HIGH_CONFIDENCE_SKIP,
      });

      await runWithConcurrency(
        sectionsToVerify.map((s) => () => classifyOne(s)),
        LLM_CONCURRENCY,
      );

      invalidateSectionsCache(ctx);

      logger.info("LLM section classification complete", {
        total: sections.length,
        verifiedByLlm: sectionsToVerify.length,
        skippedHighConfidence,
        updated,
        totalTokens,
      });

      return {
        data: {
          total: sections.length,
          verifiedByLlm: sectionsToVerify.length,
          skippedHighConfidence,
          updated,
          totalTokens,
          skippedNoZone: skippedNoZoneDetails.length,
          ...(skippedNoZoneDetails.length > 0 && { skippedNoZoneDetails }),
          skippedInvalidZone: skippedInvalidZoneDetails.length,
          ...(skippedInvalidZoneDetails.length > 0 && { skippedInvalidZoneDetails }),
          parseErrors: parseErrorDetails.length,
          ...(parseErrorDetails.length > 0 && { parseErrorDetails }),
          retries,
        },
        needsNextStep: true,
        llmConfigSnapshot: toConfigSnapshot(llmConfig) as unknown as Record<string, unknown>,
      };
    },
  };

  /* ───── Step 3: LLM QA — verify all classifications ───── */

  const llmQaHandler: PipelineStepHandler = {
    level: "llm_qa",
    async execute(ctx: PipelineContext): Promise<StepResult> {
      const llmConfig = await getEffectiveLlmConfig("section_classify_qa", ctx.tenantId);
      if (!llmConfig.apiKey) {
        return { data: { message: "QA LLM API key not configured, skipping" }, needsNextStep: true };
      }

      const allSections = await loadSections(ctx);
      const sections = allSections.filter((s) => s.standardSection);

      if (sections.length === 0) {
        return { data: { message: "No classified sections to verify", corrections: 0 }, needsNextStep: true };
      }

      const [resolved, promptRules] = await Promise.all([
        loadRulesForType(ctx.bundleId, "section_classification"),
        loadRulesForType(ctx.bundleId, "section_classification_qa"),
      ]);
      const catalog = resolved ? buildZoneCatalog(resolved.rules) : "";
      const zoneLookup = resolved ? buildZoneLookup(resolved.rules) : new Map<string, string>();
      const inputBudget = getInputBudgetChars(llmConfig);
      const parentChains = buildParentChains(allSections);

      const indexToId = new Map<number, string>();
      sections.forEach((s, i) => indexToId.set(i + 1, s.id));

      const qaPromptTemplate =
        promptRules?.rules.find((r) => r.name === "section_classify:qa")?.promptTemplate ??
        DEFAULT_LLM_QA_PROMPT;
      const systemPrompt = qaPromptTemplate.replace("{{catalog}}", catalog);

      const sectionEntries = sections.map((s, i) => {
        const breadcrumb = parentChains.get(s.id);
        const path = breadcrumb && breadcrumb.length > 0
          ? ` | Путь: ${breadcrumb.join(" → ")}`
          : "";
        const firstWords = s.contentBlocks[0]?.content?.slice(0, 60)?.replace(/\n/g, " ") ?? "";
        const preview = firstWords ? ` | «${firstWords}…»` : "";
        return `[${i + 1}] ${s.title} → ${s.standardSection} (${Math.round((s.confidence ?? 0) * 100)}%, ${s.classifiedBy ?? "??"})${path}${preview}`;
      });

      const contentBudget = inputBudget - systemPrompt.length - 100;
      const batches = batchByBudget(sectionEntries, Math.max(contentBudget, 2000));

      const gateway = new LLMGateway({
        provider: llmConfig.provider as LLMProvider,
        model: llmConfig.model,
        apiKey: llmConfig.apiKey,
        baseUrl: llmConfig.baseUrl || undefined,
        temperature: llmConfig.temperature,
        thinkingEnabled: ctx.llmThinkingEnabled,
        reasoningMode: llmConfig.reasoningMode,
        timeoutMs: llmConfig.timeoutMs,
      });

      let corrections = 0;
      let totalTokens = 0;
      let skippedInvalidZone = 0;
      const parseErrors: string[] = [];

      const batchResults = await runWithConcurrency(
        batches.map((batch, batchIdx) => async (): Promise<{ content: string; parsed: unknown[] | null; tokens: number }> => {
          const batchText = batch.join("\n");
          logger.info(`LLM QA classify batch ${batchIdx + 1}/${batches.length}`, { sections: batch.length });

          // Per-batch retry на TypeError: fetch failed (системный сбой DeepSeek-V32 endpoint).
          // Раньше при первом fetch-failed batch уходил в parseError навсегда — все 8 batch'ей
          // на типичном документе падали (см. logs от 2026-05-01). Retry с backoff покрывает
          // транзиентные сетевые проблемы.
          let lastErr: unknown = null;
          for (let attempt = 1; attempt <= QA_BATCH_RETRY_ATTEMPTS; attempt++) {
            try {
              const response = await gateway.generate({
                system: systemPrompt,
                messages: [{ role: "user", content: batchText }],
                maxTokens: llmConfig.maxTokens,
                responseFormat: "json",
              });

              let parsed: unknown[] | null = null;
              try {
                parsed = parseLlmJsonArray(response.content);
              } catch { /* skip */ }

              return { content: response.content, parsed, tokens: response.usage.totalTokens };
            } catch (err) {
              lastErr = err;
              if (attempt < QA_BATCH_RETRY_ATTEMPTS) {
                logger.warn(`LLM QA classify batch ${batchIdx + 1} error (attempt ${attempt}/${QA_BATCH_RETRY_ATTEMPTS}), retrying`, { error: String(err) });
                await new Promise((r) => setTimeout(r, QA_BATCH_RETRY_DELAY_MS * attempt));
              }
            }
          }
          logger.warn(`LLM QA classify batch ${batchIdx + 1} exhausted retries`, { error: String(lastErr) });
          return { content: String(lastErr), parsed: null, tokens: 0 };
        }),
        LLM_CONCURRENCY,
      );

      for (const br of batchResults) {
        totalTokens += br.tokens;

        if (!br.parsed) {
          if (br.content && !br.content.startsWith("Error")) {
            parseErrors.push(`no_json: ${br.content.slice(0, 200)}`);
          }
          continue;
        }

        for (const rawFix of br.parsed) {
          const item = rawFix as Record<string, unknown>;
          const idx = typeof item.idx === "number" ? item.idx
            : typeof item.id === "number" ? item.id
            : parseInt(String(item.idx ?? item.id ?? ""), 10);
          const conf = typeof item.confidence === "number" ? item.confidence
            : parseFloat(String(item.confidence ?? ""));
          if (isNaN(conf)) continue;

          const sectionId = isNaN(idx) ? undefined : indexToId.get(idx);
          if (!sectionId) continue;

          let correctedZone = (item.correct_zone as string | null) ?? (item.zone as string | null) ?? null;
          if (correctedZone) {
            const resolved = zoneLookup.size > 0 ? resolveZoneKey(correctedZone, zoneLookup) : correctedZone;
            if (!resolved) {
              skippedInvalidZone++;
              logger.info("QA returned invalid zone key", { idx, zone: correctedZone });
              continue;
            }
            correctedZone = resolved;
          }

          await prisma.section.update({
            where: { id: sectionId },
            data: {
              standardSection: correctedZone,
              confidence: conf,
              classifiedBy: "llm_qa",
              classificationComment: (item.reason as string) ?? null,
              llmSection: correctedZone,
              llmConfidence: conf,
            },
          });
          corrections++;
        }
      }

      invalidateSectionsCache(ctx);

      logger.info("LLM QA section classification complete", {
        reviewed: sections.length, corrections, batches: batches.length, totalTokens,
      });

      return {
        data: {
          reviewed: sections.length,
          corrections,
          batches: batches.length,
          totalTokens,
          ...(skippedInvalidZone > 0 && { skippedInvalidZone }),
          ...(parseErrors.length > 0 && { parseErrors }),
        },
        needsNextStep: true,
        llmConfigSnapshot: toConfigSnapshot(llmConfig) as unknown as Record<string, unknown>,
      };
    },
  };

  /* ───── Run pipeline ───── */

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
