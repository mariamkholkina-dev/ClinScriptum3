/**
 * Inline footnote-marker extraction inside SoA table cells and parsing
 * of the footnote-definition block that usually follows a SoA table
 * (e.g. "Примечание: 1 — до введения препарата...").
 *
 * Used by the SoA detection pipeline to attach footnote anchors to
 * cells/rows/columns. See plan: ~/.claude/plans/spicy-tinkering-pearl.md
 */

export interface CellMarkerExtraction {
  cleanText: string;
  markers: string[];
}

export interface FootnoteDefinition {
  marker: string;
  text: string;
}

export interface PendingAnchor {
  marker: string;
  targetType: "cell" | "row" | "col";
  rowIndex?: number;
  colIndex?: number;
}

export interface ResolvedFootnote {
  marker: string;
  markerOrder: number;
  text: string;
  source: "detected";
}

export interface ResolvedAnchor extends PendingAnchor {
  footnoteMarker: string;
  confidence: number;
}

export interface ResolvedFootnotes {
  footnotes: ResolvedFootnote[];
  anchors: ResolvedAnchor[];
}

const SUP_TAG_RE = /<sup\b[^>]*>([\s\S]*?)<\/sup>/gi;
const HTML_TAG_RE = /<[^>]+>/g;

const UNICODE_SUP_MAP: Record<string, string> = {
  "¹": "1",
  "²": "2",
  "³": "3",
  "⁰": "0",
  "⁴": "4",
  "⁵": "5",
  "⁶": "6",
  "⁷": "7",
  "⁸": "8",
  "⁹": "9",
};
const UNICODE_SUP_RE = /[²³¹⁰⁴-⁹]/g;

const SYMBOL_MARKER_RE = /[*†‡§¶#]/g;
const PAREN_NUMBER_RE = /\([^()]*?(\d{1,2})\s*\)/g;
const STANDALONE_NUMERIC_RE = /^(\d{1,2})[).,]?$/;
// Real protocols often write footnote refs as a digit appended to a
// positive/dash marker without `<sup>`: "X1", "X 1", "✓2", "(X) 3",
// "– 3". The digit is the footnote, NOT part of a value or name.
// We only fire on cells whose entire remaining text is `<marker> <digit>` —
// that protects "X 5mL" (unit suffix) and "Day 1" (non-marker prefix).
// Letter markers (X / Х / ✓ / ✔ / ☑ / ● / + / ×) and dashes both qualify.
const TRAILING_DIGIT_AFTER_MARKER_RE =
  /^(\([XхХ]\)|[XхХ✓✔☑●+×]|[–—-])\s*(\d{1,2})\s*$/i;

const ENTITY_MAP: Record<string, string> = {
  "&dagger;": "†",
  "&Dagger;": "‡",
  "&sect;": "§",
  "&para;": "¶",
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#42;": "*",
};

const MAX_FOOTNOTE_NUM = 30;

