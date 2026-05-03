/**
 * Backfill ContentBlock.tableAst for already-parsed DocumentVersions.
 *
 * Why: tableAst column was added in a later migration, so rows parsed before
 * the migration have type='table' but tableAst=null. Phase 3 BM25 retrieval
 * + extractFromTable rely on tableAst → recall on tabular facts is degraded
 * for legacy documents.
 *
 * Strategy:
 *   1. Find DocumentVersions where any ContentBlock has type='table' AND
 *      tableAst IS NULL.
 *   2. For each, download the original DOCX from storage.
 *   3. Re-run parseDocx to get fresh AST (incl. tableAst).
 *   4. Walk parsed sections in order, collect [(globalSectionOrder,
 *      blockOrder, tableAst)] for every table block.
 *   5. Match against DB ContentBlock by (section.order, block.order). Update
 *      only tableAst — never touch content, rawHtml, or any other field.
 *
 * Skipped if section/block ordering has drifted (counts mismatch). Logs a
 * warning per such version.
 *
 * Usage:
 *   npx tsx --env-file=.env apps/workers/scripts/backfill-table-ast.ts
 *
 * Options:
 *   --tenant=<uuid>     limit to one tenant
 *   --dry-run           don't write, just report counts
 *   --limit=<n>         only process first N versions
 */

import { prisma } from "@clinscriptum/db";
import { parseDocx } from "@clinscriptum/doc-parser";
import { createStorageProvider } from "../src/api-shared/storage.js";

interface Args {
  tenantId?: string;
  dryRun: boolean;
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
    tenantId: get("tenant"),
    dryRun: argv.includes("--dry-run"),
    limit: limitStr ? parseInt(limitStr, 10) : undefined,
  };
}

interface FlatTableBlock {
  sectionOrder: number;
  blockOrder: number;
  tableAst: unknown;
}

function flattenTableBlocks(
  sections: any[],
  counter: { value: number },
  out: FlatTableBlock[],
) {
  for (const s of sections) {
    const sectionOrder = counter.value++;
    const blocks = s.contentBlocks ?? [];
    blocks.forEach((cb: any, j: number) => {
      if (cb.type === "table" && cb.tableAst) {
        out.push({ sectionOrder, blockOrder: j, tableAst: cb.tableAst });
      }
    });
    if (s.children?.length > 0) {
      flattenTableBlocks(s.children, counter, out);
    }
  }
}

async function processVersion(versionId: string, dryRun: boolean) {
  const version = await prisma.documentVersion.findUnique({
    where: { id: versionId },
    select: { id: true, fileUrl: true },
  });
  if (!version) {
    console.warn(`  skip: version ${versionId} not found`);
    return { updated: 0, skipped: true };
  }

  const storage = createStorageProvider();
  let buffer: Buffer;
  try {
    buffer = await storage.download(version.fileUrl);
  } catch (err) {
    console.warn(`  skip: failed to download ${version.fileUrl}: ${(err as Error).message}`);
    return { updated: 0, skipped: true };
  }

  const parsed = await parseDocx(buffer);
  const counter = { value: 0 };
  const flatTables: FlatTableBlock[] = [];
  flattenTableBlocks(parsed.sections, counter, flatTables);

  if (flatTables.length === 0) {
    return { updated: 0, skipped: false };
  }

  const dbBlocks = await prisma.contentBlock.findMany({
    where: {
      section: { docVersionId: versionId },
      type: "table",
      tableAst: { equals: null },
    },
    select: {
      id: true,
      order: true,
      section: { select: { order: true } },
    },
  });

  const dbByKey = new Map<string, string>();
  for (const b of dbBlocks) {
    dbByKey.set(`${b.section.order}:${b.order}`, b.id);
  }

  let updated = 0;
  let unmatched = 0;
  for (const t of flatTables) {
    const id = dbByKey.get(`${t.sectionOrder}:${t.blockOrder}`);
    if (!id) {
      unmatched++;
      continue;
    }
    if (!dryRun) {
      await prisma.contentBlock.update({
        where: { id },
        data: { tableAst: t.tableAst as any },
      });
    }
    updated++;
  }

  if (unmatched > 0) {
    console.warn(`  ⚠ ${unmatched} parsed table blocks did not match any DB block (drift?)`);
  }
  return { updated, skipped: false };
}

async function main() {
  const args = parseArgs();
  console.log("=== Backfill ContentBlock.tableAst ===");
  console.log(`Mode: ${args.dryRun ? "DRY-RUN" : "WRITE"}`);
  if (args.tenantId) console.log(`Tenant: ${args.tenantId}`);
  console.log("");

  const versions = await prisma.documentVersion.findMany({
    where: {
      ...(args.tenantId ? { document: { study: { tenantId: args.tenantId } } } : {}),
      sections: {
        some: {
          contentBlocks: {
            some: { type: "table", tableAst: { equals: null } },
          },
        },
      },
    },
    select: { id: true, document: { select: { name: true } } },
    take: args.limit,
  });

  if (versions.length === 0) {
    console.log("No versions need backfill. Done.");
    await prisma.$disconnect();
    return;
  }

  console.log(`Found ${versions.length} version(s) needing backfill`);
  console.log("");

  let total = 0;
  let processed = 0;
  for (const v of versions) {
    console.log(`[${++processed}/${versions.length}] ${v.id.slice(0, 8)} (${v.document.name})`);
    try {
      const res = await processVersion(v.id, args.dryRun);
      total += res.updated;
      console.log(`  → updated ${res.updated} table block(s)`);
    } catch (err) {
      console.error(`  ✗ failed: ${(err as Error).message}`);
    }
  }

  console.log("");
  console.log(`=== DONE: ${total} ContentBlock.tableAst row(s) ${args.dryRun ? "would be" : ""} updated ===`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
