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
          classificationComment: true,
          isFalseHeading: true,
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

    return prisma.section.update({
      where: { id: sectionId },
      data: { isFalseHeading },
    });
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
