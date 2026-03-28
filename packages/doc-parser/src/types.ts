export interface ParsedDocument {
  title: string;
  sections: ParsedSection[];
  metadata: Record<string, string>;
}

export interface ParsedSection {
  title: string;
  level: number;
  order: number;
  contentBlocks: ParsedContentBlock[];
  children: ParsedSection[];
  sourceAnchor: { paragraphIndex: number; textSnippet: string };
}

export interface ParsedContentBlock {
  type: "paragraph" | "table" | "table_cell" | "footnote" | "list" | "image";
  content: string;
  rawHtml?: string;
  order: number;
  sourceAnchor: { paragraphIndex: number; textSnippet: string };
}
