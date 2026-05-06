/**
 * Bulk-upload corpus DOCX → DocumentVersions + GoldenSample drafts.
 *
 * Reads .docx files from a directory, creates one Document + DocumentVersion
 * per file (uploads to MinIO/local storage), and creates a GoldenSample row
 * per document with stage='classification' status='draft'. Then enqueues
 * `run_pipeline` for each version so the parser + classifier run on it.
 *
 * Designed for the Sprint 7 annotation workflow:
 *  1. Run this once to populate a tenant with the whole corpus
 *  2. Annotator (1 person) opens each GoldenSample in rule-admin and reviews
 *     the predictions section by section, marking each as accepted / changed /
 *     question-for-expert
 *  3. Expert resolves questions; final expectedResults populated
 *
 * Idempotent: if Document with same title already exists in the study,
 * a new versionNumber is appended (instead of duplicating the document).
 *
 * Usage (inside workers container):
 *   npx tsx apps/workers/scripts/bulk-upload-corpus.ts \
 *     --source=/opt/clinscriptum/data/corpus_2026_05_06 \
 *     --tenant-name="Corpus 2026-05-06" \
 *     --study-name="Bulk Corpus 2026-05-06"
 *
 * Options:
 *   --source=<path>            (required) directory containing .docx files
 *   --tenant-id=<uuid>         use existing tenant; otherwise creates new
 *   --tenant-name=<str>        new-tenant display name (when --tenant-id absent)
 *   --tenant-slug=<str>        new-tenant slug (default: derived from name)
 *   --study-name=<str>         study name within tenant (default: same as tenant-name)
 *   --admin-user-email=<email> admin user email (default: admin@corpus.local)
 *   --document-type=<str>      protocol|icf|ib|csr (default: protocol)
 *   --enqueue                  enqueue run_pipeline jobs after upload (default: true)
 *   --no-enqueue               skip enqueue (useful for re-run or measurement)
 *   --limit=N                  upload only first N files
 *   --dry-run                  show what would be done, do nothing
 */

import { prisma } from "@clinscriptum/db";
import { createStorageProvider } from "../src/api-shared/storage.js";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { readdirSync, readFileSync } from "node:fs";
import { resolve, basename, extname } from "node:path";
import { randomUUID } from "node:crypto";
import * as bcrypt from "bcryptjs";

interface Args {
  source: string;
  tenantId?: string;
  tenantName: string;
  tenantSlug?: string;
  studyName: string;
  adminEmail: string;
  documentType: "protocol" | "icf" | "ib" | "csr";
  enqueue: boolean;
  limit?: number;
  dryRun: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (key: string): string | undefined => {
    const arg = argv.find((a) => a.startsWith(`--${key}=`));
    return arg ? arg.slice(key.length + 3) : undefined;
  };
  const has = (key: string): boolean => argv.includes(`--${key}`);

  const source = get("source");
  if (!source) {
    console.error("ERROR: --source=<path> is required");
    process.exit(1);
  }

  const tenantName = get("tenant-name") ?? "Corpus Tenant";
  const limitStr = get("limit");

