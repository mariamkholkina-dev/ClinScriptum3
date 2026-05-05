import { describe, it, expect } from "vitest";
import { filterTocChildren } from "../toc-filter.js";
import type { DetectedHeading } from "../heading-detector.js";

function h(text: string, level: number, paragraphIndex: number): DetectedHeading {
  return { text, level, method: "style", paragraphIndex };
}

describe("filterTocChildren", () => {
  it("drops TOC entries when all conditions met (digit tail + clean twin)", () => {
    const headings: DetectedHeading[] = [
      h("Содержание", 1, 0),
      h("1 Синопсис 13", 1, 1),
      h("2 Обоснование 33", 1, 2),
      h("Синопсис", 1, 50),
      h("Обоснование", 1, 100),
    ];
    const result = filterTocChildren(headings);
    expect(result.map((x) => x.text)).toEqual(["Содержание", "Синопсис", "Обоснование"]);
  });

  it("works even when «Содержание» parent is missing — per-heading rule", () => {
    // No «Содержание» heading at all — but TOC duplicates still get dropped
    // because each has a clean twin in the document body.
    const headings: DetectedHeading[] = [
      h("1 Синопсис 13", 1, 0),
      h("2 Обоснование 33", 1, 1),
      h("Синопсис", 1, 50),
      h("Обоснование", 1, 100),
    ];
    const result = filterTocChildren(headings);
    expect(result.map((x) => x.text)).toEqual(["Синопсис", "Обоснование"]);
  });

  it("partial drop: keeps page-numbered headings without a twin", () => {
    const headings: DetectedHeading[] = [
      h("Содержание", 1, 0),
      h("1 Синопсис 13", 1, 1),
      h("2 Обоснование 33", 1, 2),
      h("Синопсис", 1, 50),
      // No twin for «Обоснование» → keep «2 Обоснование 33»
    ];
    const result = filterTocChildren(headings);
    expect(result.map((x) => x.text)).toEqual([
      "Содержание",
      "2 Обоснование 33",
      "Синопсис",
    ]);
  });

  it("does not drop a heading that does not end with a digit", () => {
    const headings: DetectedHeading[] = [
      h("Содержание", 1, 0),
      h("Раздел без номера страницы", 1, 1),
      h("Раздел без номера страницы", 1, 50),
    ];
    const result = filterTocChildren(headings);
    expect(result).toEqual(headings);
  });

  it("does not drop when only candidates have digit tails (no clean twin)", () => {
    // Both «Глава 1 5» and «Глава 1 100» end with digits — neither is a clean
    // twin for the other. Without a digit-free version we cannot tell which
    // one is the TOC reference, so both are kept.
    const headings: DetectedHeading[] = [
      h("Глава 1 5", 1, 0),
      h("Глава 1 100", 1, 50),
    ];
    const result = filterTocChildren(headings);
    expect(result).toEqual(headings);
  });

  it("works with «Оглавление» variant", () => {
    const headings: DetectedHeading[] = [
      h("Оглавление", 1, 0),
      h("Введение 5", 1, 1),
      h("Введение", 1, 100),
    ];
    const result = filterTocChildren(headings);
    expect(result.map((x) => x.text)).toEqual(["Оглавление", "Введение"]);
  });

  it("works with English «Table of Contents»", () => {
    const headings: DetectedHeading[] = [
      h("Table of Contents", 1, 0),
      h("Introduction 5", 1, 1),
      h("Introduction", 1, 100),
    ];
    const result = filterTocChildren(headings);
    expect(result.map((x) => x.text)).toEqual(["Table of Contents", "Introduction"]);
  });

  it("returns headings unchanged when no TOC duplicates present", () => {
    const headings: DetectedHeading[] = [
      h("Введение", 1, 0),
      h("Глава 1", 1, 10),
      h("Глава 2", 1, 20),
    ];
    expect(filterTocChildren(headings)).toEqual(headings);
  });

  it("handles empty input", () => {
    expect(filterTocChildren([])).toEqual([]);
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
    const result = filterTocChildren(headings);
    expect(result.map((x) => x.text)).toEqual(["Содержание", "Введение", "Цель", "Задачи"]);
  });

  it("handles TOC entries with dot leaders (……)", () => {
    const headings: DetectedHeading[] = [
      h("Содержание", 1, 0),
      h("Синопсис………5", 1, 1),
      h("Синопсис", 1, 100),
    ];
    const result = filterTocChildren(headings);
    expect(result.map((x) => x.text)).toEqual(["Содержание", "Синопсис"]);
  });

  it("does not mistake «Приложение А» (letter-tail) for a TOC entry", () => {
    const headings: DetectedHeading[] = [
      h("Содержание", 1, 0),
      h("Приложение А", 1, 1),
      h("Приложение", 1, 100),
    ];
    const result = filterTocChildren(headings);
    expect(result).toEqual(headings);
  });

  it("does not drop legitimate numbered titles like «Этап 2 (визит 4)»", () => {
    // The digit «4» is followed by a closing paren, not a tail-of-line digit.
    const headings: DetectedHeading[] = [
      h("Этап 2 (визит 4)", 1, 0),
      h("Этап 2", 1, 50),
    ];
    const result = filterTocChildren(headings);
    expect(result).toEqual(headings);
  });

  it("ignores headings where digit is not at the very end (mid-string number)", () => {
    const headings: DetectedHeading[] = [
      h("Глава 5 продолжение", 1, 0),
      h("Глава 5 продолжение", 1, 50),
    ];
    expect(filterTocChildren(headings)).toEqual(headings);
  });
});
