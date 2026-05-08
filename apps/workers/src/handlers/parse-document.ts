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

    await prisma.contentBlock.deleteMany({
      where: { section: { docVersionId: version.id } },
    });
    await prisma.section.deleteMany({ where: { docVersionId: version.id } });

    await saveSections(version.id, parsed.sections, null);

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
