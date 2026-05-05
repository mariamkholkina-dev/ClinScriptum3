/**
 * Pre-label DocumentVersion'ов как draft golden samples для stage `fact_extraction`.
 *
 * Идея: вместо того чтобы эксперт размечал 30 протоколов с нуля, мы запускаем
 * текущий pipeline на корпусе из ~200 «сырых» (уже загруженных) DocumentVersion'ов
 * и засеиваем их `expectedResults` авто-черновиками. Эксперт затем подтверждает /
 * правит факты в UI rule-admin (extraction-viewer → ExpectedResults inline edit).
 *
 * Что делает (для каждого подходящего DocumentVersion):
 *   1. Если pipeline ещё не прошёл (status != 'parsed') — enqueue run_pipeline + wait.
 *   2. Читает все Fact для этой версии.
 *   3. Создаёт GoldenSample (sampleType=single_document, name=document.title).
 *   4. Прикрепляет DocumentVersion к sample как primary документ.
 *   5. Создаёт GoldenSampleStageStatus (stage='fact_extraction', status='draft')
 *      с expectedResults = { facts: [...] } для последующей правки экспертом.
 *
 * Селектор кандидатов:
 *   - tenantId совпадает (default Golden Set tenant).
 *   - DocumentVersion.document.type совпадает с --doc-type (default: protocol).
 *   - Эта DocumentVersion ещё НЕ в одной из существующих GoldenSample (через
 *     GoldenSampleDocument). Это даёт идемпотентность: повторный запуск
 *     обрабатывает только новые документы.
 *
 * Запуск:
 *   npx tsx --env-file=.env scripts/prelabel-raw-corpus.ts
 *   npx tsx --env-file=.env scripts/prelabel-raw-corpus.ts --tenant=<uuid> --limit=10
 *   npx tsx --env-file=.env scripts/prelabel-raw-corpus.ts --skip-pipeline --dry-run
 *
 * Опции:
 *   --tenant=<uuid>       default: 00000000-0000-0000-0000-000000000002 (Golden Set)
 *   --doc-type=<type>     default: protocol (protocol|icf|ib|csr)
 *   --limit=<N>           process at most N DocumentVersion'ов
 *   --skip-pipeline       не enqueue'ить run_pipeline, использовать существующие Facts
 *                         (полезно если pipeline уже прошёл, нужно только засеять golden)
 *   --no-wait             enqueue pipeline и сразу вернуться (без поллинга на parsed)
 *   --dry-run             только показать план, без записи
 *   --sample-name-prefix  prefix к имени golden sample (default: «Pre-labeled — »)
 *   --user=<uuid>         createdById для GoldenSample. Если не задан — берётся
 *                         первый пользователь tenant'а.
 */

import { PrismaClient, type DocumentType } from "@prisma/client";
import { Queue } from "bullmq";
import IORedis from "ioredis";

const GOLDEN_SET_TENANT_ID = "00000000-0000-0000-0000-000000000002";
const POLL_INTERVAL_MS = 5000;
const PIPELINE_TIMEOUT_MS = 30 * 60 * 1000;

const TERMINAL_STATUSES = new Set(["parsed", "error", "ready"]);

interface Args {
  tenantId: string;
  docType: DocumentType;
  limit?: number;
  skipPipeline: boolean;
  noWait: boolean;
  dryRun: boolean;
  sampleNamePrefix: string;
  createdById?: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (key: string) => {
    const arg = argv.find((a) => a.startsWith(`--${key}=`));
    return arg ? arg.slice(key.length + 3) : undefined;
  };
  const has = (key: string) => argv.includes(`--${key}`);

  const limit = get("limit");
  const docTypeRaw = get("doc-type") ?? "protocol";
  if (!["protocol", "icf", "ib", "csr"].includes(docTypeRaw)) {
    console.error(`Invalid --doc-type=${docTypeRaw}. Allowed: protocol|icf|ib|csr`);
    process.exit(1);
  }

  return {
    tenantId: get("tenant") ?? GOLDEN_SET_TENANT_ID,
    docType: docTypeRaw as DocumentType,
    limit: limit ? parseInt(limit, 10) : undefined,
    skipPipeline: has("skip-pipeline"),
    noWait: has("no-wait"),
    dryRun: has("dry-run"),
    sampleNamePrefix: get("sample-name-prefix") ?? "Pre-labeled — ",
    createdById: get("user"),
  };
}

