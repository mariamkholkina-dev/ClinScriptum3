import { createHash } from "node:crypto";
import { prisma, getEffectiveLlmConfig } from "@clinscriptum/db";
import { parseDocx } from "@clinscriptum/doc-parser";
import type {
  LlmFallbackParagraph,
  LlmDetectedHeading,
} from "@clinscriptum/doc-parser";
import { LLMGateway, type LLMProvider } from "@clinscriptum/llm-gateway";
import { createStorageProvider } from "../api-shared/storage.js";
import { logger } from "../lib/logger.js";

const LLM_FALLBACK_THRESHOLD = 20;
const LLM_PARAGRAPH_TEXT_TRUNCATE = 200;

/**
 * Builds an llmFallback callback wired to the tenant's LLM gateway. Used
 * when rule-based heading detection finds <20 headings — common in
 * poorly-authored DOCX where authors don't apply Heading styles.
 *
 * Best-effort: if no LLM config available, returns no-op (returns []).
 */
function buildLlmHeadingFallback(tenantId: string) {
  return async (
    paragraphs: LlmFallbackParagraph[],
  ): Promise<LlmDetectedHeading[]> => {
    if (paragraphs.length === 0) return [];

    // task id `parse_heading_fallback` — caller может настроить отдельный
    // конфиг. Если нет — падаем на `section_classify` (он точно настроен).
    let llmConfig = await getEffectiveLlmConfig(
      "parse_heading_fallback",
      tenantId,
    ).catch(() => null);
    if (!llmConfig?.apiKey) {
      llmConfig = await getEffectiveLlmConfig(
        "section_classify",
        tenantId,
      ).catch(() => null);
    }
    if (!llmConfig?.apiKey) {
      logger.warn("LLM heading fallback: no LLM config available", { tenantId });
      return [];
    }

    const gateway = new LLMGateway({
      provider: llmConfig.provider as LLMProvider,
      model: llmConfig.model,
      apiKey: llmConfig.apiKey,
      baseUrl: llmConfig.baseUrl || undefined,
      temperature: llmConfig.temperature,
      reasoningMode: llmConfig.reasoningMode,
      timeoutMs: llmConfig.timeoutMs,
    });

    const lines = paragraphs.map((p, i) => {
      const flags: string[] = [];
      if (p.isBold) flags.push("BOLD");
      if (p.fontSize) flags.push(`${p.fontSize}pt`);
      const flagStr = flags.length > 0 ? ` [${flags.join(",")}]` : "";
      return `[${i + 1}]${flagStr} ${p.text.slice(0, LLM_PARAGRAPH_TEXT_TRUNCATE)}`;
    });

    const systemPrompt = `Ты — эксперт по структуре клинических протоколов. Получаешь список параграфов с маркером порядка [N]. Найди ЗАГОЛОВКИ РАЗДЕЛОВ.

Типичные разделы протокола (для ориентира): Введение, Цели исследования, Дизайн исследования, Популяция, Включение/Исключение, Исследуемая терапия, Безопасность, Нежелательные явления, Статистика, Этика, Информированное согласие.

НЕ помечай как заголовок:
- Списки, bullet-points, отдельные подписи и подписи к рисункам
- Footnote-rows (строки начинающиеся с цифры + дефис + lowercase)
- Ячейки таблиц со значениями шкал ("0-7 Норма", "1 - Здоров")
- Ссылки на статьи / нумерованные пункты типа "1. ICH-GCP, 2002"

Уровни иерархии:
- level=1 — главный раздел протокола (Введение, Цели, Дизайн, ...)
- level=2 — подраздел (внутри главного, например "Первичная цель" внутри "Цели")
- level=3 — под-подраздел

Ответь JSON: { "headings": [{ "index": N, "level": 1|2|3 }] }
- index — целое число из квадратных скобок (1-based)
- НЕ возвращай index'ы которых не было во входе
- порядок не важен`;

    let parsedContent: unknown;
    let totalTokens: number | undefined;
    try {
      const response = await gateway.generate({
        system: systemPrompt,
        messages: [{ role: "user", content: lines.join("\n") }],
        maxTokens: Math.min(8000, paragraphs.length * 30 + 500),
        responseFormat: "json",
      });
      totalTokens = response.usage.totalTokens;
      parsedContent = JSON.parse(response.content);
    } catch (err) {
      logger.warn("LLM heading fallback failed", {
        tenantId,
        error: String(err).slice(0, 200),
      });
      return [];
    }

    const obj = parsedContent as Record<string, unknown> | null;
    const heads = (obj?.headings ?? []) as Array<Record<string, unknown>>;
    if (!Array.isArray(heads)) return [];

    const result: LlmDetectedHeading[] = [];
    for (const h of heads) {
      const idx = Number(h.index);
      const level = Number(h.level);
      if (!Number.isInteger(idx) || idx < 1 || idx > paragraphs.length) continue;
      if (!Number.isInteger(level) || level < 1 || level > 9) continue;
      result.push({
        paragraphIndex: paragraphs[idx - 1].paragraphIndex,
        level,
      });
    }

    logger.info("LLM heading fallback detected", {
      inputParagraphs: paragraphs.length,
      detectedHeadings: result.length,
      totalTokens,
    });
    return result;
  };
}

