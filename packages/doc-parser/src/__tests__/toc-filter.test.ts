import { describe, it, expect } from "vitest";
import { filterTocChildren } from "../toc-filter.js";
import type { DetectedHeading } from "../heading-detector.js";

function h(text: string, level: number, paragraphIndex: number): DetectedHeading {
  return { text, level, method: "style", paragraphIndex };
}

describe("filterTocChildren", () => {
  it("drops TOC entries when all conditions met (digit tail + clean twin + empty section)", () => {
    const headings: DetectedHeading[] = [
      h("Содержание", 1, 0),
      h("1 Синопсис 13", 1, 1),
      h("2 Обоснование 33", 1, 2),
      h("Синопсис", 1, 50),
      h("Обоснование", 1, 100),
    ];
    // No paragraphs between TOC entries (empty sections); both real headings
    // have paragraphs of body text after them.
    const blocks = [60, 70, 110, 120];
    const result = filterTocChildren(headings, blocks);
    expect(result.map((x) => x.text)).toEqual(["Содержание", "Синопсис", "Обоснование"]);
  });

  it("works even when «Содержание» parent is missing — per-heading rule", () => {
    const headings: DetectedHeading[] = [
      h("1 Синопсис 13", 1, 0),
      h("2 Обоснование 33", 1, 1),
      h("Синопсис", 1, 50),
      h("Обоснование", 1, 100),
    ];
    const blocks = [60, 70, 110, 120];
    const result = filterTocChildren(headings, blocks);
    expect(result.map((x) => x.text)).toEqual(["Синопсис", "Обоснование"]);
  });

  it("partial drop: keeps page-numbered headings without a twin", () => {
    const headings: DetectedHeading[] = [
      h("Содержание", 1, 0),
      h("1 Синопсис 13", 1, 1),
      h("2 Обоснование 33", 1, 2),
      h("Синопсис", 1, 50),
    ];
    const blocks = [60];
    const result = filterTocChildren(headings, blocks);
    expect(result.map((x) => x.text)).toEqual([
      "Содержание",
      "2 Обоснование 33",
      "Синопсис",
    ]);
  });

  it("KEEPS heading whose section has body text — even if twin exists", () => {
    // «1 Синопсис 13» has a paragraph at index 5 between it and the next
    // heading at index 10. That means it is NOT a TOC entry — it's a real
    // heading that happens to have a digit at the end (or to share a title
    // with another section). Heuristic must NOT drop it.
    const headings: DetectedHeading[] = [
      h("1 Синопсис 13", 1, 1),
      h("Следующий раздел", 1, 10),
      h("Синопсис", 1, 50),
    ];
    const blocks = [5, 15, 60];
    const result = filterTocChildren(headings, blocks);
    expect(result).toEqual(headings);
  });

  it("does not drop a heading that does not end with a digit", () => {
    const headings: DetectedHeading[] = [
      h("Содержание", 1, 0),
      h("Раздел без номера страницы", 1, 1),
      h("Раздел без номера страницы", 1, 50),
    ];
    expect(filterTocChildren(headings, [])).toEqual(headings);
  });

  it("does not drop when only candidates have digit tails (no clean twin)", () => {
    const headings: DetectedHeading[] = [
      h("Глава 1 5", 1, 0),
      h("Глава 1 100", 1, 50),
    ];
    expect(filterTocChildren(headings, [])).toEqual(headings);
  });

  it("works with «Оглавление» variant", () => {
    const headings: DetectedHeading[] = [
      h("Оглавление", 1, 0),
      h("Введение 5", 1, 1),
      h("Введение", 1, 100),
    ];
    const blocks = [110];
    const result = filterTocChildren(headings, blocks);
    expect(result.map((x) => x.text)).toEqual(["Оглавление", "Введение"]);
  });

  it("works with English «Table of Contents»", () => {
    const headings: DetectedHeading[] = [
      h("Table of Contents", 1, 0),
      h("Introduction 5", 1, 1),
      h("Introduction", 1, 100),
    ];
    const blocks = [110];
    const result = filterTocChildren(headings, blocks);
    expect(result.map((x) => x.text)).toEqual(["Table of Contents", "Introduction"]);
  });

  it("returns headings unchanged when no TOC duplicates present", () => {
    const headings: DetectedHeading[] = [
      h("Введение", 1, 0),
      h("Глава 1", 1, 10),
      h("Глава 2", 1, 20),
    ];
    expect(filterTocChildren(headings, [])).toEqual(headings);
  });

  it("handles empty input", () => {
    expect(filterTocChildren([], [])).toEqual([]);
  });

  it("handles nested TOC entries with section numbering (1., 1.1.)", () => {
    const headings: DetectedHeading[] = [
      h("Содержание", 1, 0),
      h("1. Введение 5", 1, 1),
      h("1.1. Цель 6", 1, 2),
      h("1.2. Задачи 7", 1, 3),
      h("Введение", 1, 100),
      h("Цель", 2, 110),
      h("Задачи", 2, 120),
    ];
    // Real sections have body text, TOC entries do not.
    const blocks = [105, 115, 125];
    const result = filterTocChildren(headings, blocks);
    expect(result.map((x) => x.text)).toEqual(["Содержание", "Введение", "Цель", "Задачи"]);
  });

  it("handles TOC entries with dot leaders (……)", () => {
    const headings: DetectedHeading[] = [
      h("Содержание", 1, 0),
      h("Синопсис………5", 1, 1),
      h("Синопсис", 1, 100),
    ];
    const blocks = [110];
    const result = filterTocChildren(headings, blocks);
    expect(result.map((x) => x.text)).toEqual(["Содержание", "Синопсис"]);
  });

  it("does not mistake «Приложение А» (letter-tail) for a TOC entry", () => {
    const headings: DetectedHeading[] = [
      h("Содержание", 1, 0),
      h("Приложение А", 1, 1),
      h("Приложение", 1, 100),
    ];
    expect(filterTocChildren(headings, [])).toEqual(headings);
  });

  it("does not drop legitimate numbered titles like «Этап 2 (визит 4)»", () => {
    const headings: DetectedHeading[] = [
      h("Этап 2 (визит 4)", 1, 0),
      h("Этап 2", 1, 50),
    ];
    expect(filterTocChildren(headings, [])).toEqual(headings);
  });

  it("ignores headings where digit is not at the very end (mid-string number)", () => {
    const headings: DetectedHeading[] = [
      h("Глава 5 продолжение", 1, 0),
      h("Глава 5 продолжение", 1, 50),
    ];
    expect(filterTocChildren(headings, [])).toEqual(headings);
  });

  it("backwards-compat: works without blockParagraphIndices arg (treats all as empty)", () => {
    // When called with no blocks, every section is considered empty —
    // so the rule degrades to v1 behaviour (digit tail + clean twin).
    const headings: DetectedHeading[] = [
      h("1 Синопсис 13", 1, 0),
      h("Синопсис", 1, 50),
    ];
    const result = filterTocChildren(headings);
    expect(result.map((x) => x.text)).toEqual(["Синопсис"]);
  });

  it("KEEPS isolated empty heading with digit-tail when both neighbours have content", () => {
    // «Раздел 5» has empty section AND a twin «Раздел» — but its previous
    // and next neighbours are both real sections WITH body text. So this is
    // not a TOC block — it's a one-off empty heading. Heuristic must NOT drop.
    const headings: DetectedHeading[] = [
      h("Введение", 1, 0),
      h("Раздел 5", 1, 10),
      h("Заключение", 1, 20),
      h("Раздел", 1, 50),
    ];
    const blocks = [5, 15, 25, 55];  // each real section has content
    const result = filterTocChildren(headings, blocks);
    expect(result).toEqual(headings);
  });

  it("DROPS first TOC entry where prev is «Содержание» (TOC parent)", () => {
    // Boundary case: first TOC entry. Its previous heading is «Содержание»
    // itself — that counts as TOC-block boundary, so drop is allowed.
    const headings: DetectedHeading[] = [
      h("Содержание", 1, 0),
      h("1 Синопсис 13", 1, 1),
      // Next entry has body text (real section)
      h("Введение", 1, 10),
      h("Синопсис", 1, 50),
    ];
    const blocks = [15, 55];  // body of «Введение» and «Синопсис»
    const result = filterTocChildren(headings, blocks);
    expect(result.map((x) => x.text)).toEqual(["Содержание", "Введение", "Синопсис"]);
  });

  it("DROPS last TOC entry in a block (next has body text)", () => {
    const headings: DetectedHeading[] = [
      h("1 Синопсис 13", 1, 0),
      h("2 Обоснование 33", 1, 1),
      h("Синопсис", 1, 10),
      h("Обоснование", 1, 50),
    ];
    const blocks = [15, 55];
    const result = filterTocChildren(headings, blocks);
    expect(result.map((x) => x.text)).toEqual(["Синопсис", "Обоснование"]);
  });

  it("KEEPS pair when page numbers go BACKWARDS (not a real TOC)", () => {
    // Two empty headings that look like TOC entries (digit tail + twin),
    // but page numbers decrease (33 → 5) — so they aren't actually a TOC
    // block, just two unrelated headings. Heuristic must NOT drop.
    const headings: DetectedHeading[] = [
      h("Раздел 33", 1, 0),
      h("Раздел 5", 1, 1),
      h("Раздел", 1, 50),
    ];
    const blocks = [55];
    const result = filterTocChildren(headings, blocks);
    expect(result).toEqual(headings);
  });

  it("DROPS TOC entries with non-decreasing pages (5, 5, 6, 7)", () => {
    // Repeated pages are OK — common when several short subsections fit on one page.
    const headings: DetectedHeading[] = [
      h("Содержание", 1, 0),
      h("A 5", 1, 1),
      h("B 5", 1, 2),
      h("C 6", 1, 3),
      h("D 7", 1, 4),
      h("A", 1, 50),
      h("B", 1, 60),
      h("C", 1, 70),
      h("D", 1, 80),
    ];
    const blocks = [55, 65, 75, 85];
    const result = filterTocChildren(headings, blocks);
    expect(result.map((x) => x.text)).toEqual(["Содержание", "A", "B", "C", "D"]);
  });

  it("KEEPS entries where neighbour pages break monotonicity", () => {
    // Three candidates: «A 5», «B 100», «C 6».
    // - «A 5»: prev=«Содержание» (TOC parent ok), next=«B 100», 5≤100 → drop.
    // - «B 100»: next=«C 6», 100→6 decreases → break monotonicity → keep.
    // - «C 6»: prev=«B 100», 100>6 decreases → break monotonicity → keep.
    const headings: DetectedHeading[] = [
      h("Содержание", 1, 0),
      h("A 5", 1, 1),
      h("B 100", 1, 2),
      h("C 6", 1, 3),
      h("A", 1, 50),
      h("B", 1, 60),
      h("C", 1, 70),
    ];
    const blocks = [55, 65, 75];
    const result = filterTocChildren(headings, blocks);
    expect(result.map((x) => x.text)).toEqual([
      "Содержание",
      "B 100",
      "C 6",
      "A",
      "B",
      "C",
    ]);
  });
});
