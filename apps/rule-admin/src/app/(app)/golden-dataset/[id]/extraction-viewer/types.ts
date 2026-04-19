export interface FactSource {
  sectionId: string;
  sectionTitle: string;
  standardSection: string | null;
  text: string;
  isSynopsis: boolean;
}

export interface Fact {
  id: string;
  factKey: string;
  factCategory: string;
  description: string;
  value: string;
  manualValue: string | null;
  confidence: number;
  factClass: string;
  sources: FactSource[];
  hasContradiction: boolean;
  status: "extracted" | "verified" | "validated" | "deferred" | "not_found" | "rejected";
  deterministicValue: string | null;
  deterministicConfidence: number;
  llmValue: string | null;
  llmConfidence: number;
  qaValue: string | null;
  qaConfidence: number;
}

export type SortKey = "factKey" | "factCategory" | "confidence" | "status" | "value" | "hasContradiction";

export interface FilterState {
  status: "" | Fact["status"];
  category: string;
  hasContradiction: "" | "yes" | "no";
  hasValue: "" | "yes" | "no";
  confidenceRange: "" | "high" | "medium" | "low";
  levelAgreement: "" | "agree" | "disagree" | "qa_corrected";
}

export const EMPTY_FILTERS: FilterState = {
  status: "",
  category: "",
  hasContradiction: "",
  hasValue: "",
  confidenceRange: "",
  levelAgreement: "",
};
