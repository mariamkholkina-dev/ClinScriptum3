import { prisma } from "@clinscriptum/db";
import { DomainError } from "./errors.js";
import { requireTenantResource } from "./tenant-guard.js";
import {
  diffSections,
  diffFacts,
  analyzeProtocolImpactOnICF,
  analyzeProtocolImpactOnIB,
} from "@clinscriptum/diff-engine";

async function loadVersionWithSections(versionId: string) {
  return prisma.documentVersion.findUnique({
    where: { id: versionId },
    include: {
      document: { include: { study: true } },
      sections: {
        include: { contentBlocks: { orderBy: { order: "asc" } } },
        orderBy: { order: "asc" },
      },
    },
  });
}

function toSectionPayload(
  sections: { id: string; title: string; standardSection: string | null; contentBlocks: { content: string }[] }[],
) {
  return sections.map((s) => ({
    id: s.id,
    title: s.title,
    standardSection: s.standardSection,
    content: s.contentBlocks.map((b) => b.content).join("\n"),
  }));
}

export const comparisonService = {
  async compare(
    tenantId: string,
    oldVersionId: string,
    newVersionId: string,
  ) {
    const [oldVersion, newVersion] = await Promise.all([
      loadVersionWithSections(oldVersionId),
      loadVersionWithSections(newVersionId),
    ]);

    if (!oldVersion || !newVersion) {
      throw new DomainError("NOT_FOUND", "Resource not found");
    }
    requireTenantResource(oldVersion, tenantId, (v) => v.document.study.tenantId);

    const oldSections = toSectionPayload(oldVersion.sections);
    const newSections = toSectionPayload(newVersion.sections);
    const diffResult = diffSections(oldSections, newSections);

    const [oldFacts, newFacts] = await Promise.all([
      prisma.fact.findMany({ where: { docVersionId: oldVersionId } }),
      prisma.fact.findMany({ where: { docVersionId: newVersionId } }),
    ]);

    const factChanges = diffFacts(
      oldFacts.map((f) => ({ factKey: f.factKey, value: f.value })),
      newFacts.map((f) => ({ factKey: f.factKey, value: f.value })),
    );

    return { ...diffResult, factChanges };
  },

  async impactAnalysis(
    tenantId: string,
    oldVersionId: string,
    newVersionId: string,
    targetDocumentId: string,
  ) {
    const [oldVersion, newVersion] = await Promise.all([
      loadVersionWithSections(oldVersionId),
      loadVersionWithSections(newVersionId),
    ]);

    if (!oldVersion || !newVersion) {
      throw new DomainError("NOT_FOUND", "Resource not found");
    }
    requireTenantResource(oldVersion, tenantId, (v) => v.document.study.tenantId);

    const targetDoc = await prisma.document.findFirst({
      where: { id: targetDocumentId, study: { tenantId } },
    });
    if (!targetDoc) {
      throw new DomainError("NOT_FOUND", "Target document not found");
    }

    const oldSections = toSectionPayload(oldVersion.sections);
    const newSections = toSectionPayload(newVersion.sections);
    const diff = diffSections(oldSections, newSections);

    const sourceDoc = { id: oldVersion.documentId, title: oldVersion.document.title };
    const target = { id: targetDoc.id, title: targetDoc.title };

    if (targetDoc.type === "icf") {
      return analyzeProtocolImpactOnICF(diff.sectionDiffs, sourceDoc, target);
    }
    return analyzeProtocolImpactOnIB(diff.sectionDiffs, sourceDoc, target);
  },
};
