/**
 * Seed `fact_section_priors` RuleSet — maps each factKey to the
 * `standardSection` codes where it's expected to live. Used by
 * `fact-extraction-core.ts:factMatchesSectionPriors()` to discard
 * deterministic matches from the wrong section, and is exposed to the
 * LLM as a hint about where to look.
 *
 * One Rule per factKey. `Rule.config = { factKey, expectedSections: string[] }`.
 *
 * Source of truth:
 * - LLM-side factKeys (60): `apps/api/src/data/fact-registry.yaml` —
 *   each fact's `topics` field is copied directly.
 * - Deterministic-side factKeys (10 not in YAML): hardcoded below from
 *   the legacy DEFAULT_FACT_RULES mapping in `fact-extractor.ts`. Their
 *   topics are derived by analogy with the closest YAML entries.
 */

import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface YamlFact {
  fact_key: string;
  topics?: string[];
}

/**
 * Topics for the 10 deterministic factKeys that aren't present in the
 * YAML registry under the same key. These come from `DEFAULT_FACT_RULES`
 * in `packages/rules-engine/src/fact-extractor.ts` (the legacy regex
 * pipeline) and are mapped by analogy with the LLM-side names:
 *   protocol_number   ≈ protocol_id
 *   study_phase       ≈ phase
 *   sponsor           ≈ sponsor_name
 *   sample_size       ≈ planned_n_total
 *   study_duration    ≈ duration
 *   primary_endpoint  ≈ endpoints.primary
 *   secondary_endpoint ≈ endpoints.secondary
 */
const DETERMINISTIC_ONLY_PRIORS: Record<string, string[]> = {
  study_title: ["overview_objectives"],
  protocol_number: ["admin_ethics", "overview_objectives"],
  sponsor: ["admin_ethics"],
  study_phase: ["overview_objectives", "design_plan"],
  indication: ["overview_objectives", "indication"],
  study_drug: ["ip_management"],
  sample_size: ["stats_sample_size", "population_eligibility", "overview_objectives"],
  study_duration: ["design_plan"],
  primary_endpoint: ["endpoints_efficacy"],
  secondary_endpoint: ["endpoints_efficacy"],
};

function loadYamlPriors(): Map<string, Set<string>> {
  // Walk up from packages/db/src to monorepo root, then into apps/api.
  const yamlPath = resolve(__dirname, "../../..", "apps/api/src/data/fact-registry.yaml");
  const raw = readFileSync(yamlPath, "utf-8");
  const data = parseYaml(raw) as Record<string, YamlFact[]>;

  const priors = new Map<string, Set<string>>();
  for (const facts of Object.values(data)) {
    if (!Array.isArray(facts)) continue;
    for (const f of facts) {
      if (!f.fact_key) continue;
      const topics = Array.isArray(f.topics) ? f.topics : [];
      const set = priors.get(f.fact_key) ?? new Set<string>();
      for (const t of topics) set.add(t);
      priors.set(f.fact_key, set);
    }
  }
  return priors;
}

function buildPriors(): Array<{ factKey: string; expectedSections: string[] }> {
  const merged = loadYamlPriors();

  for (const [factKey, sections] of Object.entries(DETERMINISTIC_ONLY_PRIORS)) {
    const set = merged.get(factKey) ?? new Set<string>();
    for (const s of sections) set.add(s);
    merged.set(factKey, set);
  }

  return Array.from(merged.entries())
    .filter(([, sections]) => sections.size > 0)
    .map(([factKey, sections]) => ({
      factKey,
      expectedSections: Array.from(sections).sort(),
    }))
    .sort((a, b) => a.factKey.localeCompare(b.factKey));
}

export async function seedFactSectionPriors(prisma: PrismaClient) {
  const priors = buildPriors();
  if (priors.length === 0) {
    throw new Error("seedFactSectionPriors: no priors built — YAML registry empty?");
  }

  const existing = await prisma.ruleSet.findFirst({
    where: { type: "fact_section_priors", tenantId: null },
  });
  let ruleSet = existing;
  if (!ruleSet) {
    ruleSet = await prisma.ruleSet.create({
      data: {
        type: "fact_section_priors",
        name: "Default fact-extraction section priors",
      },
    });
  }

  let version = await prisma.ruleSetVersion.findFirst({
    where: { ruleSetId: ruleSet.id, version: 1 },
  });
  if (!version) {
    version = await prisma.ruleSetVersion.create({
      data: {
        ruleSetId: ruleSet.id,
        version: 1,
        description: "Initial section priors from fact-registry.yaml + deterministic mapping",
        isActive: true,
      },
    });
  } else {
    await prisma.rule.deleteMany({ where: { ruleSetVersionId: version.id } });
  }

  for (const p of priors) {
    await prisma.rule.create({
      data: {
        ruleSetVersionId: version.id,
        name: `priors:${p.factKey}`,
        pattern: p.factKey,
        config: {
          factKey: p.factKey,
          expectedSections: p.expectedSections,
        },
      },
    });
  }
}

export const FACT_SECTION_PRIORS_BUILDER = buildPriors;
