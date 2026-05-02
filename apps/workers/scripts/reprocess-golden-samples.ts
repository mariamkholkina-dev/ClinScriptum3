/**
 * Reprocess всех golden samples в Golden Set tenant + ждёт parsed status.
 *
 * После merge code-changes (PR-1/PR-2/PR-3) Section.standardSection в БД
 * по-прежнему содержит результат СТАРОГО pipeline. Чтобы получить корректный
 * after-baseline, нужно перезапустить pipeline на 4 sample-протоколах с
 * НОВЫМ кодом, и только потом запускать `npm run baseline`.
 *
 * Что делает (для каждого sample.documentVersion):
 *  1. Удаляет старые ProcessingStep / ProcessingRun / Finding / Fact /
 *     SoaCell / SoaTable / ContentBlock / Section
 *  2. Update DocumentVersion.status = 'parsing'
 *  3. Enqueue job 'run_pipeline' в очередь 'processing'
 *
 * После всех enqueue — поллит каждые 5 сек DocumentVersion.status, ждёт
 * пока все 4 не станут 'parsed' (или 'error'). Timeout 30 мин на всё.
 *
 * Запуск:
 *   npx tsx --env-file=.env apps/workers/scripts/reprocess-golden-samples.ts
 *
 * Опции:
 *   --tenant=<uuid>     default: 00000000-0000-0000-0000-000000000002 (Golden Set)
 *   --no-wait           не поллить после enqueue
 */

import { PrismaClient } from "@prisma/client";
import { Queue } from "bullmq";
import IORedis from "ioredis";

const GOLDEN_SET_TENANT_ID = "00000000-0000-0000-0000-000000000002";
const POLL_INTERVAL_MS = 5000;
const TIMEOUT_MS = 30 * 60 * 1000; // 30 min total

const TERMINAL_STATUSES = new Set(["parsed", "error", "ready"]);

interface Args {
  tenantId: string;
  noWait: boolean;
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
    noWait: argv.includes("--no-wait"),
    limit: limitStr ? parseInt(limitStr, 10) : undefined,
  };
}

async function main() {
  const args = parseArgs();
  const prisma = new PrismaClient();

  console.log("=== Reprocess Golden Samples ===");
  console.log(`Tenant: ${args.tenantId}`);
  console.log("");

  const samples = await prisma.goldenSample.findMany({
    where: { tenantId: args.tenantId },
    include: {
      documents: {
        include: {
          documentVersion: { select: { id: true, versionLabel: true, status: true } },
        },
      },
    },
  });

  if (samples.length === 0) {
    console.error(`No golden samples found for tenant ${args.tenantId}`);
    process.exit(1);
  }

  const samplesToProcess = args.limit ? samples.slice(0, args.limit) : samples;
  console.log(`Found ${samples.length} golden samples; will reprocess ${samplesToProcess.length}:`);
  const versionIds: string[] = [];
  for (const s of samplesToProcess) {
    for (const doc of s.documents) {
      const vId = doc.documentVersion.id;
      versionIds.push(vId);
      console.log(`  - ${s.name} → docVersion ${vId.slice(0, 8)} (${doc.documentVersion.status})`);
    }
  }
  console.log("");

  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue("processing", { connection });

  for (const versionId of versionIds) {
    console.log(`\nReprocessing ${versionId.slice(0, 8)}...`);
    await prisma.$transaction([
      prisma.processingStep.deleteMany({ where: { processingRun: { docVersionId: versionId } } }),
      prisma.processingRun.deleteMany({ where: { docVersionId: versionId } }),
      prisma.finding.deleteMany({ where: { docVersionId: versionId } }),
      prisma.fact.deleteMany({ where: { docVersionId: versionId } }),
      prisma.soaCell.deleteMany({ where: { soaTable: { docVersionId: versionId } } }),
      prisma.soaTable.deleteMany({ where: { docVersionId: versionId } }),
      prisma.contentBlock.deleteMany({ where: { section: { docVersionId: versionId } } }),
      prisma.section.deleteMany({ where: { docVersionId: versionId } }),
      prisma.documentVersion.update({ where: { id: versionId }, data: { status: "parsing" } }),
    ]);
    await queue.add("run_pipeline", { versionId }, { attempts: 2, backoff: { type: "exponential", delay: 15000 } });
    console.log(`  enqueued run_pipeline for ${versionId.slice(0, 8)}`);
  }

  if (args.noWait) {
    console.log(`\n--no-wait: skipping poll. Check status manually.`);
    await connection.quit();
    await prisma.$disconnect();
    return;
  }

  console.log(`\nWaiting for all to reach terminal status (parsed|error|ready). Timeout ${TIMEOUT_MS / 1000}s...`);
  const startTime = Date.now();

  while (Date.now() - startTime < TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const versions = await prisma.documentVersion.findMany({
      where: { id: { in: versionIds } },
      select: { id: true, status: true },
    });
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const summary = versions.map((v) => `${v.id.slice(0, 8)}=${v.status}`).join("  ");
    process.stdout.write(`  [${elapsed}s] ${summary}\r`);
    const allDone = versions.every((v) => TERMINAL_STATUSES.has(v.status));
    if (allDone) {
      console.log("");
      console.log("");
      const errors = versions.filter((v) => v.status === "error");
      if (errors.length > 0) {
        console.error(`ERROR: ${errors.length} version(s) ended in 'error' status:`);
        for (const v of errors) console.error(`  - ${v.id}`);
        await connection.quit();
        await prisma.$disconnect();
        process.exit(1);
      }
      console.log(`=== ALL DONE (${versions.length} versions reached terminal status, 0 errors) ===`);
      await connection.quit();
      await prisma.$disconnect();
      return;
    }
  }

  console.log("");
  console.error(`Timeout after ${TIMEOUT_MS / 1000}s. Some versions still processing.`);
  await connection.quit();
  await prisma.$disconnect();
  process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
