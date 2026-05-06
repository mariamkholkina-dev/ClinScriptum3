/**
 * Corpus discovery — bulk parse + deterministic classify the corpus
 * (e.g. C:/protocol_last_version) and produce a report. NO database, NO BullMQ,
 * NO LLM — just `@clinscriptum/doc-parser` + `@clinscriptum/rules-engine`
 * applied to taxonomy.yaml rules.
 *
 * Output: `docs/discovery/`
 *  - summary.json — totals, zone distribution, top unclassified clusters
 *  - per-document.json — one row per file (sections, classified count, top zones)
 *  - unclassified-titles.txt — line per unclassified title (for clustering)
 *  - zone-distribution.csv — zone, count
 *
 * Usage:
 *   npx tsx apps/workers/scripts/corpus-discovery.ts [corpus-dir]
 *
 * Default corpus-dir: C:/protocol_last_version
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { parseDocx } from "@clinscriptum/doc-parser";
import { SectionClassifier } from "@clinscriptum/rules-engine";
import type { SectionMappingRule } from "@clinscriptum/rules-engine";
import type { ParsedSection } from "@clinscriptum/doc-parser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../../..");

interface TaxonomyChild {
  title_ru: string;
  patterns?: string[];
  require_patterns?: string[];
  not_keywords?: string[];
}

interface TaxonomyZone {
  canonical_zone: string;
  title_ru: string;
  patterns?: string[];
  require_patterns?: string[];
  not_keywords?: string[];
  children?: Record<string, TaxonomyChild>;
}

function loadRulesFromTaxonomy(yamlPath: string): SectionMappingRule[] {
  const raw = readFileSync(yamlPath, "utf-8");
  const taxonomy = parseYaml(raw) as Record<string, TaxonomyZone>;
  const rules: SectionMappingRule[] = [];

  for (const [zoneKey, zone] of Object.entries(taxonomy)) {
    rules.push({
      standardSection: zone.canonical_zone,
      patterns: zone.patterns ?? [],
      requirePatterns: zone.require_patterns ?? [],
      notKeywords: zone.not_keywords ?? [],
      type: "zone",
      level: 1,
      isRequired: false,
      category: "protocol",
    });

    if (zone.children) {
      for (const [childKey, child] of Object.entries(zone.children)) {
        rules.push({
          standardSection: `${zone.canonical_zone}.${childKey}`,
          patterns: child.patterns ?? [],
          requirePatterns: child.require_patterns ?? [],
          notKeywords: child.not_keywords ?? [],
          type: "subzone",
          parentZone: zone.canonical_zone,
          level: 2,
          isRequired: false,
          category: "protocol",
        });
      }
    }
  }

  return rules;
}

function flattenSections(sections: ParsedSection[]): ParsedSection[] {
  const out: ParsedSection[] = [];
  function walk(s: ParsedSection) {
    out.push(s);
    for (const c of s.children) walk(c);
  }
  for (const s of sections) walk(s);
  return out;
}

interface DocReport {
  filename: string;
  sectionCount: number;
  unclassifiedCount: number;
  zoneDistribution: Record<string, number>;
  emptySections: number;
  parseError?: string;
}

interface CorpusSummary {
  generatedAt: string;
  corpusDir: string;
  totals: {
    documents: number;
    parseFailures: number;
    sectionsTotal: number;
    sectionsUnclassified: number;
    sectionsClassifiedRate: number;
    avgSectionsPerDoc: number;
    emptySections: number;
  };
  zoneDistribution: Array<{ zone: string; count: number; pctOfTotal: number }>;
  topUnclassifiedTitles: Array<{ title: string; count: number }>;
  topUnclassifiedTokens: Array<{ token: string; count: number }>;
}

const STOPWORDS = new Set([
  "и", "в", "на", "для", "по", "с", "к", "о", "об", "от", "до", "как",
  "не", "при", "из", "за", "у", "ли", "что", "это", "the", "a", "of",
  "в", "и", "ис", "ил", "or", "and", "to", "for", "with", "in", "on",
  "проведения", "проведение", "связанные", "связанные", "т.е.",
]);

function topKByCount<K>(map: Map<K, number>, k: number): Array<[K, number]> {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, k);
}

async function main() {
  const corpusDir = process.argv[2] ?? "C:/protocol_last_version";
  const outputDir = resolve(REPO_ROOT, "docs/discovery");
  mkdirSync(outputDir, { recursive: true });

  console.log(`Corpus dir: ${corpusDir}`);
  console.log(`Output dir: ${outputDir}`);

  const rules = loadRulesFromTaxonomy(resolve(REPO_ROOT, "taxonomy.yaml"));
  const classifier = new SectionClassifier(rules);
  console.log(`Loaded ${rules.length} taxonomy rules (${rules.filter(r => r.type === "zone").length} zones, ${rules.filter(r => r.type === "subzone").length} subzones)`);

  const files = readdirSync(corpusDir)
    .filter((f) => f.toLowerCase().endsWith(".docx"))
    .sort();
  console.log(`Found ${files.length} .docx files\n`);

  const zoneCounts = new Map<string, number>();
  const unclassifiedTitles = new Map<string, number>();
  const tokenCounts = new Map<string, number>();
  const perDoc: DocReport[] = [];
  let parseFailures = 0;
  let sectionsTotal = 0;
  let sectionsUnclassified = 0;
  let emptySections = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const idx = `[${i + 1}/${files.length}]`;
    process.stdout.write(`\r${idx} ${file.slice(0, 70).padEnd(70)}`);

    try {
      const buffer = readFileSync(resolve(corpusDir, file));
      const parsed = await parseDocx(buffer);
      const allSections = flattenSections(parsed.sections);

      const docZones: Record<string, number> = {};
      let docUnclassified = 0;
      let docEmpty = 0;

      for (const s of allSections) {
        if (s.contentBlocks.length === 0) docEmpty++;
        const result = classifier.classify(s.title);
        if (result.standardSection) {
          zoneCounts.set(result.standardSection, (zoneCounts.get(result.standardSection) ?? 0) + 1);
          docZones[result.standardSection] = (docZones[result.standardSection] ?? 0) + 1;
        } else {
          docUnclassified++;
          const title = s.title.trim().toLowerCase();
          unclassifiedTitles.set(title, (unclassifiedTitles.get(title) ?? 0) + 1);
          for (const tok of title.split(/[\s.,;:()«»"'\-—–]+/)) {
            const t = tok.trim();
            if (t.length < 4) continue;
            if (STOPWORDS.has(t)) continue;
            if (/^\d+$/.test(t)) continue;
            tokenCounts.set(t, (tokenCounts.get(t) ?? 0) + 1);
          }
        }
      }

      perDoc.push({
        filename: file,
        sectionCount: allSections.length,
        unclassifiedCount: docUnclassified,
        zoneDistribution: docZones,
        emptySections: docEmpty,
      });

      sectionsTotal += allSections.length;
      sectionsUnclassified += docUnclassified;
      emptySections += docEmpty;
    } catch (err) {
      parseFailures++;
      perDoc.push({
        filename: file,
        sectionCount: 0,
        unclassifiedCount: 0,
        zoneDistribution: {},
        emptySections: 0,
        parseError: String(err).slice(0, 200),
      });
    }
  }

  console.log("\n");

  const summary: CorpusSummary = {
    generatedAt: new Date().toISOString(),
    corpusDir,
    totals: {
      documents: files.length,
      parseFailures,
      sectionsTotal,
      sectionsUnclassified,
      sectionsClassifiedRate: sectionsTotal > 0 ? (sectionsTotal - sectionsUnclassified) / sectionsTotal : 0,
      avgSectionsPerDoc: files.length > parseFailures ? sectionsTotal / (files.length - parseFailures) : 0,
      emptySections,
    },
    zoneDistribution: topKByCount(zoneCounts, 200).map(([zone, count]) => ({
      zone,
      count,
      pctOfTotal: count / sectionsTotal,
    })),
    topUnclassifiedTitles: topKByCount(unclassifiedTitles, 100).map(([title, count]) => ({ title, count })),
    topUnclassifiedTokens: topKByCount(tokenCounts, 50).map(([token, count]) => ({ token, count })),
  };

  writeFileSync(
    resolve(outputDir, "summary.json"),
    JSON.stringify(summary, null, 2),
    "utf-8",
  );
  writeFileSync(
    resolve(outputDir, "per-document.json"),
    JSON.stringify(perDoc, null, 2),
    "utf-8",
  );
  writeFileSync(
    resolve(outputDir, "unclassified-titles.txt"),
    [...unclassifiedTitles.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([title, count]) => `${count}\t${title}`)
      .join("\n"),
    "utf-8",
  );
  writeFileSync(
    resolve(outputDir, "zone-distribution.csv"),
    "zone,count,pct\n" +
      summary.zoneDistribution
        .map((d) => `${d.zone},${d.count},${d.pctOfTotal.toFixed(4)}`)
        .join("\n"),
    "utf-8",
  );

  console.log("=== Corpus Discovery — Summary ===");
  console.log(`Documents:          ${files.length} (${parseFailures} parse failures)`);
  console.log(`Sections total:     ${sectionsTotal}`);
  console.log(`Avg sections/doc:   ${summary.totals.avgSectionsPerDoc.toFixed(1)}`);
  console.log(`Classified rate:    ${(summary.totals.sectionsClassifiedRate * 100).toFixed(1)}%`);
  console.log(`Unclassified:       ${sectionsUnclassified} (${((sectionsUnclassified / sectionsTotal) * 100).toFixed(1)}%)`);
  console.log(`Empty sections:     ${emptySections} (${((emptySections / sectionsTotal) * 100).toFixed(1)}%)`);
  console.log("\nTop 10 zones:");
  for (const z of summary.zoneDistribution.slice(0, 10)) {
    console.log(`  ${z.count.toString().padStart(5)}  ${(z.pctOfTotal * 100).toFixed(1).padStart(5)}%  ${z.zone}`);
  }
  console.log("\nTop 10 unclassified tokens:");
  for (const t of summary.topUnclassifiedTokens.slice(0, 10)) {
    console.log(`  ${t.count.toString().padStart(5)}  ${t.token}`);
  }
  console.log("\nFiles in:");
  console.log(`  ${resolve(outputDir, "summary.json")}`);
  console.log(`  ${resolve(outputDir, "per-document.json")}`);
  console.log(`  ${resolve(outputDir, "unclassified-titles.txt")}`);
  console.log(`  ${resolve(outputDir, "zone-distribution.csv")}`);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
