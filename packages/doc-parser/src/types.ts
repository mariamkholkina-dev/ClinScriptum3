export interface ParsedDocument {
  title: string;
  sections: ParsedSection[];
  synopsis: ParsedSection | null;
  soaTable: ParsedTable | null;
  footnotes: ParsedFootnote[];
  metadata: Record<string, string>;
}

export interface ParsedSection {
  id: string;
  title: string;
  level: number;
  order: number;
  contentBlocks: ParsedContentBlock[];
  children: ParsedSection[];
  sourceAnchor: SourceAnchor;
}

export interface ParsedContentBlock {
  type: ContentBlockType;
  content: string;
  rawHtml?: string;
  order: number;
  sourceAnchor: SourceAnchor;
  tableAst?: TableAst;
}

export interface TableAst {
  headers: string[];
  rows: string[][];
  footnotes: string[];
}

export type ContentBlockType = "paragraph" | "table" | "table_cell" | "footnote" | "list" | "image";

export interface ParsedTable {
  headers: string[];
  rows: string[][];
  sourceAnchor: SourceAnchor;
  footnotes: string[];
}

export interface ParsedFootnote {
  id: string;
  marker: string;
  content: string;
  sourceAnchor: SourceAnchor;
}

export interface SourceAnchor {
  paragraphIndex: number;
  textSnippet: string;
  sectionPath?: string[];
}

export interface ParserOptions {
  maxHeadingDepth: number;
  detectSynopsis: boolean;
  detectSOA: boolean;
  ignoreHeadersFooters: boolean;
}

export const DEFAULT_PARSER_OPTIONS: ParserOptions = {
  maxHeadingDepth: 4,
  detectSynopsis: true,
  detectSOA: true,
  ignoreHeadersFooters: true,
};
