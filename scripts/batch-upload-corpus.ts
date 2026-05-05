/**
 * Batch upload корпуса .doc/.docx в указанный tenant + study.
 *
 * Покрывает шаг, который рукой делать дорого: 200 DOCX → 200 DocumentVersion'ов
 * со статусом `parsing` и enqueue'нутыми job'ами `run_pipeline`. Дальше
 * `prelabel-raw-corpus.ts --skip-pipeline` засеет golden-черновики.
 *
 * Что делает:
 *   1. Находит/создаёт Study (default name «Pre-label corpus») в tenant.
 *   2. Для каждого *.doc / *.docx в --corpus:
 *      - Legacy .doc сначала конвертируется в .docx через LibreOffice headless
 *        (`soffice` или `libreoffice` в PATH). Если конвертер недоступен —
 *        файл пропускается с понятной ошибкой.
 *      - Извлекаем первые ~5000 символов через mammoth и классифицируем тип
 *        документа эвристикой (см. lib/document-classifier.ts). Если тип НЕ
 *        совпадает с --doc-type и не передан --allow-mismatch — пропускаем
 *        (защита от случайно попавших в корпус ICF/IB/CSR).
 *      - Если Document с таким же title уже существует в study — пропускает.
 *      - Иначе создаёт Document + DocumentVersion(versionNumber=1, status='uploading').
 *      - Кладёт байты (.docx) в storage (local FS или S3).
 *      - Меняет статус DocumentVersion на 'parsing' и enqueue'ит `run_pipeline`.
 *   3. По умолчанию — ждёт пока все DocumentVersion не дойдут до terminal-статуса
 *      (parsed/error/ready). Timeout 30 мин на всю партию. С --no-wait сразу выходит.
 *
 * Запуск:
 *   npx tsx --env-file=.env scripts/batch-upload-corpus.ts --corpus=C:/protocol_corpus
 *   npx tsx --env-file=.env scripts/batch-upload-corpus.ts --corpus=./protocols --limit=10 --dry-run
 *   npx tsx --env-file=.env scripts/batch-upload-corpus.ts --corpus=./protocols --allow-mismatch
 *
 * Опции:
 *   --corpus=<dir>          обязательно. Директория с DOC/DOCX-файлами.
 *   --tenant=<uuid>         default: 00000000-0000-0000-0000-000000000002 (Golden Set).
 *   --study=<uuid>          конкретная study; если не задан — find-or-create по name.
 *   --study-name=<str>      default: «Pre-label corpus». Используется при auto-create.
 *   --doc-type=<type>       default: protocol (protocol|icf|ib|csr). Файлы другого
 *                           классифицированного типа пропускаются (если не --allow-mismatch).
 *   --limit=<N>             загрузить максимум N файлов.
 *   --dry-run               только показать план, без записи.
 *   --no-wait               enqueue и сразу выйти (без поллинга).
 *   --no-classify           пропустить классификацию (загрузить всё как --doc-type).
 *                           Полезно если корпус уже отфильтрован вручную.
 *   --allow-mismatch        классификация выполнена, но mismatch'и НЕ пропускаются —
 *                           всё загружается как --doc-type. Логирует mismatch'и.
 *   --version-label=<str>   default: v1.0
 *
 * Идемпотентность: повторный запуск на той же директории НЕ создаёт дубликаты —
 * Document'ы матчатся по (studyId, type, title). Title = filename без расширения.
 */

import { PrismaClient, type DocumentType } from "@prisma/client";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { classifyDocumentText, extractDocxFirstText, type DocumentTypeGuess } from "./lib/document-classifier.js";
import { ConverterNotFoundError, convertDocToDocx, isConverterAvailable } from "./lib/doc-to-docx.js";

const GOLDEN_SET_TENANT_ID = "00000000-0000-0000-0000-000000000002";
const POLL_INTERVAL_MS = 5000;
const PIPELINE_TIMEOUT_MS = 30 * 60 * 1000;

const TERMINAL_STATUSES = new Set(["parsed", "error", "ready"]);

interface Args {
  corpusDir: string;
  tenantId: string;
  studyId?: string;
  studyName: string;
  docType: DocumentType;
  limit?: number;
  dryRun: boolean;
  noWait: boolean;
  versionLabel: string;
  noClassify: boolean;
  allowMismatch: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (key: string) => {
    const arg = argv.find((a) => a.startsWith(`--${key}=`));
    return arg ? arg.slice(key.length + 3) : undefined;
  };
  const has = (key: string) => argv.includes(`--${key}`);

