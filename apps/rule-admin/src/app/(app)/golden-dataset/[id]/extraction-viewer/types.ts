export interface FactSource {
  sectionId: string;
  sectionTitle: string;
  standardSection: string | null;
  text: string;
  isSynopsis: boolean;
}

export interface FactVariant {
  value: string;
  confidence: number;
  level: "deterministic" | "llm_check" | "llm_qa";
  sourceText: string;
  sectionTitle: string;
  sectionId?: string;
}

export type FactStatus = "extracted" | "verified" | "validated" | "deferred" | "not_found" | "rejected";

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
  status: FactStatus;
  deterministicValue: string | null;
  deterministicConfidence: number;
  llmValue: string | null;
  llmConfidence: number;
  qaValue: string | null;
  qaConfidence: number;
}

export interface GroupedFact {
  factKey: string;
  factCategory: string;
  description: string;
  valueType: string;
  deterministicValue: string | null;
  deterministicConfidence: number;
  llmValue: string | null;
  llmConfidence: number;
  qaValue: string | null;
  qaConfidence: number;
  finalValue: string | null;
  finalConfidence: number;
  manualValue: string | null;
  status: FactStatus;
  hasContradiction: boolean;
  isFromRegistry: boolean;
  factIds: string[];
  factClass: string;
  variants: FactVariant[];
  sources: FactSource[];
}

export type SortKey = "factKey" | "factCategory" | "confidence" | "status" | "value" | "hasContradiction";

export interface FilterState {
  status: "" | FactStatus;
  category: string;
  hasContradiction: "" | "yes" | "no";
  hasValue: "" | "yes" | "no";
  confidenceRange: "" | "high" | "medium" | "low";
  levelAgreement: "" | "all_agree" | "llm_qa_agree" | "det_ne_llm" | "qa_corrected";
}

export const EMPTY_FILTERS: FilterState = {
  status: "",
  category: "",
  hasContradiction: "",
  hasValue: "",
  confidenceRange: "",
  levelAgreement: "",
};
