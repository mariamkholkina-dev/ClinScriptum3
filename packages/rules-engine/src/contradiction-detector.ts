import type { ExtractedFact } from "./fact-extractor.js";
import { canonicalize } from "./canonicalize.js";

export interface Contradiction {
  factKey: string;
  values: Array<{ value: string; source: ExtractedFact["source"] }>;
}

/**
 * URS-026: If the same fact is found in multiple places with
 * differing values, flag it as an intra-document contradiction.
 *
 * Comparison is done on the canonical form so that "30 пациентов",
 * "N=30", and "30 patients" do not falsely trigger as different.
 */
export function detectContradictions(facts: ExtractedFact[]): Contradiction[] {
  const grouped = new Map<string, ExtractedFact[]>();

  for (const fact of facts) {
    const existing = grouped.get(fact.factKey) ?? [];
    existing.push(fact);
    grouped.set(fact.factKey, existing);
  }

  const contradictions: Contradiction[] = [];

  for (const [factKey, entries] of grouped) {
    const uniqueCanonicals = new Set(
      entries.map((e) => canonicalize(e.factKey, e.value).canonical),
    );
    if (uniqueCanonicals.size > 1) {
      contradictions.push({
        factKey,
        values: entries.map((e) => ({ value: e.value, source: e.source })),
      });
    }
  }

  return contradictions;
}