  const corpusDir = get("corpus");
  if (!corpusDir) {
    console.error("Required: --corpus=<dir>");
    process.exit(1);
  }
  const docTypeRaw = get("doc-type") ?? "protocol";
  if (!["protocol", "icf", "ib", "csr"].includes(docTypeRaw)) {
    console.error(`Invalid --doc-type=${docTypeRaw}. Allowed: protocol|icf|ib|csr`);
    process.exit(1);
  }
  const limit = get("limit");

  return {
    corpusDir: path.resolve(corpusDir),
    tenantId: get("tenant") ?? GOLDEN_SET_TENANT_ID,
    studyId: get("study"),
    studyName: get("study-name") ?? "Pre-label corpus",
    docType: docTypeRaw as DocumentType,
    limit: limit ? parseInt(limit, 10) : undefined,
    dryRun: has("dry-run"),
    noWait: has("no-wait"),
    versionLabel: get("version-label") ?? "v1.0",
    noClassify: has("no-classify"),
    allowMismatch: has("allow-mismatch"),
  };
}

interface StorageProvider {
  upload(key: string, data: Buffer): Promise<void>;
}

class LocalStorage implements StorageProvider {
  constructor(private basePath: string) {}
  async upload(key: string, data: Buffer): Promise<void> {
    const filePath = path.join(this.basePath, key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, data);
  }
}

class S3Storage implements StorageProvider {
  private bucket: string;
  private client: unknown;
  constructor() {
    this.bucket = process.env.S3_BUCKET ?? "clinscriptum";
  }
  private async getClient() {
    if (this.client) return this.client;
    const { S3Client } = await import("@aws-sdk/client-s3");
    this.client = new S3Client({
      region: process.env.S3_REGION ?? "us-east-1",
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: !!process.env.S3_ENDPOINT,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
      },
    });
    return this.client;
  }
  async upload(key: string, data: Buffer): Promise<void> {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = (await this.getClient()) as { send: (cmd: unknown) => Promise<unknown> };
    await client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data }));
  }
}

function makeStorage(): StorageProvider {
  const type = process.env.STORAGE_TYPE ?? "local";
  if (type === "s3") return new S3Storage();
  return new LocalStorage(process.env.STORAGE_LOCAL_PATH ?? "./uploads");
}

async function findOrCreateStudy(prisma: PrismaClient, args: Args) {
  if (args.studyId) {
    const study = await prisma.study.findFirst({
      where: { id: args.studyId, tenantId: args.tenantId },
    });
    if (!study) {
      throw new Error(`Study ${args.studyId} not found in tenant ${args.tenantId}`);
    }
    return study;
  }

  const existing = await prisma.study.findFirst({
    where: { tenantId: args.tenantId, title: args.studyName },
  });
  if (existing) return existing;

  if (args.dryRun) {
    console.log(`[dry-run] would create Study "${args.studyName}" in tenant ${args.tenantId}`);
    return {
      id: "dry-run-study",
      tenantId: args.tenantId,
      title: args.studyName,
      sponsor: null,
      drug: null,
      therapeuticArea: null,
      protocolTitle: null,
      phase: "",
      operatorReviewEnabled: false,
      llmThinkingEnabled: false,
      excludedSectionPrefixes: [],
      auditMode: "auto",
      crossCheckPairs: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  const created = await prisma.study.create({
    data: {
      tenantId: args.tenantId,
      title: args.studyName,
      phase: "",
    },
  });
  console.log(`Created Study ${created.id} (${created.title})`);
  return created;
}

async function listSourceFiles(corpusDir: string, limit?: number): Promise<string[]> {
  const stat = await fs.stat(corpusDir).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`--corpus=${corpusDir} is not a directory`);
  }
  const entries = await fs.readdir(corpusDir, { withFileTypes: true });
  const files = entries
    .filter((e) => {
      if (!e.isFile() || e.name.startsWith("~$")) return false;
      const lower = e.name.toLowerCase();
      return lower.endsWith(".doc") || lower.endsWith(".docx");
    })
    .map((e) => path.join(corpusDir, e.name))
    .sort();
  return limit ? files.slice(0, limit) : files;
}

function deriveTitle(filePath: string): string {
  const base = path.basename(filePath, path.extname(filePath));
  return base.slice(0, 200);
}

/**
 * Возвращает путь к .docx-варианту файла. Для .docx — оригинал. Для .doc — конвертирует
 * в указанную tmp-директорию. Если конвертер недоступен — бросает ConverterNotFoundError.
 */
async function ensureDocx(filePath: string, tmpDir: string): Promise<{ docxPath: string; isConverted: boolean }> {
  if (filePath.toLowerCase().endsWith(".docx")) {
    return { docxPath: filePath, isConverted: false };
  }
  const converted = await convertDocToDocx(filePath, tmpDir);
  return { docxPath: converted, isConverted: true };
}

