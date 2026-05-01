/**
 * Запуск baseline-evaluation для tenant Golden Set.
 *
 * Что делает:
 *  1. Находит все GoldenSample c approved stage='classification' (или другим, если задан --stage)
 *     в tenant Golden Set.
 *  2. Создаёт EvaluationRun (status='queued') с фиксацией активной версии section_classification
 *     ruleset и default LLM-config для section_classify.
 *  3. Ставит job "run_evaluation" в очередь BullMQ "processing".
 *  4. Поллит status пока не completed/failed (timeout 10 мин).
 *  5. Сохраняет метрики + per-sample результаты в docs/baselines/{name}.json
 *     с git-коммитом, ruleSetVersionId и llmConfigSnapshot для воспроизводимости.
 *
 * Запуск (из root):
 *   npx tsx apps/workers/scripts/run-baseline-evaluation.ts
 *
 * Опции (через argv):
 *   --name=<str>            имя prog. default: baseline-{ISO timestamp}
 *   --tenant=<uuid>         default: 00000000-0000-0000-0000-000000000002 (Golden Set)
 *   --stage=<str>           для filtering samples. default: classification
 *   --output-dir=<path>     default: docs/baselines
 *   --compared-to=<runId>   если задан — выставит comparedToRunId, evaluation посчитает delta
 *   --dry-run               только показать, что будет сделано, без запуска
 */

import { PrismaClient } from "@prisma/client";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const GOLDEN_SET_TENANT_ID = "00000000-0000-0000-0000-000000000002";
const POLL_INTERVAL_MS = 3000;
const TIMEOUT_MS = 10 * 60 * 1000; // 10 min

interface Args {
  name: string;
  tenantId: string;
  stage: string;
  outputDir: string;
  comparedToRunId?: string;
  dryRun: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (key: string) => {
    const arg = argv.find((a) => a.startsWith(`--${key}=`));
    return arg ? arg.slice(key.length + 3) : undefined;
  };
  const has = (key: string) => argv.includes(`--${key}`);

  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return {
    name: get("name") ?? `baseline-${ts}`,
    tenantId: get("tenant") ?? GOLDEN_SET_TENANT_ID,
    stage: get("stage") ?? "classification",
    outputDir: get("output-dir") ?? resolve(__dirname, "../../../docs/baselines"),
    comparedToRunId: get("compared-to"),
    dryRun: has("dry-run"),
  };
}

