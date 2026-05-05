/**
 * Detects TOC (table of contents) entries in the heading list and drops them.
 *
 * Per-heading drop rule (all six must hold):
 *  1. Heading text ends with a digit / dot-leader sequence (looks like a page number).
 *  2. There exists another heading elsewhere whose normalized text matches —
 *     i.e. same title without the leading section number and trailing page
 *     number (the «twin» — the real section in the document body).
 *  3. The twin itself does NOT end with a digit. This guarantees we keep
 *     the clean version (real heading) and drop the page-numbered version
 *     (TOC reference). If both candidates end with digits — neither is
 *     dropped (ambiguous).
 *  4. The «section» under this heading is EMPTY — no content-block paragraphs
 *     between it and the next heading. TOC entries are pure references
 *     followed by another TOC entry, so the gap contains no body text. Real
 *     section titles always have at least one paragraph of content beneath
 *     them.
 *  5. At least one neighbour (previous or next heading) is also part of a
 *     TOC-block — meaning either:
 *       - it is the «Содержание / Оглавление / Table of Contents» heading itself,
 *       - or its own section is empty (i.e. another TOC entry next to us),
 *       - or it doesn't exist (we are at the array boundary).
 *     This ensures we only drop within a contiguous TOC block; an isolated
 *     empty heading with a digit-tail and a twin is kept.
 *  6. Page-number monotonicity: if a TOC neighbour exists with its own
 *     digit-tail, page numbers must be non-decreasing in the natural reading
 *     order (prevPage ≤ candidatePage ≤ nextPage). TOC entries reference
 *     pages in document order, so a decrease signals we are NOT inside a
 *     TOC block (probably two unrelated empty headings that happen to share
 *     normalized titles).
 *
 * Why per-heading rather than per-TOC-block: in real DOCX protocols the
 * «Содержание» parent is often missing or detected at the same level as its
 * page-numbered children (numbered-detection sees «1 синопсис 13» as a
 * top-level heading, not a child of «Содержание»). A pure parent/child rule
 * misses these — the page-numbered duplicates show up as siblings, not as
 * descendants of the TOC heading.
 */

import type { DetectedHeading } from "./heading-detector.js";

const PAGE_NUMBER_TAIL_RE = /[\s.…]+\d{1,4}\s*$/;
const SECTION_NUMBER_PREFIX_RE = /^\d+(\.\d+)*\.?\s+/;
const TOC_TITLE_RE = /^(содержани[ея]|оглавлени[ея]|table\s+of\s+contents|contents)\s*$/i;

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

function extractPageNumber(text: string): number | null {
  const match = text.match(/[\s.…]+(\d{1,4})\s*$/);
  return match ? parseInt(match[1], 10) : null;
}

function isTocTitle(heading: DetectedHeading): boolean {
  return TOC_TITLE_RE.test(heading.text.trim());
}

function sectionIsEmpty(
  heading: DetectedHeading,
  nextHeading: DetectedHeading | undefined,
  blockParagraphIndices: number[],
): boolean {
  return !blockParagraphIndices.some(
    (idx) =>
      idx > heading.paragraphIndex &&
      (!nextHeading || idx < nextHeading.paragraphIndex),
  );
}

export function filterTocChildren(
  headings: DetectedHeading[],
  blockParagraphIndices: number[] = [],
): DetectedHeading[] {
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
    if (!twinExists) continue;

    const isOwnSectionEmpty = sectionIsEmpty(
      candidate,
      headings[i + 1],
      blockParagraphIndices,
    );
    if (!isOwnSectionEmpty) continue;

    const prev = i > 0 ? headings[i - 1] : undefined;
    const next = i < headings.length - 1 ? headings[i + 1] : undefined;

    const prevIsTocBlock =
      !prev ||
      isTocTitle(prev) ||
      sectionIsEmpty(prev, candidate, blockParagraphIndices);

    const nextIsTocBlock =
      !next ||
      sectionIsEmpty(next, headings[i + 2], blockParagraphIndices);

    if (!prevIsTocBlock && !nextIsTocBlock) continue;

    const candidatePage = extractPageNumber(candidate.text);
    if (candidatePage === null) continue;

    // Monotonicity: prev TOC neighbour with own page must have page ≤ candidate.
    if (prev && endsWithPageNumber(prev.text)) {
      const prevPage = extractPageNumber(prev.text);
      if (prevPage !== null && prevPage > candidatePage) continue;
    }
    // And next TOC neighbour with own page must have page ≥ candidate.
    if (next && endsWithPageNumber(next.text)) {
      const nextPage = extractPageNumber(next.text);
      if (nextPage !== null && nextPage < candidatePage) continue;
    }

    indicesToDrop.add(i);
  }

  if (indicesToDrop.size === 0) return headings;
  return headings.filter((_, i) => !indicesToDrop.has(i));
}
