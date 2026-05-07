/**
 * Reprocess DocumentVersions stuck in `status=error` after bulk-upload-corpus,
 * caused by `file_url` storing the full MinIO URL instead of the storage key
 * (parse-document expects key, not URL).
 *
 * Idempotent: skips versions where file_url is already a clean key.
 *
 * Usage (inside workers container):
 *   npx tsx apps/workers/scripts/reprocess-bulk-error-versions.ts \
 *     --tenant-id=<uuid> [--study-id=<uuid>] [--limit=N] [--dry-run]
 *
 * Flow per version:
 *   1. Strip `<scheme>://<host>/<bucket>/` prefix from file_url → leaves just
 *      the key `<tenant>/<doc>/v1.docx` (matches what's actually in MinIO).
 *   2. Set status='uploading' (reset).
 *   3. Run handleParseDocument + handleClassifySections in-process.
 *   4. status='ready' on success, 'error' on failure (with proper trace this
 *      time — DB row keeps last_error if classify run was created).
 */

import { prisma, resolveActiveBundle } from "@clinscriptum/db";
import { handleParseDocument } from "../src/handlers/parse-document.js";
import { handleClassifySections } from "../src/handlers/classify-sections.js";

interface Args {
  tenantId: string;
  studyId?: string;
  limit?: number;
  dryRun: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (key: string) => argv.find((a) => a.startsWith(`--${key}=`))?.slice(key.length + 3);
  const has = (key: string) => argv.includes(`--${key}`);
  const tenantId = get("tenant-id");
  if (!tenantId) {
    console.error("ERROR: --tenant-id=<uuid> is required");
    process.exit(1);
  }
  const limitStr = get("limit");
  return {
    tenantId,
    studyId: get("study-id"),
    limit: limitStr ? parseInt(limitStr, 10) : undefined,
    dryRun: has("dry-run"),
  };
}

/**
 * Strip `<scheme>://<host>[:<port>]/<bucket>/` prefix from `fileUrl` if present,
 * leaving only the storage key. If already a key — return as is.
 */
function normalizeKey(fileUrl: string): string {
  const m = fileUrl.match(/^https?:\/\/[^/]+\/[^/]+\/(.+)$/);
  return m ? m[1] : fileUrl;
}

async function main() {
  const args = parseArgs();
  console.log("=== Reprocess bulk-upload error versions ===");
  console.log(`Tenant: ${args.tenantId}`);
  if (args.studyId) console.log(`Study:  ${args.studyId}`);
  console.log(`Dry run: ${args.dryRun}\n`);

  const where: Record<string, unknown> = {
    status: "error",
    document: {
      study: { tenantId: args.tenantId, ...(args.studyId ? { id: args.studyId } : {}) },
    },
  };

  const versions = await prisma.documentVersion.findMany({
    where,
    include: {
      document: { select: { id: true, title: true, studyId: true } },
    },
    orderBy: { createdAt: "asc" },
    take: args.limit,
  });

  if (versions.length === 0) {
    console.log("No error versions found — nothing to do.");
    return;
  }
  console.log(`Found ${versions.length} error versions; processing...\n`);

  const activeBundleId = !args.dryRun ? await resolveActiveBundle(args.tenantId) : null;

  let fixedCount = 0;
  let stillErrorCount = 0;

  for (let i = 0; i < versions.length; i++) {
    const v = versions[i];
    const idx = `[${i + 1}/${versions.length}]`;
    const title = v.document.title;
    const newKey = normalizeKey(v.fileUrl);
    const needsKeyFix = newKey !== v.fileUrl;

    try {
      if (args.dryRun) {
        console.log(
          `${idx} [dry-run] ${title} — fix file_url=${needsKeyFix ? "yes" : "no"}, would re-parse`,
        );
        continue;
      }

      // 1. Normalize file_url + reset status
      await prisma.documentVersion.update({
        where: { id: v.id },
        data: {
          fileUrl: newKey,
          status: "uploading",
        },
      });

      // 2. Re-parse
      await handleParseDocument({ versionId: v.id });

      // 3. Re-classify
      await prisma.documentVersion.update({
        where: { id: v.id },
        data: { status: "classifying_sections" },
      });
      const run = await prisma.processingRun.create({
        data: {
          studyId: v.document.studyId,
          docVersionId: v.id,
          type: "section_classification",
          status: "queued",
          ruleSetBundleId: activeBundleId,
        },
      });
      await handleClassifySections({ processingRunId: run.id, operatorReviewEnabled: false });

      // 4. Mark ready
      await prisma.documentVersion.update({
        where: { id: v.id },
        data: { status: "ready" },
      });

      fixedCount++;
      console.log(`${idx} ✓ ${title} → parse + classify done`);
    } catch (err) {
      stillErrorCount++;
      await prisma.documentVersion
        .update({ where: { id: v.id }, data: { status: "error" } })
        .catch(() => {});
      console.error(`${idx} ERR ${title}: ${String(err).slice(0, 200)}`);
    }
  }

  console.log("\n=== Done ===");
  console.log(`Fixed:        ${fixedCount}`);
  console.log(`Still error:  ${stillErrorCount}`);
}

main()
  .catch((err) => {
    console.error("FATAL:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
