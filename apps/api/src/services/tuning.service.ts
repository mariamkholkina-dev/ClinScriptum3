import { prisma } from "@clinscriptum/db";
import { DomainError } from "./errors.js";
import { requireTenantResource } from "./tenant-guard.js";

/* ═══════════════ Helper: populate verdicts ═══════════════ */

async function populateSectionVerdicts(sessionId: string, docVersionId: string) {
  const sections = await prisma.section.findMany({
    where: { docVersionId },
    orderBy: { order: "asc" },
  });

  await prisma.sectionVerdict.createMany({
    data: sections.map((s) => ({
      tuningSessionId: sessionId,
      sectionId: s.id,
      algoResult: s.algoSection,
      algoConfidence: s.algoConfidence,
      llmResult: s.llmSection,
      llmConfidence: s.llmConfidence,
    })),
  });
}

async function populateFactVerdicts(sessionId: string, docVersionId: string) {
  const facts = await prisma.fact.findMany({
    where: { docVersionId },
    orderBy: { factKey: "asc" },
  });

  await prisma.factVerdict.createMany({
    data: facts.map((f) => ({
      tuningSessionId: sessionId,
      factId: f.id,
      factKey: f.factKey,
      llmValue: f.value,
      llmConfidence: f.confidence,
    })),
  });
}

async function populateSoaVerdicts(sessionId: string, docVersionId: string) {
  const soaTables = await prisma.soaTable.findMany({
    where: { docVersionId },
  });

  await prisma.soaVerdict.createMany({
    data: soaTables.map((t) => ({
      tuningSessionId: sessionId,
      soaTableId: t.id,
    })),
  });
}

async function populateGenerationVerdicts(sessionId: string, generatedDocId: string) {
  const sections = await prisma.generatedDocSection.findMany({
    where: { generatedDocId },
    orderBy: { order: "asc" },
  });

  await prisma.generationVerdict.createMany({
    data: sections.map((s) => ({
      tuningSessionId: sessionId,
      generatedDocSectionId: s.id,
      sectionTitle: s.title,
      standardSection: s.standardSection,
    })),
  });
}

/* ═══════════════ Helper: compute stats ═══════════════ */

async function computeSessionStats(sessionId: string, type: string) {
  if (type === "section_classification") {
    const verdicts = await prisma.sectionVerdict.findMany({
      where: { tuningSessionId: sessionId },
    });
    const total = verdicts.length;
    const reviewed = verdicts.filter((v) => v.reviewedAt).length;
    const algoCorrect = verdicts.filter((v) => v.auditorAgreedWith === "algo").length;
    const llmCorrect = verdicts.filter((v) => v.auditorAgreedWith === "llm").length;
    const custom = verdicts.filter((v) => v.auditorAgreedWith === "custom").length;

    return { total, reviewed, algoCorrect, llmCorrect, custom };
  }

  if (type === "fact_extraction") {
    const verdicts = await prisma.factVerdict.findMany({
      where: { tuningSessionId: sessionId },
    });
    const total = verdicts.length;
    const reviewed = verdicts.filter((v) => v.reviewedAt).length;
    const correct = verdicts.filter((v) => v.isCorrect === true).length;
    const incorrect = verdicts.filter((v) => v.isCorrect === false).length;

    return { total, reviewed, correct, incorrect };
  }

  if (type === "soa_detection") {
    const verdicts = await prisma.soaVerdict.findMany({
      where: { tuningSessionId: sessionId },
    });
    const total = verdicts.length;
    const reviewed = verdicts.filter((v) => v.reviewedAt).length;
    const correctDetections = verdicts.filter((v) => v.isCorrectDetection === true).length;
    const falseDetections = verdicts.filter((v) => v.isCorrectDetection === false).length;

    return { total, reviewed, correctDetections, falseDetections };
  }

  if (type === "icf_generation") {
    const verdicts = await prisma.generationVerdict.findMany({
      where: { tuningSessionId: sessionId },
    });
    const total = verdicts.length;
    const reviewed = verdicts.filter((v) => v.reviewedAt).length;
    const ratings = verdicts.filter((v) => v.rating > 0).map((v) => v.rating);
    const avgRating = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;
    const withComments = verdicts.filter((v) => v.comment && v.comment.length > 0).length;
    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of ratings) distribution[r] = (distribution[r] ?? 0) + 1;

    return { total, reviewed, avgRating: Math.round(avgRating * 100) / 100, withComments, distribution };
  }

  return {};
}

