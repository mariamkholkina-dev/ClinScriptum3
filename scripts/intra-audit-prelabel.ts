/**
 * Pre-labelling для intra-audit golden samples.
 *
 * Цель — превратить ~100% ручной работы аннотатора в ~30%, авто-заполнив
 * draft.annotations теми решениями, которые модель сама в состоянии
 * вывести из метаданных finding'а.
 *
 * Эвристики (в порядке приоритета):
 *   1. issueFamily ∈ {PLACEHOLDER, EDITORIAL} → пропускаем (исключены из
 *      метрики варианта A, заполнять draft для них бессмысленно).
 *   2. status='false_positive' ИЛИ extraAttributes.qaVerdict='deduplicated'
 *      → 'rejected' (Sprint 4 дедупликатор уже пометил это как дубль).
 *   3. extraAttributes.qaVerdict='dismissed' → 'rejected' (LLM QA отвергла).
 *   4. extraAttributes.qaVerdict='confirmed' (+ qaVerified=true)
 *      → 'accepted' (LLM QA уже подтвердила).
 *   5. Иначе → НЕ пишем annotation (оставляем как 'unreviewed' по умолчанию
 *      в viewer'е, эксперт решает сам).
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/intra-audit-prelabel.ts
 *   npx tsx --env-file=.env scripts/intra-audit-prelabel.ts --dry-run
 *   npx tsx --env-file=.env scripts/intra-audit-prelabel.ts --sample-id <uuid>
 *   npx tsx --env-file=.env scripts/intra-audit-prelabel.ts --tenant-id <uuid>
 *   # --overwrite — перезаписать existing draft.annotations (по умолчанию мерж)
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/* ─── Argv ─────────────────────────────────────────────────── */

interface Args {
  dryRun: boolean;
  sampleId?: string;
  tenantId?: string;
  overwrite: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    dryRun: argv.includes("--dry-run"),
    sampleId: get("--sample-id"),
    tenantId: get("--tenant-id"),
    overwrite: argv.includes("--overwrite"),
  };
}

/* ─── Pure heuristic (unit-tested) ─────────────────────────── */

export type PrelabelDecision = "accepted" | "rejected" | "skip";

export interface PrelabelInputFinding {
  id: string;
  status: string;
  issueFamily: string | null;
  qaVerified: boolean;
  extraAttributes: unknown;
}

export interface PrelabelOutcome {
  decision: PrelabelDecision;
  source:
    | "skip_excluded_family"
    | "skip_uncertain"
    | "dedup_or_false_positive"
    | "qa_dismissed"
    | "qa_confirmed";
}

const EXCLUDED_FAMILIES = new Set(["PLACEHOLDER", "EDITORIAL"]);

export function decidePrelabel(f: PrelabelInputFinding): PrelabelOutcome {
  const fam = (f.issueFamily ?? "").toUpperCase();
  if (EXCLUDED_FAMILIES.has(fam)) {
    return { decision: "skip", source: "skip_excluded_family" };
  }

  const extra = (f.extraAttributes ?? {}) as Record<string, unknown>;
  const verdict = typeof extra.qaVerdict === "string" ? extra.qaVerdict : null;

  if (f.status === "false_positive" || verdict === "deduplicated") {
    return { decision: "rejected", source: "dedup_or_false_positive" };
  }
  if (verdict === "dismissed") {
    return { decision: "rejected", source: "qa_dismissed" };
  }
  if (verdict === "confirmed" && f.qaVerified) {
    return { decision: "accepted", source: "qa_confirmed" };
  }
  return { decision: "skip", source: "skip_uncertain" };
}

/* ─── Per-sample worker ────────────────────────────────────── */

interface SampleRow {
  id: string;
  tenantId: string;
  documents: Array<{ documentVersionId: string }>;
  stageStatuses: Array<{
    id: string;
    expectedResults: unknown;
  }>;
}

type AnnotationRecord = Record<string, { decision: "accepted" | "rejected" }>;

interface Stats {
  sampleId: string;
  totalFindings: number;
  preAccepted: number;
  preRejected: number;
  unreviewed: number;
  skippedExcluded: number;
}

