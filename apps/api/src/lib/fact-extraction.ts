/**
 * Сервис извлечения фактов из документа.
 *
 * Процесс:
 *   1. Сбор текста документа (исключая overview, admin, appendix)
 *   2. Загрузка реестра фактов
 *   3. Отправка в LLM (Qwen3-Next-80B-A3B-Thinking на RunPod)
 *   4. QA-проверка низкоуверенных фактов через Yandex LLM
 *   5. Сохранение в БД (найденных и ненайденных)
 *
 * Факты из раздела Synopsis имеют приоритет.
 * Факты категории bioequivalence — только для БЭ-исследований.
 */

import { prisma } from "@clinscriptum/db";
import { llmAsk, llmGetConfig } from "./llm-gateway.js";
import { config, getInputBudgetChars } from "../config.js";
import {
  loadFactRegistry,
  type FactRegistryEntry,
} from "../data/fact-registry.js";
import { logger } from "./logger.js";

/* ═══════════════════════ Types ═══════════════════════ */

interface FactSource {
  sectionId: string;
  sectionTitle: string;
  standardSection: string | null;
  text: string;
  isSynopsis: boolean;
}

interface ExtractedFact {
  factKey: string;
  category: string;
  value: string;
  confidence: number;
  sources: FactSource[];
  hasContradiction: boolean;
  description: string;
  llmValue: string;
  llmConfidence: number;
  qaValue: string | null;
  qaConfidence: number;
}

const EXCLUDED_SECTION_PREFIXES = ["overview", "admin", "appendix"];
const SYNOPSIS_PREFIX = "synopsis";
const LOW_CONFIDENCE_THRESHOLD = 0.6;

/**
 * Примерное количество символов на один токен для смешанного RU/EN текста.
 * Для русского языка токенизаторы (BPE) дают ~2–3 символа/токен,
 * для английского ~4. Значение 3 — консервативный общий множитель.
 */
const CHARS_PER_TOKEN = 3;

/**
 * Резерв токенов на системный промпт + список фактов + буфер ответа LLM.
 * Системный промпт + 60 фактов с описаниями ≈ 2 500 токенов,
 * плюс 3 500 токенов на ответ (JSON с найденными фактами).
 */
const FACT_EXTRACTION_PROMPT_OVERHEAD_TOKENS = 6_000;

/**
 * Резерв токенов для QA-шага: системный промпт + сводка фактов ≈ 800 токенов,
 * плюс 700 токенов на ответ.
 */
const FACT_EXTRACTION_QA_PROMPT_OVERHEAD_TOKENS = 1_500;

async function getMaxDocumentChars(): Promise<number> {
  const cfg = await llmGetConfig("fact_extraction");
  return getInputBudgetChars(cfg);
}

async function getMaxQaContextChars(): Promise<number> {
  const cfg = await llmGetConfig("fact_extraction_qa");
  return getInputBudgetChars(cfg);
}

/* ═══════════════════════ Entry point ═══════════════════════ */

export async function extractFactsForVersion(versionId: string) {
  logger.info("[facts] Starting fact extraction", { versionId });

  const version = await prisma.documentVersion.findUniqueOrThrow({
    where: { id: versionId },
    include: {
      document: { include: { study: true } },
      sections: {
        orderBy: { order: "asc" },
        include: { contentBlocks: { orderBy: { order: "asc" } } },
      },
    },
  });

  const isProtocol = version.document.type === "protocol";
  if (!isProtocol) {
    logger.info("[facts] Skipping fact extraction: non-protocol document", { docType: version.document.type });
    return;
  }

  const phaseNormalized = (version.document.study.phase || "").toUpperCase().replace(/\s/g, "");
  const isBioequivalence = phaseNormalized === "I" || phaseNormalized === "I/II";

  // 1. Собрать секции (исключая overview, admin, appendix)
  const relevantSections = version.sections.filter((s) => {
    if (!s.standardSection) return true;
    return !EXCLUDED_SECTION_PREFIXES.some((prefix) =>
      s.standardSection!.startsWith(prefix)
    );
  });

  if (relevantSections.length === 0) {
    logger.info("[facts] No relevant sections found");
    return;
  }

  // 2. Подготовить текст документа с маркерами секций
  const maxDocumentChars = await getMaxDocumentChars();
  logger.info("[facts] Document text budget", { maxDocumentChars });
  const documentText = buildDocumentText(relevantSections, maxDocumentChars);

  // 3. Загрузить реестр фактов, отфильтровать по типу исследования
  const allFacts = loadFactRegistry();
  const targetFacts = allFacts.filter((f) => {
    if (f.category === "bioequivalence" && !isBioequivalence) return false;
    return true;
  });

  // 4. Извлечь факты через LLM
  const extracted = await llmExtractFacts(documentText, targetFacts, relevantSections);
  logger.info("[facts] LLM extracted facts", { count: extracted.length });

  // 5. QA для низкоуверенных фактов
  const lowConfidence = extracted.filter((f) => f.confidence < LOW_CONFIDENCE_THRESHOLD && f.confidence > 0);
  if (lowConfidence.length > 0) {
    logger.info("[facts] QA check for low-confidence facts", { count: lowConfidence.length });
    await qaCheckFacts(lowConfidence, documentText);
  }

  // 6. Определить ненайденные факты
  const foundKeys = new Set(extracted.map((f) => `${f.category}.${f.factKey}`));
  const notFoundFacts = targetFacts.filter(
    (f) => !foundKeys.has(`${f.category}.${f.factKey}`)
  );

  // 7. Сохранить в БД
  await persistFacts(versionId, extracted, notFoundFacts);
  logger.info("[facts] Saved facts", { foundCount: extracted.length, notFoundCount: notFoundFacts.length });
}