/* ═══════════════ Helper: regression runners ═══════════════ */

async function runSectionRegression(session: { id: string; docVersionId: string }) {
  const verdicts = await prisma.sectionVerdict.findMany({
    where: { tuningSessionId: session.id, auditorChoice: { not: null } },
  });

  const sections = await prisma.section.findMany({
    where: { docVersionId: session.docVersionId },
  });
  const sectionMap = new Map(sections.map((s) => [s.id, s]));

  const details: Array<{ itemId: string; expected: string; current: string }> = [];
  let matches = 0;

  for (const v of verdicts) {
    const section = sectionMap.get(v.sectionId);
    const current = section?.standardSection ?? "";
    const expected = v.auditorChoice ?? "";

    if (current === expected) {
      matches++;
    } else {
      details.push({ itemId: v.sectionId, expected, current });
    }
  }

  return {
    sessionId: session.id,
    docVersionId: session.docVersionId,
    totalItems: verdicts.length,
    matches,
    mismatches: verdicts.length - matches,
    accuracy: verdicts.length > 0 ? matches / verdicts.length : 0,
    details,
  };
}

async function runFactRegression(session: { id: string; docVersionId: string }) {
  const verdicts = await prisma.factVerdict.findMany({
    where: { tuningSessionId: session.id, isCorrect: { not: null } },
  });

  const facts = await prisma.fact.findMany({
    where: { docVersionId: session.docVersionId },
  });
  const factMap = new Map(facts.map((f) => [f.id, f]));

  const details: Array<{ itemId: string; expected: string; current: string }> = [];
  let matches = 0;

  for (const v of verdicts) {
    const fact = v.factId ? factMap.get(v.factId) : null;
    const currentValue = fact?.value ?? "";

    if (v.isCorrect && currentValue === (fact?.value ?? "")) {
      matches++;
    } else if (!v.isCorrect) {
      details.push({
        itemId: v.factKey,
        expected: v.auditorValue ?? "[marked incorrect]",
        current: currentValue,
      });
    } else {
      matches++;
    }
  }

  return {
    sessionId: session.id,
    docVersionId: session.docVersionId,
    totalItems: verdicts.length,
    matches,
    mismatches: verdicts.length - matches,
    accuracy: verdicts.length > 0 ? matches / verdicts.length : 0,
    details,
  };
}

async function runSoaRegression(session: { id: string; docVersionId: string }) {
  const verdicts = await prisma.soaVerdict.findMany({
    where: { tuningSessionId: session.id, isCorrectDetection: { not: null } },
  });

  const details: Array<{ itemId: string; expected: string; current: string }> = [];
  let matches = 0;

  const currentSoaTables = await prisma.soaTable.findMany({
    where: { docVersionId: session.docVersionId },
  });
  const currentIds = new Set(currentSoaTables.map((t) => t.id));

  for (const v of verdicts) {
    const stillExists = v.soaTableId ? currentIds.has(v.soaTableId) : false;

    if (v.isCorrectDetection && stillExists) {
      matches++;
    } else if (!v.isCorrectDetection && !stillExists) {
      matches++;
    } else {
      details.push({
        itemId: v.soaTableId ?? "unknown",
        expected: v.isCorrectDetection ? "should_exist" : "should_not_exist",
        current: stillExists ? "exists" : "missing",
      });
    }
  }

  return {
    sessionId: session.id,
    docVersionId: session.docVersionId,
    totalItems: verdicts.length,
    matches,
    mismatches: verdicts.length - matches,
    accuracy: verdicts.length > 0 ? matches / verdicts.length : 0,
    details,
  };
}

