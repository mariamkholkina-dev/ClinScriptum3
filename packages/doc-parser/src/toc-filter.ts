/**
 * Detects TOC (table of contents) entries in the heading list and drops them.
 *
 * Per-heading drop rule (all three must hold):
 *  1. Heading text ends with a digit / dot-leader sequence (looks like a page number).
 *  2. There exists another heading elsewhere whose normalized text matches —
 *     i.e. same title without the leading section number and trailing page
 *     number (the «twin» — the real section in the document body).
 *  3. The twin itself does NOT end with a digit. This guarantees we are
 *     keeping the clean version (real heading) and dropping the page-numbered
 *     version (TOC reference). If both candidates end with digits — neither
 *     is dropped (ambiguous — could be «Приложение 1» / «Приложение 1 5»
 *     where both might be real).
 *
 * Why per-heading rather than per-TOC-block: in real DOCX protocols the
 * «Содержание» parent is often missing or detected at the same level as its
 * page-numbered children (numbered-detection sees «1 синопсис 13» as a
 * top-level heading, not a child of «Содержание»). A pure parent/child rule
 * misses these — the page-numbered duplicates show up as siblings, not as
 * descendants of the TOC heading.
 *
 * The twin-without-digit guard prevents false positives on legitimate
 * numbered titles like «Приложение А» (no digit tail), «Этап 2 (визит 4)»
 * (digit not at the end), or sections that legitimately repeat in the
 * document where neither is a TOC reference.
 */

import type { DetectedHeading } from "./heading-detector.js";

const PAGE_NUMBER_TAIL_RE = /[\s.…]+\d{1,4}\s*$/;
const SECTION_NUMBER_PREFIX_RE = /^\d+(\.\d+)*\.?\s+/;

function normalizeForTwinMatch(text: string): string {
  return text
    .replace(PAGE_NUMBER_TAIL_RE, "")
    .replace(SECTION_NUMBER_PREFIX_RE, "")
    .trim()
    .toLowerCase();
}

function endsWithPageNumber(text: string): boolean {
  return PAGE_NUMBER_TAIL_RE.test(text);
}

export function filterTocChildren(headings: DetectedHeading[]): DetectedHeading[] {
  if (headings.length === 0) return headings;

  const indicesToDrop = new Set<number>();

  for (let i = 0; i < headings.length; i++) {
    const candidate = headings[i];
    if (!endsWithPageNumber(candidate.text)) continue;

    const stripped = normalizeForTwinMatch(candidate.text);
    if (!stripped) continue;

    const twinExists = headings.some((other, otherIdx) => {
      if (otherIdx === i) return false;
      if (endsWithPageNumber(other.text)) return false;
      return normalizeForTwinMatch(other.text) === stripped;
    });

    if (twinExists) indicesToDrop.add(i);
  }

  if (indicesToDrop.size === 0) return headings;
  return headings.filter((_, i) => !indicesToDrop.has(i));
}
