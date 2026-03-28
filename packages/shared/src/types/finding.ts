export interface Finding {
  id: string;
  docVersionId: string;
  type: FindingType;
  description: string;
  suggestion: string | null;
  sourceRef: import("./document.js").SourceAnchor;
  status: FindingStatus;
  extraAttributes: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export type FindingType = "editorial" | "semantic";

export type FindingStatus = "pending" | "confirmed" | "rejected" | "resolved";