export async function handleParseDocument(data: { versionId: string }) {
  const version = await prisma.documentVersion.findUnique({
    where: { id: data.versionId },
    include: { document: { include: { study: true } } },
  });

  if (!version) throw new Error(`DocumentVersion ${data.versionId} not found`);

  await prisma.documentVersion.update({
    where: { id: version.id },
    data: { status: "parsing" },
  });

  try {
    const storage = createStorageProvider();
    const buffer = await storage.download(version.fileUrl);
    const tenantId = version.document.study.tenantId;

    const parsed = await parseDocx(buffer, {
      llmFallback: buildLlmHeadingFallback(tenantId),
      llmFallbackThreshold: LLM_FALLBACK_THRESHOLD,
    });

    await prisma.documentVersion.update({
      where: { id: version.id },
      data: {
        digitalTwin: JSON.parse(JSON.stringify(parsed)),
      },
    });

    // Сохраняем manual sections (isManual=true) при re-parse: annotator
    // мог добавить разделы которые auto-парсер пропустил, и их нельзя терять
    // при каждом reprocess'е. Удаляем только auto-detected sections.
    await prisma.contentBlock.deleteMany({
      where: { section: { docVersionId: version.id, isManual: false } },
    });
    await prisma.section.deleteMany({
      where: { docVersionId: version.id, isManual: false },
    });

    await saveSections(version.id, parsed.sections, null);

    // После сохранения новых auto-секций пересчитываем `order` так чтобы manual
    // секции встали в правильную позицию по их sourceAnchor.paragraphIndex.
    // Это уже делается в saveSectionsBatch через counter — но manual'ы там не
    // участвуют (они УЖЕ в БД). Поэтому делаем post-fix: read all sections,
    // sort by paragraphIndex (auto) или manualSourceAnchor.paragraphIndex
    // (manual), reassign order.
    await reorderSectionsByAnchor(version.id);

    // Re-link expected sections (golden dataset truth) с реальными после
    // re-parse. paragraphIndex плывёт между парсами, поэтому матчим в 4 шага:
    // paragraphIndex → digest → snippet → title+occurrence.
    await relinkExpectedSections(version.id);

    logger.info("Parsed document", {
      versionId: version.id,
      sections: parsed.sections.length,
      tables: parsed.metadata.totalTables,
      footnotes: parsed.metadata.totalFootnotes,
    });

    return { success: true, metadata: parsed.metadata };
  } catch (error) {
    await prisma.documentVersion.update({
      where: { id: version.id },
      data: { status: "error" },
    });
    throw error;
  }
}

/**
 * После save новых auto-секций пересчитывает `order` так, чтобы manual
 * секции (isManual=true) встали по своему sourceAnchor.paragraphIndex
 * относительно auto-секций.
 *
 * Алгоритм:
 *  1. Загрузить все секции (auto + manual) с их paragraphIndex.
 *     - auto: уже отсортированы по `order` после save (counter-based)
 *     - manual: paragraphIndex из sourceAnchor.paragraphIndex
 *  2. Sort by paragraphIndex (для auto — берём min(paragraphIndex) среди
 *     contentBlocks или anchor поля; для manual — sourceAnchor.paragraphIndex).
 *  3. Reassign sequential order'ы.
 */
