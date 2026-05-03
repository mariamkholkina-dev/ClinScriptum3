export { parseDocx } from "./parser.js";
export { detectHeading } from "./heading-detector.js";
export { parseHtmlTable, isSOATable } from "./table-parser.js";
export { extractFootnotes } from "./footnote-extractor.js";
export {
  extractCellMarkers,
  extractFootnoteDefinitions,
  linkAnchorsToFootnotes,
} from "./cell-markers.js";
export { extractTableGeometry } from "./table-geometry.js";
export type { CellRect, TableGeometry } from "./table-geometry.js";
export type {
  CellMarkerExtraction,
  FootnoteDefinition,
  PendingAnchor,
  ResolvedFootnote,
  ResolvedAnchor,
  ResolvedFootnotes,
} from "./cell-markers.js";
export type {
  ParsedDocument,
  ParsedSection,
  ParsedContentBlock,
  ParsedTable,
  ParsedFootnote,
  SourceAnchor,
  ParserOptions,
} from "./types.js";
export { DEFAULT_PARSER_OPTIONS } from "./types.js";
