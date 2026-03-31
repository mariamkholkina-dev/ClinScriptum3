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
import { llmAsk } from "./llm-gateway.js";
import {
  loadFactRegistry,
  type FactRegistryEntry,
} from "../data/fact-registry.js";

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
}

const EXCLUDED_SECTION_PREFIXES = ["overview", "admin", "appendix"];
const SYNOPSIS_PREFIX = "synopsis";
const LOW_CONFIDENCE_THRESHOLD = 0.6;
const MAX_DOCUMENT_CHARS = 120_000;

/* ═══════════════════════ Entry point ═══════════════════════ */

export async function extractFactsForVersion(versionId: string) {
  console.log(`[facts] Starting fact extraction for version ${versionId}`);

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
    console.log(`[facts] Skipping fact extraction: document type is "${version.document.type}"`);
    return;
  }

  const isBioequivalence = version.document.study.phase === "I" ||
    version.document.study.phase === "I_II";

  // 1. Собрать секции (исключая overview, admin, appendix)
  const relevantSections = version.sections.filter((s) => {
    if (!s.standardSection) return true;
    return !EXCLUDED_SECTION_PREFIXES.some((prefix) =>
      s.standardSection!.startsWith(prefix)
    );
  });

  if (relevantSections.length === 0) {
    console.log("[facts] No relevant sections found");
    return;
  }

  // 2. Подготовить текст документа с маркерами секций
  const documentText = buildDocumentText(relevantSections);

  // 3. Загрузить реестр фактов, отфильтровать по типу исследования
  const allFacts = loadFactRegistry();
  const targetFacts = allFacts.filter((f) => {
    if (f.category === "bioequivalence" && !isBioequivalence) return false;
    return true;
  });

  // 4. Извлечь факты через LLM
  const extracted = await llmExtractFacts(documentText, targetFacts, relevantSections);
  console.log(`[facts] LLM extracted ${extracted.length} facts`);

  // 5. QA для низкоуверенных фактов
  const lowConfidence = extracted.filter((f) => f.confidence < LOW_CONFIDENCE_THRESHOLD && f.confidence > 0);
  if (lowConfidence.length > 0) {
    console.log(`[facts] QA check for ${lowConfidence.length} low-confidence facts`);
    await qaCheckFacts(lowConfidence, documentText);
  }

  // 6. Определить ненайденные факты
  const foundKeys = new Set(extracted.map((f) => `${f.category}.${f.factKey}`));
  const notFoundFacts = targetFacts.filter(
    (f) => !foundKeys.has(`${f.category}.${f.factKey}`)
  );

  // 7. Сохранить в БД
  await persistFacts(versionId, extracted, notFoundFacts);
  console.log(`[facts] Saved ${extracted.length} found + ${notFoundFacts.length} not-found facts`);
}

/* ═══════════════════════ Document text builder ═══════════════════════ */

function buildDocumentText(
  sections: {
    id: string;
    title: string;
    standardSection: string | null;
    contentBlocks: { content: string }[];
  }[]
): string {
  const parts: string[] = [];
  let totalChars = 0;

  for (const section of sections) {
    const isSynopsis = section.standardSection?.startsWith(SYNOPSIS_PREFIX) ?? false;
    const marker = isSynopsis ? "[SYNOPSIS]" : `[SECTION: ${section.title}]`;
    const sectionText = section.contentBlocks.map((b) => b.content).join("\n");

    const chunk = `\n${marker}\n${sectionText}\n`;

    if (totalChars + chunk.length > MAX_DOCUMENT_CHARS) {
      const remaining = MAX_DOCUMENT_CHARS - totalChars;
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
    console.error("[facts] LLM extraction error:", err);
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

        return {
          factKey,
          category,
          value: String(f.value),
          confidence: typeof f.confidence === "number"
            ? Math.min(Math.max(f.confidence, 0), 1)
            : 0.5,
          sources,
          hasContradiction: f.has_contradiction === true,
          description: registry?.description ?? "",
        };
      });
  } catch (err) {
    console.warn("[facts] Failed to parse LLM extraction response:", (raw ?? "").slice(0, 300));
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

  const contextSnippet = documentText.slice(0, 60_000);

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

      if (correction.correct === false && correction.corrected_value) {
        fact.value = String(correction.corrected_value);
      }

      if (typeof correction.new_confidence === "number") {
        fact.confidence = Math.min(Math.max(correction.new_confidence, 0), 1);
      }
    }
  } catch (err) {
    console.warn("[facts] QA check error:", err);
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
