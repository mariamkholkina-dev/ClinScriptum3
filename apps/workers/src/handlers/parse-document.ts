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
        status: "parsed",
        digitalTwin: JSON.parse(JSON.stringify(parsed)),
      },
    });

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
  orderOffset = 0
) {
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];

    const section = await prisma.section.create({
      data: {
        docVersionId,
        title: s.title,
        level: s.level,
        order: orderOffset + i,
        sourceAnchor: s.sourceAnchor ?? {},
      },
    });

    for (let j = 0; j < (s.contentBlocks ?? []).length; j++) {
      const cb = s.contentBlocks[j];
      await prisma.contentBlock.create({
        data: {
          sectionId: section.id,
          type: cb.type,
          content: cb.content,
          rawHtml: cb.rawHtml,
          order: j,
          sourceAnchor: cb.sourceAnchor ?? {},
        },
      });
    }

    if (s.children?.length > 0) {
      await saveSections(docVersionId, s.children, section.id, 0);
    }
  }
}
