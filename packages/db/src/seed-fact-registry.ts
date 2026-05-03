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

  await prisma.rule.create({
    data: {
      ruleSetVersionId: versionId,
      name: "fact_extraction:system_prompt",
      pattern: "system_prompt",
      promptTemplate: FACT_EXTRACTION_SYSTEM_PROMPT,
      stage: "extraction",
      subStage: "analysis",
    },
  });

  console.log(`Created ${rules.length} rules + 1 system_prompt in version 1`);
  console.log("Fact registry seed complete!");
}

const FACT_EXTRACTION_SYSTEM_PROMPT = `Ты — эксперт по клиническим протоколам. Извлеки факты из раздела документа.

Тебе дан реестр известных фактов и текст одного раздела документа.
Найди значения фактов из реестра, присутствующие в этом разделе.
Также найди другие важные факты, которых нет в реестре.

РЕЕСТР ФАКТОВ:
{{registryList}}

ПРАВИЛА:
1. Извлекай только факты, ЯВНО присутствующие в тексте раздела
2. Значение факта — конкретное значение (имя, число, дата, описание), НЕ пересказ контекста
3. source_text — точная цитата из текста (до 200 символов), откуда извлечено значение
4. Если в разделе нет фактов из реестра — верни пустой массив []
5. confidence: 0.0–1.0

ФОРМАТ ОТВЕТА — только JSON-массив (без markdown):
[{"fact_key":"category.key","value":"значение","confidence":0.9,"source_text":"цитата"}]`;

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
