/**
 * Audit golden-sample coverage for the `fact_extraction` stage.
 *
 * Prints how many GoldenSample rows have a GoldenSampleStageStatus(stage='fact_extraction')
 * with non-empty expectedResults, broken down by status (draft / in_review / approved).
 *
 * Goal: confirm we have ≥30 approved samples before kicking off the Sprint 6
 * fact-extraction baseline run.
 *
 * Usage:
 *   npx tsx --env-file=.env apps/workers/scripts/audit-golden-fact-extraction-coverage.ts
 *
 * Options:
 *   --tenant=<uuid>   default: 00000000-0000-0000-0000-000000000002 (Golden Set)
 *   --json            emit machine-readable JSON instead of a human table
 */

import { PrismaClient } from "@prisma/client";

const GOLDEN_SET_TENANT_ID = "00000000-0000-0000-0000-000000000002";
const STAGE = "fact_extraction";
const TARGET_APPROVED = 30;

interface Args {
  tenantId: string;
  json: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (key: string) => {
    const arg = argv.find((a) => a.startsWith(`--${key}=`));
    return arg ? arg.slice(key.length + 3) : undefined;
  };
  return {
    tenantId: get("tenant") ?? GOLDEN_SET_TENANT_ID,
    json: argv.includes("--json"),
  };
}

interface SampleRow {
  id: string;
  name: string;
  stageStatus: "draft" | "in_review" | "approved" | null;
  factKeyCount: number;
  totalFacts: number;
  hasNonEmptyExpected: boolean;
  reviewedAt: string | null;
  approvedAt: string | null;
}

function countFacts(expected: unknown): { factKeys: number; total: number } {
  if (!expected || typeof expected !== "object") return { factKeys: 0, total: 0 };
  const obj = expected as Record<string, unknown>;

  // Tolerated shapes for expectedResults:
  //   { facts: { factKeyA: [...], factKeyB: [...] } }
  //   { factKeyA: [...], factKeyB: [...] }
  //   { factKeyA: "value" }
  const root: Record<string, unknown> =
    obj.facts && typeof obj.facts === "object"
      ? (obj.facts as Record<string, unknown>)
      : obj;

  let total = 0;
  let keys = 0;
  for (const v of Object.values(root)) {
    if (v == null) continue;
    keys++;
    if (Array.isArray(v)) total += v.length;
    else total += 1;
  }
  return { factKeys: keys, total };
}

async function main() {
  const args = parseArgs();
  const prisma = new PrismaClient();

  const samples = await prisma.goldenSample.findMany({
    where: { tenantId: args.tenantId },
    include: {
      stageStatuses: { where: { stage: STAGE } },
    },
    orderBy: { name: "asc" },
  });

  const rows: SampleRow[] = samples.map((s) => {
    const stage = s.stageStatuses[0];
    const { factKeys, total } = countFacts(stage?.expectedResults);
    return {
      id: s.id,
      name: s.name,
      stageStatus: (stage?.status as SampleRow["stageStatus"]) ?? null,
      factKeyCount: factKeys,
      totalFacts: total,
      hasNonEmptyExpected: factKeys > 0,
      reviewedAt: stage?.reviewedAt?.toISOString() ?? null,
      approvedAt: stage?.approvedAt?.toISOString() ?? null,
    };
  });

  const approvedNonEmpty = rows.filter((r) => r.stageStatus === "approved" && r.hasNonEmptyExpected).length;
  const summary = {
    tenantId: args.tenantId,
    stage: STAGE,
    totalSamples: rows.length,
    withStageRow: rows.filter((r) => r.stageStatus !== null).length,
    withNonEmptyExpected: rows.filter((r) => r.hasNonEmptyExpected).length,
    approvedNonEmpty,
    inReviewNonEmpty: rows.filter((r) => r.stageStatus === "in_review" && r.hasNonEmptyExpected).length,
    draftNonEmpty: rows.filter((r) => r.stageStatus === "draft" && r.hasNonEmptyExpected).length,
    totalFactKeys: rows.reduce((sum, r) => sum + r.factKeyCount, 0),
    targetApproved: TARGET_APPROVED,
    gap: Math.max(0, TARGET_APPROVED - approvedNonEmpty),
    generatedAt: new Date().toISOString(),
  };

  if (args.json) {
    console.log(JSON.stringify({ summary, samples: rows }, null, 2));
  } else {
    console.log(`=== Golden coverage / stage=${STAGE} / tenant=${args.tenantId} ===\n`);
    console.log(`Всего samples:           ${summary.totalSamples}`);
    console.log(`С строкой stage_status:  ${summary.withStageRow}`);
    console.log(`С непустым expected:     ${summary.withNonEmptyExpected}`);
    console.log(`  approved:              ${summary.approvedNonEmpty}`);
    console.log(`  in_review:             ${summary.inReviewNonEmpty}`);
    console.log(`  draft:                 ${summary.draftNonEmpty}`);
    console.log(`Сумма factKey по всем:   ${summary.totalFactKeys}`);
    console.log(`Цель approved:           ${summary.targetApproved}`);
    console.log(`Дефицит:                 ${summary.gap}\n`);

    if (rows.length > 0) {
      const pad = (s: string, n: number) => s.padEnd(n).slice(0, n);
      console.log(pad("Name", 50), pad("Status", 12), pad("FactKeys", 10), "TotalFacts");
      console.log("-".repeat(90));
      for (const r of rows) {
        console.log(
          pad(r.name, 50),
          pad(r.stageStatus ?? "—", 12),
          pad(String(r.factKeyCount), 10),
          r.totalFacts,
        );
      }
    }
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
