/**
 * Phase 4 fact-extraction roadmap — few-shot generator.
 *
 * Reads verified fact-extraction results from approved golden samples
 * (`GoldenSampleStageStatus.expectedResults` for stage 'fact_extraction')
 * and groups them by the section's `standardSection`. Produces few-shot
 * examples and stores them on the `system_prompt` Rule's
 * `Rule.config.fewShotExamples` for the active `fact_extraction` RuleSet.
 *
 * Output shape (Rule.config):
 *   {
 *     fewShotExamples: {
 *       [sectionType: string]: { input: string, output: string }[]
 *     }
 *   }
 *
 * Inputs:
 *   - approved GoldenSampleStageStatus rows for stage 'fact_extraction'.
 *     `expectedResults` JSON shape: { facts: [{ factKey, value, sectionStandardCode? }, ...] }
 *
 * Outputs:
 *   - upsert on the Rule with pattern='system_prompt' in the active version
 *     of the first `fact_extraction` RuleSet that has a system_prompt.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/generate-few-shot.ts
 *   npx tsx --env-file=.env scripts/generate-few-shot.ts --dry-run
 *   npx tsx --env-file=.env scripts/generate-few-shot.ts --max-per-section=3
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface ExpectedFact {
  factKey: string;
  value: string;
  sectionStandardCode?: string;
  sourceText?: string;
}

interface FewShotExample {
  input: string;
  output: string;
}

interface Args {
  dryRun: boolean;
  maxPerSection: number;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (key: string) => {
    const arg = argv.find((a) => a.startsWith(`--${key}=`));
    return arg ? arg.slice(key.length + 3) : undefined;
  };
  const max = get("max-per-section");
  return {
    dryRun: argv.includes("--dry-run"),
    maxPerSection: max ? parseInt(max, 10) : 3,
  };
}

async function collectExamples(): Promise<Map<string, FewShotExample[]>> {
  const statuses = await prisma.goldenSampleStageStatus.findMany({
    where: { stage: "fact_extraction", status: "approved" },
    select: { expectedResults: true, goldenSampleId: true },
  });

  const bySection = new Map<string, FewShotExample[]>();

  for (const s of statuses) {
    const er = s.expectedResults as { facts?: ExpectedFact[] } | null;
    const facts = er?.facts;
    if (!Array.isArray(facts) || facts.length === 0) continue;

    const bySectionInSample = new Map<string, ExpectedFact[]>();
    for (const f of facts) {
      const key = f.sectionStandardCode ?? "unknown";
      if (!bySectionInSample.has(key)) bySectionInSample.set(key, []);
      bySectionInSample.get(key)!.push(f);
    }

    for (const [section, sectionFacts] of bySectionInSample) {
      const inputLines = sectionFacts
        .map((f) => f.sourceText ?? "")
        .filter((s) => s.length > 0)
        .join("\n");
      if (!inputLines) continue;

      const output = JSON.stringify(
        sectionFacts.map((f) => ({
          fact_key: f.factKey,
          value: f.value,
          confidence: 0.95,
          source_text: f.sourceText ?? f.value.slice(0, 80),
        })),
      );

      if (!bySection.has(section)) bySection.set(section, []);
      bySection.get(section)!.push({ input: inputLines, output });
    }
  }

  return bySection;
}

async function main() {
  const args = parseArgs();
  console.log("=== Generate few-shot examples ===");
  console.log(`Mode: ${args.dryRun ? "DRY-RUN" : "WRITE"}`);
  console.log(`Max examples per section: ${args.maxPerSection}`);
  console.log("");

  const bySection = await collectExamples();
  if (bySection.size === 0) {
    console.log("No approved golden samples with fact_extraction expectedResults — nothing to do.");
    await prisma.$disconnect();
    return;
  }

  const fewShotExamples: Record<string, FewShotExample[]> = {};
  for (const [section, examples] of bySection) {
    fewShotExamples[section] = examples.slice(0, args.maxPerSection);
    console.log(`  ${section}: ${fewShotExamples[section]!.length} example(s)`);
  }
  console.log("");

  const ruleSet = await prisma.ruleSet.findFirst({
    where: { type: "fact_extraction", tenantId: null },
  });
  if (!ruleSet) {
    console.error("No global fact_extraction RuleSet found. Run db:seed first.");
    process.exit(1);
  }

  const version = await prisma.ruleSetVersion.findFirst({
    where: { ruleSetId: ruleSet.id, isActive: true },
  });
  if (!version) {
    console.error("No active version found for fact_extraction RuleSet.");
    process.exit(1);
  }

  const systemRule = await prisma.rule.findFirst({
    where: { ruleSetVersionId: version.id, pattern: "system_prompt" },
  });
  if (!systemRule) {
    console.error("No system_prompt Rule found in active fact_extraction version. Run seed-fact-registry first.");
    process.exit(1);
  }

  const existingConfig = (systemRule.config as Record<string, unknown> | null) ?? {};
  const newConfig = { ...existingConfig, fewShotExamples };

  if (args.dryRun) {
    console.log("DRY-RUN: would write Rule.config = ");
    console.log(JSON.stringify(newConfig, null, 2).slice(0, 1000));
  } else {
    await prisma.rule.update({
      where: { id: systemRule.id },
      data: { config: newConfig as any },
    });
    console.log(`Updated Rule ${systemRule.id} with fewShotExamples for ${Object.keys(fewShotExamples).length} section(s)`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
