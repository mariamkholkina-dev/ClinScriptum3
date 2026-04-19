import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { parse } from "yaml";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const prisma = new PrismaClient();

interface FactEntry {
  fact_key: string;
  value_type: string;
  priority: number;
  confidence: string;
  description: string;
  labels_ru: string[];
  labels_en: string[];
  topics: string[];
}

type FactRegistry = Record<string, FactEntry[]>;

function flattenRegistry(registry: FactRegistry) {
  const rules: { name: string; pattern: string; config: object }[] = [];

  for (const [category, facts] of Object.entries(registry)) {
    for (const fact of facts) {
      rules.push({
        name: `fact:${category}.${fact.fact_key}`,
        pattern: fact.fact_key,
        config: {
          type: "fact",
          category,
          factKey: fact.fact_key,
          valueType: fact.value_type,
          priority: fact.priority,
          confidence: fact.confidence,
          description: fact.description,
          labelsRu: fact.labels_ru ?? [],
          labelsEn: fact.labels_en ?? [],
          topics: fact.topics ?? [],
        },
      });
    }
  }

  return rules;
}

async function main() {
  const registryPath = resolve(__dirname, "../../..", "apps/api/src/data/fact-registry.yaml");
  let content: string;
  try {
    content = readFileSync(registryPath, "utf-8");
  } catch {
    const altPath = resolve(__dirname, "../../../..", "clinnexus", "apps/api/src/data/fact-registry.yaml");
    content = readFileSync(altPath, "utf-8");
  }

  const registry = parse(content) as FactRegistry;
  const rules = flattenRegistry(registry);

  console.log(`Parsed ${rules.length} fact definitions from registry`);

  const ruleSet = await prisma.ruleSet.upsert({
    where: { id: "00000000-0000-0000-0000-000000000300" },
    update: { name: "Реестр фактов клинического протокола v1" },
    create: {
      id: "00000000-0000-0000-0000-000000000300",
      name: "Реестр фактов клинического протокола v1",
      type: "fact_extraction",
    },
  });

  console.log(`RuleSet: ${ruleSet.id}`);

  const existingVersion = await prisma.ruleSetVersion.findFirst({
    where: { ruleSetId: ruleSet.id, version: 1 },
  });

  let versionId: string;
  if (existingVersion) {
    versionId = existingVersion.id;
    await prisma.rule.deleteMany({ where: { ruleSetVersionId: versionId } });
    console.log("Cleared existing rules for version 1");
  } else {
    const version = await prisma.ruleSetVersion.create({
      data: {
        ruleSetId: ruleSet.id,
        version: 1,
        isActive: true,
      },
    });
    versionId = version.id;
  }

  for (const rule of rules) {
    await prisma.rule.create({
      data: {
        ruleSetVersionId: versionId,
        name: rule.name,
        pattern: rule.pattern,
        config: rule.config,
      },
    });
  }

  console.log(`Created ${rules.length} rules in version 1`);
  console.log("Fact registry seed complete!");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
