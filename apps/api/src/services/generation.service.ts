import { prisma } from "@clinscriptum/db";
import { DomainError } from "./errors.js";
import { requireTenantResource } from "./tenant-guard.js";
import { logger } from "../lib/logger.js";
import {
  runDocGeneration,
  getDefaultTemplate,
  type TemplateSectionDef,
} from "../lib/doc-generation.js";

export const generationService = {
  /* ═══════════════ Templates ═══════════════ */

  async listTemplates(tenantId: string, docType: "icf" | "csr") {
    const templates = await prisma.docTemplate.findMany({
      where: { tenantId, docType },
      orderBy: { createdAt: "desc" },
    });
    return templates.map((t) => ({
      id: t.id,
      name: t.name,
      docType: t.docType,
      sections: t.sections as unknown as TemplateSectionDef[],
      createdAt: t.createdAt,
    }));
  },

  async createTemplate(
    tenantId: string,
    input: {
      name: string;
      docType: "icf" | "csr";
      sections: { title: string; standardSection: string | null; order: number }[];
    },
  ) {
    const template = await prisma.docTemplate.create({
      data: {
        tenantId,
        name: input.name,
        docType: input.docType,
        sections: input.sections as any,
      },
    });
    return { id: template.id };
  },

  async deleteTemplate(tenantId: string, templateId: string) {
    const template = await prisma.docTemplate.findUnique({
      where: { id: templateId },
    });
    requireTenantResource(template, tenantId);

    await prisma.docTemplate.delete({ where: { id: templateId } });
    return { success: true };
  },

  /* ═══════════════ Generation ═══════════════ */

  async startGeneration(
    tenantId: string,
    input: {
      protocolVersionId: string;
      docType: "icf" | "csr";
      templateId?: string;
    },
  ) {
    const version = await prisma.documentVersion.findUnique({
      where: { id: input.protocolVersionId },
      include: { document: { include: { study: true } } },
    });
    requireTenantResource(version, tenantId, (v) => v.document.study.tenantId);

    if (version.document.type !== "protocol") {
      throw new DomainError("BAD_REQUEST", "Source must be a protocol");
    }

    let templateSections: TemplateSectionDef[];

    if (input.templateId) {
      const template = await prisma.docTemplate.findUnique({
        where: { id: input.templateId },
      });
      requireTenantResource(template, tenantId);

      if (template.docType !== input.docType) {
        throw new DomainError("BAD_REQUEST", "Template type mismatch");
      }
      templateSections = template.sections as unknown as TemplateSectionDef[];
    } else {
      templateSections = getDefaultTemplate(input.docType);
    }

    const generatedDoc = await prisma.generatedDoc.create({
      data: {
        protocolVersionId: input.protocolVersionId,
        templateId: input.templateId ?? null,
        docType: input.docType,
        status: "generating",
        sections: {
          create: templateSections.map((s) => ({
            title: s.title,
            standardSection: s.standardSection,
            order: s.order,
            status: "pending",
          })),
        },
      },
    });

    runDocGeneration(generatedDoc.id).catch((err) =>
      logger.error(`[generation] Background error for ${generatedDoc.id}:`, { error: String(err) }),
    );

    return { generatedDocId: generatedDoc.id };
  },

  async getGeneratedDoc(tenantId: string, generatedDocId: string) {
    const doc = await prisma.generatedDoc.findUnique({
      where: { id: generatedDocId },
      include: {
        sections: { orderBy: { order: "asc" } },
        protocolVersion: {
          include: { document: { include: { study: true } } },
        },
      },
    });
    requireTenantResource(doc, tenantId, (d) => d.protocolVersion.document.study.tenantId);

    return {
      id: doc.id,
      docType: doc.docType,
      status: doc.status,
      createdAt: doc.createdAt,
      studyTitle: doc.protocolVersion.document.study.title,
      protocolTitle: doc.protocolVersion.document.title,
      protocolLabel: doc.protocolVersion.versionLabel ?? `v${doc.protocolVersion.versionNumber}`,
      sections: doc.sections.map((s) => ({
        id: s.id,
        title: s.title,
        standardSection: s.standardSection,
        order: s.order,
        content: s.content,
        status: s.status,
        qaFindings: s.qaFindings,
      })),
    };
  },

  async updateSectionContent(tenantId: string, sectionId: string, content: string) {
    const section = await prisma.generatedDocSection.findUnique({
      where: { id: sectionId },
      include: {
        generatedDoc: {
          include: {
            protocolVersion: { include: { document: { include: { study: true } } } },
          },
        },
      },
    });
    requireTenantResource(
      section,
      tenantId,
      (s) => s.generatedDoc.protocolVersion.document.study.tenantId,
    );

    await prisma.generatedDocSection.update({
      where: { id: sectionId },
      data: { content },
    });

    return { success: true };
  },

  async listGeneratedDocs(tenantId: string, protocolVersionId: string) {
    const version = await prisma.documentVersion.findUnique({
      where: { id: protocolVersionId },
      include: { document: { include: { study: true } } },
    });
    requireTenantResource(version, tenantId, (v) => v.document.study.tenantId);

    const docs = await prisma.generatedDoc.findMany({
      where: { protocolVersionId },
      orderBy: { createdAt: "desc" },
      include: { sections: { select: { id: true, status: true } } },
    });

    return docs.map((d) => ({
      id: d.id,
      docType: d.docType,
      status: d.status,
      createdAt: d.createdAt,
      totalSections: d.sections.length,
      completedSections: d.sections.filter((s) => s.status === "completed").length,
    }));
  },
};
