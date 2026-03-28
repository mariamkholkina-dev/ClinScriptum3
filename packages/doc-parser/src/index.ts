export { parseDocx } from "./parser.js";
export { detectHeading } from "./heading-detector.js";
export { parseHtmlTable, isSOATable } from "./table-parser.js";
export { extractFootnotes } from "./footnote-extractor.js";
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