interface UploadResult {
  status: "uploaded" | "skipped";
  versionId?: string;
  reason?: string;
  classifiedAs?: DocumentTypeGuess;
  classifierConfidence?: number;
}

async function uploadOne(
  prisma: PrismaClient,
  queue: Queue,
  storage: StorageProvider,
  args: Args,
  studyId: string,
  filePath: string,
  tmpDir: string,
): Promise<UploadResult> {
  const title = deriveTitle(filePath);

  const existing = await prisma.document.findFirst({
    where: { studyId, type: args.docType, title },
    include: { versions: { take: 1 } },
  });
  if (existing) {
    return { status: "skipped", reason: `document "${title}" already exists` };
  }

  let prepared: { docxPath: string; isConverted: boolean };
  try {
    prepared = await ensureDocx(filePath, tmpDir);
  } catch (err) {
    if (err instanceof ConverterNotFoundError) {
      return { status: "skipped", reason: `cannot convert .doc — LibreOffice not in PATH (${err.message.split("\n")[0]})` };
    }
    return { status: "skipped", reason: `convert failed: ${(err as Error).message}` };
  }
  const { docxPath, isConverted } = prepared;
  const cleanupConverted = async () => {
    if (isConverted) await fs.unlink(docxPath).catch(() => {});
  };

  let classifiedAs: DocumentTypeGuess | undefined;
  let classifierConfidence: number | undefined;
  if (!args.noClassify) {
    try {
      const text = await extractDocxFirstText(docxPath, 5000);
      const classification = classifyDocumentText(text);
      classifiedAs = classification.type;
      classifierConfidence = classification.confidence;

      if (classification.type !== args.docType && !args.allowMismatch) {
        await cleanupConverted();
        return {
          status: "skipped",
          reason: `classified as ${classification.type} (conf=${classification.confidence.toFixed(2)}), expected ${args.docType}`,
          classifiedAs,
          classifierConfidence,
        };
      }
    } catch (err) {
      await cleanupConverted();
      return { status: "skipped", reason: `classifier failed: ${(err as Error).message}` };
    }
  }

  if (args.dryRun) {
    await cleanupConverted();
    return { status: "uploaded", reason: "dry-run", classifiedAs, classifierConfidence };
  }

  const buffer = await fs.readFile(docxPath);

  const result = await prisma.$transaction(async (tx) => {
    const doc = await tx.document.create({
      data: { studyId, type: args.docType, title },
    });
    const key = `${args.tenantId}/${studyId}/${doc.id}/v1.docx`;
    const version = await tx.documentVersion.create({
      data: {
        documentId: doc.id,
        versionNumber: 1,
        versionLabel: args.versionLabel,
        fileUrl: key,
        status: "uploading",
        isCurrent: true,
      },
    });
    return { docId: doc.id, versionId: version.id, key };
  });

  await storage.upload(result.key, buffer);
  await prisma.documentVersion.update({
    where: { id: result.versionId },
    data: { status: "parsing" },
  });
  await queue.add(
    "run_pipeline",
    { versionId: result.versionId },
    { attempts: 2, backoff: { type: "exponential", delay: 15000 } },
  );

  await cleanupConverted();

  return { status: "uploaded", versionId: result.versionId, classifiedAs, classifierConfidence };
}

async function waitForPipeline(prisma: PrismaClient, versionIds: string[]) {
  if (versionIds.length === 0) return;
  console.log(`\nWaiting for pipeline (${versionIds.length} versions, timeout ${PIPELINE_TIMEOUT_MS / 1000}s)...`);
  const start = Date.now();
  while (Date.now() - start < PIPELINE_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const rows = await prisma.documentVersion.findMany({
      where: { id: { in: versionIds } },
      select: { id: true, status: true },
    });
    const elapsed = Math.round((Date.now() - start) / 1000);
    const counts = rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    }, {});
    const summary = Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(" ");
    process.stdout.write(`  [${elapsed}s] ${summary}\r`);
    if (rows.every((r) => TERMINAL_STATUSES.has(r.status))) {
      console.log("");
      const errors = rows.filter((r) => r.status === "error");
      if (errors.length > 0) {
        console.error(`  ${errors.length} version(s) ended in 'error' status.`);
      }
      return;
    }
  }
  console.log("");
  console.error(`Timeout. Some versions still processing — check apps/workers logs.`);
}

