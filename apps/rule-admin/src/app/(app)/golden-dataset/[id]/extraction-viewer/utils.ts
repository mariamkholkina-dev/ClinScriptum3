import type { Fact, SortKey, FilterState } from "./types";

const STATUS_ORDER: Record<string, number> = {
  not_found: 0,
  extracted: 1,
  verified: 2,
  deferred: 3,
  validated: 4,
  rejected: 5,
};

export function sortFacts(facts: Fact[], key: SortKey): Fact[] {
  const copy = [...facts];
  switch (key) {
    case "factKey":
      return copy.sort((a, b) => a.factKey.localeCompare(b.factKey));
    case "factCategory":
      return copy.sort((a, b) => a.factCategory.localeCompare(b.factCategory) || a.factKey.localeCompare(b.factKey));
    case "confidence":
      return copy.sort((a, b) => b.confidence - a.confidence || a.factKey.localeCompare(b.factKey));
    case "status":
      return copy.sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || a.factKey.localeCompare(b.factKey));
    case "value":
      return copy.sort((a, b) => (a.manualValue ?? a.value).localeCompare(b.manualValue ?? b.value));
    case "hasContradiction":
      return copy.sort((a, b) => (b.hasContradiction ? 1 : 0) - (a.hasContradiction ? 1 : 0) || a.factKey.localeCompare(b.factKey));
    default:
      return copy;
  }
}

export function filterFacts(facts: Fact[], filters: FilterState): Fact[] {
  return facts.filter((f) => {
    if (filters.status && f.status !== filters.status) return false;
    if (filters.category && f.factCategory !== filters.category) return false;

    if (filters.hasContradiction === "yes" && !f.hasContradiction) return false;
    if (filters.hasContradiction === "no" && f.hasContradiction) return false;

    if (filters.hasValue === "yes" && !f.value && !f.manualValue) return false;
    if (filters.hasValue === "no" && (f.value || f.manualValue)) return false;

    if (filters.confidenceRange === "high" && f.confidence < 0.85) return false;
    if (filters.confidenceRange === "medium" && (f.confidence < 0.3 || f.confidence >= 0.85)) return false;
    if (filters.confidenceRange === "low" && f.confidence >= 0.3) return false;

    if (filters.levelAgreement === "disagree") {
      const hasDisagreement = f.deterministicValue != null && f.llmValue != null && f.deterministicValue !== f.llmValue;
      if (!hasDisagreement) return false;
    }
    if (filters.levelAgreement === "agree") {
      const allAgree = !f.deterministicValue || !f.llmValue || f.deterministicValue === f.llmValue;
      if (!allAgree) return false;
    }
    if (filters.levelAgreement === "qa_corrected") {
      if (!f.qaValue || f.qaValue === f.llmValue) return false;
    }

    return true;
  });
}