async function prelabelOne(sample: SampleRow, args: Args): Promise<Stats | null> {
  const stage = sample.stageStatuses[0];
  if (!stage) return null;
  const primaryDoc = sample.documents[0];
  if (!primaryDoc) return null;

  const findings = await prisma.finding.findMany({
    where: {
      docVersionId: primaryDoc.documentVersionId,
      type: { in: ["intra_audit", "editorial", "semantic"] },
    },
    select: {
      id: true,
      status: true,
      issueFamily: true,
      qaVerified: true,
      extraAttributes: true,
    },
  });

  // Существующие annotations (либо мерджим, либо перезаписываем)
  const expected = (stage.expectedResults ?? {}) as Record<string, unknown>;
  const draftIn = (expected.draft ?? {}) as Record<string, unknown>;
  const existingAnnotations = ((draftIn.annotations as AnnotationRecord) ?? {});
  const annotations: AnnotationRecord = args.overwrite ? {} : { ...existingAnnotations };

  const stats: Stats = {
    sampleId: sample.id,
    totalFindings: findings.length,
    preAccepted: 0,
    preRejected: 0,
    unreviewed: 0,
    skippedExcluded: 0,
  };

  for (const f of findings) {
    const outcome = decidePrelabel(f);
    if (outcome.source === "skip_excluded_family") {
      stats.skippedExcluded++;
      continue;
    }
    if (outcome.decision === "skip") {
      stats.unreviewed++;
      continue;
    }
    // Не перезаписываем явно установленную аннотацию эксперта (только если --overwrite).
    if (!args.overwrite && existingAnnotations[f.id]) continue;
    annotations[f.id] = { decision: outcome.decision };
    if (outcome.decision === "accepted") stats.preAccepted++;
    else stats.preRejected++;
  }

  if (args.dryRun) {
    return stats;
  }

  // Запись через прямой update — без updateStageStatus, чтобы не дёргать
  // auth context (мы — system script).
  const nextExpected = {
    ...expected,
    draft: {
      ...draftIn,
      annotations,
    },
  };
  await prisma.goldenSampleStageStatus.update({
    where: { id: stage.id },
    data: {
      expectedResults: nextExpected as object,
      // Если эталон ещё в draft — пометим in_review (аннотатор начал).
      // approved оставляем как есть.
    },
  });

  return stats;
}

/* ─── Main ────────────────────────────────────────────────── */

async function main() {
  const args = parseArgs();
  console.log("intra-audit pre-label", {
    dryRun: args.dryRun,
    sampleId: args.sampleId,
    tenantId: args.tenantId,
    overwrite: args.overwrite,
  });

  const samples = (await prisma.goldenSample.findMany({
    where: {
      ...(args.tenantId ? { tenantId: args.tenantId } : {}),
      ...(args.sampleId ? { id: args.sampleId } : {}),
    },
    select: {
      id: true,
      tenantId: true,
      documents: { select: { documentVersionId: true } },
      stageStatuses: {
        where: { stage: "intra_audit" },
        select: { id: true, expectedResults: true },
      },
    },
  })) as SampleRow[];

  const relevant = samples.filter((s) => s.stageStatuses.length > 0 && s.documents.length > 0);
  console.log(`Found ${relevant.length} sample(s) with stage='intra_audit'`);

  const aggregate = {
    samples: 0,
    findings: 0,
    accepted: 0,
    rejected: 0,
    unreviewed: 0,
    skipped: 0,
  };

  for (const sample of relevant) {
    const s = await prelabelOne(sample, args);
    if (!s) continue;
    aggregate.samples++;
    aggregate.findings += s.totalFindings;
    aggregate.accepted += s.preAccepted;
    aggregate.rejected += s.preRejected;
    aggregate.unreviewed += s.unreviewed;
    aggregate.skipped += s.skippedExcluded;
    console.log(
      `  sample=${s.sampleId.slice(0, 8)}  total=${s.totalFindings}  accepted=${s.preAccepted}  rejected=${s.preRejected}  unreviewed=${s.unreviewed}  skipped=${s.skippedExcluded}`,
    );
  }

  const labelledRatio =
    aggregate.findings > 0
      ? ((aggregate.accepted + aggregate.rejected) / aggregate.findings) * 100
      : 0;
  console.log("");
  console.log("─── Summary ───");
  console.log(`Samples processed:     ${aggregate.samples}`);
  console.log(`Findings inspected:    ${aggregate.findings}`);
  console.log(`Pre-accepted:          ${aggregate.accepted}`);
  console.log(`Pre-rejected:          ${aggregate.rejected}`);
  console.log(`Unreviewed (for exp):  ${aggregate.unreviewed}`);
  console.log(`Skipped (excluded):    ${aggregate.skipped}`);
  console.log(`Auto-labelled:         ${labelledRatio.toFixed(1)}%`);
  console.log(args.dryRun ? "(dry-run — no DB writes)" : "(written to DB)");

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
