import type { Fact, GroupedFact, SortKey, FilterState } from "./types";

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

export function sortGroupedFacts(facts: GroupedFact[], key: SortKey): GroupedFact[] {
  const copy = [...facts];
  switch (key) {
    case "factKey":
      return copy.sort((a, b) => a.factKey.localeCompare(b.factKey));
    case "factCategory":
      return copy.sort((a, b) => a.factCategory.localeCompare(b.factCategory) || a.factKey.localeCompare(b.factKey));
    case "confidence":
      return copy.sort((a, b) => b.finalConfidence - a.finalConfidence || a.factKey.localeCompare(b.factKey));
    case "status":
      return copy.sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || a.factKey.localeCompare(b.factKey));
    case "value":
      return copy.sort((a, b) => (a.finalValue ?? "").localeCompare(b.finalValue ?? ""));
    case "hasContradiction":
      return copy.sort((a, b) => (b.hasContradiction ? 1 : 0) - (a.hasContradiction ? 1 : 0) || a.factKey.localeCompare(b.factKey));
    default:
      return copy;
  }
}

export function filterFacts(facts: Fact[], filters: FilterState): Fact[] {
  return facts.filter((f) => applyFilters(f, filters));
}

export function filterGroupedFacts(facts: GroupedFact[], filters: FilterState): GroupedFact[] {
  return facts.filter((f) => {
    if (filters.status && f.status !== filters.status) return false;
    if (filters.category && f.factCategory !== filters.category) return false;

    if (filters.hasContradiction === "yes" && !f.hasContradiction) return false;
    if (filters.hasContradiction === "no" && f.hasContradiction) return false;

    if (filters.hasValue === "yes" && !f.finalValue && !f.manualValue) return false;
    if (filters.hasValue === "no" && (f.finalValue || f.manualValue)) return false;

    if (filters.confidenceRange === "high" && f.finalConfidence < 0.85) return false;
    if (filters.confidenceRange === "medium" && (f.finalConfidence < 0.3 || f.finalConfidence >= 0.85)) return false;
    if (filters.confidenceRange === "low" && f.finalConfidence >= 0.3) return false;

    const norm = (v: string | null) => v?.toLowerCase().trim() ?? "";
    if (filters.levelAgreement === "all_agree") {
      if (!f.deterministicValue || !f.llmValue || !f.qaValue) return false;
      if (norm(f.deterministicValue) !== norm(f.llmValue) || norm(f.llmValue) !== norm(f.qaValue)) return false;
    }
    if (filters.levelAgreement === "llm_qa_agree") {
      if (!f.llmValue || !f.qaValue) return false;
      if (norm(f.llmValue) !== norm(f.qaValue)) return false;
    }
    if (filters.levelAgreement === "det_ne_llm") {
      if (!f.deterministicValue || !f.llmValue) return false;
      if (norm(f.deterministicValue) === norm(f.llmValue)) return false;
    }
    if (filters.levelAgreement === "qa_corrected") {
      if (!f.qaValue || norm(f.qaValue) === norm(f.llmValue)) return false;
    }
    return true;
  });
}

function applyFilters(f: Fact | GroupedFact, filters: FilterState): boolean {
  if (filters.status && f.status !== filters.status) return false;
  if (filters.category && f.factCategory !== filters.category) return false;
  if (filters.hasContradiction === "yes" && !f.hasContradiction) return false;
  if (filters.hasContradiction === "no" && f.hasContradiction) return false;
  return true;
}
