/**
 * Detects TOC (table of contents) blocks in detected headings and drops
 * their children — TOC entries are not real document sections, they are
 * page-number references rendered with heading styles.
 *
 * Heuristic (all three must hold per TOC parent):
 *  1. Parent heading title matches «Содержание / Оглавление / Table of Contents / Contents».
 *  2. ALL its direct descendants end with a digit (looks like page number).
 *  3. For EACH such descendant, an identical title-twin (same text minus the
 *     trailing page number) exists elsewhere in the heading list — proving the
 *     TOC entry references a real section, so the digit is a page reference.
 *
 * If any condition fails — leave the TOC block untouched (false-positive guard).
 */

import type { DetectedHeading } from "./heading-detector.js";

const TOC_TITLE_RE = /^(содержани[ея]|оглавлени[ея]|table\s+of\s+contents|contents)\s*$/i;
const PAGE_NUMBER_TAIL_RE = /[\s.…]+\d{1,4}\s*$/;
const SECTION_NUMBER_PREFIX_RE = /^\d+(\.\d+)*\.?\s+/;

function normalizeForTwinMatch(text: string): string {
  return text
    .replace(PAGE_NUMBER_TAIL_RE, "")
    .replace(SECTION_NUMBER_PREFIX_RE, "")
    .trim()
    .toLowerCase();
}

export function filterTocChildren(headings: DetectedHeading[]): DetectedHeading[] {
  if (headings.length === 0) return headings;

  const indicesToDrop = new Set<number>();

  for (let tocIdx = 0; tocIdx < headings.length; tocIdx++) {
    const tocHeading = headings[tocIdx];
    if (!TOC_TITLE_RE.test(tocHeading.text.trim())) continue;

    const childIndices: number[] = [];
    for (let j = tocIdx + 1; j < headings.length; j++) {
      if (headings[j].level <= tocHeading.level) break;
      childIndices.push(j);
    }

    if (childIndices.length === 0) continue;

    const allEndWithDigit = childIndices.every((idx) =>
      PAGE_NUMBER_TAIL_RE.test(headings[idx].text)
    );
    if (!allEndWithDigit) continue;

    const allHaveTwin = childIndices.every((childIdx) => {
      const stripped = normalizeForTwinMatch(headings[childIdx].text);
      if (!stripped) return false;
      return headings.some((other, otherIdx) => {
        if (otherIdx === childIdx) return false;
        if (childIndices.includes(otherIdx)) return false;
        return normalizeForTwinMatch(other.text) === stripped;
      });
    });
    if (!allHaveTwin) continue;

    for (const idx of childIndices) indicesToDrop.add(idx);
  }

  if (indicesToDrop.size === 0) return headings;
  return headings.filter((_, i) => !indicesToDrop.has(i));
}