function getGitCommit(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

function getGitBranch(): string {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

async function main() {
  const args = parseArgs();
  const prisma = new PrismaClient();

  console.log("=== Baseline Evaluation Run ===");
  console.log(`Name:           ${args.name}`);
  console.log(`Tenant:         ${args.tenantId}`);
  console.log(`Stage filter:   ${args.stage}`);
  console.log(`Output dir:     ${args.outputDir}`);
  console.log(`Compared to:    ${args.comparedToRunId ?? "(none)"}`);
  console.log(`Dry run:        ${args.dryRun}`);
  console.log("");

  // ── 1. Resolve tenant + admin user ──
  const tenant = await prisma.tenant.findUnique({ where: { id: args.tenantId } });
  if (!tenant) {
    console.error(`ERROR: Tenant ${args.tenantId} not found`);
    process.exit(1);
  }
  const admin = await prisma.user.findFirst({
    where: { tenantId: args.tenantId, role: { in: ["rule_admin", "tenant_admin"] } },
    orderBy: { createdAt: "asc" },
  });
  if (!admin) {
    console.error(`ERROR: No rule_admin/tenant_admin user in tenant ${args.tenantId}`);
    process.exit(1);
  }

  // ── 2. Find approved samples for the stage ──
  const samples = await prisma.goldenSample.findMany({
    where: {
      tenantId: args.tenantId,
      stageStatuses: { some: { stage: args.stage, status: "approved" } },
    },
    include: {
      stageStatuses: { where: { status: "approved" } },
      documents: { include: { documentVersion: { select: { id: true, versionLabel: true } } } },
    },
  });
  if (samples.length === 0) {
    console.error(`ERROR: No GoldenSample with approved stage='${args.stage}' in tenant ${args.tenantId}`);
    console.error(`Check rule-admin UI → Golden Sets → make sure samples exist and stage is approved.`);
    process.exit(1);
  }
  console.log(`Found ${samples.length} approved sample(s) for stage='${args.stage}':`);
  for (const s of samples) {
    const docNames = s.documents.map((d) => d.documentVersion.versionLabel ?? d.documentVersionId.slice(0, 8)).join(", ");
    console.log(`  - ${s.name} (${s.id.slice(0, 8)}, docs: ${docNames})`);
  }
  console.log("");

  // ── 3. Resolve active ruleSetVersion + default LLM config ──
  const ruleSet = await prisma.ruleSet.findFirst({
    where: { type: "section_classification", OR: [{ tenantId: args.tenantId }, { tenantId: null }] },
    orderBy: { tenantId: { sort: "desc", nulls: "last" } },
  });
  const activeVersion = ruleSet
    ? await prisma.ruleSetVersion.findFirst({
        where: { ruleSetId: ruleSet.id, isActive: true },
      })
    : null;

  const llmConfig = await prisma.llmConfig.findFirst({
    where: {
      taskId: "section_classify",
      isDefault: true,
      isActive: true,
      OR: [{ tenantId: args.tenantId }, { tenantId: null }],
    },
    orderBy: { tenantId: { sort: "desc", nulls: "last" } },
  });

  console.log(`RuleSet:        ${ruleSet?.name ?? "(none)"} (${ruleSet?.id.slice(0, 8) ?? "-"})`);
  console.log(`Version:        ${activeVersion ? `v${activeVersion.version}` : "(none active)"} (${activeVersion?.id.slice(0, 8) ?? "-"})`);
  console.log(`LLM config:     ${llmConfig?.name ?? "(none)"} (${llmConfig?.id.slice(0, 8) ?? "-"})`);
  console.log("");

  if (args.dryRun) {
    console.log("Dry run: no changes made.");
    await prisma.$disconnect();
    return;
  }

  // ── 4. Create EvaluationRun ──
  const run = await prisma.evaluationRun.create({
    data: {
      tenantId: args.tenantId,
      name: args.name,
      type: "batch",
      status: "queued",
      createdById: admin.id,
      ruleSetVersionId: activeVersion?.id,
      llmConfigId: llmConfig?.id,
      comparedToRunId: args.comparedToRunId,
    },
  });
  console.log(`Created EvaluationRun: ${run.id}`);

  // ── 5. Enqueue job in BullMQ ──
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue("processing", { connection });
  await queue.add("run_evaluation", { evaluationRunId: run.id }, { attempts: 2, backoff: { type: "exponential", delay: 10000 } });
  console.log(`Enqueued job 'run_evaluation' in queue 'processing'`);
  console.log("");

  // ── 6. Poll until completed/failed ──
  console.log("Polling status...");
  const startTime = Date.now();
  let final;
  while (Date.now() - startTime < TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const cur = await prisma.evaluationRun.findUnique({ where: { id: run.id } });
    if (!cur) throw new Error("Run disappeared from DB");
    process.stdout.write(`  status=${cur.status} elapsed=${Math.round((Date.now() - startTime) / 1000)}s\r`);
    if (cur.status === "completed" || cur.status === "failed") {
      final = cur;
      break;
    }
  }
  console.log("");
  console.log("");

  if (!final) {
    console.error(`ERROR: Timeout (${TIMEOUT_MS / 1000}s) waiting for evaluation to complete.`);
    console.error(`Run ID: ${run.id} — check workers logs and DB for status.`);
    await connection.quit();
    await prisma.$disconnect();
    process.exit(1);
  }

  if (final.status === "failed") {
    console.error(`Evaluation failed:`, final.metrics);
    await connection.quit();
    await prisma.$disconnect();
    process.exit(1);
  }

  // ── 7. Fetch results, write baseline file ──
  const results = await prisma.evaluationResult.findMany({
    where: { evaluationRunId: run.id },
    include: { goldenSample: { select: { id: true, name: true } } },
    orderBy: [{ stage: "asc" }, { goldenSampleId: "asc" }],
  });

  const baseline = {
    name: args.name,
    runId: run.id,
    createdAt: run.createdAt.toISOString(),
    completedAt: final.completedAt?.toISOString(),
    durationMs: final.durationMs,
    git: {
      commit: getGitCommit(),
      branch: getGitBranch(),
    },
    config: {
      tenantId: args.tenantId,
      ruleSetVersionId: activeVersion?.id ?? null,
      ruleSetVersion: activeVersion ? { version: activeVersion.version, name: ruleSet?.name } : null,
      llmConfigId: llmConfig?.id ?? null,
      llmConfig: llmConfig
        ? {
            name: llmConfig.name,
            provider: llmConfig.provider,
            model: llmConfig.model,
            temperature: llmConfig.temperature,
            maxOutputTokens: llmConfig.maxOutputTokens,
            maxInputTokens: llmConfig.maxInputTokens,
            contextStrategy: llmConfig.contextStrategy,
            reasoningMode: llmConfig.reasoningMode,
          }
        : null,
    },
    summary: {
      totalSamples: final.totalSamples,
      passedSamples: final.passedSamples,
      failedSamples: final.failedSamples,
      passRate: final.totalSamples > 0 ? final.passedSamples / final.totalSamples : null,
    },
    metrics: final.metrics,
    delta: final.delta ?? null,
    perSampleResults: results.map((r) => ({
      goldenSampleId: r.goldenSampleId,
      goldenSampleName: r.goldenSample.name,
      stage: r.stage,
      status: r.status,
      precision: r.precision,
      recall: r.recall,
      f1: r.f1,
      latencyMs: r.latencyMs,
      diff: r.diff,
    })),
  };

  mkdirSync(args.outputDir, { recursive: true });
  const outFile = resolve(args.outputDir, `${args.name}.json`);
  writeFileSync(outFile, JSON.stringify(baseline, null, 2), "utf-8");

  console.log("=== DONE ===");
  console.log(`Total:    ${final.totalSamples}`);
  console.log(`Passed:   ${final.passedSamples}`);
  console.log(`Failed:   ${final.failedSamples}`);
  if (final.metrics && typeof final.metrics === "object") {
    const stageMetrics = (final.metrics as Record<string, unknown>)[args.stage];
    if (stageMetrics && typeof stageMetrics === "object") {
      const m = stageMetrics as { avgPrecision?: number; avgRecall?: number; avgF1?: number; passRate?: number };
      console.log(`Stage '${args.stage}':`);
      console.log(`  avgPrecision: ${m.avgPrecision?.toFixed(3) ?? "-"}`);
      console.log(`  avgRecall:    ${m.avgRecall?.toFixed(3) ?? "-"}`);
      console.log(`  avgF1:        ${m.avgF1?.toFixed(3) ?? "-"}`);
      console.log(`  passRate:     ${m.passRate?.toFixed(3) ?? "-"}`);
    }
  }
  console.log("");
  console.log(`Saved: ${outFile}`);
  console.log(`Run ID for next compare: --compared-to=${run.id}`);

  await connection.quit();
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