async function reorderSectionsByAnchor(docVersionId: string) {
  const sections = await prisma.section.findMany({
    where: { docVersionId },
    select: {
      id: true,
      isManual: true,
      sourceAnchor: true,
      order: true,
    },
  });
  if (sections.length === 0) return;

  // Если manual нет — порядок auto-секций уже правильный, не трогаем.
  const hasManual = sections.some((s) => s.isManual);
  if (!hasManual) return;

  const withParagraphIndex = sections.map((s) => {
    const anchor = (s.sourceAnchor ?? {}) as { paragraphIndex?: number };
    return {
      id: s.id,
      isManual: s.isManual,
      paragraphIndex: typeof anchor.paragraphIndex === "number" ? anchor.paragraphIndex : Number.MAX_SAFE_INTEGER,
      currentOrder: s.order,
    };
  });

  // Sort: by paragraphIndex; ties — auto перед manual (stable-ish);
  // если paragraphIndex отсутствует (manual orphaned после re-parse) —
  // в самый конец.
  withParagraphIndex.sort((a, b) => {
    if (a.paragraphIndex !== b.paragraphIndex) return a.paragraphIndex - b.paragraphIndex;
    if (a.isManual && !b.isManual) return 1;
    if (!a.isManual && b.isManual) return -1;
    return a.currentOrder - b.currentOrder;
  });

  // Применить новые order'ы только если что-то поменялось.
  await prisma.$transaction(
    withParagraphIndex
      .map((s, i) =>
        s.currentOrder !== i
          ? prisma.section.update({ where: { id: s.id }, data: { order: i } })
          : null,
      )
      .filter((q): q is NonNullable<typeof q> => q !== null),
  );
}

async function saveSections(
  docVersionId: string,
  sections: any[],
  _parentId: string | null,
) {
  const counter = { value: 0 };
  await prisma.$transaction(async (tx) => {
    await saveSectionsBatch(tx, docVersionId, sections, counter);
  });
}

async function saveSectionsBatch(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  docVersionId: string,
  sections: any[],
  counter: { value: number },
) {
  for (const s of sections) {
    const section = await tx.section.create({
      data: {
        docVersionId,
        title: s.title,
        level: s.level,
        order: counter.value++,
        sourceAnchor: s.sourceAnchor ?? {},
      },
    });

    const blocks = (s.contentBlocks ?? []).map((cb: any, j: number) => ({
      sectionId: section.id,
      type: cb.type,
      content: cb.content,
      rawHtml: cb.rawHtml,
      order: j,
      sourceAnchor: cb.sourceAnchor ?? {},
      ...(cb.tableAst ? { tableAst: cb.tableAst } : {}),
    }));

    if (blocks.length > 0) {
      await tx.contentBlock.createMany({ data: blocks });
    }

    if (s.children?.length > 0) {
      await saveSectionsBatch(tx, docVersionId, s.children, counter);
    }
  }
}

// ─── Expected-sections re-link ───────────────────────────────
// После re-parse'а sections в БД пересоздаются — а expected_sections
// (эталонная разметка золотых сэмплов) ссылаются на старые id'шники через
// `realSectionId`. Этот хук переmatch'ит каждую expected row с актуальной
// real Section по 4-уровневому fallback'у, чтобы baseline считался по
// «той же» секции даже после структурных правок документа.
//
// Алгоритм матчинга (sequential per expected row):
//   (1) anchor.paragraphIndex → точное совпадение с Section.sourceAnchor.paragraphIndex
//   (2) anchor.contentBlockDigest → sha256 первых 200 chars контента секции
//   (3) anchor.textSnippet → substring search в title (фильтр по level)
//   (4) title + anchor.occurrenceIndex → N-я по счёту секция с таким title
//   (5) ничего → realSectionId=null, matchMethod=null (orphaned, UI помечает)
//
// Worker-package не имеет dep на @clinscriptum/api, поэтому матчинг
// реализован локально через прямой prisma access. Тот же алгоритм
// продублирован в `apps/api/src/services/expectedSection.service.ts:relinkExpectedSections`.
const DIGEST_PREFIX_LENGTH = 200;

interface ExpectedAnchorShape {
  paragraphIndex?: number;
  textSnippet?: string;
  occurrenceIndex?: number;
  contentBlockDigest?: string;
}

