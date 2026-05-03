/**
 * Full document processing pipeline handler for BullMQ.
 * Sequences: parse → classify → extract facts → SOA detection → intra-audit.
 */

import { prisma, resolveActiveBundle } from "@clinscriptum/db";
import { detectSoaForVersion } from "@clinscriptum/shared/soa-detection";
import { handleParseDocument } from "./parse-document.js";
import { handleClassifySections } from "./classify-sections.js";
import { handleExtractFacts } from "./extract-facts.js";
import { handleIntraDocAudit } from "./intra-doc-audit.js";
import { verifySoaTablesForVersion } from "../lib/soa-llm-verification.js";
import { logger } from "../lib/logger.js";

export async function handleRunPipeline(data: { versionId: string }) {
  const { versionId } = data;

  try {
    logger.info("[pipeline] Starting", { versionId });

    const versionDoc = await prisma.documentVersion.findUniqueOrThrow({
      where: { id: versionId },
      include: { document: { include: { study: true } } },
    });

    const tenantId = versionDoc.document.study.tenantId;
    const studyId = versionDoc.document.studyId;
    const isProtocol = versionDoc.document.type === "protocol";
    const operatorReviewEnabled = versionDoc.document.study.operatorReviewEnabled;
    const bundleId = await resolveActiveBundle(tenantId);

    logger.info("[pipeline] Resolved bundle", { bundleId, tenantId, operatorReviewEnabled });

    // Stage 1: Parse
    await handleParseDocument({ versionId });
    logger.info("[pipeline] Stage 1 (parse) complete");

    // Stage 2: Classify sections
    await setVersionStatus(versionId, "classifying_sections");
    const classifyRun = await createRun(studyId, versionId, "section_classification", bundleId);
    await handleClassifySections({ processingRunId: classifyRun.id, operatorReviewEnabled });
    logger.info("[pipeline] Stage 2 (classify) complete");

    // Stage 3: Extract facts (protocol only)
    if (isProtocol) {
      await setVersionStatus(versionId, "extracting_facts");
      const factRun = await createRun(studyId, versionId, "fact_extraction", bundleId);
      await handleExtractFacts({ processingRunId: factRun.id, operatorReviewEnabled });
      logger.info("[pipeline] Stage 3 (fact extraction) complete");
    }

    // Stage 4: SOA detection (protocol only)
    if (isProtocol) {
      await setVersionStatus(versionId, "detecting_soa");
      const soaRun = await createRun(studyId, versionId, "soa_detection", bundleId);

      try {
        await detectSoaForVersion(versionId, logger);
        // LLM verification is best-effort (gated by LLM_SOA_VERIFY_ENABLED)
        // and never fails the pipeline — failure leaves the deterministic
        // result intact at verificationLevel=deterministic.
        await verifySoaTablesForVersion(versionId);
        await prisma.processingRun.update({
          where: { id: soaRun.id },
          data: { status: "completed" },
        });
        logger.info("[pipeline] Stage 4 (SOA detection) complete");
      } catch (soaErr) {
        await prisma.processingRun.update({
          where: { id: soaRun.id },
          data: { status: "failed", lastError: String(soaErr) },
        }).catch((updateErr) =>
          logger.error("[pipeline] Failed to update SOA run status", { error: String(updateErr) })
        );
        throw soaErr;
      }
    }

    // Stage 5: Intra-document audit
    await setVersionStatus(versionId, "intra_audit");
    const auditRun = await createRun(studyId, versionId, "intra_doc_audit", bundleId);
    await handleIntraDocAudit({ processingRunId: auditRun.id, operatorReviewEnabled });
    logger.info("[pipeline] Stage 5 (intra-audit) complete");

    await setVersionStatus(versionId, "parsed");
    logger.info("[pipeline] Done", { versionId, bundleId });
  } catch (err) {
    logger.error("[pipeline] Error", { versionId, error: String(err) });
    await setVersionStatus(versionId, "error").catch(() => {});
    throw err;
  }
}

async function setVersionStatus(versionId: string, status: string) {
  await prisma.documentVersion.update({
    where: { id: versionId },
    data: { status: status as any },
  });
}

async function createRun(
  studyId: string,
  docVersionId: string,
  type: string,
  bundleId: string | null,
) {
  return prisma.processingRun.create({
    data: {
      studyId,
      docVersionId,
      type: type as any,
      status: "queued",
      ruleSetBundleId: bundleId,
    },
  });
}
