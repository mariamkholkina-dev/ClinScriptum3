/**
 * Reprocess golden samples ТОЛЬКО parse + classify_sections.
 * Пропускает extract_facts, soa_detection, intra_doc_audit — эти этапы жгут
 * LLM-токены, а baseline f1 от classification зависит только от parse + classify.
 *
 * Используй когда нужно перемерить эффект изменений в taxonomy/classifier и не
 * платить за audit/facts.
 *
 * Запуск (внутри workers контейнера):
 *   docker compose -f docker-compose.prod.yml exec -w /app workers \
 *     npx tsx apps/workers/scripts/reprocess-golden-samples-classify-only.ts
 *
 * Опции:
 *   --tenant=<uuid>     default: 00000000-0000-0000-0000-000000000002 (Golden Set)
 *   --limit=N           обработать только первые N samples
 */

import { prisma, resolveActiveBundle } from "@clinscriptum/db";
import { handleParseDocument } from "../src/handlers/parse-document.js";
import { handleClassifySections } from "../src/handlers/classify-sections.js";

const GOLDEN_SET_TENANT_ID = "00000000-0000-0000-0000-000000000002";

interface Args {
  tenantId: string;
  limit?: number;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (key: string) => {
    const arg = argv.find((a) => a.startsWith(`--${key}=`));
    return arg ? arg.slice(key.length + 3) : undefined;
  };
  const limitStr = get("limit");
  return {
    tenantId: get("tenant") ?? GOLDEN_SET_TENANT_ID,
    limit: limitStr ? parseInt(limitStr, 10) : undefined,
  };
}

async function main() {
  const args = parseArgs();

  console.log("=== Reprocess Golden Samples (classify-only) ===");
  console.log(`Tenant: ${args.tenantId}`);
  console.log("");

  const samples = await prisma.goldenSample.findMany({
    where: { tenantId: args.tenantId },
    include: {
      documents: {
        include: {
          documentVersion: {
            select: { id: true, versionLabel: true, status: true, document: { select: { studyId: true } } },
          },
        },
      },
    },
  });

  if (samples.length === 0) {
    console.error(`No golden samples found for tenant ${args.tenantId}`);
    process.exit(1);
  }

  const samplesToProcess = args.limit ? samples.slice(0, args.limit) : samples;
  const versions: { id: string; studyId: string; name: string }[] = [];
  for (const s of samplesToProcess) {
    for (const doc of s.documents) {
      versions.push({
        id: doc.documentVersion.id,
        studyId: doc.documentVersion.document.studyId,
        name: s.name,
      });
    }
  }
  console.log(`Will reprocess ${versions.length} document versions:`);
  for (const v of versions) console.log(`  - ${v.name} → ${v.id.slice(0, 8)}`);
  console.log("");

  const bundleId = await resolveActiveBundle(args.tenantId);
  console.log(`Bundle: ${bundleId}\n`);

  let okCount = 0;
  let errCount = 0;

  for (const v of versions) {
    console.log(`\n=== ${v.name} (${v.id.slice(0, 8)}) ===`);
    try {
      await prisma.$transaction([
        prisma.processingStep.deleteMany({ where: { processingRun: { docVersionId: v.id } } }),
        prisma.processingRun.deleteMany({ where: { docVersionId: v.id } }),
        prisma.finding.deleteMany({ where: { docVersionId: v.id } }),
        prisma.fact.deleteMany({ where: { docVersionId: v.id } }),
        prisma.soaCell.deleteMany({ where: { soaTable: { docVersionId: v.id } } }),
        prisma.soaTable.deleteMany({ where: { docVersionId: v.id } }),
        prisma.contentBlock.deleteMany({ where: { section: { docVersionId: v.id } } }),
        prisma.section.deleteMany({ where: { docVersionId: v.id } }),
        prisma.documentVersion.update({ where: { id: v.id }, data: { status: "parsing" } }),
      ]);
      console.log("  cleared old runs/sections/findings");

      await handleParseDocument({ versionId: v.id });
      console.log("  parse done");

      await prisma.documentVersion.update({ where: { id: v.id }, data: { status: "classifying_sections" } });
      const run = await prisma.processingRun.create({
        data: {
          studyId: v.studyId,
          docVersionId: v.id,
          type: "section_classification" as any,
          status: "queued",
          ruleSetBundleId: bundleId,
        },
      });
      await handleClassifySections({ processingRunId: run.id, operatorReviewEnabled: false });
      console.log("  classify done");

      await prisma.documentVersion.update({ where: { id: v.id }, data: { status: "ready" } });
      okCount++;
    } catch (err) {
      console.error(`  ERROR: ${String(err)}`);
      await prisma.documentVersion.update({ where: { id: v.id }, data: { status: "error" } }).catch(() => {});
      errCount++;
    }
  }

  console.log(`\n=== DONE: ${okCount} ok, ${errCount} errors ===`);
  await prisma.$disconnect();
  process.exit(errCount > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
