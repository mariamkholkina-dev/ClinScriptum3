import { prisma } from "@clinscriptum/db";
import { parseDocx } from "@clinscriptum/doc-parser";
import { createStorageProvider } from "../api-shared/storage.js";
import { logger } from "../lib/logger.js";

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
    const parsed = await parseDocx(buffer);

    await prisma.documentVersion.update({
      where: { id: version.id },
      data: {
        digitalTwin: JSON.parse(JSON.stringify(parsed)),
      },
    });

    // Sprint 7e: сохраняем экспертские isFalseHeading-флаги через reprocess.
    // Без этого после reprocess все ручные пометки «не заголовок» теряются —
    // STP-baseline 2026-05-05 показал 224 lonely-extra секций в STP именно из-за
    // этого: эксперт ранее помечал глубоко-нумерованные подзаголовки как
    // false_heading, но reprocess через parse-document обнулял флаг.
    const previousFalseHeadings = await prisma.section.findMany({
      where: { docVersionId: version.id, isFalseHeading: true },
      select: { title: true, level: true },
    });
    const falseHeadingKeys = new Set(
      previousFalseHeadings.map((s) => `${s.title.trim().toLowerCase()}::${s.level}`),
    );

    await prisma.contentBlock.deleteMany({
      where: { section: { docVersionId: version.id } },
    });
    await prisma.section.deleteMany({ where: { docVersionId: version.id } });

    await saveSections(version.id, parsed.sections, null);

    // Восстановить isFalseHeading для секций которые matched по (title, level).
    // Match свободный — разные order'ы у одинаковых title не различаем; если
    // в новой версии добавились новые секции с теми же title и level, флаг
    // тоже выставится — это false-positive, но эксперт может снять через UI.
    let restoredFlags = 0;
    if (falseHeadingKeys.size > 0) {
      const newSections = await prisma.section.findMany({
        where: { docVersionId: version.id },
        select: { id: true, title: true, level: true },
      });
      const idsToFlag: string[] = [];
      for (const s of newSections) {
        if (falseHeadingKeys.has(`${s.title.trim().toLowerCase()}::${s.level}`)) {
          idsToFlag.push(s.id);
        }
      }
      if (idsToFlag.length > 0) {
        await prisma.section.updateMany({
          where: { id: { in: idsToFlag } },
          data: { isFalseHeading: true },
        });
        restoredFlags = idsToFlag.length;
      }
    }

    logger.info("Parsed document", {
      versionId: version.id,
      sections: parsed.sections.length,
      tables: parsed.metadata.totalTables,
      footnotes: parsed.metadata.totalFootnotes,
      restoredFalseHeadings: restoredFlags,
      previousFalseHeadings: previousFalseHeadings.length,
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