/* ═══════════════════════ Document text builder ═══════════════════════ */

function buildDocumentText(
  sections: {
    id: string;
    title: string;
    standardSection: string | null;
    contentBlocks: { content: string }[];
  }[],
  maxChars: number
): string {
  const parts: string[] = [];
  let totalChars = 0;

  for (const section of sections) {
    const isSynopsis = section.standardSection?.startsWith(SYNOPSIS_PREFIX) ?? false;
    const marker = isSynopsis ? "[SYNOPSIS]" : `[SECTION: ${section.title}]`;
    const sectionText = section.contentBlocks.map((b) => b.content).join("\n");

    const chunk = `\n${marker}\n${sectionText}\n`;

    if (totalChars + chunk.length > maxChars) {
      const remaining = maxChars - totalChars;
      if (remaining > 200) parts.push(chunk.slice(0, remaining));
      break;
    }

    parts.push(chunk);
    totalChars += chunk.length;
  }

  return parts.join("");
}

/* ═══════════════════════ LLM Extraction ═══════════════════════ */

async function llmExtractFacts(
  documentText: string,
  targetFacts: FactRegistryEntry[],
  sections: {
    id: string;
    title: string;
    standardSection: string | null;
    contentBlocks: { content: string }[];
  }[]
): Promise<ExtractedFact[]> {
  const factList = targetFacts.map((f) => {
    const labels = [...f.labelsRu, ...f.labelsEn].join(", ");
    return `- ${f.category}.${f.factKey}: ${f.description} (тип: ${f.valueType}; метки: ${labels})`;
  }).join("\n");

  const systemPrompt = `Ты — эксперт по клинической документации. Извлеки факты из протокола клинического исследования.

ПРАВИЛА:
1. Для каждого факта из списка найди его значение в документе.
2. Ищи каждый факт во ВСЕХ релевантных местах документа — если факт встречается несколько раз, перечисли все места.
3. Секции [SYNOPSIS] имеют ВЫСШИЙ ПРИОРИТЕТ — если факт найден в Synopsis, его значение считается основным.
4. Если один и тот же факт найден в разных местах с РАЗНЫМИ значениями, отметь has_contradiction=true.
5. Для каждого найденного места укажи название секции и фрагмент текста-источника (до 200 символов).
6. Уверенность (confidence) — число от 0.0 до 1.0, отражающее точность извлечения.
7. Если факт НЕ найден, НЕ включай его в ответ.

Верни СТРОГО JSON (без markdown, без комментариев):
{
  "facts": [
    {
      "fact_key": "category.key",
      "value": "извлечённое значение",
      "confidence": 0.95,
      "sources": [
        {"section_title": "название секции", "text": "фрагмент текста-источника"}
      ],
      "has_contradiction": false
    }
  ]
}`;

  const userPrompt = `ДОКУМЕНТ:\n${documentText}\n\nСПИСОК ФАКТОВ ДЛЯ ИЗВЛЕЧЕНИЯ:\n${factList}`;

  try {
    const raw = await llmAsk("fact_extraction", systemPrompt, userPrompt);

    return parseLlmExtractionResponse(raw, targetFacts, sections);
  } catch (err) {
    logger.error("[facts] LLM extraction error", { error: String(err) });
    return [];
  }
}

