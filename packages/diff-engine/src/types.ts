export interface DiffResult {
  added: SectionDiff[];
  removed: SectionDiff[];
  modified: SectionDiff[];
}

export interface SectionDiff {
  sectionTitle: string;
  oldContent?: string;
  newContent?: string;
  changes: Array<{ type: "add" | "remove" | "modify"; text: string }>;
}
