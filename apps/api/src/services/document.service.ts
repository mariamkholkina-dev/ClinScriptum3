import { prisma } from "@clinscriptum/db";
import { storage } from "../lib/storage.js";
import { enqueueJob } from "../lib/queue.js";
import { DomainError } from "./errors.js";
import { requireTenantResource } from "./tenant-guard.js";
import { logger } from "../lib/logger.js";

export const documentService = {
  async listAll(tenantId: string) {
    return prisma.documentVersion.findMany({
      where: { document: { study: { tenantId } } },
      include: {
        document: {
          include: {
            study: { select: { id: true, title: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  },

  async listByStudy(tenantId: string, studyId: string) {
    const study = await prisma.study.findFirst({
      where: { id: studyId, tenantId },
    });
    requireTenantResource(study, tenantId);

    return prisma.document.findMany({
      where: { studyId },
      include: { versions: { orderBy: { versionNumber: "desc" } } },
      orderBy: { createdAt: "desc" },
    });
  },

  async create(
    tenantId: string,
    input: { studyId: string; type: "protocol" | "icf" | "ib" | "csr"; title: string },
  ) {
    const study = await prisma.study.findFirst({
      where: { id: input.studyId, tenantId },
    });
    requireTenantResource(study, tenantId);

    if (input.type !== "protocol") {
      const hasProtocol = await prisma.document.findFirst({
        where: { studyId: input.studyId, type: "protocol" },
      });
      if (!hasProtocol) {
        throw new DomainError(
          "PRECONDITION_FAILED",
          "Protocol must be uploaded first (URS-068)",
        );
      }
    }

    return prisma.document.create({
      data: {
        studyId: input.studyId,
        type: input.type,
        title: input.title,
      },
    });
  },

  async getUploadUrl(
    tenantId: string,
    documentId: string,
    versionLabel?: string,
  ) {
    const doc = await prisma.document.findFirst({
      where: { id: documentId },
      include: { study: true, versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
    });
    requireTenantResource(doc, tenantId, (d) => d.study.tenantId);

    const nextVersion = (doc.versions[0]?.versionNumber ?? 0) + 1;
    const key = `${tenantId}/${doc.studyId}/${doc.id}/v${nextVersion}.docx`;

    const version = await prisma.documentVersion.create({
      data: {
        documentId: doc.id,
        versionNumber: nextVersion,
        versionLabel: versionLabel || `v${nextVersion}.0`,
        fileUrl: key,
        status: "uploading",
      },
    });

    return { versionId: version.id, storageKey: key };
  },

  async deleteVersion(tenantId: string, versionId: string) {
    const version = await prisma.documentVersion.findUnique({
      where: { id: versionId },
      include: { document: { include: { study: true } } },
    });
    requireTenantResource(version, tenantId, (v) => v.document.study.tenantId);

    await prisma.documentVersion.delete({ where: { id: versionId } });
    return { success: true };
  },

  async setCurrentVersion(tenantId: string, versionId: string) {
    const version = await prisma.documentVersion.findUnique({
      where: { id: versionId },
      include: { document: { include: { study: true } } },
    });
    requireTenantResource(version, tenantId, (v) => v.document.study.tenantId);

    await prisma.documentVersion.updateMany({
      where: { documentId: version.documentId },
      data: { isCurrent: false },
    });
    await prisma.documentVersion.update({
      where: { id: versionId },
      data: { isCurrent: true },
    });
    return { success: true };
  },

  async confirmUpload(tenantId: string, versionId: string, fileBuffer: string) {
    const version = await prisma.documentVersion.findUnique({
      where: { id: versionId },
      include: { document: { include: { study: true } } },
    });
    requireTenantResource(version, tenantId, (v) => v.document.study.tenantId);

    const buffer = Buffer.from(fileBuffer, "base64");
    await storage.upload(version.fileUrl, buffer);

    await prisma.documentVersion.update({
      where: { id: version.id },
      data: { status: "parsing" },
    });

    await enqueueJob("run_pipeline", { versionId: version.id });
    logger.info("[pipeline] Enqueued run_pipeline job", { versionId: version.id });

    return { versionId: version.id, status: "parsing" as const };
  },

  async reprocessVersion(tenantId: string, versionId: string) {
    const version = await prisma.documentVersion.findUnique({
      where: { id: versionId },
      include: { document: { include: { study: true } } },
    });
    requireTenantResource(version, tenantId, (v) => v.document.study.tenantId);

    await prisma.$transaction([
      prisma.processingStep.deleteMany({
        where: { processingRun: { docVersionId: versionId } },
      }),
      prisma.processingRun.deleteMany({ where: { docVersionId: versionId } }),
      prisma.finding.deleteMany({ where: { docVersionId: versionId } }),
      prisma.fact.deleteMany({ where: { docVersionId: versionId } }),
      prisma.soaCell.deleteMany({ where: { soaTable: { docVersionId: versionId } } }),
      prisma.soaTable.deleteMany({ where: { docVersionId: versionId } }),
      prisma.contentBlock.deleteMany({ where: { section: { docVersionId: versionId } } }),
      prisma.section.deleteMany({ where: { docVersionId: versionId } }),
      prisma.documentVersion.update({
        where: { id: versionId },
        data: { status: "parsing" },
      }),
    ]);

    logger.info("[reprocess] Cleared history, restarting pipeline", { versionId });

    await enqueueJob("run_pipeline", { versionId });
    logger.info("[pipeline] Enqueued run_pipeline job for reprocess", { versionId });

    return { versionId, status: "parsing" as const };
  },

  async getVersionStatuses(tenantId: string, versionIds: string[]) {
    const versions = await prisma.documentVersion.findMany({
      where: { id: { in: versionIds } },
      select: {
        id: true,
        status: true,
        document: { select: { study: { select: { tenantId: true } } } },
      },
    });
    return versions
      .filter((v) => v.document.study.tenantId === tenantId)
      .map((v) => ({ id: v.id, status: v.status }));
  },

  async getVersion(tenantId: string, versionId: string) {
    const versionBase = await prisma.documentVersion.findUnique({
      where: { id: versionId },
      select: {
        id: true,
        versionNumber: true,
        versionLabel: true,
        status: true,
        document: {
          select: {
            id: true,
            studyId: true,
            type: true,
            title: true,
            study: { select: { id: true, title: true, tenantId: true } },
          },
        },
      },
    });
    requireTenantResource(versionBase, tenantId, (v) => v.document.study.tenantId);

    try {
      const sections = await prisma.section.findMany({
        where: { docVersionId: versionId },
        orderBy: { order: "asc" },
        select: {
          id: true,
          title: true,
          standardSection: true,
          confidence: true,
          classifiedBy: true,
          level: true,
          order: true,
          structureStatus: true,
          classificationStatus: true,
          algoSection: true,
          algoConfidence: true,
          llmSection: true,
          llmConfidence: true,
          structureComment: true,
          classificationComment: true,
          isFalseHeading: true,
          isManual: true,
          manualCreatedById: true,
          sourceAnchor: true,
          contentBlocks: {
            orderBy: { order: "asc" },
            select: { id: true, type: true, content: true, rawHtml: true, order: true },
          },
        },
      });
      return { ...versionBase, sections };
    } catch (err) {
      logger.error("[document.getVersion] Prisma read failed, using raw fallback", {
        error: String(err),
      });
      return { ...versionBase, sections: await this.getVersionSectionsRaw(versionId) };
    }
  },

  async getVersionSectionsRaw(versionId: string) {
    type RawSectionRow = {
      id: string;
      title: string;
      standardSection: string | null;
      confidence: number | null;
      classifiedBy: string | null;
      level: number | null;
      order: number | null;
      structureStatus: string | null;
      classificationStatus: string | null;
      algoSection: string | null;
      algoConfidence: number | null;
      llmSection: string | null;
      llmConfidence: number | null;
      structureComment: string | null;
      classificationComment: string | null;
      isFalseHeading: boolean | null;
    };
    type RawBlockRow = {
      id: string;
      sectionId: string;
      type: string | null;
      content: string;
      rawHtml: string | null;
      order: number | null;
    };

    const rawSections = await prisma.$queryRaw<RawSectionRow[]>`
      SELECT s.id, s.title, s.standard_section AS "standardSection",
             s.confidence, s.classified_by AS "classifiedBy",
             s.level, s."order",
             s.structure_status::text AS "structureStatus",
             s.classification_status::text AS "classificationStatus",
             s.algo_section AS "algoSection",
             s.algo_confidence AS "algoConfidence",
             s.llm_section AS "llmSection",
             s.llm_confidence AS "llmConfidence",
             s.structure_comment AS "structureComment",
             s.classification_comment AS "classificationComment",
             s.is_false_heading AS "isFalseHeading"
      FROM sections s WHERE s.doc_version_id = ${versionId}::uuid
      ORDER BY s."order" ASC
    `;

    const rawBlocks = await prisma.$queryRaw<RawBlockRow[]>`
      SELECT cb.id, cb.section_id AS "sectionId", cb.type::text AS type,
             cb.content, cb.raw_html AS "rawHtml", cb."order"
      FROM content_blocks cb
      INNER JOIN sections s ON s.id = cb.section_id
      WHERE s.doc_version_id = ${versionId}::uuid
      ORDER BY cb."order" ASC
    `;

    const blocksBySection = new Map<string, RawBlockRow[]>();
    for (const block of rawBlocks) {
      const existing = blocksBySection.get(block.sectionId) ?? [];
      existing.push(block);
      blocksBySection.set(block.sectionId, existing);
    }

    const validStatuses = new Set(["validated", "requires_rework", "not_validated"]);
    const validTypes = new Set(["paragraph", "table", "table_cell", "footnote", "list", "image"]);

    return rawSections.map((s) => ({
      id: s.id,
      title: s.title,
      standardSection: s.standardSection,
      confidence: Number(s.confidence ?? 0),
      classifiedBy: s.classifiedBy,
      level: Number(s.level ?? 1),
      order: Number(s.order ?? 0),
      structureStatus: validStatuses.has(s.structureStatus ?? "") ? s.structureStatus : "not_validated",
      classificationStatus: validStatuses.has(s.classificationStatus ?? "") ? s.classificationStatus : "not_validated",
      algoSection: s.algoSection,
      algoConfidence: Number(s.algoConfidence ?? 0),
      llmSection: s.llmSection,
      llmConfidence: Number(s.llmConfidence ?? 0),
      structureComment: s.structureComment,
      classificationComment: s.classificationComment,
      isFalseHeading: Boolean(s.isFalseHeading ?? false),
      contentBlocks: (blocksBySection.get(s.id) ?? []).map((b) => ({
        id: b.id,
        type: validTypes.has(b.type ?? "") ? b.type : "paragraph",
        content: b.content ?? "",
        rawHtml: b.rawHtml,
        order: Number(b.order ?? 0),
      })),
    }));
  },

  async validateAllStructure(tenantId: string, versionId: string) {
    const version = await prisma.documentVersion.findUnique({
      where: { id: versionId },
      include: { document: { include: { study: true } } },
    });
    requireTenantResource(version, tenantId, (v) => v.document.study.tenantId);

    await prisma.section.updateMany({
      where: { docVersionId: versionId },
      data: { structureStatus: "validated" },
    });
    return { success: true };
  },

  async validateAllClassification(tenantId: string, versionId: string) {
    const version = await prisma.documentVersion.findUnique({
      where: { id: versionId },
      include: { document: { include: { study: true } } },
    });
    requireTenantResource(version, tenantId, (v) => v.document.study.tenantId);

    await prisma.section.updateMany({
      where: { docVersionId: versionId },
      data: { classificationStatus: "validated" },
    });
    return { success: true };
  },

  async validateAllSections(tenantId: string, versionId: string) {
    const version = await prisma.documentVersion.findUnique({
      where: { id: versionId },
      include: { document: { include: { study: true } } },
    });
    requireTenantResource(version, tenantId, (v) => v.document.study.tenantId);

    await prisma.section.updateMany({
      where: { docVersionId: versionId },
      data: { structureStatus: "validated", classificationStatus: "validated" },
    });
    return { success: true };
  },

  async updateSectionClassification(
    tenantId: string,
    sectionId: string,
    standardSection: string | null,
    classificationStatus?: "validated" | "not_validated" | "requires_rework",
  ) {
    const section = await prisma.section.findUnique({
      where: { id: sectionId },
      include: { docVersion: { include: { document: { include: { study: true } } } } },
    });
    requireTenantResource(section, tenantId, (s) => s.docVersion.document.study.tenantId);

    return prisma.section.update({
      where: { id: sectionId },
      data: {
        standardSection,
        classificationStatus: classificationStatus ?? section.classificationStatus,
      },
    });
  },

  /**
   * Помечает секцию как ложный заголовок (или снимает пометку).
   *
   * Cascade cleanup при transition false → true:
   *   - Чистит classification поля Section (standardSection, algoSection,
   *     llmSection, confidence'ы, classifiedBy, classificationStatus,
   *     classificationComment) — раз заголовок ложный, его привязка к зоне
   *     теряет смысл.
   *   - Удаляет GoldenAnnotation записи (по sectionKey = title.lower().trim()
   *     + golden_samples этого doc_version'а). GoldenAnnotationDecision удалится
   *     каскадно через FK.
   *   - Удаляет из expected_results.sections (JSON в GoldenSampleStageStatus)
   *     записи с этим title — для всех stages этого sample'а.
   *   - Возвращает дополнительный объект `cleanupSummary` чтобы UI мог
   *     показать «удалено N annotations / M expected entries» в подтверждении.
   *
   * При обратном transition (true → false) ничего не восстанавливаем:
   * следующий reprocess заполнит классификацию автоматически.
   */
  async markSectionFalseHeading(
    tenantId: string,
    sectionId: string,
    isFalseHeading: boolean,
  ) {
    const section = await prisma.section.findUnique({
      where: { id: sectionId },
      include: { docVersion: { include: { document: { include: { study: true } } } } },
    });
    requireTenantResource(section, tenantId, (s) => s.docVersion.document.study.tenantId);

    const transitioning = isFalseHeading === true && !section!.isFalseHeading;
    const sectionKey = section!.title.trim().toLowerCase();

    return prisma.$transaction(async (tx) => {
      // 1. Section update (вкл. cleanup classification если transitioning)
      const updateData: Record<string, unknown> = { isFalseHeading };
      if (transitioning) {
        Object.assign(updateData, {
          standardSection: null,
          algoSection: null,
          algoConfidence: 0,
          llmSection: null,
          llmConfidence: 0,
          classifiedBy: null,
          confidence: 0,
          classificationStatus: "not_validated",
          classificationComment: null,
        });
      }
      const updated = await tx.section.update({
        where: { id: sectionId },
        data: updateData,
      });

      const cleanupSummary = {
        clearedClassification: transitioning,
        deletedAnnotations: 0,
        clearedExpectedEntries: 0,
        clearedStageStatuses: 0,
      };

      if (!transitioning) {
        return { ...updated, cleanupSummary };
      }

      // 2. GoldenAnnotation для этого sectionKey по всем golden_samples
      //    которые ссылаются на ЭТОТ doc_version (через goldenSampleDocuments)
      const annotationsToDelete = await tx.goldenAnnotation.findMany({
        where: {
          sectionKey,
          goldenSample: {
            documents: { some: { documentVersionId: section!.docVersionId } },
          },
        },
        select: { id: true },
      });
      if (annotationsToDelete.length > 0) {
        await tx.goldenAnnotation.deleteMany({
          where: { id: { in: annotationsToDelete.map((a) => a.id) } },
        });
        cleanupSummary.deletedAnnotations = annotationsToDelete.length;
      }

      // 3. expected_results.sections — удалить entry с этим title
      //    (для всех stages: parsing, classification — обе используют sections[])
      const stageStatuses = await tx.goldenSampleStageStatus.findMany({
        where: {
          goldenSample: {
            documents: { some: { documentVersionId: section!.docVersionId } },
          },
        },
      });
      let clearedStageStatuses = 0;
      let clearedExpectedEntries = 0;
      for (const ss of stageStatuses) {
        const expected = (ss.expectedResults ?? {}) as {
          sections?: Array<{ title?: string }>;
        };
        if (!Array.isArray(expected.sections)) continue;
        const before = expected.sections.length;
        expected.sections = expected.sections.filter(
          (s) => (s.title ?? "").trim().toLowerCase() !== sectionKey,
        );
        const removed = before - expected.sections.length;
        if (removed > 0) {
          await tx.goldenSampleStageStatus.update({
            where: { id: ss.id },
            data: { expectedResults: expected as object },
          });
          clearedStageStatuses += 1;
          clearedExpectedEntries += removed;
        }
      }
      cleanupSummary.clearedStageStatuses = clearedStageStatuses;
      cleanupSummary.clearedExpectedEntries = clearedExpectedEntries;

      logger.info("section_false_heading_cascade_cleanup", {
        sectionId,
        sectionKey,
        ...cleanupSummary,
      });

      return { ...updated, cleanupSummary };
    });
  },

  /**
   * Возвращает превью cascade cleanup без выполнения изменений. UI вызывает
   * перед toggle false-heading чтобы показать confirm-диалог если есть
   * annotations от других пользователей или записи в expected.
   */
  async previewFalseHeadingCleanup(
    tenantId: string,
    sectionId: string,
  ) {
    const section = await prisma.section.findUnique({
      where: { id: sectionId },
      include: { docVersion: { include: { document: { include: { study: true } } } } },
    });
    requireTenantResource(section, tenantId, (s) => s.docVersion.document.study.tenantId);

    if (section!.isFalseHeading) {
      // Уже отмечена → cleanup не сработает, ничего не покажем
      return {
        clearedClassification: false,
        annotations: [],
        expectedEntries: 0,
      };
    }

    const sectionKey = section!.title.trim().toLowerCase();

    const annotations = await prisma.goldenAnnotation.findMany({
      where: {
        sectionKey,
        goldenSample: {
          documents: { some: { documentVersionId: section!.docVersionId } },
        },
      },
      include: {
        annotator: { select: { id: true, name: true, email: true } },
      },
    });

    const stageStatuses = await prisma.goldenSampleStageStatus.findMany({
      where: {
        goldenSample: {
          documents: { some: { documentVersionId: section!.docVersionId } },
        },
      },
    });
    let expectedEntries = 0;
    for (const ss of stageStatuses) {
      const expected = (ss.expectedResults ?? {}) as { sections?: Array<{ title?: string }> };
      if (!Array.isArray(expected.sections)) continue;
      expectedEntries += expected.sections.filter(
        (s) => (s.title ?? "").trim().toLowerCase() === sectionKey,
      ).length;
    }

    const hasZone =
      Boolean(section!.standardSection) ||
      Boolean(section!.algoSection) ||
      Boolean(section!.llmSection);

    return {
      clearedClassification: hasZone,
      currentZone: section!.standardSection,
      annotations: annotations.map((a) => ({
        id: a.id,
        proposedZone: a.proposedZone,
        isQuestion: a.isQuestion,
        annotator: a.annotator,
      })),
      expectedEntries,
    };
  },

  /**
   * Изменение уровня заголовка (indent / outdent) с каскадом на поддерево.
   *
   * Поддерево собирается по правилу: все секции с order > S.order, у которых
   * level > S.level — пока не встретится секция с level <= S.level. False-heading
   * секции прозрачны для иерархии (пропускаются — не двигаются и не служат
   * границей), как и в getParentChain/breadcrumb/numbering.
   *
   * Диапазон уровней: [1, 6] (Word H1–H6 convention). Если хоть один член
   * поддерева вышел бы за границы — отклоняем всё (атомарно).
   *
   * False-heading цель — отклоняем: у неё нет осмысленного уровня в иерархии.
   *
   * Classification (standardSection и т.п.) не сбрасывается — зональная
   * классификация title-driven, не level-driven.
   */
  async changeSectionLevel(
    tenantId: string,
    sectionId: string,
    delta: 1 | -1,
  ) {
    const section = await prisma.section.findUnique({
      where: { id: sectionId },
      include: { docVersion: { include: { document: { include: { study: true } } } } },
    });
    requireTenantResource(section, tenantId, (s) => s.docVersion.document.study.tenantId);

    if (section!.isFalseHeading) {
      throw new DomainError(
        "BAD_REQUEST",
        "Cannot change level of false-heading section",
      );
    }

    const all = await prisma.section.findMany({
      where: { docVersionId: section!.docVersionId },
      orderBy: { order: "asc" },
      select: { id: true, level: true, order: true, isFalseHeading: true },
    });

    const startIdx = all.findIndex((s) => s.id === sectionId);
    const subtree: Array<{ id: string; level: number }> = [
      { id: all[startIdx].id, level: all[startIdx].level },
    ];
    for (let i = startIdx + 1; i < all.length; i++) {
      const t = all[i];
      if (t.isFalseHeading) continue;
      if (t.level <= section!.level) break;
      subtree.push({ id: t.id, level: t.level });
    }

    for (const s of subtree) {
      const next = s.level + delta;
      if (next < 1 || next > 6) {
        throw new DomainError(
          "BAD_REQUEST",
          `Resulting level ${next} is out of range [1,6]`,
        );
      }
    }

    await prisma.$transaction(async (tx) => {
      for (const s of subtree) {
        await tx.section.update({
          where: { id: s.id },
          data: { level: s.level + delta },
        });
      }
    });

    logger.info("section_level_changed", {
      sectionId,
      delta,
      affectedCount: subtree.length,
    });

    return { affectedCount: subtree.length };
  },

  /**
   * Manual section creation — annotator adds a section that auto-parser missed.
   *
   * Anchor — гибрид: paragraphIndex (точная позиция в текущем re-parse'е) +
   * textSnippet (substring для fallback после re-parse если paragraphIndex
   * сместился). См. handleParseDocument: при re-parse manual sections
   * сохраняются (isManual=true), а конфликты (auto-found с тем же title) UI
   * подсвечивает на admin-странице /manual-sections для ручного разрешения.
   *
   * `afterSectionId` — опционально: вставить после этой секции (order = thatOrder + 0.5
   * → renumber всех order'ов после save). Если не задан — append в конец.
   * `contentBlockId` — опционально: дополнительная anchor-привязка к конкретному
   * content_block. Сохраняется в sourceAnchor.contentBlockId.
   */
  async addManualSection(
    tenantId: string,
    userId: string,
    input: {
      docVersionId: string;
      title: string;
      level: number;
      paragraphIndex: number;
      textSnippet: string;
      afterSectionId?: string;
      contentBlockId?: string;
    },
  ) {
    if (input.level < 1 || input.level > 5) {
      throw new DomainError("BAD_REQUEST", "level must be 1..5");
    }
    if (!input.title.trim()) {
      throw new DomainError("BAD_REQUEST", "title cannot be empty");
    }

    const version = await prisma.documentVersion.findUnique({
      where: { id: input.docVersionId },
      include: { document: { include: { study: true } } },
    });
    requireTenantResource(version, tenantId, (v) => v.document.study.tenantId);

    let insertOrder: number;
    if (input.afterSectionId) {
      const after = await prisma.section.findUnique({
        where: { id: input.afterSectionId },
        select: { order: true, docVersionId: true },
      });
      if (!after || after.docVersionId !== input.docVersionId) {
        throw new DomainError("BAD_REQUEST", "afterSectionId must belong to the same docVersion");
      }
      insertOrder = after.order + 1;
      // Сдвинуть всех с order >= insertOrder на +1, чтобы освободить место.
      await prisma.section.updateMany({
        where: { docVersionId: input.docVersionId, order: { gte: insertOrder } },
        data: { order: { increment: 1 } },
      });
    } else {
      const max = await prisma.section.aggregate({
        where: { docVersionId: input.docVersionId },
        _max: { order: true },
      });
      insertOrder = (max._max.order ?? -1) + 1;
    }

    const sourceAnchor = {
      paragraphIndex: input.paragraphIndex,
      textSnippet: input.textSnippet.slice(0, 200),
      ...(input.contentBlockId ? { contentBlockId: input.contentBlockId } : {}),
    };

    return prisma.section.create({
      data: {
        docVersionId: input.docVersionId,
        title: input.title.trim(),
        level: input.level,
        order: insertOrder,
        sourceAnchor,
        isManual: true,
        manualCreatedById: userId,
        // Status defaults: not_validated (как для auto sections).
      },
    });
  },

  /**
   * Удаление manual section. Можно удалить ТОЛЬКО isManual=true — auto-found
   * секции защищены (их можно только пометить isFalseHeading=true).
   */
  async deleteManualSection(tenantId: string, sectionId: string) {
    const section = await prisma.section.findUnique({
      where: { id: sectionId },
      include: { docVersion: { include: { document: { include: { study: true } } } } },
    });
    requireTenantResource(section, tenantId, (s) => s.docVersion.document.study.tenantId);

    if (!section!.isManual) {
      throw new DomainError(
        "BAD_REQUEST",
        "Cannot delete auto-detected section. Use markSectionFalseHeading to hide it.",
      );
    }

    const removedOrder = section!.order;

    // Cascade: contentBlocks удалятся через relation.
    await prisma.section.delete({ where: { id: sectionId } });

    // Сжать order'ы сзади чтобы убрать дыру.
    await prisma.section.updateMany({
      where: { docVersionId: section!.docVersionId, order: { gt: removedOrder } },
      data: { order: { decrement: 1 } },
    });

    return { deleted: true };
  },

  async getTaxonomy(tenantId: string) {
    const ruleSet = await prisma.ruleSet.findFirst({
      where: {
        type: "section_classification",
        OR: [{ tenantId }, { tenantId: null }],
      },
      orderBy: { tenantId: { sort: "desc", nulls: "last" } },
      include: {
        versions: {
          where: { isActive: true },
          include: { rules: true },
          take: 1,
        },
      },
    });
    if (!ruleSet?.versions[0]) return [];
    return ruleSet.versions[0].rules.map((r) => ({
      name: r.name,
      pattern: r.pattern,
      config: r.config as Record<string, unknown>,
    }));
  },
};