function parseLlmExtractionResponse(
  raw: string,
  targetFacts: FactRegistryEntry[],
  sections: {
    id: string;
    title: string;
    standardSection: string | null;
  }[]
): ExtractedFact[] {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];

    const data = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(data.facts)) return [];

    const factMap = new Map(
      targetFacts.map((f) => [`${f.category}.${f.factKey}`, f])
    );

    return data.facts
      .filter((f: any) => f.fact_key && f.value !== undefined && f.value !== null && f.value !== "")
      .map((f: any) => {
        const fullKey = f.fact_key as string;
        const dotIdx = fullKey.indexOf(".");
        const category = dotIdx > -1 ? fullKey.slice(0, dotIdx) : "";
        const factKey = dotIdx > -1 ? fullKey.slice(dotIdx + 1) : fullKey;
        const registry = factMap.get(fullKey);

        const sources: FactSource[] = (f.sources ?? []).map((s: any) => {
          const matched = sections.find(
            (sec) =>
              sec.title.toLowerCase().includes((s.section_title ?? "").toLowerCase()) ||
              (s.section_title ?? "").toLowerCase().includes(sec.title.toLowerCase())
          );

          return {
            sectionId: matched?.id ?? "",
            sectionTitle: s.section_title ?? "",
            standardSection: matched?.standardSection ?? null,
            text: (s.text ?? "").slice(0, 500),
            isSynopsis: matched?.standardSection?.startsWith(SYNOPSIS_PREFIX) ?? false,
          };
        });

        const conf = typeof f.confidence === "number"
          ? Math.min(Math.max(f.confidence, 0), 1)
          : 0.5;
        const val = String(f.value);

        return {
          factKey,
          category,
          value: val,
          confidence: conf,
          sources,
          hasContradiction: f.has_contradiction === true,
          description: registry?.description ?? "",
          llmValue: val,
          llmConfidence: conf,
          qaValue: null,
          qaConfidence: 0,
        };
      });
  } catch (err) {
    logger.warn("[facts] Failed to parse LLM extraction response", { response: (raw ?? "").slice(0, 300) });
    return [];
  }
}

/* ═══════════════════════ QA Check (Yandex LLM) ═══════════════════════ */

async function qaCheckFacts(
  facts: ExtractedFact[],
  documentText: string
): Promise<void> {
  const factsSummary = facts.map((f) => {
    const srcTexts = f.sources.map((s) => `"${s.text}"`).join("; ");
    return `- ${f.category}.${f.factKey}: значение="${f.value}", уверенность=${f.confidence}, источники: ${srcTexts}`;
  }).join("\n");

  const maxQaContextChars = await getMaxQaContextChars();
  const contextSnippet = documentText.slice(0, maxQaContextChars);

  const systemPrompt = `Ты — QA-аудитор извлечения фактов из клинического протокола.
Тебе даны факты с низкой уверенностью извлечения. Проверь каждый:
1. Правильно ли извлечено значение?
2. Соответствует ли текст-источник указанному значению?
3. Если значение неверно, предложи правильное значение.

Верни СТРОГО JSON массив:
[
  {
    "fact_key": "category.key",
    "correct": true/false,
    "corrected_value": "исправленное значение (если correct=false)",
    "new_confidence": 0.8
  }
]`;

  const userPrompt = `ФАКТЫ ДЛЯ ПРОВЕРКИ:\n${factsSummary}\n\nКОНТЕКСТ ДОКУМЕНТА (фрагмент):\n${contextSnippet}`;

  try {
    const raw = await llmAsk("fact_extraction_qa", systemPrompt, userPrompt);

    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return;

    const corrections = JSON.parse(jsonMatch[0]) as any[];

    for (const correction of corrections) {
      const key = correction.fact_key as string;
      const fact = facts.find((f) => `${f.category}.${f.factKey}` === key);
      if (!fact) continue;

      const qaConf = typeof correction.new_confidence === "number"
        ? Math.min(Math.max(correction.new_confidence, 0), 1)
        : fact.confidence;

      if (correction.correct === false && correction.corrected_value) {
        const correctedVal = String(correction.corrected_value);
        fact.qaValue = correctedVal;
        fact.qaConfidence = qaConf;
        fact.value = correctedVal;
      } else {
        fact.qaValue = fact.value;
        fact.qaConfidence = qaConf;
      }

      fact.confidence = qaConf;
    }
  } catch (err) {
    logger.warn("[facts] QA check error", { error: String(err) });
  }
}

/* ═══════════════════════ Persist to DB ═══════════════════════ */

async function persistFacts(
  versionId: string,
  extracted: ExtractedFact[],
  notFound: FactRegistryEntry[]
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.fact.deleteMany({ where: { docVersionId: versionId } });

    for (const fact of extracted) {
      const isBE = fact.category === "bioequivalence";
      await tx.fact.create({
        data: {
          docVersionId: versionId,
          factKey: fact.factKey,
          factCategory: fact.category,
          description: fact.description,
          value: fact.value,
          confidence: fact.confidence,
          factClass: isBE ? "phase_specific" : "general",
          sources: fact.sources as any,
          hasContradiction: fact.hasContradiction,
          status: "extracted",
          llmValue: fact.llmValue,
          llmConfidence: fact.llmConfidence,
          qaValue: fact.qaValue,
          qaConfidence: fact.qaConfidence,
        },
      });
    }

    for (const def of notFound) {
      const isBE = def.category === "bioequivalence";
      await tx.fact.create({
        data: {
          docVersionId: versionId,
          factKey: def.factKey,
          factCategory: def.category,
          description: def.description,
          value: "",
          confidence: 0,
          factClass: isBE ? "phase_specific" : "general",
          sources: [],
          hasContradiction: false,
          status: "not_found",
        },
      });
    }
  });
}
