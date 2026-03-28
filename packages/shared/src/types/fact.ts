export interface Fact {
  id: string;
  docVersionId: string;
  factKey: string;
  value: string;
  factClass: FactClass;
  sources: FactSource[];
  hasContradiction: boolean;
  status: FactStatus;
}

export type FactClass = "general" | "phase_specific";

export type FactStatus = "extracted" | "verified" | "validated" | "rejected";

export interface FactSource {
  sectionId?: string;
  sourceAnchor: import("./document.js").SourceAnchor;
  extractedValue: string;
  method: "regex" | "llm";
}
