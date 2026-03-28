import type { ParsedFootnote, SourceAnchor } from "./types.js";

/**
 * Extracts footnotes from document content (URS-011).
 * Handles both Word's native footnote objects and text-based footnote references
 * (e.g., superscript numbers, *, †, ‡).
 */

const FOOTNOTE_MARKER_RE = /(?:^|\s)(\*|†|‡|§|¶|\d+)\s*[):.]/gm;
const SUPERSCRIPT_REF_RE = /\[(\d+)\]|<sup>(\d+)<\/sup>/g;

export function extractFootnotes(
  paragraphs: Array<{ text: string; index: number; isSuperscript?: boolean }>,
): ParsedFootnote[] {
  const footnotes: ParsedFootnote[] = [];
  let fnId = 0;

  for (const para of paragraphs) {
    const markerMatches = para.text.matchAll(FOOTNOTE_MARKER_RE);
    for (const match of markerMatches) {
      const marker = match[1];
      const contentStart = (match.index ?? 0) + match[0].length;
      const content = para.text.slice(contentStart).trim();
      if (content.length > 5) {
        footnotes.push({
          id: `fn-${++fnId}`,
          marker,
          content,
          sourceAnchor: {
            paragraphIndex: para.index,
            textSnippet: para.text.slice(0, 80),
          },
        });
      }
    }

    if (para.isSuperscript) {
      const refMatches = para.text.matchAll(SUPERSCRIPT_REF_RE);
      for (const match of refMatches) {
        const marker = match[1] ?? match[2];
        footnotes.push({
          id: `fn-ref-${++fnId}`,
          marker,
          content: `[Reference to footnote ${marker}]`,
          sourceAnchor: {
            paragraphIndex: para.index,
            textSnippet: para.text.slice(0, 80),
          },
        });
      }
    }
  }

  return footnotes;
}
