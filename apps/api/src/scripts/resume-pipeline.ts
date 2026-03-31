import { PrismaClient } from "@prisma/client";
import { extractFactsForVersion } from "../lib/fact-extraction.js";
import { detectSoaForVersion } from "../lib/soa-detection.js";

const versionId = process.argv[2];
if (!versionId) {
  console.error("Usage: npx tsx apps/api/src/scripts/resume-pipeline.ts <versionId>");
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  const ver = await prisma.documentVersion.findUnique({
    where: { id: versionId },
    include: { document: { include: { study: true } } },
  });
  if (!ver) throw new Error(`Version ${versionId} not found`);

  console.log(`[resume] Version: ${versionId}, type: ${ver.document.type}, status: ${ver.status}`);

  // Stage 3: Fact extraction
  console.log("[resume] Starting Stage 3 (fact extraction)...");
  await prisma.documentVersion.update({ where: { id: versionId }, data: { status: "extracting_facts" } });

  const factRun = await prisma.processingRun.create({
    data: {
      studyId: ver.document.studyId,
      docVersionId: versionId,
      type: "fact_extraction",
      status: "running",
    },
  });

  try {
    await extractFactsForVersion(versionId);
    await prisma.processingRun.update({ where: { id: factRun.id }, data: { status: "completed" } });
    console.log("[resume] Stage 3 complete");
  } catch (err) {
    console.error("[resume] Stage 3 failed:", err);
    await prisma.processingRun.update({ where: { id: factRun.id }, data: { status: "failed" } }).catch(() => {});
  }

  // Stage 4: SOA detection
  if (ver.document.type === "protocol") {
    console.log("[resume] Starting Stage 4 (SOA detection)...");
    await prisma.documentVersion.update({ where: { id: versionId }, data: { status: "detecting_soa" } });

    const soaRun = await prisma.processingRun.create({
      data: {
        studyId: ver.document.studyId,
        docVersionId: versionId,
        type: "soa_detection",
        status: "running",
      },
    });

    try {
      await detectSoaForVersion(versionId);
      await prisma.processingRun.update({ where: { id: soaRun.id }, data: { status: "completed" } });
      console.log("[resume] Stage 4 complete");
    } catch (err) {
      console.error("[resume] Stage 4 failed:", err);
      await prisma.processingRun.update({ where: { id: soaRun.id }, data: { status: "failed" } }).catch(() => {});
    }
  }

  // Mark as ready
  await prisma.documentVersion.update({ where: { id: versionId }, data: { status: "parsed" } });
  console.log("[resume] Pipeline done, version status: parsed");
}

main().catch((e) => { console.error(e); process.exit(1); });
