/**
 * One-shot script: находит секции с isFalseHeading=true но всё ещё имеющие
 * привязку к зоне (standardSection / algoSection / llmSection != null) или
 * orphan annotations / expected_results entries. Применяет cleanup как в
 * `documentService.markSectionFalseHeading` — но retroactively для данных
 * накопленных ДО фикса cascade cleanup (см. PR feat/false-heading-cascade-cleanup).
 *
 * Usage (из docker-контейнера api):
 *   npx tsx apps/api/scripts/cleanup-orphan-false-heading-classifications.ts \
 *     --tenant-id=<uuid> [--dry-run]
 *
 * Запускается после deploy чтобы прибрать «грязь» — Section.standardSection
 * остался выставленным несмотря на isFalseHeading=true, GoldenAnnotation'ы
 * по этим секциям висят, expected_results.sections содержит ложные заголовки.
 *
 * NB: для corpus-tenant'а дев-стенда (4dae44bf-2397-4b94-a3d7-b4224d093d68)
 * прогнать СНАЧАЛА с --dry-run, проверить вывод, потом без флага.
 */

import { prisma } from "@clinscriptum/db";

interface Args {
  tenantId: string;
  dryRun: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (key: string) =>
    argv.find((a) => a.startsWith(`--${key}=`))?.slice(key.length + 3);
  const has = (key: string) => argv.includes(`--${key}`);
  const tenantId = get("tenant-id");
  if (!tenantId) {
    console.error("ERROR: --tenant-id=<uuid> is required");
    console.error(
      "Usage: npx tsx apps/api/scripts/cleanup-orphan-false-heading-classifications.ts --tenant-id=<uuid> [--dry-run]",
    );
    process.exit(1);
  }
  return { tenantId, dryRun: has("dry-run") };
}

async function main() {
  const args = parseArgs();
  console.log("=== Cleanup orphan false-heading classifications ===");
  console.log(`Tenant:  ${args.tenantId}`);
  console.log(`Dry run: ${args.dryRun}\n`);

  // 1. Найти все Section'ы где tenant matches AND isFalseHeading=true AND
  //    осталась привязка к зоне (standardSection/algoSection/llmSection != null).
  //    Это «orphan classifications» — основной маркер pre-fix грязи.
  const orphanSections = await prisma.section.findMany({
    where: {
      isFalseHeading: true,
      docVersion: {
        document: { study: { tenantId: args.tenantId } },
      },
      OR: [
        { standardSection: { not: null } },
        { algoSection: { not: null } },
        { llmSection: { not: null } },
      ],
    },
    select: {
      id: true,
      title: true,
      docVersionId: true,
      standardSection: true,
      algoSection: true,
      llmSection: true,
    },
  });

  if (orphanSections.length === 0) {
    console.log("No orphan false-heading classifications found — nothing to do.");
    return;
  }

  console.log(`Found ${orphanSections.length} false-heading sections still bound to a zone:\n`);

  let totalAnnotations = 0;
  let totalExpectedEntries = 0;
  let totalSectionsProcessed = 0;

  for (let i = 0; i < orphanSections.length; i++) {
    const sec = orphanSections[i];
    const idx = `[${i + 1}/${orphanSections.length}]`;
    const sectionKey = sec.title.trim().toLowerCase();
    const zoneSummary = [
      sec.standardSection ? `standard=${sec.standardSection}` : null,
      sec.algoSection ? `algo=${sec.algoSection}` : null,
      sec.llmSection ? `llm=${sec.llmSection}` : null,
    ]
      .filter(Boolean)
      .join(", ");

    // 2. Найти связанные annotations.
    const annotations = await prisma.goldenAnnotation.findMany({
      where: {
        sectionKey,
        goldenSample: {
          documents: { some: { documentVersionId: sec.docVersionId } },
        },
      },
      select: { id: true },
    });

    // 3. Найти expected_results entries.
    const stageStatuses = await prisma.goldenSampleStageStatus.findMany({
      where: {
        goldenSample: {
          documents: { some: { documentVersionId: sec.docVersionId } },
        },
      },
    });
    let pendingExpectedEntries = 0;
    const stageStatusUpdates: Array<{ id: string; updatedExpected: object }> = [];
    for (const ss of stageStatuses) {
      const expected = (ss.expectedResults ?? {}) as {
        sections?: Array<{ title?: string }>;
      };
      if (!Array.isArray(expected.sections)) continue;
      const before = expected.sections.length;
      const filtered = expected.sections.filter(
        (s) => (s.title ?? "").trim().toLowerCase() !== sectionKey,
      );
      const removed = before - filtered.length;
      if (removed > 0) {
        pendingExpectedEntries += removed;
        stageStatusUpdates.push({
          id: ss.id,
          updatedExpected: { ...expected, sections: filtered },
        });
      }
    }

    console.log(
      `${idx} "${sec.title.slice(0, 60)}" — zone[${zoneSummary}], annotations=${annotations.length}, expectedEntries=${pendingExpectedEntries}`,
    );

    totalAnnotations += annotations.length;
    totalExpectedEntries += pendingExpectedEntries;

    if (args.dryRun) continue;

    // 4. Apply cleanup в одной транзакции.
    await prisma.$transaction(async (tx) => {
      await tx.section.update({
        where: { id: sec.id },
        data: {
          standardSection: null,
          algoSection: null,
          algoConfidence: 0,
          llmSection: null,
          llmConfidence: 0,
          classifiedBy: null,
          confidence: 0,
          classificationStatus: "not_validated",
          classificationComment: null,
        },
      });

      if (annotations.length > 0) {
        await tx.goldenAnnotation.deleteMany({
          where: { id: { in: annotations.map((a) => a.id) } },
        });
      }

      for (const upd of stageStatusUpdates) {
        await tx.goldenSampleStageStatus.update({
          where: { id: upd.id },
          data: { expectedResults: upd.updatedExpected },
        });
      }
    });

    totalSectionsProcessed++;
  }

  console.log("\n=== Summary ===");
  if (args.dryRun) {
    console.log(`Would clean ${orphanSections.length} sections`);
    console.log(`Would delete ${totalAnnotations} annotations`);
    console.log(`Would clear  ${totalExpectedEntries} expected entries`);
    console.log("\n(dry-run — no DB changes applied)");
  } else {
    console.log(`Cleaned ${totalSectionsProcessed} sections, deleted ${totalAnnotations} annotations, cleared ${totalExpectedEntries} expected entries`);
  }
}

main()
  .catch((err) => {
    console.error("FATAL:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
