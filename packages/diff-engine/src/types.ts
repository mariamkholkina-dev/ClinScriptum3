export interface DiffResult {
  summary: DiffSummary;
  sectionDiffs: SectionDiff[];
  factChanges: FactChange[];
}

export interface DiffSummary {
  addedSections: number;
  removedSections: number;
  modifiedSections: number;
  unchangedSections: number;
  totalChanges: number;
}

export interface SectionDiff {
  standardSection: string | null;
  sectionTitle: string;
  changeType: "added" | "removed" | "modified" | "unchanged";
  oldContent?: string;
  newContent?: string;
  textChanges: TextChange[];
}

export interface TextChange {
  type: "add" | "remove" | "equal";
  value: string;
}

export interface FactChange {
  factKey: string;
  changeType: "added" | "removed" | "modified" | "unchanged";
  oldValue?: string;
  newValue?: string;
}

export interface ImpactAssessment {
  sourceDocument: { id: string; type: string; title: string };
  impactedDocument: { id: string; type: string; title: string };
  impacts: ImpactItem[];
}

export interface ImpactItem {
  changedSection: string;
  impactedSection: string;
  severity: "high" | "medium" | "low";
  description: string;
  requiresUpdate: boolean;
}
