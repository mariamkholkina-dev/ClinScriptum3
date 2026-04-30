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
    }));

    if (blocks.length > 0) {
      await tx.contentBlock.createMany({ data: blocks });
    }

    if (s.children?.length > 0) {
      await saveSectionsBatch(tx, docVersionId, s.children, counter);
    }
  }
}