// Acceptable footnote markers in the *definitions* block: single symbol
// from the punctuation set, or 1–30. Multi-letter abbreviations (ТЗ,
// MFI-20) are intentionally excluded — they belong to the abbreviation
// glossary, not the footnotes.
const FOOTNOTE_DEF_RE =
  /^([*†‡§¶#]|\d{1,2})\s*[)\s.:\-–—]+\s*(.+)$/;

const LINE_SEPARATOR_RE = /<\/p>|<\/li>|<br\s*\/?>/gi;

function decodeEntities(s: string): string {
  return s.replace(/&[a-zA-Z]+;|&#\d+;/g, (m) => ENTITY_MAP[m] ?? m);
}

function stripHtmlTags(s: string): string {
  return s.replace(HTML_TAG_RE, "").replace(/\s+/g, " ").trim();
}

function pushMarkersFromSupContent(inner: string, markers: string[]): void {
  const text = decodeEntities(stripHtmlTags(inner));
  if (!text) return;
  const tokens = text.split(/[,\s]+/).filter(Boolean);
  for (const tok of tokens) {
    if (/^[*†‡§¶#]+$/.test(tok)) {
      for (const ch of tok) markers.push(ch);
    } else if (/^\d{1,2}[a-z]?$/i.test(tok)) {
      const num = parseInt(tok.replace(/[^0-9]/g, ""), 10);
      if (num >= 1 && num <= MAX_FOOTNOTE_NUM) markers.push(tok);
    } else if (/^[a-z]$/i.test(tok)) {
      markers.push(tok);
    } else {
      // Unknown token in <sup> — preserve as-is, normalised by trim.
      markers.push(tok);
    }
  }
}

export function extractCellMarkers(
  rawCellHtml: string | null | undefined,
): CellMarkerExtraction {
  if (!rawCellHtml) return { cleanText: "", markers: [] };

  const markers: string[] = [];
  let html = rawCellHtml;

  html = html.replace(SUP_TAG_RE, (_match, inner: string) => {
    pushMarkersFromSupContent(inner, markers);
    return "";
  });

  html = decodeEntities(html);
  let text = stripHtmlTags(html);

  text = text.replace(UNICODE_SUP_RE, (ch) => {
    markers.push(UNICODE_SUP_MAP[ch] ?? ch);
    return "";
  });

  text = text.replace(SYMBOL_MARKER_RE, (ch) => {
    markers.push(ch);
    return "";
  });

  text = text.replace(PAREN_NUMBER_RE, (full, num: string) => {
    const n = parseInt(num, 10);
    if (n >= 1 && n <= MAX_FOOTNOTE_NUM) {
      markers.push(num);
      return "";
    }
    return full;
  });

  // Trailing-digit-after-marker. Symbol markers are already gone after
  // SYMBOL_MARKER_RE above, so "X*1" / "X1*" both arrive here as "X1".
  {
    const t = text.replace(/\s+/g, " ").trim();
    const m = TRAILING_DIGIT_AFTER_MARKER_RE.exec(t);
    if (m) {
      const n = parseInt(m[2], 10);
      if (n >= 1 && n <= MAX_FOOTNOTE_NUM) {
        markers.push(m[2]);
        text = m[1];
      }
    }
  }

  const trimmed = text.replace(/\s+/g, " ").trim();
  const standalone = STANDALONE_NUMERIC_RE.exec(trimmed);
  if (standalone) {
    const n = parseInt(standalone[1], 10);
    if (n >= 1 && n <= MAX_FOOTNOTE_NUM) {
      markers.push(standalone[1]);
      text = "";
    }
  }

  return {
    cleanText: text.replace(/\s+/g, " ").trim(),
    markers,
  };
}

export function extractFootnoteDefinitions(
  htmlBlockAfterTable: string | null | undefined,
): FootnoteDefinition[] {
  if (!htmlBlockAfterTable) return [];

  const segments = htmlBlockAfterTable.split(LINE_SEPARATOR_RE);
  const definitions: FootnoteDefinition[] = [];
  const seen = new Set<string>();

  for (const segment of segments) {
    const line = decodeEntities(stripHtmlTags(segment)).trim();
    if (!line) continue;

    const match = FOOTNOTE_DEF_RE.exec(line);
    if (!match) continue;

    const marker = match[1];
    const body = match[2].trim();
    if (!body) continue;

    if (seen.has(marker)) {
      // Duplicate marker in the same definitions block — keep the first.
      // eslint-disable-next-line no-console
      console.warn(`[cell-markers] duplicate footnote marker '${marker}'`);
      continue;
    }
    seen.add(marker);
    definitions.push({ marker, text: body });
  }

  return definitions;
}

export function linkAnchorsToFootnotes(
  pendingAnchors: PendingAnchor[],
  definitions: FootnoteDefinition[],
): ResolvedFootnotes {
  const markerSet = new Set<string>();
  const footnotes: ResolvedFootnote[] = [];

  for (const def of definitions) {
    if (markerSet.has(def.marker)) continue;
    markerSet.add(def.marker);
    footnotes.push({
      marker: def.marker,
      markerOrder: footnotes.length,
      text: def.text,
      source: "detected",
    });
  }

  for (const anchor of pendingAnchors) {
    if (markerSet.has(anchor.marker)) continue;
    markerSet.add(anchor.marker);
    footnotes.push({
      marker: anchor.marker,
      markerOrder: footnotes.length,
      text: "",
      source: "detected",
    });
  }

  const anchors: ResolvedAnchor[] = pendingAnchors.map((a) => ({
    ...a,
    footnoteMarker: a.marker,
    confidence: 1.0,
  }));

  return { footnotes, anchors };
}
