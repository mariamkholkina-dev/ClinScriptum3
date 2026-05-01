/**
 * Миграция данных под изменённые ключи taxonomy (PR-1, 2026-05-01).
 *
 * Маппинг:
 *   ip.preclinical_data                        → ip.preclinical_clinical_data
 *   population.contraception_requirements      → procedures.contraception_requirements
 *
 * Что обновляется:
 *  1. sections.standard_section (TEXT)
 *  2. sections.algo_section     (TEXT)  — baseline-выход deterministic
 *  3. sections.llm_section      (TEXT)  — baseline-выход LLM
 *  4. sections.classification_comment (TEXT) — если содержит старый ключ
 *  5. golden_sample_stage_statuses.expected_results (JSONB) —
 *     поле sections[*].standardSection в ground truth
 *
 * Запуск:
 *   npx tsx apps/workers/scripts/migrate-taxonomy-keys.ts             # dry-run, показывает что изменит
 *   npx tsx apps/workers/scripts/migrate-taxonomy-keys.ts --apply     # реально применяет в транзакции
 *
 * Безопасность:
 *  - dry-run по умолчанию
 *  - --apply оборачивает все UPDATE в одну транзакцию
 *  - после apply делает verification: SELECT COUNT(*) с фильтром по старым ключам = 0
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const KEY_MIGRATIONS: Array<{ from: string; to: string }> = [
  { from: "ip.preclinical_data", to: "ip.preclinical_clinical_data" },
  { from: "population.contraception_requirements", to: "procedures.contraception_requirements" },
  // 2026-05-02: merged into design.visit_schedule
  { from: "procedures.schedule_of_assessments", to: "design.visit_schedule" },
];

interface MigrationStats {
  table: string;
  field: string;
  fromKey: string;
  toKey: string;
  matched: number;
}

async function countSectionRefs(field: "standardSection" | "algoSection" | "llmSection" | "classificationComment", key: string): Promise<number> {
  const result = await prisma.section.count({
    where: { [field]: { contains: key } } as Record<string, unknown>,
  });
  return result;
}

async function countExpectedResultsRefs(key: string): Promise<number> {
  // JSON может сериализоваться с пробелом после ":" ("standardSection": "value")
  // или без ("standardSection":"value"). Проверяем оба варианта.
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*) AS count FROM golden_sample_stage_statuses
     WHERE expected_results::text LIKE $1 OR expected_results::text LIKE $2`,
    `%"standardSection":"${key}"%`,
    `%"standardSection": "${key}"%`,
  );
  return Number(rows[0]?.count ?? 0);
}

async function dryRun(): Promise<MigrationStats[]> {
  const stats: MigrationStats[] = [];
  for (const { from, to } of KEY_MIGRATIONS) {
    stats.push({
      table: "sections",
      field: "standard_section",
      fromKey: from,
      toKey: to,
      matched: await countSectionRefs("standardSection", from),
    });
    stats.push({
      table: "sections",
      field: "algo_section",
      fromKey: from,
      toKey: to,
      matched: await countSectionRefs("algoSection", from),
    });
    stats.push({
      table: "sections",
      field: "llm_section",
      fromKey: from,
      toKey: to,
      matched: await countSectionRefs("llmSection", from),
    });
    stats.push({
      table: "sections",
      field: "classification_comment",
      fromKey: from,
      toKey: to,
      matched: await countSectionRefs("classificationComment", from),
    });
    stats.push({
      table: "golden_sample_stage_statuses",
      field: "expected_results",
      fromKey: from,
      toKey: to,
      matched: await countExpectedResultsRefs(from),
    });
  }
  return stats;
}

async function apply(): Promise<MigrationStats[]> {
  return prisma.$transaction(async (tx) => {
    const stats: MigrationStats[] = [];

    for (const { from, to } of KEY_MIGRATIONS) {
      // 1. sections.standard_section — exact match (TEXT, без дробной структуры)
      const sUpdated = await tx.section.updateMany({
        where: { standardSection: from },
        data: { standardSection: to },
      });
      stats.push({ table: "sections", field: "standard_section", fromKey: from, toKey: to, matched: sUpdated.count });

      // 2. sections.algo_section
      const aUpdated = await tx.section.updateMany({
        where: { algoSection: from },
        data: { algoSection: to },
      });
      stats.push({ table: "sections", field: "algo_section", fromKey: from, toKey: to, matched: aUpdated.count });

      // 3. sections.llm_section
      const lUpdated = await tx.section.updateMany({
        where: { llmSection: from },
        data: { llmSection: to },
      });
      stats.push({ table: "sections", field: "llm_section", fromKey: from, toKey: to, matched: lUpdated.count });

      // 4. sections.classification_comment (если содержит старый ключ — заменяем substring)
      const cUpdated = await tx.$executeRawUnsafe(
        `UPDATE sections SET classification_comment = REPLACE(classification_comment, $1, $2) WHERE classification_comment LIKE $3`,
        from,
        to,
        `%${from}%`,
      );
      stats.push({ table: "sections", field: "classification_comment", fromKey: from, toKey: to, matched: cUpdated });

      // 5. golden_sample_stage_statuses.expected_results — JSONB, заменяем
      // оба варианта формата: с пробелом и без. REPLACE применяется ко всему
      // тексту JSON — последовательно для каждого варианта.
      const erUpdated = await tx.$executeRawUnsafe(
        `UPDATE golden_sample_stage_statuses
         SET expected_results = REPLACE(REPLACE(expected_results::text, $1, $2), $3, $4)::jsonb
         WHERE expected_results::text LIKE $5 OR expected_results::text LIKE $6`,
        `"standardSection":"${from}"`,
        `"standardSection":"${to}"`,
        `"standardSection": "${from}"`,
        `"standardSection": "${to}"`,
        `%"standardSection":"${from}"%`,
        `%"standardSection": "${from}"%`,
      );
      stats.push({ table: "golden_sample_stage_statuses", field: "expected_results", fromKey: from, toKey: to, matched: erUpdated });
    }

    return stats;
  });
}

async function verify(): Promise<{ totalRemaining: number; details: MigrationStats[] }> {
  const remaining = await dryRun();
  const totalRemaining = remaining.reduce((sum, s) => sum + s.matched, 0);
  return { totalRemaining, details: remaining };
}

function printStats(label: string, stats: MigrationStats[]) {
  console.log(`\n=== ${label} ===`);
  for (const s of stats) {
    if (s.matched === 0) continue;
    console.log(`  ${s.table}.${s.field}  '${s.fromKey}' → '${s.toKey}'  : ${s.matched} row(s)`);
  }
  const total = stats.reduce((sum, s) => sum + s.matched, 0);
  console.log(`  TOTAL: ${total} row(s)`);
}

async function main() {
  const args = process.argv.slice(2);
  const apply_ = args.includes("--apply");

  console.log(`Mode: ${apply_ ? "APPLY (writing changes in a transaction)" : "DRY-RUN (no changes)"}`);
  console.log(`Migrations:`);
  for (const m of KEY_MIGRATIONS) console.log(`  - '${m.from}' → '${m.to}'`);

  const dryStats = await dryRun();
  printStats("Dry-run preview", dryStats);

  if (!apply_) {
    console.log(`\nNo changes applied. Re-run with --apply to execute.`);
    await prisma.$disconnect();
    return;
  }

  console.log(`\nApplying changes...`);
  const applied = await apply();
  printStats("Applied", applied);

  console.log(`\nVerifying (re-counting old keys, expected = 0)...`);
  const { totalRemaining, details } = await verify();
  if (totalRemaining > 0) {
    printStats("REMAINING (should be 0!)", details);
    console.error(`\nERROR: ${totalRemaining} row(s) still reference old keys after migration.`);
    process.exit(1);
  }
  console.log(`  OK — 0 remaining references to old keys.`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
