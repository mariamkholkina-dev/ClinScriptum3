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

// Sprint 4.3: Levenshtein distance для fuzzy match невалидных zones.
// Когда LLM возвращает близкий по написанию ключ — возьмём его. Например
// "preclinical_data" → "preclinical_clinical_data" (1 word missing/typo).
// Threshold MAX_FUZZY_DISTANCE = 3 — выше существенно меняет смысл.
function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const m = a.length;
  const n = b.length;
  // 2-row optimization вместо full matrix.
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

const MAX_FUZZY_DISTANCE = 3;

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

  // Fuzzy fallback: ищем ближайший канонический key в lookup по Levenshtein.
  // Сравниваем normalized zone с каждым ключом lookup; берём min distance.
  // Только если distance ≤ MAX_FUZZY_DISTANCE и string length > distance × 2
  // (чтобы избежать совпадения коротких разных слов вроде "ae" vs "ip").
  let bestMatch: { key: string; canonical: string; dist: number } | null = null;
  for (const [key, canonical] of lookup) {
    if (key.length < 4) continue; // слишком коротко для fuzzy
    const dist = levenshteinDistance(normalized, key);
    if (dist > MAX_FUZZY_DISTANCE) continue;
    if (dist > Math.floor(key.length / 2)) continue; // дистанция > половины — чужое слово
    if (!bestMatch || dist < bestMatch.dist) {
      bestMatch = { key, canonical, dist };
    }
  }
  if (bestMatch) return bestMatch.canonical;

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
// Sprint 3.3: per-section retry удалён в LLM Check (заменён batch-retry в
// 3.1) и в QA уже используется per-batch retry. На уровне step-retry
// orchestrator (lib/step-retry.ts) — exponential backoff 3 попытки для
// llm_check и llm_qa уровней. Дублирующий per-section retry убран.
// Per-batch retry на TypeError: fetch failed.
const QA_BATCH_RETRY_ATTEMPTS = 2;
const QA_BATCH_RETRY_DELAY_MS = 5000;

// Sprint 3.1: batch-режим LLM Check (Step 2). Отдельно от QA's
// MAX_SECTIONS_PER_BATCH=10 — у Check проще промпт (не reasoning-tier QA),
// можно крупнее. 20 секций × ~150 chars каждая ≈ 3K input + ответ ≈ 1.3K
// → влезает в default 8K context window любого LLM.
const LLM_CHECK_BATCH_SIZE = 20;
const LLM_CHECK_BATCH_RETRY_ATTEMPTS = 2;
const LLM_CHECK_BATCH_RETRY_DELAY_MS = 3000;

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

ЗАДАЧА: Классифицируй каждую секцию из списка, присвоив ей стандартную зону из каталога ниже.

ПРИОРИТЕТ ИСТОЧНИКОВ ИНФОРМАЦИИ:
1. ЗАГОЛОВОК секции + ПУТЬ родительских заголовков — главный источник. В большинстве случаев заголовка и его позиции в иерархии достаточно для уверенной классификации.
2. СТРУКТУРА ДОКУМЕНТА (список всех заголовков) — помогает определить контекст и тип документа.
3. СОДЕРЖАНИЕ РАЗДЕЛА — используй ТОЛЬКО если заголовок неоднозначен и не позволяет уверенно определить зону (confidence < 0.7 по заголовку). Не позволяй содержанию перевесить очевидный заголовок.

КАТАЛОГ ЗОН (выбирай ТОЛЬКО из этого списка):
{{catalog}}

ПРАВИЛА:
1. Используй zone key ТОЧНО как он написан в каталоге. НЕ добавляй к нему имя родительской зоны.
2. Если секция является подзоной — используй ключ подзоны, а не родительской зоны.
3. Учитывай иерархию: путь родительских заголовков и общую структуру документа.
4. Если алгоритм уже предложил зону — проверь: если согласен, верни ту же; если нет — верни правильную.
5. Если секция не подходит ни к одной зоне — zone:null, confidence:0.
6. confidence: 0.0–1.0.