async function main() {
  const args = parseArgs();
  const prisma = new PrismaClient();

  console.log("=== Batch upload corpus ===");
  console.log(`Corpus dir:     ${args.corpusDir}`);
  console.log(`Tenant:         ${args.tenantId}`);
  console.log(`Study:          ${args.studyId ?? "(auto: " + args.studyName + ")"}`);
  console.log(`Doc type:       ${args.docType}`);
  console.log(`Limit:          ${args.limit ?? "unlimited"}`);
  console.log(`Storage:        ${process.env.STORAGE_TYPE ?? "local"}`);
  console.log(`Classify:       ${args.noClassify ? "disabled" : args.allowMismatch ? "log-only" : "strict (skip mismatches)"}`);
  console.log(`Dry run:        ${args.dryRun}`);
  console.log("");

  const files = await listSourceFiles(args.corpusDir, args.limit);
  if (files.length === 0) {
    console.log("No .doc/.docx files found in corpus dir. Nothing to do.");
    await prisma.$disconnect();
    return;
  }
  const docCount = files.filter((f) => f.toLowerCase().endsWith(".doc")).length;
  const docxCount = files.length - docCount;
  console.log(`Found ${files.length} file(s): ${docxCount} .docx + ${docCount} .doc`);

  if (docCount > 0) {
    const hasConverter = await isConverterAvailable();
    if (!hasConverter) {
      console.warn(
        `\n  Внимание: ${docCount} .doc-файл(ов) обнаружено, но LibreOffice (soffice/libreoffice) не найден в PATH.\n` +
          `  Эти файлы будут пропущены. Установите LibreOffice или предварительно конвертируйте .doc → .docx вручную.\n`,
      );
    } else {
      console.log(`  LibreOffice найден — .doc будут конвертированы в .docx «на лету».`);
    }
  }

  const study = await findOrCreateStudy(prisma, args);

  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue("processing", { connection });
  const storage = makeStorage();

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clinscriptum-batch-"));
  console.log(`  Tmp dir: ${tmpDir}`);

  const uploadedIds: string[] = [];
  let uploaded = 0;
  let skipped = 0;
  let failed = 0;
  const skipReasonCounts: Record<string, number> = {};
  const classifyMismatches: { file: string; classifiedAs: DocumentTypeGuess; conf: number }[] = [];

  for (const filePath of files) {
    try {
      const r = await uploadOne(prisma, queue, storage, args, study.id, filePath, tmpDir);
      if (r.status === "uploaded") {
        uploaded++;
        if (r.versionId) uploadedIds.push(r.versionId);
        const classifierTag = r.classifiedAs ? ` [${r.classifiedAs}=${r.classifierConfidence?.toFixed(2)}]` : "";
        console.log(`  ✓ ${path.basename(filePath)}${classifierTag}${r.versionId ? ` → ${r.versionId.slice(0, 8)}` : ""}`);
        if (r.classifiedAs && r.classifiedAs !== args.docType) {
          classifyMismatches.push({ file: path.basename(filePath), classifiedAs: r.classifiedAs, conf: r.classifierConfidence ?? 0 });
        }
      } else {
        skipped++;
        const shortReason = r.reason?.split(":")[0] ?? "skipped";
        skipReasonCounts[shortReason] = (skipReasonCounts[shortReason] ?? 0) + 1;
        console.log(`  ◦ ${path.basename(filePath)} (${r.reason})`);
      }
    } catch (err) {
      failed++;
      console.error(`  ✗ ${path.basename(filePath)}: ${(err as Error).message}`);
    }
  }

  // Best-effort cleanup of tmp dir (only if empty — converter outputs were unlinked individually)
  await fs.rmdir(tmpDir).catch(() => {});

  console.log("");
  console.log(`=== Upload phase: uploaded ${uploaded}, skipped ${skipped}, failed ${failed} ===`);
  if (Object.keys(skipReasonCounts).length > 0) {
    console.log("Skip breakdown:");
    for (const [r, c] of Object.entries(skipReasonCounts)) console.log(`  - ${r}: ${c}`);
  }
  if (classifyMismatches.length > 0) {
    console.log(`Classification mismatches uploaded with --allow-mismatch (${classifyMismatches.length}):`);
    for (const m of classifyMismatches.slice(0, 10)) {
      console.log(`  - ${m.file} → классифицирован как ${m.classifiedAs} (conf=${m.conf.toFixed(2)})`);
    }
  }

  if (args.dryRun) {
    console.log("[dry-run] no actual writes were made.");
    await connection.quit();
    await prisma.$disconnect();
    return;
  }

  if (!args.noWait) {
    await waitForPipeline(prisma, uploadedIds);
  } else {
    console.log("--no-wait: enqueued, exiting immediately.");
  }

  await connection.quit();
  await prisma.$disconnect();

  console.log("");
  console.log(`Next: npx tsx --env-file=.env scripts/prelabel-raw-corpus.ts ${args.noWait ? "" : "--skip-pipeline "}--tenant=${args.tenantId}`);
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