  return {
    source,
    tenantId: get("tenant-id"),
    tenantName,
    tenantSlug: get("tenant-slug"),
    studyName: get("study-name") ?? tenantName,
    adminEmail: get("admin-user-email") ?? "admin@corpus.local",
    documentType: (get("document-type") as Args["documentType"]) ?? "protocol",
    enqueue: !has("no-enqueue"),
    limit: limitStr ? parseInt(limitStr, 10) : undefined,
    dryRun: has("dry-run"),
  };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

async function ensureTenant(args: Args) {
  if (args.tenantId) {
    const existing = await prisma.tenant.findUnique({ where: { id: args.tenantId } });
    if (!existing) {
      console.error(`Tenant ${args.tenantId} not found`);
      process.exit(1);
    }
    console.log(`Using existing tenant: ${existing.name} (${existing.id})`);
    return existing;
  }
  const slug = args.tenantSlug ?? slugify(args.tenantName);
  const existing = await prisma.tenant.findUnique({ where: { slug } });
  if (existing) {
    console.log(`Found tenant by slug: ${existing.name} (${existing.id})`);
    return existing;
  }
  if (args.dryRun) {
    console.log(`[dry-run] Would create tenant: ${args.tenantName} (slug=${slug})`);
    return { id: "dry-run-tenant", name: args.tenantName, slug } as any;
  }
  const tenant = await prisma.tenant.create({
    data: { name: args.tenantName, slug },
  });
  console.log(`Created tenant: ${tenant.name} (${tenant.id})`);
  return tenant;
}

async function ensureAdminUser(tenantId: string, email: string, dryRun: boolean) {
  const existing = await prisma.user.findFirst({
    where: { email, tenantId },
  });
  if (existing) return existing;
  if (dryRun) {
    console.log(`[dry-run] Would create admin user: ${email}`);
    return { id: "dry-run-user", email } as any;
  }
  const passwordHash = await bcrypt.hash(randomUUID(), 10);
  const user = await prisma.user.create({
    data: {
      tenantId,
      email,
      name: "Bulk Upload Admin",
      passwordHash,
      role: "tenant_admin",
    },
  });
  console.log(`Created admin user: ${email} (${user.id})`);
  return user;
}

async function ensureStudy(
  tenantId: string,
  name: string,
  createdById: string,
  dryRun: boolean,
) {
  const existing = await prisma.study.findFirst({
    where: { tenantId, name },
  });
  if (existing) return existing;
  if (dryRun) {
    console.log(`[dry-run] Would create study: ${name}`);
    return { id: "dry-run-study", name } as any;
  }
  const study = await prisma.study.create({
    data: {
      tenantId,
      name,
      protocolNumber: `CORPUS-${slugify(name)}`,
      indication: "n/a (corpus)",
      phase: "n/a",
      sponsor: "n/a (bulk import)",
      createdById,
    },
  });
  console.log(`Created study: ${study.name} (${study.id})`);
  return study;
}

async function uploadFile(filePath: string, storageKey: string, dryRun: boolean): Promise<string> {
  if (dryRun) return `dry-run://${storageKey}`;
  const data = readFileSync(filePath);
  const storage = createStorageProvider();
  await storage.upload(storageKey, data);
  return storage.getUrl(storageKey);
}

async function main() {
  const args = parseArgs();
  console.log("=== Bulk Upload Corpus ===");
  console.log(`Source dir: ${args.source}`);
  console.log(`Tenant: ${args.tenantId ?? args.tenantName}`);
  console.log(`Study: ${args.studyName}`);
  console.log(`Doc type: ${args.documentType}`);
  console.log(`Enqueue: ${args.enqueue}`);
  console.log(`Dry run: ${args.dryRun}`);
  console.log("");

  const files = readdirSync(args.source)
    .filter((f) => f.toLowerCase().endsWith(".docx"))
    .sort();
  if (files.length === 0) {
    console.error(`No .docx files in ${args.source}`);
    process.exit(1);
  }
  const filesToProcess = args.limit ? files.slice(0, args.limit) : files;
  console.log(`Found ${files.length} .docx files; will process ${filesToProcess.length}\n`);

  const tenant = await ensureTenant(args);
  const adminUser = await ensureAdminUser(tenant.id, args.adminEmail, args.dryRun);
  const study = await ensureStudy(tenant.id, args.studyName, adminUser.id, args.dryRun);

  const queue = args.enqueue && !args.dryRun
    ? new Queue("processing", { connection: new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null }) })
    : null;

  let createdCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (let i = 0; i < filesToProcess.length; i++) {
    const file = filesToProcess[i];
    const idx = `[${i + 1}/${filesToProcess.length}]`;
    const title = basename(file, extname(file));

    try {
      const existing = await prisma.document.findFirst({
        where: { studyId: study.id, title, type: args.documentType },
        include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
      });

      if (existing) {
        skippedCount++;
        console.log(`${idx} SKIP (exists): ${title}`);
        continue;
      }

      const filePath = resolve(args.source, file);
      const documentId = randomUUID();
      const versionId = randomUUID();
      const storageKey = `${tenant.id}/${documentId}/v1.docx`;
      const fileUrl = await uploadFile(filePath, storageKey, args.dryRun);

      if (!args.dryRun) {
        await prisma.$transaction(async (tx) => {
          const doc = await tx.document.create({
            data: {
              id: documentId,
              studyId: study.id,
              type: args.documentType,
              title,
            },
          });
          await tx.documentVersion.create({
            data: {
              id: versionId,
              documentId: doc.id,
              versionNumber: 1,
              versionLabel: "v1",
              fileUrl,
              status: "uploading",
              isCurrent: true,
            },
          });
          const goldenSample = await tx.goldenSample.create({
            data: {
              tenantId: tenant.id,
              name: title,
              description: `Bulk-uploaded from ${file}`,
              sampleType: "single_document",
              createdById: adminUser.id,
            },
          });
          await tx.goldenSampleDocument.create({
            data: {
              goldenSampleId: goldenSample.id,
              documentVersionId: versionId,
              documentType: args.documentType,
              role: "primary",
              order: 0,
            },
          });
          // Создаём пустой stage status для классификации в draft —
          // annotator будет позже наполнять через annotation UI.
          await tx.goldenSampleStageStatus.create({
            data: {
              goldenSampleId: goldenSample.id,
              stage: "classification",
              status: "draft",
              expectedResults: {},
            },
          });
        });
      }

      if (queue) {
        await queue.add(
          "run_pipeline",
          { versionId },
          { attempts: 2, backoff: { type: "exponential", delay: 15000 } },
        );
      }

      createdCount++;
      console.log(`${idx} ✓ ${title} → versionId ${versionId.slice(0, 8)}`);
    } catch (err) {
      errorCount++;
      console.error(`${idx} ERR ${title}: ${String(err).slice(0, 200)}`);
    }
  }

  if (queue) {
    await queue.close();
  }

  console.log("");
  console.log("=== Done ===");
  console.log(`Created: ${createdCount}`);
  console.log(`Skipped (existing): ${skippedCount}`);
  console.log(`Errors: ${errorCount}`);
  console.log(`Tenant ID: ${tenant.id}`);
  console.log(`Study ID:  ${study.id}`);
  if (args.enqueue && createdCount > 0 && !args.dryRun) {
    console.log("");
    console.log("Pipeline jobs enqueued. Watch progress with:");
    console.log(`  docker compose -f docker-compose.prod.yml logs -f workers | grep -i pipeline`);
  }

  await prisma.$disconnect();
  process.exit(errorCount > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("FATAL:", err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