ФОРМАТ ОТВЕТА — JSON-массив, по одному объекту на каждую секцию, в ТОМ ЖЕ ПОРЯДКЕ что в input:
[{"idx":1,"zone":"synopsis","confidence":0.95},{"idx":2,"zone":"rationale","confidence":0.85}]`;

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

/**
 * Balanced-bracket parser. Возвращает первый balanced range [start..end]
 * для скобок open/close с поддержкой strings и escapes — игнорирует скобки
 * внутри "..." кавычек.
 *
 * Раньше использовался greedy regex `\[[\s\S]*\]` — он matched от первого
 * `[` до последнего `]` в строке, что ломалось на reasoning-ответах вида
 * "пример: [1,2,3], результат: [{...}]" (matched всё, JSON.parse не валиден).
 */
function extractBalanced(s: string, open: string, close: string): string | null {
  const start = s.indexOf(open);
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (escaped) { escaped = false; continue; }
    if (inStr) {
      if (c === "\\") escaped = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

function parseLlmJsonArray(raw: string): unknown[] | null {
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

  if (/не могу обсуждать|давайте поговорим|не могу помочь с этим/i.test(cleaned)) {
    return null;
  }

  // 1) Пробуем JSON.parse(cleaned) целиком (если LLM вернул чистый JSON без
  //    обёртки — это самый быстрый и точный путь).
  try {
    const direct = JSON.parse(cleaned);
    if (Array.isArray(direct)) return direct;
    if (direct && typeof direct === "object") {
      const obj = direct as Record<string, unknown>;
      if (Array.isArray(obj.sections)) return obj.sections;
      if (Array.isArray(obj.results)) return obj.results;
      if (Array.isArray(obj.corrections)) return obj.corrections;
      return [obj];
    }
  } catch { /* fall through */ }

  // 2) Balanced-bracket для массива.
  const arrStr = extractBalanced(cleaned, "[", "]");
  if (arrStr) {
    try {
      const parsed = JSON.parse(arrStr);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* fall through */ }
  }

  // 3) Balanced-bracket для объекта (с массивом внутри как sections/results/corrections).
  const objStr = extractBalanced(cleaned, "{", "}");
  if (!objStr) return null;
  try {
    const obj = JSON.parse(objStr) as Record<string, unknown>;
    if (Array.isArray(obj.sections)) return obj.sections;
    if (Array.isArray(obj.results)) return obj.results;
    if (Array.isArray(obj.corrections)) return obj.corrections;
    return [obj];
  } catch {
    return null;
  }
}

function parseLlmJsonObject(raw: string): Record<string, unknown> | null {
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  if (/не могу обсуждать|давайте поговорим|не могу помочь с этим/i.test(cleaned)) {
    return null;
  }
  // 1) Прямой parse целиком — fast path для чистого JSON.
  try {
    const direct = JSON.parse(cleaned);
    if (direct && typeof direct === "object" && !Array.isArray(direct)) {
      return direct as Record<string, unknown>;
    }
  } catch { /* fall through */ }

  // 2) Balanced-bracket для объекта.
  const objStr = extractBalanced(cleaned, "{", "}");
  if (!objStr) return null;
  try {
    const parsed = JSON.parse(objStr);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

// Экспортируем для unit-тестов.
export const __testing = { extractBalanced, parseLlmJsonArray, parseLlmJsonObject };

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

      // Sprint 3.1: batch LLM Check. Раньше — 1 LLM-вызов на секцию (≈200 для
      // протокола), теперь — batch по LLM_CHECK_BATCH_SIZE секций, ~10x reduction
      // в количестве запросов и токенах overhead'а (system prompt не повторяется).
      // Per-batch retry (на TypeError fetch failed, JSON parse) с exponential
      // backoff. Если batch возвращает массив с пропуском idx — секция остаётся
      // на deterministic-зоне, лог warn.
      const classifyBatch = async (batch: CachedSection[]): Promise<void> => {
        const idxToSection = new Map<number, CachedSection>();
        const inputLines: string[] = [];
        batch.forEach((section, i) => {
          const idx = i + 1;
          idxToSection.set(idx, section);
          const breadcrumb = parentChains.get(section.id);
          const path = breadcrumb?.length ? breadcrumb.join(" → ") : "(корень)";
          const contentParts = section.contentBlocks.map((b) => b.content).join(" ");
          const preview = contentParts.slice(0, 200).replace(/\s+/g, " ").trim();
          const algo = section.algoSection
            ? ` | алгоритм:${section.algoSection} (${Math.round((section.algoConfidence ?? 0) * 100)}%)`
            : "";
          inputLines.push(
            `[${idx}] ${section.title} | путь:${path}${algo}${preview ? ` | preview:${preview}` : ""}`,
          );
        });

        const userMessage = `СПИСОК СЕКЦИЙ ДЛЯ КЛАССИФИКАЦИИ (${batch.length} шт):
