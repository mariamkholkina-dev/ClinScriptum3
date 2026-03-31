import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { parse } from "yaml";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const prisma = new PrismaClient();

interface TaxonomyZone {
  canonical_zone: string;
  title_ru: string;
  patterns?: string[];
  require_patterns?: string[];
  not_keywords?: string[];
  children?: Record<string, TaxonomyChild>;
}

interface TaxonomyChild {
  title_ru: string;
  patterns?: string[];
  require_patterns?: string[];
  not_keywords?: string[];
}

function flattenTaxonomy(taxonomy: Record<string, TaxonomyZone>) {
  const rules: { name: string; pattern: string; config: object }[] = [];

  for (const [zoneKey, zone] of Object.entries(taxonomy)) {
    rules.push({
      name: `zone:${zoneKey}`,
      pattern: zone.canonical_zone,
      config: {
        type: "zone",
        key: zoneKey,
        canonicalZone: zone.canonical_zone,
        titleRu: zone.title_ru,
        patterns: zone.patterns ?? [],
        requirePatterns: zone.require_patterns ?? [],
        notKeywords: zone.not_keywords ?? [],
      },
    });

    if (zone.children) {
      for (const [childKey, child] of Object.entries(zone.children)) {
        rules.push({
          name: `subzone:${zoneKey}.${childKey}`,
          pattern: `${zone.canonical_zone}.${childKey}`,
          config: {
            type: "subzone",
            key: childKey,
            parentZone: zoneKey,
            canonicalZone: zone.canonical_zone,
            titleRu: child.title_ru,
            patterns: child.patterns ?? [],
            requirePatterns: child.require_patterns ?? [],
            notKeywords: child.not_keywords ?? [],
          },
        });
      }
    }
  }

  return rules;
}

async function main() {
  const taxonomyPath = resolve(__dirname, "../../..", "taxonomy.yaml");
  let taxonomyContent: string;
  try {
    taxonomyContent = readFileSync(taxonomyPath, "utf-8");
  } catch {
    const altPath = resolve(__dirname, "../../../..", "clinnexus", "taxonomy.yaml");
    taxonomyContent = readFileSync(altPath, "utf-8");
  }

  const taxonomy = parse(taxonomyContent) as Record<string, TaxonomyZone>;
  const rules = flattenTaxonomy(taxonomy);

  console.log(`Parsed ${rules.length} rules from taxonomy`);

  const ruleSet = await prisma.ruleSet.upsert({
    where: { id: "00000000-0000-0000-0000-000000000100" },
    update: { name: "Таксономия секций протокола v3" },
    create: {
      id: "00000000-0000-0000-0000-000000000100",
      name: "Таксономия секций протокола v3",
      type: "section_classification",
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
    console.log(`Cleared existing rules for version 1`);
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
  console.log("Taxonomy seed complete!");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
