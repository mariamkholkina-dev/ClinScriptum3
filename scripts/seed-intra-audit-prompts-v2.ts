/**
 * Seed intra-audit prompts v2 (bundle-aware).
 *
 * Добавляет новую версию промтов к СУЩЕСТВУЮЩИМ глобальным RuleSet'ам
 * intra_audit + intra_audit_qa и (при --activate) переключает на неё
 * активный bundle.
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
 * ВАЖНО про резолюцию версии (см. packages/db/src/bundle-rule-loader.ts):
 *   pipeline всегда резолвит активный bundle (resolveActiveBundle) и берёт
 *   версию правил через RuleSetBundleEntry. Поэтому простого flip isActive
 *   на RuleSetVersion НЕДОСТАТОЧНО — нужно ещё переключить bundle entry.
 *   Этот скрипт делает оба действия.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/seed-intra-audit-prompts-v2.ts
 *   npx tsx --env-file=.env scripts/seed-intra-audit-prompts-v2.ts --activate
 *
 * --activate: flip isActive + переключить активный bundle на новую версию.
 * Без флага: версия создаётся как isActive=false, bundle не трогается —
 * для A/B на golden corpus.
 *
 * Идемпотентность: каждый запуск создаёт новую RuleSetVersion с version+1,
 * существующие версии не трогаются (кроме isActive при --activate).
 */

import { PrismaClient, RuleSubStage } from "@prisma/client";
import type { RuleSetType } from "@prisma/client";
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

// ВАЖНО: pattern-ключи должны совпадать с тем, что читает handler через
// toAuditPromptMap (см. apps/workers/src/handlers/intra-doc-audit.ts):
//   promptMap.get("self_check_prompt" | "cross_check_prompt" |
//                 "editorial_prompt" | "system_prompt")
// Если использовать другие имена (например full_doc_*), handler не найдёт
// их и упадёт на hard-coded v1 constants — активация v2 будет no-op.
const INTRA_AUDIT_PROMPTS: PromptSpec[] = [
  {
    pattern: "self_check_prompt",
    name: "Self-check (full document) v2",
    promptFile: "full_doc_self_check.md",
    subStage: RuleSubStage.self_check,
  },
  {
    pattern: "cross_check_prompt",
    name: "Cross-check (full document) v2",
    promptFile: "full_doc_cross_check.md",
    subStage: RuleSubStage.cross_check,
  },
  {
    pattern: "editorial_prompt",
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

/**
 * Находит глобальный (tenantId=null) RuleSet нужного типа. Предпочитает тот,
 * на который ссылается активный bundle (если есть) — чтобы версии ложились
 * в тот же ruleset, что реально используется pipeline. Если глобального
 * ruleset нет — создаёт с дефолтным именем.
 */
async function resolveRuleSet(type: RuleSetType, fallbackName: string) {
  // 1. Через активный bundle — самый надёжный источник истины.
  const bundleEntry = await prisma.ruleSetBundleEntry.findFirst({
    where: {
      bundle: { isActive: true, tenantId: null },
      ruleSetVersion: { ruleSet: { type, tenantId: null } },
    },
    include: { ruleSetVersion: { include: { ruleSet: true } } },
  });
  if (bundleEntry) {
    return bundleEntry.ruleSetVersion.ruleSet;
  }

  // 2. Любой глобальный ruleset этого типа.
  const existing = await prisma.ruleSet.findFirst({
    where: { tenantId: null, type },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing;

  // 3. Создаём новый.
  const created = await prisma.ruleSet.create({
    data: { tenantId: null, type, name: fallbackName },
  });
  console.log(`Created new RuleSet ${created.id} (${fallbackName})`);
  return created;
}

async function seedRuleSet(opts: {
  type: RuleSetType;
  fallbackName: string;
  versionDescription: string;
  prompts: PromptSpec[];
  activate: boolean;
}) {
  const { type, fallbackName, versionDescription, prompts, activate } = opts;

  const ruleSet = await resolveRuleSet(type, fallbackName);
  console.log(`RuleSet ${ruleSet.id} ("${ruleSet.name}", type=${type})`);

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
  console.log(`  Created RuleSetVersion v${newVersionNumber} (id=${version.id})`);

  for (const p of prompts) {
    const promptText = readFileSync(join(PROMPT_DIR, p.promptFile), "utf-8");
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
    console.log(`    + Rule pattern=${p.pattern} (${promptText.length} chars)`);
  }

  if (activate) {
    // (a) flip isActive — для fallback-пути loadRulesForType (без bundle).
    await prisma.ruleSetVersion.updateMany({
      where: { ruleSetId: ruleSet.id, NOT: { id: version.id } },
      data: { isActive: false },
    });
    await prisma.ruleSetVersion.update({
      where: { id: version.id },
      data: { isActive: true },
    });

    // (b) переключить активный bundle на новую версию — основной путь pipeline.
    const activeBundle = await prisma.ruleSetBundle.findFirst({
      where: { isActive: true, tenantId: null },
      orderBy: { createdAt: "asc" },
    });
    if (activeBundle) {
      const existingEntry = await prisma.ruleSetBundleEntry.findFirst({
        where: {
          bundleId: activeBundle.id,
          ruleSetVersion: { ruleSet: { type } },
        },
      });
      if (existingEntry) {
        await prisma.ruleSetBundleEntry.update({
          where: { id: existingEntry.id },
          data: { ruleSetVersionId: version.id },
        });
        console.log(`  Bundle "${activeBundle.name}" entry → v${newVersionNumber}`);
      } else {
        await prisma.ruleSetBundleEntry.create({
          data: { bundleId: activeBundle.id, ruleSetVersionId: version.id },
        });
        console.log(`  Bundle "${activeBundle.name}" entry created → v${newVersionNumber}`);
      }
    } else {
      console.log(`  WARN: no active global bundle — only isActive flipped (fallback path)`);
    }
    console.log(`  Activated v${newVersionNumber}`);
  } else {
    console.log(`  v${newVersionNumber} created but NOT activated (isActive=false, bundle untouched)`);
  }

  return { ruleSetId: ruleSet.id, versionId: version.id, version: newVersionNumber };
}

async function main() {
  const activate = process.argv.includes("--activate");

  console.log("=== Seeding intra-audit prompts v2 (bundle-aware) ===");
  console.log(activate ? "Mode: ACTIVATE (flip isActive + switch active bundle entry)" : "Mode: create as inactive (for A/B)");
  console.log("");

  const intraAudit = await seedRuleSet({
    type: "intra_audit",
    fallbackName: "Intra-document Audit Prompts",
    versionDescription:
      "v2: anchor_id [S<path>:<type>], severity matrix, confidence guide, 13 few-shots, value extraction",
    prompts: INTRA_AUDIT_PROMPTS,
    activate,
  });

  console.log("");

  const intraAuditQa = await seedRuleSet({
    type: "intra_audit_qa",
    fallbackName: "Intra-document Audit QA Prompts",
    versionDescription:
      "v2: confidence calibration, deduplicated verdict, section_id and value awareness",
    prompts: INTRA_AUDIT_QA_PROMPTS,
    activate,
  });

  console.log("\n=== Done ===");
  console.log(`intra_audit:    versionId=${intraAudit.versionId} (v${intraAudit.version})`);
  console.log(`intra_audit_qa: versionId=${intraAuditQa.versionId} (v${intraAuditQa.version})`);
  if (!activate) {
    console.log("\nRun with --activate to switch the active bundle to the new version.");
  } else {
    console.log("\nActive bundle now points to v2. Re-run intra_doc_audit to use new prompts.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