${inputLines.join("\n")}`;

        let parsed: unknown[] | null = null;
        for (let attempt = 0; attempt <= LLM_CHECK_BATCH_RETRY_ATTEMPTS; attempt++) {
          try {
            if (attempt > 0) {
              retries++;
              await new Promise((r) => setTimeout(r, LLM_CHECK_BATCH_RETRY_DELAY_MS * attempt));
            }
            const response = await gateway.generate({
              system: systemPrompt,
              messages: [{ role: "user", content: userMessage }],
              maxTokens: 64 * batch.length + 256,
              responseFormat: "json",
            });
            totalTokens += response.usage.totalTokens;
            parsed = parseLlmJsonArray(response.content);
            if (parsed) break;
            if (attempt === LLM_CHECK_BATCH_RETRY_ATTEMPTS) {
              for (const s of batch) {
                parseErrorDetails.push({
                  title: s.title,
                  sectionId: s.id,
                  reason: `batch_parse: ${response.content.slice(0, 100)}`,
                });
              }
              logger.warn("LLM classify batch parse failed", {
                batchSize: batch.length,
                preview: response.content.slice(0, 200),
              });
            }
          } catch (err) {
            if (attempt === LLM_CHECK_BATCH_RETRY_ATTEMPTS) {
              for (const s of batch) {
                parseErrorDetails.push({ title: s.title, sectionId: s.id, reason: String(err).slice(0, 200) });
              }
              logger.warn("LLM classify batch error", { batchSize: batch.length, error: String(err) });
            }
          }
        }

        if (!parsed) return;

        const seenIdx = new Set<number>();
        for (const item of parsed) {
          if (!item || typeof item !== "object") continue;
          const obj = item as Record<string, unknown>;
          const idx = typeof obj.idx === "number" ? obj.idx
            : parseInt(String(obj.idx ?? ""), 10);
          if (isNaN(idx)) continue;
          const section = idxToSection.get(idx);
          if (!section) continue;
          seenIdx.add(idx);

          const zone = (obj.zone as string | null) ?? (obj.zone_key as string | null) ?? null;
          const conf = typeof obj.confidence === "number" ? obj.confidence
            : parseFloat(String(obj.confidence ?? ""));

          if (!zone || isNaN(conf)) {
            skippedNoZoneDetails.push({ title: section.title, sectionId: section.id, rawZone: zone, rawConfidence: obj.confidence ?? null });
            continue;
          }

          const resolvedZone = zoneLookup.size > 0 ? resolveZoneKey(zone, zoneLookup) : zone;
          if (!resolvedZone) {
            skippedInvalidZoneDetails.push({ title: section.title, sectionId: section.id, zone });
            continue;
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
        }

        for (const [idx, section] of idxToSection) {
          if (!seenIdx.has(idx)) {
            logger.warn("LLM classify batch missed section", { idx, sectionId: section.id, title: section.title });
            parseErrorDetails.push({
              title: section.title,
              sectionId: section.id,
              reason: `batch_missed_idx:${idx}`,
            });
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

      // Разбиваем на batches и обрабатываем параллельно с concurrency LLM_CONCURRENCY.
      const batches: CachedSection[][] = [];
      for (let i = 0; i < sectionsToVerify.length; i += LLM_CHECK_BATCH_SIZE) {
        batches.push(sectionsToVerify.slice(i, i + LLM_CHECK_BATCH_SIZE));
      }
      logger.info("LLM Check batched", {
        sectionsToVerify: sectionsToVerify.length,
        batches: batches.length,
        batchSize: LLM_CHECK_BATCH_SIZE,
      });

      await runWithConcurrency(
        batches.map((b) => () => classifyBatch(b)),
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
