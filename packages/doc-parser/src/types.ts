import type { Drawing } from "./drawing-parser.js";
import type { TableGeometry } from "./table-geometry.js";

export interface ParsedDocument {
  title: string;
  sections: ParsedSection[];
  synopsis: ParsedSection | null;
  soaTable: ParsedTable | null;
  footnotes: ParsedFootnote[];
  /**
   * Graphic shapes (arrows, lines, brackets, images) extracted from
   * `word/document.xml`. Empty when the parser is invoked without a
   * DOCX buffer (e.g. unit tests on plain HTML). Used by SoA detection
   * to find cells that are marked by an overlaying arrow rather than
   * a text X.
   */
  drawings: Drawing[];
  /**
   * EMU geometry of every top-level `<w:tbl>` in document order. Used
   * by `mapDrawingsToCells` to decide which drawings overlay which
   * cells. Empty when the parser was called without a DOCX buffer.
   */
  tableGeometries: TableGeometry[];
  /**
   * Bodies of `<w:footnote w:id="N">` from `word/footnotes.xml`,
   * indexed by `id`. Empty when the file is missing or the parser
   * was called without a DOCX buffer.
   */
  wordFootnotes: Record<string, string>;
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