function computeContentDigestForReal(section: {
  contentBlocks: Array<{ content: string; order: number }>;
}): string {
  if (section.contentBlocks.length === 0) return "";
  const sorted = [...section.contentBlocks].sort((a, b) => a.order - b.order);
  const joined = sorted
    .map((b) => b.content ?? "")
    .join("\n")
    .slice(0, DIGEST_PREFIX_LENGTH);
  if (!joined.trim()) return "";
  return createHash("sha256").update(joined, "utf8").digest("hex");
}

async function relinkExpectedSections(docVersionId: string): Promise<void> {
  // Find expected_sections that *could* point at this docVersion's sections
  // (path: ExpectedSection → StageStatus → GoldenSample → GoldenSampleDocument).
  const stageStatuses = await prisma.goldenSampleStageStatus.findMany({
    where: {
      goldenSample: { documents: { some: { documentVersionId: docVersionId } } },
    },
    select: { id: true },
  });
  if (stageStatuses.length === 0) return;
  const stageStatusIds = stageStatuses.map((s) => s.id);

  const expectedRows = await prisma.expectedSection.findMany({
    where: { goldenSampleStageStatusId: { in: stageStatusIds } },
  });
  if (expectedRows.length === 0) return;

  const realSections = await prisma.section.findMany({
    where: { docVersionId },
    include: { contentBlocks: { orderBy: { order: "asc" } } },
    orderBy: { order: "asc" },
  });

  const byParagraph = new Map<number, (typeof realSections)[number]>();
  for (const s of realSections) {
    const pi = (s.sourceAnchor as { paragraphIndex?: number } | null)?.paragraphIndex;
    if (typeof pi === "number") byParagraph.set(pi, s);
  }
  const digestToSection = new Map<string, (typeof realSections)[number]>();
  for (const s of realSections) {
    const d = computeContentDigestForReal(s);
    if (d) digestToSection.set(d, s);
  }
  const titleToSections = new Map<string, typeof realSections>();
  for (const s of realSections) {
    const key = s.title.trim().toLowerCase();
    const arr = titleToSections.get(key) ?? [];
    arr.push(s);
    titleToSections.set(key, arr);
  }

  const byMethod = { paragraph: 0, digest: 0, snippet: 0, title_occurrence: 0 };
  let matched = 0;
  let orphaned = 0;

  for (const exp of expectedRows) {
    const anchor = (exp.anchor ?? {}) as ExpectedAnchorShape;
    let match: { id: string; method: keyof typeof byMethod } | null = null;

    if (typeof anchor.paragraphIndex === "number") {
      const hit = byParagraph.get(anchor.paragraphIndex);
      if (hit) match = { id: hit.id, method: "paragraph" };
    }
    if (!match && anchor.contentBlockDigest) {
      const hit = digestToSection.get(anchor.contentBlockDigest);
      if (hit) match = { id: hit.id, method: "digest" };
    }
    if (!match && anchor.textSnippet) {
      const needle = anchor.textSnippet.trim().toLowerCase();
      if (needle.length > 0) {
        const hit = realSections.find(
          (s) => s.level === exp.level && s.title.toLowerCase().includes(needle),
        );
        if (hit) match = { id: hit.id, method: "snippet" };
      }
    }
    if (!match) {
      const arr = titleToSections.get(exp.title.trim().toLowerCase());
      if (arr && arr.length > 0) {
        const idx = anchor.occurrenceIndex ?? 0;
        const hit = arr[idx] ?? arr[0];
        if (hit) match = { id: hit.id, method: "title_occurrence" };
      }
    }

    if (match) {
      matched += 1;
      byMethod[match.method] += 1;
      await prisma.expectedSection.update({
        where: { id: exp.id },
        data: {
          realSectionId: match.id,
          matchMethod: match.method,
          matchedAt: new Date(),
        },
      });
    } else {
      orphaned += 1;
      if (exp.realSectionId !== null) {
        await prisma.expectedSection.update({
          where: { id: exp.id },
          data: { realSectionId: null, matchMethod: null, matchedAt: null },
        });
      }
    }
  }

  logger.info("expected_sections_relinked", {
    docVersionId,
    total: expectedRows.length,
    matched,
    orphaned,
    byMethod,
  });
}