async function resolveCreatorId(prisma: PrismaClient, args: Args): Promise<string> {
  if (args.createdById) return args.createdById;
  const user = await prisma.user.findFirst({
    where: { tenantId: args.tenantId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!user) {
    throw new Error(`No user found in tenant ${args.tenantId}. Pass --user=<uuid> or seed a user.`);
  }
  return user.id;
}

interface FactSourceLike {
  text?: string;
  sectionTitle?: string;
}

function extractSourceText(sources: unknown): string | undefined {
  if (!Array.isArray(sources) || sources.length === 0) return undefined;
  const first = sources[0] as FactSourceLike;
  if (typeof first?.text === "string" && first.text.trim().length > 0) {
    return first.text.trim().slice(0, 500);
  }
  return undefined;
}

async function findCandidates(prisma: PrismaClient, args: Args) {
  const seenVersionIds = new Set(
    (
      await prisma.goldenSampleDocument.findMany({
        where: { goldenSample: { tenantId: args.tenantId } },
        select: { documentVersionId: true },
      })
    ).map((d) => d.documentVersionId),
  );

  const versions = await prisma.documentVersion.findMany({
    where: {
      document: {
        type: args.docType,
        study: { tenantId: args.tenantId },
      },
    },
    include: {
      document: { select: { id: true, title: true, type: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const candidates = versions.filter((v) => !seenVersionIds.has(v.id));
  return args.limit ? candidates.slice(0, args.limit) : candidates;
}

async function ensurePipelineDone(
  prisma: PrismaClient,
  queue: Queue,
  versionIds: string[],
  args: Args,
): Promise<{ ok: string[]; failed: string[] }> {
  if (args.skipPipeline) return { ok: versionIds, failed: [] };

  const needed = await prisma.documentVersion.findMany({
    where: { id: { in: versionIds }, status: { notIn: ["parsed", "ready"] } },
    select: { id: true, status: true },
  });

  if (needed.length === 0) {
    console.log("All candidates already have status=parsed/ready, skipping pipeline run.");
    return { ok: versionIds, failed: [] };
  }

  console.log(`\nEnqueueing run_pipeline for ${needed.length} version(s)...`);
  for (const v of needed) {
    if (args.dryRun) {
      console.log(`  [dry-run] would enqueue ${v.id.slice(0, 8)}`);
      continue;
    }
    await queue.add("run_pipeline", { versionId: v.id }, { attempts: 2, backoff: { type: "exponential", delay: 15000 } });
    console.log(`  enqueued ${v.id.slice(0, 8)} (was ${v.status})`);
  }

  if (args.dryRun || args.noWait) {
    return { ok: args.noWait ? [] : versionIds, failed: [] };
  }

  console.log(`\nWaiting for pipeline completion (timeout ${PIPELINE_TIMEOUT_MS / 1000}s)...`);
  const start = Date.now();
  const targetIds = needed.map((n) => n.id);

  while (Date.now() - start < PIPELINE_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const rows = await prisma.documentVersion.findMany({
      where: { id: { in: targetIds } },
      select: { id: true, status: true },
    });
    const elapsed = Math.round((Date.now() - start) / 1000);
    const summary = rows
      .slice(0, 5)
      .map((r) => `${r.id.slice(0, 6)}=${r.status}`)
      .join(" ");
    process.stdout.write(`  [${elapsed}s] ${summary}${rows.length > 5 ? ` (+${rows.length - 5})` : ""}\r`);

    const allDone = rows.every((r) => TERMINAL_STATUSES.has(r.status));
    if (allDone) {
      console.log("");
      const failed = rows.filter((r) => r.status === "error").map((r) => r.id);
      const ok = rows.filter((r) => r.status === "parsed" || r.status === "ready").map((r) => r.id);
      const others = versionIds.filter((id) => !targetIds.includes(id));
      return { ok: [...ok, ...others], failed };
    }
  }

  console.log("");
  console.error(`Timeout waiting for pipeline. Continuing with whatever finished.`);
  const final = await prisma.documentVersion.findMany({
    where: { id: { in: targetIds } },
    select: { id: true, status: true },
  });
  const failed = final.filter((r) => !TERMINAL_STATUSES.has(r.status) || r.status === "error").map((r) => r.id);
  const ok = final.filter((r) => r.status === "parsed" || r.status === "ready").map((r) => r.id);
  const others = versionIds.filter((id) => !targetIds.includes(id));
  return { ok: [...ok, ...others], failed };
}

async function seedGoldenSample(
  prisma: PrismaClient,
  args: Args,
  version: { id: string; document: { id: string; title: string; type: DocumentType } },
  createdById: string,
): Promise<{ goldenSampleId: string; factCount: number } | null> {
  const facts = await prisma.fact.findMany({
    where: { docVersionId: version.id },
    select: {
      factKey: true,
      factCategory: true,
      value: true,
      manualValue: true,
      standardSectionCode: true,
      sources: true,
      status: true,
    },
  });

  if (facts.length === 0) {
    console.log(`  → no facts found for ${version.id.slice(0, 8)}, skipping`);
    return null;
  }

  const expectedFacts = facts.map((f) => {
    const fact: Record<string, unknown> = {
      factKey: f.factKey,
      factCategory: f.factCategory,
      value: f.manualValue ?? f.value,
      status: f.status,
    };
    if (f.standardSectionCode) fact.sectionStandardCode = f.standardSectionCode;
    const srcText = extractSourceText(f.sources);
    if (srcText) fact.sourceText = srcText;
    return fact;
  });

  const sampleName = `${args.sampleNamePrefix}${version.document.title}`.slice(0, 200);

  if (args.dryRun) {
    console.log(`  [dry-run] would create GoldenSample "${sampleName}" with ${expectedFacts.length} facts`);
    return { goldenSampleId: "dry-run", factCount: expectedFacts.length };
  }

  const expectedResultsJson: unknown = { facts: expectedFacts };
  const created = await prisma.$transaction(async (tx) => {
    const sample = await tx.goldenSample.create({
      data: {
        tenantId: args.tenantId,
        name: sampleName,
        sampleType: "single_document",
        description: `Auto-prelabeled from DocumentVersion ${version.id} (pipeline-extracted facts; needs expert review)`,
        createdById,
      },
    });

    await tx.goldenSampleDocument.create({
      data: {
        goldenSampleId: sample.id,
        documentVersionId: version.id,
        documentType: version.document.type,
        role: "primary",
        order: 0,
      },
    });

    await tx.goldenSampleStageStatus.create({
      data: {
        goldenSampleId: sample.id,
        stage: "fact_extraction",
        status: "draft",
        expectedResults: expectedResultsJson as object,
      },
    });

    return sample;
  });

  return { goldenSampleId: created.id, factCount: expectedFacts.length };
}

async function main() {
  const args = parseArgs();
  const prisma = new PrismaClient();

  console.log("=== Pre-label raw corpus ===");
  console.log(`Tenant:            ${args.tenantId}`);
  console.log(`Document type:     ${args.docType}`);
  console.log(`Limit:             ${args.limit ?? "unlimited"}`);
  console.log(`Skip pipeline:     ${args.skipPipeline}`);
  console.log(`No-wait:           ${args.noWait}`);
  console.log(`Dry run:           ${args.dryRun}`);
  console.log("");

  const createdById = await resolveCreatorId(prisma, args);
  console.log(`Creator user:      ${createdById}`);
  console.log("");

  const candidates = await findCandidates(prisma, args);
  if (candidates.length === 0) {
    console.log("No candidate DocumentVersion'ов (всё уже разобрано в GoldenSample). Nothing to do.");
    await prisma.$disconnect();
    return;
  }

  console.log(`Found ${candidates.length} candidate DocumentVersion'ов:`);
  for (const c of candidates.slice(0, 20)) {
    console.log(`  - ${c.id.slice(0, 8)}  ${c.status.padEnd(10)}  ${c.document.title.slice(0, 80)}`);
  }
  if (candidates.length > 20) console.log(`  ... and ${candidates.length - 20} more`);
  console.log("");

  if (args.dryRun) {
    console.log("[dry-run] not enqueueing pipeline / not creating samples");
    await prisma.$disconnect();
    return;
  }

  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue("processing", { connection });

  const { ok, failed } = await ensurePipelineDone(
    prisma,
    queue,
    candidates.map((c) => c.id),
    args,
  );

  if (failed.length > 0) {
    console.log(`\nPipeline failed for ${failed.length} version(s) — they will be skipped:`);
    for (const id of failed.slice(0, 10)) console.log(`  - ${id}`);
  }

  console.log(`\nSeeding golden samples for ${ok.length} version(s)...`);
  const okSet = new Set(ok);
  let seeded = 0;
  let skipped = 0;
  for (const v of candidates) {
    if (!okSet.has(v.id)) {
      skipped++;
      continue;
    }
    const result = await seedGoldenSample(prisma, args, v, createdById);
    if (result) {
      console.log(`  ✓ ${v.id.slice(0, 8)} → sample ${result.goldenSampleId.slice(0, 8)} (${result.factCount} facts)`);
      seeded++;
    } else {
      skipped++;
    }
  }

  console.log("");
  console.log(`=== Done: seeded ${seeded}, skipped ${skipped}, failed pipeline ${failed.length} ===`);
  console.log(`Next: open rule-admin → Эталонные наборы → выберите sample → этап «Извлечение» и подтвердите/правьте факты.`);

  await connection.quit();
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