async function runGenerationRegression(session: { id: string; docVersionId: string }) {
  const verdicts = await prisma.generationVerdict.findMany({
    where: { tuningSessionId: session.id, reviewedAt: { not: null } },
  });

  const GOOD_THRESHOLD = 4;
  const details: Array<{ itemId: string; expected: string; current: string }> = [];
  let matches = 0;

  for (const v of verdicts) {
    if (v.rating >= GOOD_THRESHOLD) {
      matches++;
    } else {
      details.push({
        itemId: v.generatedDocSectionId,
        expected: `rating >= ${GOOD_THRESHOLD}`,
        current: `rating ${v.rating}${v.comment ? ` — ${v.comment.slice(0, 80)}` : ""}`,
      });
    }
  }

  return {
    sessionId: session.id,
    docVersionId: session.docVersionId,
    totalItems: verdicts.length,
    matches,
    mismatches: verdicts.length - matches,
    accuracy: verdicts.length > 0 ? matches / verdicts.length : 0,
    details,
  };
}

/* ═══════════════ Service ═══════════════ */

type TuningType = "section_classification" | "fact_extraction" | "soa_detection" | "icf_generation";
type TuningSessionStatus = "processing" | "pending_review" | "in_review" | "completed";

export const tuningService = {
  async createSession(
    tenantId: string,
    userId: string,
    input: { docVersionId: string; type: TuningType; generatedDocId?: string },
  ) {
    const version = await prisma.documentVersion.findUnique({
      where: { id: input.docVersionId },
      include: { document: { include: { study: true } } },
    });
    requireTenantResource(version, tenantId, (v) => v.document.study.tenantId);

    if (input.type === "icf_generation") {
      if (!input.generatedDocId) {
        throw new DomainError("BAD_REQUEST", "generatedDocId is required for icf_generation tuning");
      }
      const genDoc = await prisma.generatedDoc.findUnique({
        where: { id: input.generatedDocId },
      });
      if (!genDoc || genDoc.status !== "completed") {
        throw new DomainError("BAD_REQUEST", "Generated document must be completed");
      }
    } else {
      const isParsed = ["parsed", "ready", "intra_audit", "inter_audit"].includes(version.status);
      if (!isParsed) {
        throw new DomainError(
          "BAD_REQUEST",
          `Document version must be fully processed (current status: ${version.status})`,
        );
      }
    }

    const session = await prisma.tuningSession.create({
      data: {
        tenantId,
        userId,
        docVersionId: input.docVersionId,
        type: input.type,
        status: "pending_review",
        generatedDocId: input.generatedDocId ?? null,
      },
    });

    if (input.type === "section_classification") {
      await populateSectionVerdicts(session.id, input.docVersionId);
    } else if (input.type === "fact_extraction") {
      await populateFactVerdicts(session.id, input.docVersionId);
    } else if (input.type === "soa_detection") {
      await populateSoaVerdicts(session.id, input.docVersionId);
    } else if (input.type === "icf_generation") {
      await populateGenerationVerdicts(session.id, input.generatedDocId!);
    }

    return session;
  },

  async listSessions(
    tenantId: string,
    input: { type?: TuningType; status?: TuningSessionStatus; goldenOnly?: boolean },
  ) {
    const where: any = { tenantId };
    if (input.type) where.type = input.type;
    if (input.status) where.status = input.status;
    if (input.goldenOnly) where.isGoldenSet = true;

    return prisma.tuningSession.findMany({
      where,
      include: {
        docVersion: {
          select: {
            id: true,
            versionLabel: true,
            versionNumber: true,
            document: { select: { id: true, title: true, type: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  },

  async getSession(tenantId: string, sessionId: string) {
    const session = await prisma.tuningSession.findUnique({
      where: { id: sessionId },
      include: {
        docVersion: {
          select: {
            id: true,
            versionLabel: true,
            versionNumber: true,
            document: { select: { id: true, title: true, type: true } },
          },
        },
        generatedDoc: {
          select: {
            id: true,
            docType: true,
            status: true,
            createdAt: true,
          },
        },
      },
    });
    requireTenantResource(session, tenantId);
    return session;
  },

  /* ═══════════════ Section Verdicts ═══════════════ */

  async getSectionVerdicts(tenantId: string, sessionId: string) {
    const session = await prisma.tuningSession.findUnique({
      where: { id: sessionId },
    });
    requireTenantResource(session, tenantId);

    const verdicts = await prisma.sectionVerdict.findMany({
      where: { tuningSessionId: sessionId },
      orderBy: { algoConfidence: "asc" },
    });

    const sectionIds = verdicts.map((v) => v.sectionId);
    const sections = await prisma.section.findMany({
      where: { id: { in: sectionIds } },
      include: {
        contentBlocks: { orderBy: { order: "asc" }, take: 3 },
      },
    });
    const sectionMap = new Map(sections.map((s) => [s.id, s]));

    return verdicts.map((v) => {
      const section = sectionMap.get(v.sectionId);
      return {
        ...v,
        sectionTitle: section?.title ?? "",
        sectionLevel: section?.level ?? 0,
        sectionOrder: section?.order ?? 0,
        contentPreview: section?.contentBlocks
          .map((b) => b.content)
          .join(" ")
          .slice(0, 300) ?? "",
      };
    });
  },

  async saveSectionVerdict(
    tenantId: string,
    input: { verdictId: string; auditorChoice: string; auditorAgreedWith: "algo" | "llm" | "custom"; comment?: string },
  ) {
    const verdict = await prisma.sectionVerdict.findUnique({
      where: { id: input.verdictId },
      include: { tuningSession: true },
    });
    requireTenantResource(verdict, tenantId, (v) => v.tuningSession.tenantId);

    return prisma.sectionVerdict.update({
      where: { id: input.verdictId },
      data: {
        auditorChoice: input.auditorChoice,
        auditorAgreedWith: input.auditorAgreedWith,
        comment: input.comment ?? null,
        reviewedAt: new Date(),
      },
    });
  },

  /* ═══════════════ Fact Verdicts ═══════════════ */

  async getFactVerdicts(tenantId: string, sessionId: string) {
    const session = await prisma.tuningSession.findUnique({
      where: { id: sessionId },
    });
    requireTenantResource(session, tenantId);

    const verdicts = await prisma.factVerdict.findMany({
      where: { tuningSessionId: sessionId },
      orderBy: { factKey: "asc" },
    });

    const factIds = verdicts.map((v) => v.factId).filter(Boolean) as string[];
    const facts = await prisma.fact.findMany({
      where: { id: { in: factIds } },
    });
    const factMap = new Map(facts.map((f) => [f.id, f]));

    return verdicts.map((v) => {
      const fact = v.factId ? factMap.get(v.factId) : null;
      return {
        ...v,
        factCategory: fact?.factCategory ?? "",
        factDescription: fact?.description ?? "",
        sources: fact?.sources ?? [],
      };
    });
  },

  async saveFactVerdict(
    tenantId: string,
    input: { verdictId: string; isCorrect: boolean; auditorValue?: string; comment?: string },
  ) {
    const verdict = await prisma.factVerdict.findUnique({
      where: { id: input.verdictId },
      include: { tuningSession: true },
    });
    requireTenantResource(verdict, tenantId, (v) => v.tuningSession.tenantId);

    return prisma.factVerdict.update({
      where: { id: input.verdictId },
      data: {
        isCorrect: input.isCorrect,
        auditorValue: input.auditorValue ?? null,
        comment: input.comment ?? null,
        reviewedAt: new Date(),
      },
    });
  },

  /* ═══════════════ SOA Verdicts ═══════════════ */

  async getSoaVerdicts(tenantId: string, sessionId: string) {
    const session = await prisma.tuningSession.findUnique({
      where: { id: sessionId },
    });
    requireTenantResource(session, tenantId);

    const verdicts = await prisma.soaVerdict.findMany({
      where: { tuningSessionId: sessionId },
    });

    const soaTableIds = verdicts.map((v) => v.soaTableId).filter(Boolean) as string[];
    const soaTables = await prisma.soaTable.findMany({
      where: { id: { in: soaTableIds } },
      include: { cells: { orderBy: [{ rowIndex: "asc" }, { colIndex: "asc" }] } },
    });
    const tableMap = new Map(soaTables.map((t) => [t.id, t]));

    return verdicts.map((v) => {
      const table = v.soaTableId ? tableMap.get(v.soaTableId) : null;
      return {
        ...v,
        tableTitle: table?.title ?? "",
        soaScore: table?.soaScore ?? 0,
        cellCount: table?.cells.length ?? 0,
      };
    });
  },

  async saveSoaVerdict(
    tenantId: string,
    input: { verdictId: string; isCorrectDetection: boolean; comment?: string },
  ) {
    const verdict = await prisma.soaVerdict.findUnique({
      where: { id: input.verdictId },
      include: { tuningSession: true },
    });
    requireTenantResource(verdict, tenantId, (v) => v.tuningSession.tenantId);

    return prisma.soaVerdict.update({
      where: { id: input.verdictId },
      data: {
        isCorrectDetection: input.isCorrectDetection,
        comment: input.comment ?? null,
        reviewedAt: new Date(),
      },
    });
  },

  /* ═══════════════ Generation Verdicts ═══════════════ */

  async getGenerationVerdicts(tenantId: string, sessionId: string) {
    const session = await prisma.tuningSession.findUnique({
      where: { id: sessionId },
    });
    requireTenantResource(session, tenantId);

    const verdicts = await prisma.generationVerdict.findMany({
      where: { tuningSessionId: sessionId },
      orderBy: { sectionTitle: "asc" },
    });

    const sectionIds = verdicts.map((v) => v.generatedDocSectionId);
    const sections = await prisma.generatedDocSection.findMany({
      where: { id: { in: sectionIds } },
    });
    const sectionMap = new Map(sections.map((s) => [s.id, s]));

    return verdicts.map((v) => {
      const section = sectionMap.get(v.generatedDocSectionId);
      return {
        ...v,
        content: section?.content ?? "",
        order: section?.order ?? 0,
        sectionStatus: section?.status ?? "unknown",
        qaFindings: section?.qaFindings ?? [],
      };
    });
  },

  async saveGenerationVerdict(
    tenantId: string,
    input: { verdictId: string; rating: number; comment?: string },
  ) {
    const verdict = await prisma.generationVerdict.findUnique({
      where: { id: input.verdictId },
      include: { tuningSession: true },
    });
    requireTenantResource(verdict, tenantId, (v) => v.tuningSession.tenantId);

    return prisma.generationVerdict.update({
      where: { id: input.verdictId },
      data: {
        rating: input.rating,
        comment: input.comment ?? null,
        reviewedAt: new Date(),
      },
    });
  },

  async getGeneratedDocsForTuning(tenantId: string, protocolVersionId: string) {
    const version = await prisma.documentVersion.findUnique({
      where: { id: protocolVersionId },
      include: { document: { include: { study: true } } },
    });
    requireTenantResource(version, tenantId, (v) => v.document.study.tenantId);

    const docs = await prisma.generatedDoc.findMany({
      where: {
        protocolVersionId,
        status: "completed",
      },
      orderBy: { createdAt: "desc" },
      include: { sections: { select: { id: true, status: true } } },
    });

    return docs.map((d) => ({
      id: d.id,
      docType: d.docType,
      status: d.status,
      createdAt: d.createdAt,
      totalSections: d.sections.length,
    }));
  },

  /* ═══════════════ Session lifecycle ═══════════════ */

  async completeSession(tenantId: string, sessionId: string) {
    const session = await prisma.tuningSession.findUnique({
      where: { id: sessionId },
    });
    requireTenantResource(session, tenantId);

    if (session.status === "completed") {
      throw new DomainError("BAD_REQUEST", "Session already completed");
    }

    const stats = await computeSessionStats(session.id, session.type);

    return prisma.tuningSession.update({
      where: { id: sessionId },
      data: {
        status: "completed",
        completedAt: new Date(),
        stats,
      },
    });
  },

  async toggleGoldenSet(tenantId: string, sessionId: string) {
    const session = await prisma.tuningSession.findUnique({
      where: { id: sessionId },
    });
    requireTenantResource(session, tenantId);

    if (session.status !== "completed") {
      throw new DomainError("BAD_REQUEST", "Only completed sessions can be marked as golden set");
    }

    return prisma.tuningSession.update({
      where: { id: sessionId },
      data: { isGoldenSet: !session.isGoldenSet },
    });
  },

  async listGoldenSets(tenantId: string, input: { type?: TuningType }) {
    const where: any = { tenantId, isGoldenSet: true };
    if (input.type) where.type = input.type;

    return prisma.tuningSession.findMany({
      where,
      include: {
        docVersion: {
          select: {
            id: true,
            versionLabel: true,
            versionNumber: true,
            document: { select: { id: true, title: true, type: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  },

  async runRegression(tenantId: string, type: TuningType) {
    const goldenSessions = await prisma.tuningSession.findMany({
      where: {
        tenantId,
        isGoldenSet: true,
        type,
        status: "completed",
      },
    });

    if (goldenSessions.length === 0) {
      throw new DomainError("BAD_REQUEST", "No golden sets found for this type");
    }

    const results: Array<{
      sessionId: string;
      docVersionId: string;
      totalItems: number;
      matches: number;
      mismatches: number;
      accuracy: number;
      details: Array<{ itemId: string; expected: string; current: string }>;
    }> = [];

    for (const session of goldenSessions) {
      if (type === "section_classification") {
        results.push(await runSectionRegression(session));
      } else if (type === "fact_extraction") {
        results.push(await runFactRegression(session));
      } else if (type === "soa_detection") {
        results.push(await runSoaRegression(session));
      } else if (type === "icf_generation") {
        results.push(await runGenerationRegression(session));
      }
    }

    const totalItems = results.reduce((s, r) => s + r.totalItems, 0);
    const totalMatches = results.reduce((s, r) => s + r.matches, 0);

    return {
      type,
      goldenSetCount: goldenSessions.length,
      totalItems,
      totalMatches,
      overallAccuracy: totalItems > 0 ? totalMatches / totalItems : 0,
      sessions: results,
    };
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

    if (!ruleSet || ruleSet.versions.length === 0) return [];

    return ruleSet.versions[0].rules.map((r) => {
      const config = r.config as any;
      return {
        key: config.key ?? r.name,
        name: r.name,
        titleRu: config.titleRu ?? r.name,
        type: config.type ?? "zone",
        parentZone: config.parentZone ?? null,
      };
    });
  },

  async getVersionsForTuning(tenantId: string) {
    const versions = await prisma.documentVersion.findMany({
      where: {
        document: { study: { tenantId } },
        status: { in: ["parsed", "ready", "intra_audit", "inter_audit"] },
      },
      include: {
        document: { select: { id: true, title: true, type: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return versions.map((v) => ({
      id: v.id,
      versionNumber: v.versionNumber,
      versionLabel: v.versionLabel,
      status: v.status,
      documentTitle: v.document.title,
      documentType: v.document.type,
    }));
  },
};
