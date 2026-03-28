import type { ExtractedFact } from "./fact-extractor.js";

export interface Contradiction {
  factKey: string;
  values: Array<{ value: string; source: ExtractedFact["source"] }>;
}

/**
 * URS-026: If the same fact is found in multiple places with
 * differing values, flag it as an intra-document contradiction.
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
    const uniqueValues = new Set(entries.map((e) => normalizeValue(e.value)));
    if (uniqueValues.size > 1) {
      contradictions.push({
        factKey,
        values: entries.map((e) => ({ value: e.value, source: e.source })),
      });
    }
  }

  return contradictions;
}

function normalizeValue(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}
