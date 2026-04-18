export interface Section {
  id: string;
  docVersionId: string;
  title: string;
  standardSection: string | null;
  level: number;
  order: number;
  structureStatus: SectionStatus;
  classificationStatus: SectionStatus;
  sourceAnchor: import("./document.js").SourceAnchor;
  content: ContentBlock[];
}

export type SectionStatus = "validated" | "not_validated" | "requires_rework";

export interface ContentBlock {
  id: string;
  sectionId: string;
  type: ContentBlockType;
  content: string;
  rawHtml?: string;
  order: number;
  sourceAnchor: import("./document.js").SourceAnchor;
}

export type ContentBlockType = "paragraph" | "table" | "table_cell" | "footnote" | "list" | "image";
