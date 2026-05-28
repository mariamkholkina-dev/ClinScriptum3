/**
 * Seed intra-audit prompts v2.
 *
 * Создаёт новую (неактивную) версию RuleSet для intra_audit + intra_audit_qa,
 * заливая обновлённые промты из scripts/prompts/intra-audit-v2/*.md.
 *
 * Что есть в v2:
 *   - anchor_id [S<path>:<type>] для секций;
 *   - матрица confidence × severity;
 *   - расширенные few-shot (13 примеров для cross-check);
 *   - извлечение reference_value / target_value (для post-LLM canonicalize);
 *   - явные anti-patterns ("не путай" + "запрещено");
 *   - per-family confidence defaults;
 *   - 4-уровневая калибровка severity с примерами;
 *   - deduplicated verdict в QA-промте.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/seed-intra-audit-prompts-v2.ts
 *   npx tsx --env-file=.env scripts/seed-intra-audit-prompts-v2.ts --activate
 *
 * --activate сразу включает новую версию (деактивируя предыдущие).
 * Без флага версия создаётся как isActive=false — для A/B на golden corpus.
 *
 * Идемпотентность: каждый запуск создаёт новую RuleSetVersion с version+1,
 * существующие версии не трогаются.
 */

import { PrismaClient, RuleSubStage } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Скрипт запускается из корня проекта: `npx tsx --env-file=.env scripts/seed-intra-audit-prompts-v2.ts`
const PROMPT_DIR = join(process.cwd(), "scripts/prompts/intra-audit-v2");

const prisma = new PrismaClient();

type PromptSpec = {
  pattern: string;
  name: string;
  promptFile: string;
  subStage: RuleSubStage | null;
};

const INTRA_AUDIT_PROMPTS: PromptSpec[] = [
  {
    pattern: "full_doc_self_check_prompt",
    name: "Self-check (full document) v2",
    promptFile: "full_doc_self_check.md",
    subStage: RuleSubStage.self_check,
  },
  {
    pattern: "full_doc_cross_check_prompt",
    name: "Cross-check (full document) v2",
    promptFile: "full_doc_cross_check.md",
    subStage: RuleSubStage.cross_check,
  },
  {
    pattern: "full_doc_editorial_prompt",
    name: "Editorial (full document) v2",
    promptFile: "full_doc_editorial.md",
    subStage: RuleSubStage.editorial,
  },
];

const INTRA_AUDIT_QA_PROMPTS: PromptSpec[] = [
  {
    pattern: "system_prompt",
    name: "QA arbiter v2",
    promptFile: "qa_system.md",
    subStage: RuleSubStage.qa,
  },
];

async function seedRuleSet(opts: {
  type: "intra_audit" | "intra_audit_qa";
  rulesetName: string;
  versionDescription: string;
  prompts: PromptSpec[];
  activate: boolean;
}) {
  const { type, rulesetName, versionDescription, prompts, activate } = opts;

  let ruleSet = await prisma.ruleSet.findFirst({
    where: { tenantId: null, type, name: rulesetName },
  });
  if (!ruleSet) {
    ruleSet = await prisma.ruleSet.create({
      data: { tenantId: null, type, name: rulesetName },
    });
    console.log(`Created RuleSet ${ruleSet.id} (${rulesetName})`);
  } else {
    console.log(`Reusing RuleSet ${ruleSet.id} (${rulesetName})`);
  }

  const maxVersion = await prisma.ruleSetVersion.aggregate({
    where: { ruleSetId: ruleSet.id },
    _max: { version: true },
  });
  const newVersionNumber = (maxVersion._max.version ?? 0) + 1;

  const version = await prisma.ruleSetVersion.create({
    data: {
      ruleSetId: ruleSet.id,
      version: newVersionNumber,
      description: versionDescription,
      isActive: false,
    },
  });
  console.log(`Created RuleSetVersion v${newVersionNumber} (id=${version.id})`);

  for (const p of prompts) {
    const promptPath = join(PROMPT_DIR, p.promptFile);
    const promptText = readFileSync(promptPath, "utf-8");
    await prisma.rule.create({
      data: {
        ruleSetVersionId: version.id,
        name: p.name,
        pattern: p.pattern,
        promptTemplate: promptText,
        subStage: p.subStage,
        isEnabled: true,
      },
    });
    console.log(`  + Rule pattern=${p.pattern} (${promptText.length} chars)`);
  }

  if (activate) {
    await prisma.ruleSetVersion.updateMany({
      where: { ruleSetId: ruleSet.id, NOT: { id: version.id } },
      data: { isActive: false },
    });
    await prisma.ruleSetVersion.update({
      where: { id: version.id },
      data: { isActive: true },
    });
    console.log(`Activated v${newVersionNumber}`);
  } else {
    console.log(
      `v${newVersionNumber} created but NOT activated. To activate later:\n` +
      `  UPDATE rule_set_versions SET is_active = false WHERE rule_set_id = '${ruleSet.id}';\n` +
      `  UPDATE rule_set_versions SET is_active = true WHERE id = '${version.id}';`,
    );
  }

  return { ruleSetId: ruleSet.id, versionId: version.id, version: newVersionNumber };
}

async function main() {
  const activate = process.argv.includes("--activate");

  console.log("=== Seeding intra-audit prompts v2 ===");
  console.log(activate ? "Mode: ACTIVATE immediately" : "Mode: create as inactive (recommended for A/B)");
  console.log("");

  const intraAudit = await seedRuleSet({
    type: "intra_audit",
    rulesetName: "Global intra-audit prompts",
    versionDescription:
      "v2: anchor_id [S<path>:<type>], severity matrix, confidence guide, 13 few-shots, value extraction",
    prompts: INTRA_AUDIT_PROMPTS,
    activate,
  });

  console.log("");

  const intraAuditQa = await seedRuleSet({
    type: "intra_audit_qa",
    rulesetName: "Global intra-audit QA prompts",
    versionDescription:
      "v2: confidence calibration, deduplicated verdict, section_id and value awareness",
    prompts: INTRA_AUDIT_QA_PROMPTS,
    activate,
  });

  console.log("\n=== Done ===");
  console.log(`intra_audit:    versionId=${intraAudit.versionId} (v${intraAudit.version})`);
  console.log(`intra_audit_qa: versionId=${intraAuditQa.versionId} (v${intraAuditQa.version})`);
  if (!activate) {
    console.log("\nRun with --activate flag to activate new version immediately.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
